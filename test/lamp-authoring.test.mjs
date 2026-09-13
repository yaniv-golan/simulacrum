import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint, validateBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { compileBody } from '../src/model/compile-body.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { createSession } from '../src/simulation/session.mjs';
test('lamp settings preserve material and survive history save and reusable copying', async () => {
  const w = await createWorkshop();
  try {
    assert.equal(
      (await w.act({ type: 'place', partType: 'poweredLamp', id: 'lamp', position: [0, 1, 0] })).ok,
      true,
    );
    for (const [key, value] of [
      ['color', 0xff3300],
      ['brightness', 0.3],
      ['beamSpread', 0.8],
    ])
      assert.equal((await w.act({ type: 'parameter', id: 'lamp', key, value })).ok, true);
    const bp = w.observe().frames[0].metadata.blueprint;
    await w.act({ type: 'undo' });
    assert.notEqual(w.observe().frames[0].metadata.blueprint.parts[0].parameters.beamSpread, 0.8);
    await w.act({ type: 'redo' });
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, bp);
    assert.equal((await w.act({ type: 'load', save: JSON.stringify(bp) })).ok, true);
    const { definition } = captureAssembly(bp, { name: 'Lamp', ids: ['lamp'], ports: [] });
    const copied = insertAssembly(bp, definition, [2, 1, 0], [0, 0, 0, 1]).blueprint.parts.at(-1);
    assert.deepEqual(copied.parameters, bp.parts[0].parameters);
    assert.deepEqual(copied.authoredMaterial, bp.parts[0].authoredMaterial);
    const renamed = structuredClone(bp.parts[0]);
    renamed.id = 'other';
    renamed.name = 'Motor';
    assert.deepEqual(compileBody(renamed), compileBody(bp.parts[0]));
    const mass = compileBody(renamed).mass;
    renamed.authoredMaterial.body = 'steel';
    assert.ok(compileBody(renamed).mass > mass * 2);
    assert.equal(renamed.parameters.color, 0xff3300);
  } finally {
    w.dispose();
  }
});
test('ninth lamp admission rejects before history changes', async () => {
  const bp = createEmptyBlueprint('lamps', 'Lamps');
  bp.parts = Array.from({ length: 8 }, (_, i) => createPart('poweredLamp', `l${i}`, [i, 1, 0]));
  assert.equal(validateBlueprint(bp).ok, true);
  const w = await createWorkshop();
  try {
    assert.equal((await w.act({ type: 'load', save: JSON.stringify(bp) })).ok, true);
    const before = w.observe().frames[0];
    assert.equal(
      (await w.act({ type: 'place', partType: 'poweredLamp', id: 'ninth', position: [9, 1, 0] }))
        .ok,
      false,
    );
    assert.deepEqual(w.observe().frames[0], before);
  } finally {
    w.dispose();
  }
});
test('lamp completed session output restores atomically and continues deterministically', async () => {
  const bp = createEmptyBlueprint('lamps', 'Lamps');
  bp.parts = [
    createPart('powerCell', 'cell', [-1, 1, 0]),
    createPart('poweredLamp', 'lamp', [0, 1, 0]),
  ];
  bp.connections = [
    {
      id: 'wire',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'lamp', port: 'power' },
    },
  ];
  const { configuration } = compileAssembly(bp);
  const s = await createSession(configuration);
  try {
    s.step(4);
    const cp = s.checkpoint();
    assert.ok(s.observe().frames[0].power.lamps[0].luminousFluxLm > 0);
    s.step(8);
    const next = s.observe().frames[0];
    s.restore(cp);
    s.step(8);
    assert.deepEqual(s.observe().frames[0].power, next.power);
    assert.deepEqual(s.observe().frames[0].physics, next.physics);
    const bad = structuredClone(cp);
    bad.power.lamps[0].luminousFluxLm++;
    const before = s.checkpoint();
    assert.throws(() => s.restore(bad));
    assert.deepEqual(s.checkpoint(), before);
  } finally {
    s.dispose();
  }
});
test('ordinary controller flashing yields to manual input and Build restart restores default', async () => {
  const { emptyControllerProgram, editControllerDraft } = await import(
    '../src/model/controller-authoring.mjs'
  );
  const bp = createEmptyBlueprint('controlled-lamp', 'Controlled lamp');
  bp.parts = ['powerCell', 'poweredLamp', 'commandReceiver', 'logicController'].map((type, i) =>
    createPart(type, `p${i}`, [i, 1, 0]),
  );
  bp.connections = [
    {
      id: 'power',
      kind: 'power',
      a: { part: 'p0', port: 'power' },
      b: { part: 'p1', port: 'power' },
    },
    {
      id: 'signal',
      kind: 'signal',
      a: { part: 'p2', port: 'signal' },
      b: { part: 'p1', port: 'signal' },
    },
    {
      id: 'program',
      kind: 'signal',
      a: { part: 'p3', port: 'out1' },
      b: { part: 'p2', port: 'command' },
    },
  ];
  const w = await createWorkshop(bp);
  try {
    const program = editControllerDraft(emptyControllerProgram(), {
      type: 'code',
      source: 'let on=0; function tick(){ on=1-on; write("out1",on); }',
    });
    assert.equal((await w.act({ type: 'install-controller-program', id: 'p3', program })).ok, true);
    await w.act({ type: 'run' });
    w.step(1);
    assert.equal(w.observe().frames[0].power.lamps[0].deliveredW, 0);
    await w.act({ type: 'control-mode', id: 'p2', mode: 'automatic' });
    w.step(1);
    const a = w.observe().frames[0].power.lamps[0].deliveredW;
    w.step(1);
    const b = w.observe().frames[0].power.lamps[0].deliveredW;
    assert.ok((a === 0 && b > 0) || (b === 0 && a > 0));
    await w.act({ type: 'control', id: 'p2', duty: 0.5 });
    w.step(2);
    assert.equal(w.observe().frames[0].power.lamps[0].requestedW, 5);
    await w.act({ type: 'control-mode', id: 'p2', mode: 'off' });
    w.step(1);
    assert.equal(w.observe().frames[0].power.lamps[0].deliveredW, 0);
    await w.act({ type: 'build' });
    assert.equal(w.observe().frames[0].power.lamps[0].luminousFluxLm, 0);
    assert.equal((await w.act({ type: 'disconnect', id: 'signal' })).ok, true);
    await w.act({ type: 'run' });
    w.step(1);
    assert.ok(w.observe().frames[0].power.lamps[0].deliveredW > 9);
  } finally {
    w.dispose();
  }
});
test('lamp trace matches four fresh processes and both production clocks', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const runs = await Promise.all(
    ['step', 'step', 'elapsed', 'elapsed'].map(async (driver) =>
      JSON.parse(
        (
          await promisify(execFile)(
            process.execPath,
            [fileURLToPath(new URL('./fixtures/lamp-run.mjs', import.meta.url)), driver],
            { timeout: 30000 },
          )
        ).stdout,
      ),
    ),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const r of runs) {
    assert.equal(r.hashes.length, 120);
    assert.ok(r.energy > 0);
    assert.deepEqual(r.hashes, runs[0].hashes);
  }
  const wrong = structuredClone(runs[0].hashes);
  wrong[20].hash = 'wrong';
  assert.notDeepEqual(wrong, runs[0].hashes);
});
test('forged lamp checkpoint cannot invent powered output behind an off receiver', async () => {
  const bp = createEmptyBlueprint('lamp-restore', 'Lamp restore');
  bp.parts = ['powerCell', 'poweredLamp', 'commandReceiver'].map((t, i) =>
    createPart(t, `p${i}`, [i, 1, 0]),
  );
  bp.connections = [
    { id: 'p', kind: 'power', a: { part: 'p0', port: 'power' }, b: { part: 'p1', port: 'power' } },
    {
      id: 's',
      kind: 'signal',
      a: { part: 'p2', port: 'signal' },
      b: { part: 'p1', port: 'signal' },
    },
  ];
  const s = await createSession(compileAssembly(bp).configuration);
  try {
    s.step(1);
    const cp = s.checkpoint();
    Object.assign(cp.power.lamps[0], {
      command: 1,
      requestedW: 10,
      deliveredW: 10,
      current: 10 / 24,
      voltage: 24,
      luminousFluxLm: 1000,
      deliveredEnergyJ: 1,
      reasonCode: 'OK',
    });
    const before = s.checkpoint();
    assert.throws(() => s.restore(cp));
    assert.deepEqual(s.checkpoint(), before);
  } finally {
    s.dispose();
  }
});

