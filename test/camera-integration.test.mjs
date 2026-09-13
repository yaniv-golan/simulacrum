import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { opticalFrame } from '../src/model/camera.mjs';
import { emptyControllerProgram, editControllerDraft } from '../src/model/controller-authoring.mjs';
const fixture = () => {
  const bp = createEmptyBlueprint('photo', 'Photography');
  bp.parts = [
    createPart('camera', 'camera', [0, 1, 0]),
    createPart('powerCell', 'cell', [1, 1, 0]),
    createPart('commandReceiver', 'trigger', [2, 1, 0]),
    createPart('logicController', 'logic', [3, 1, 0]),
  ];
  bp.connections = [
    {
      id: 'power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'camera', port: 'power' },
    },
    {
      id: 'signal',
      kind: 'signal',
      a: { part: 'trigger', port: 'signal' },
      b: { part: 'camera', port: 'trigger' },
    },
    {
      id: 'control',
      kind: 'signal',
      a: { part: 'logic', port: 'out1' },
      b: { part: 'trigger', port: 'command' },
    },
  ];
  return bp;
};
const frame = (w) => w.observe().frames[0];
test('ordinary camera has authored mass, valid optics, independent supply and no image controller channels', () => {
  const bp = fixture(),
    c = compileAssembly(bp).configuration;
  assert.ok(Math.abs(c.bodies[0].mass - 0.2592) < 1e-12);
  assert.deepEqual(loadSave(bp).blueprint.parts[0], bp.parts[0]);
  assert.equal(c.power.sensors[0].supply.resistance, 100);
  assert.deepEqual(
    opticalFrame({ position: [1, 2, 3], rotation: [0, 1, 0, 0] }).forward,
    [0, 0, -1],
  );
  assert.equal(opticalFrame({ position: [1, 2, 3], rotation: [0, 0, 0, 1] }).position[2], 3.020001);
  const renamed = structuredClone(bp);
  renamed.name = 'Anything';
  renamed.parts.forEach((p) => (p.name = 'Other ' + p.id));
  assert.deepEqual(compileAssembly(renamed).configuration, c);
});
test('manual camera requests are atomic, deduplicated, powered, scheduled and checkpoint-continuable', async () => {
  const w = await createWorkshop(fixture());
  try {
    const request = () => ({
      type: 'camera-photo',
      id: 'camera',
      requestId: 1,
      epoch: w.observe().cursor.epoch,
    });
    assert.equal((await w.act(request())).ok, false);
    await w.act({ type: 'run' });
    assert.equal((await w.act(request())).ok, true);
    const cursor = w.observe().cursor;
    assert.equal((await w.act(request())).ok, true);
    assert.deepEqual(w.observe().cursor, cursor);
    assert.equal((await w.act({ ...request(), requestId: 2 })).reasonCode, 'BUSY');
    w.step(7);
    const cp = w.checkpoint();
    w.step(5);
    const expected = deterministicProjection(frame(w));
    assert.equal(frame(w).cameras[0].result.tick, 12);
    assert.equal(frame(w).cameras[0].result.status, 'ok');
    assert.ok(frame(w).power.sensors[0].heatJ > 0);
    w.restore(cp);
    w.step(5);
    assert.deepEqual(deterministicProjection(frame(w)), expected);
    const invalid = structuredClone(w.checkpoint());
    invalid.cameras[0].sampleTick = 12000;
    const before = w.checkpoint();
    assert.throws(() => w.restore(invalid));
    assert.deepEqual(w.checkpoint(), before);
    await w.act({ type: 'build' });
    assert.equal(frame(w).cameras[0].serial, 0);
  } finally {
    w.dispose();
  }
});
test('unpowered camera cannot make a valid photo; authored controller rising edge takes exactly one', async () => {
  const bp = fixture();
  bp.connections = bp.connections.filter((c) => c.kind !== 'power');
  const no = await createWorkshop(bp);
  try {
    await no.act({ type: 'run' });
    await no.act({
      type: 'camera-photo',
      id: 'camera',
      requestId: 1,
      epoch: no.observe().cursor.epoch,
    });
    no.step(12);
    assert.equal(frame(no).cameras[0].result.status, 'no-power');
  } finally {
    no.dispose();
  }
  const w = await createWorkshop(fixture());
  try {
    const program = editControllerDraft(emptyControllerProgram(), {
      type: 'code',
      source: 'let n=0;function tick(){n=n+1;if(n<5){write("out1",0);}else{write("out1",1);}}',
    });
    assert.equal(
      (await w.act({ type: 'install-controller-program', id: 'logic', program })).ok,
      true,
    );
    await w.act({ type: 'run' });
    await w.act({ type: 'control-mode', id: 'trigger', mode: 'automatic' });
    w.step(48);
    assert.equal(frame(w).cameras[0].serial, 1);
    assert.equal(frame(w).cameras[0].result.source, 'controller');
    const cp = w.checkpoint();
    w.step(12);
    w.restore(cp);
    w.step(12);
    assert.equal(frame(w).cameras[0].serial, 1);
  } finally {
    w.dispose();
  }
});