test('lamp limit is atomic through copied parts, persisted library insertion and loading', async () => {
  const { createAssemblyLibrary } = await import('../src/application/assembly-library.mjs');
  const { assertRejectedEditUnchanged } = await import('./contracts/editing.mjs');
  const blueprint = (count) => {
    const bp = createEmptyBlueprint('limits', 'Limits');
    bp.parts = Array.from({ length: count }, (_, i) =>
      createPart('poweredLamp', `l${i}`, [i, 1, 0]),
    );
    return bp;
  };
  const source = blueprint(2);
  Object.assign(source.parts[0].parameters, { color: 0xff3300, brightness: 0.3, beamSpread: 0.8 });
  source.parts[0].authoredMaterial.body = 'steel';
  const one = captureAssembly(source, { name: 'Lamp', ids: ['l0'], ports: [] }).definition;
  const two = captureAssembly(source, { name: 'Pair', ids: ['l0', 'l1'], ports: [] }).definition;
  const values = new Map(),
    storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  createAssemblyLibrary(storage).add(one);
  const library = createAssemblyLibrary(storage);
  const restored = library.list()[0].definition;
  assert.deepEqual(restored.parts[0].parameters, one.parts[0].parameters);
  const insert = (definition) => ({
    type: 'insert-assembly',
    definition,
    position: [12, 1, 0],
    rotation: [0, 0, 0, 1],
  });
  const w = await createWorkshop(blueprint(7));
  try {
    await assertRejectedEditUnchanged(w, insert(two));
    assert.equal((await w.act(insert(restored))).ok, true);
    const eight = w.save();
    assert.equal(eight.parts.length, 8);
    assert.deepEqual(eight.parts.at(-1).authoredMaterial, one.parts[0].authoredMaterial);
    assert.deepEqual(eight.parts.at(-1).parameters, one.parts[0].parameters);
    await w.act({ type: 'undo' });
    assert.equal(w.save().parts.length, 7);
    await assertRejectedEditUnchanged(w, insert(two));
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.deepEqual(w.save(), eight);
    await assertRejectedEditUnchanged(w, insert(restored));
    await assertRejectedEditUnchanged(w, {
      type: 'insert',
      part: { ...structuredClone(one.parts[0]), id: 'copy' },
    });
    await assertRejectedEditUnchanged(w, { type: 'load', save: JSON.stringify(blueprint(9)) });
    assert.equal((await w.act({ type: 'load', save: JSON.stringify(eight) })).ok, true);
    assert.deepEqual(w.save(), eight);
    const invalid = structuredClone(one);
    invalid.parts = blueprint(9).parts;
    invalid.assemblies[0].ids = invalid.parts.map((p) => p.id);
    const before = [...values];
    assert.throws(() => library.add(invalid));
    assert.deepEqual([...values], before);
  } finally {
    w.dispose();
  }
});

test('paused lamp retains completed output and restart resets its energy ledger', async () => {
  const bp = createEmptyBlueprint('lifecycle', 'Lifecycle');
  bp.parts = [
    createPart('powerCell', 'cell', [0, 1, 0]),
    createPart('poweredLamp', 'lamp', [1, 1, 0]),
  ];
  bp.connections = [
    {
      id: 'wire',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'lamp', port: 'power' },
    },
  ];
  const w = await createWorkshop(bp);
  try {
    const initial = structuredClone(w.observe().frames[0].power);
    await w.act({ type: 'run' });
    w.step(12);
    const powered = structuredClone(w.observe().frames[0]);
    assert.ok(powered.power.lamps[0].deliveredEnergyJ > 0);
    assert.ok(powered.power.cells[0].energyJ < initial.cells[0].energyJ);
    await w.act({ type: 'pause' });
    const paused = w.observe().frames[0];
    assert.equal(paused.tick, powered.tick);
    assert.deepEqual(paused.power, powered.power);
    assert.deepEqual(paused.physics, powered.physics);
    await w.act({ type: 'build' });
    assert.deepEqual(w.observe().frames[0].power, initial);
    await w.act({ type: 'run' });
    assert.deepEqual(w.observe().frames[0].power, initial);
    w.step(1);
    assert.ok(w.observe().frames[0].power.lamps[0].luminousFluxLm > 990);
  } finally {
    w.dispose();
  }
});