test('camera copy and mirror preserve authored choices and reflect the optical frame', async () => {
  const { proposeMirroredAssembly } = await import('../src/model/mirror-assembly.mjs');
  const { assertCopiedGraph } = await import('./contracts/copied-graph.mjs');
  const bp = createEmptyBlueprint('mirrored', 'Mirrored camera');
  bp.parts = [createPart('camera', 'lens', [1, 1, 0]), createPart('beam', 'reference', [0, 1, 0])];
  bp.parts[0].authoredMaterial.body = 'steel';
  const before = structuredClone(bp),
    p = proposeMirroredAssembly(bp, { ids: ['lens'], referenceId: 'reference', axis: 'x' });
  assertCopiedGraph({
    source: before,
    copied: p.blueprint,
    partIds: ['lens'],
    idMap: p.idMap,
    connectionIdMap: p.connectionIdMap,
  });
  assert.deepEqual(bp, before);
  const copied = p.blueprint.parts.find((p) => p.id !== 'lens' && p.type === 'camera');
  assert.deepEqual(opticalFrame(copied).forward, [0, 0, 1]);
  assert.equal(copied.position[0], -1);
  assert.deepEqual(loadSave(p.blueprint).blueprint, p.blueprint);
});

test('camera capacity rejection preserves the admitted machine and permits eight ordinary cameras', async () => {
  const bp = createEmptyBlueprint('capacity', 'Camera capacity');
  bp.parts = Array.from({ length: 8 }, (_, i) =>
    createPart('camera', `lens-${i}`, [i * 0.1, 1, 0]),
  );
  const w = await createWorkshop(bp);
  try {
    const before = w.checkpoint(),
      cursor = w.observe().cursor;
    const result = await w.act({
      type: 'place',
      partType: 'camera',
      id: 'ninth',
      position: [2, 1, 0],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'CAMERA_LIMIT');
    assert.deepEqual(w.checkpoint(), before);
    assert.deepEqual(w.observe().cursor, cursor);
    const ninth = structuredClone(bp);
    ninth.parts.push(createPart('camera', 'ninth', [2, 1, 0]));
    await assert.rejects(() => createWorkshop(ninth), /CAMERA_LIMIT/);
  } finally {
    w.dispose();
  }
});

test('camera brownout and exhausted cells stop powered exposures with accounted energy', async () => {
  for (const parameters of [{ voltage: 0.5 }, { capacityJ: 1 }]) {
    const bp = fixture();
    bp.parts[1].parameters = { ...bp.parts[1].parameters, ...parameters };
    const w = await createWorkshop(bp);
    try {
      await w.act({ type: 'run' });
      w.step(parameters.capacityJ ? 120 : 12);
      assert.equal(frame(w).cameras[0].powered, false);
      await w.act({
        type: 'camera-photo',
        id: 'camera',
        requestId: 1,
        epoch: w.observe().cursor.epoch,
      });
      w.step(12);
      assert.equal(frame(w).cameras[0].result.status, 'no-power');
      if (parameters.capacityJ) assert.equal(frame(w).power.cells[0].energyJ, 0);
    } finally {
      w.dispose();
    }
  }
});
test('camera authored optical pose and material survive Undo Redo and reload', async () => {
  const bp = fixture(),
    w = await createWorkshop(bp);
  try {
    const before = structuredClone(frame(w).metadata.blueprint);
    assert.equal(
      (await w.act({ type: 'material', id: 'camera', primitive: 'body', material: 'steel' })).ok,
      true,
    );
    const changed = structuredClone(frame(w).metadata.blueprint);
    await w.act({ type: 'undo' });
    assert.deepEqual(frame(w).metadata.blueprint, before);
    await w.act({ type: 'redo' });
    assert.deepEqual(frame(w).metadata.blueprint, changed);
    const saved = loadSave(changed);
    assert.equal(saved.ok, true);
    const next = await createWorkshop(saved.blueprint);
    try {
      assert.deepEqual(frame(next).metadata.blueprint, changed);
    } finally {
      next.dispose();
    }
  } finally {
    w.dispose();
  }
});