test('serialized lamp failure replays actual inputs and rejects wrong traces and outputs', async () => {
  const { replayBundle } = await import('../scripts/replay.mjs');
  const bp = createEmptyBlueprint('replay-lamp', 'Replay lamp');
  bp.parts = ['powerCell', 'poweredLamp', 'commandReceiver'].map((t, i) =>
    createPart(t, `p${i}`, [i, 1, 0]),
  );
  Object.assign(bp.parts[1].parameters, { brightness: 0.4, color: 0xff3300, beamSpread: 0.8 });
  bp.connections = [
    { id: 'p', kind: 'power', a: { part: 'p0', port: 'power' }, b: { part: 'p1', port: 'power' } },
    {
      id: 's',
      kind: 'signal',
      a: { part: 'p2', port: 'signal' },
      b: { part: 'p1', port: 'signal' },
    },
  ];
  const s = await createSession(compileAssembly(bp).configuration);
  try {
    for (const duty of [0.5, 0, 1]) {
      assert.equal(s.act({ type: 'receiver', node: 2, duty }).ok, true);
      s.step(3);
    }
    assert.equal(s.act({ type: 'impulse', body: 0, value: [1e200, 0, 0] }).ok, true);
    assert.throws(() => s.step());
    const bundle = JSON.parse(JSON.stringify(s.failureBundle()));
    assert.ok(bundle.completed.power.lamps[0].luminousFluxLm > 0);
    assert.ok(bundle.completed.power.lamps[0].deliveredEnergyJ > 0);
    const result = await replayBundle(bundle);
    assert.equal(result.matched, true);
    assert.equal(result.failedTick, bundle.failedTick);
    assert.deepEqual(result.identity, bundle.identity);
    for (const corrupt of [
      (b) => {
        b.inputs.find((x) => x.command.type === 'receiver').command.duty = 0;
      },
      (b) => {
        b.completed.power.lamps[0].luminousFluxLm++;
      },
      (b) => {
        b.inputs.find((x) => x.command.type === 'impulse').command.value = [0, 0, 0];
      },
    ]) {
      const wrong = structuredClone(bundle);
      corrupt(wrong);
      await assert.rejects(replayBundle(wrong));
    }
  } finally {
    s.dispose();
  }
});

test('restore rejects lamp output that violates source droop and preserves the session', async () => {
  for (const withMotor of [false, true]) {
    const bp = createEmptyBlueprint('lamp-droop', 'Lamp droop');
    bp.parts = [
      createPart('powerCell', 'cell', [0, 1, 0]),
      createPart('poweredLamp', 'lamp', [1, 1, 0]),
    ];
    bp.parts[0].parameters.internalResistance = 100;
    bp.connections = [
      {
        id: 'wire',
        kind: 'power',
        a: { part: 'cell', port: 'power' },
        b: { part: 'lamp', port: 'power' },
      },
    ];
    if (withMotor) {
      bp.parts.push(createPart('poweredMotor', 'motor', [2, 1, 0]));
      bp.connections.push({
        id: 'motor-power',
        kind: 'power',
        a: { part: 'cell', port: 'power' },
        b: { part: 'motor', port: 'power' },
      });
    }
    const s = await createSession(compileAssembly(bp).configuration);
    try {
      s.step(1);
      const genuine = s.checkpoint();
      assert.ok(genuine.power.lamps[0].deliveredW > 0 && genuine.power.lamps[0].deliveredW < 2);
      s.restore(JSON.parse(JSON.stringify(genuine)));
      s.step(2);
      const continuation = s.observe().frames[0].power;
      s.restore(genuine);
      s.step(2);
      assert.deepEqual(s.observe().frames[0].power, continuation);
      const before = s.checkpoint(),
        observation = s.observe();
      for (const reading of [
        { deliveredW: 10, current: 10 / 24, voltage: 24, luminousFluxLm: 1000, reasonCode: 'OK' },
        { deliveredW: 0, current: 0, voltage: 24, luminousFluxLm: 0, reasonCode: 'LIMITED' },
        {
          deliveredW: 1.44,
          current: 0.12,
          voltage: 12,
          luminousFluxLm: 144,
          reasonCode: 'LIMITED',
        },
      ]) {
        const forged = structuredClone(genuine);
        Object.assign(forged.power.lamps[0], reading);
        assert.throws(() => s.restore(forged), /INVALID_POWER_CHECKPOINT/);
        assert.deepEqual(s.checkpoint(), before);
        assert.deepEqual(s.observe(), observation);
      }
    } finally {
      s.dispose();
    }
  }
});
