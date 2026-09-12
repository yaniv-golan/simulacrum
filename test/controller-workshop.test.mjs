import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { emptyControllerProgram, editControllerDraft } from '../src/model/controller-authoring.mjs';
test('installed WASM program needs explicit ownership, yields to keys, and keeps its last good version', async () => {
  const bp = createEmptyBlueprint('program-test', 'Program test');
  bp.parts = [
    createPart('logicController', 'controller', [0, 1, 0]),
    createPart('commandReceiver', 'receiver', [1, 1, 0]),
  ];
  bp.connections = [
    {
      id: 'output',
      kind: 'signal',
      a: { part: 'controller', port: 'out1' },
      b: { part: 'receiver', port: 'command' },
    },
  ];
  const workshop = await createWorkshop(bp);
  const program = editControllerDraft(emptyControllerProgram(), {
    type: 'code',
    source:
      'let counter = 0; function tick() { counter = counter + 0.01; write("out1", counter); }',
  });
  try {
    assert.equal(
      (await workshop.act({ type: 'install-controller-program', id: 'controller', program })).ok,
      true,
    );
    assert.equal((await workshop.act({ type: 'run' })).ok, true);
    workshop.step(1);
    assert.equal(workshop.observe().frames[0].receiverControl.receivers[0].duty, 0);
    assert.equal(
      (await workshop.act({ type: 'control-mode', id: 'receiver', mode: 'automatic' })).ok,
      true,
    );
    workshop.step(1);
    assert.equal(workshop.observe().frames[0].receiverControl.receivers[0].duty, 0.02);
    await workshop.act({ type: 'control', id: 'receiver', duty: -0.3 });
    workshop.step(2);
    assert.equal(workshop.observe().frames[0].receiverControl.receivers[0].duty, -0.3);
    assert.equal(
      (await workshop.act({ type: 'install-controller-program', id: 'controller', program })).ok,
      false,
    );
    await workshop.act({ type: 'build' });
    const bad = { ...program, source: 'function tick(){while(true){}}' };
    assert.equal(
      (await workshop.act({ type: 'install-controller-program', id: 'controller', program: bad }))
        .ok,
      false,
    );
    assert.deepEqual(
      workshop.observe().frames[0].metadata.blueprint.parts[0].controllerProgram,
      program,
    );
  } finally {
    workshop.dispose();
  }
});
test('viewing code leaves rules editable; actual edits disable rules and restore preserves code', () => {
  const initial = emptyControllerProgram();
  assert.equal(
    editControllerDraft(initial, { type: 'code', source: initial.source }).mode,
    'rules',
  );
  const edited = editControllerDraft(initial, { type: 'code', source: initial.source + ' ' });
  assert.equal(edited.mode, 'code');
  assert.throws(() => editControllerDraft(edited, { type: 'rules', rules: [] }));
  const restored = editControllerDraft(edited, { type: 'restore-rules' });
  assert.equal(restored.mode, 'rules');
  assert.equal(restored.savedCode[0], edited.source);
});

test('required sensing faults disable code even when a custom branch requests drive', async () => {
  const { createProgramExecutors } = await import('../src/scripting/controller-executors.mjs');
  const authoring = editControllerDraft(emptyControllerProgram(), {
    type: 'code',
    source:
      'function tick(){ if(status("input1") === 1){write("out1",1);}else{write("out1",0.5);} }',
  });
  const power = {
    controllers: [
      {
        node: 1,
        program: {
          authoring,
          inputs: [{ port: 'input1', node: 0, channel: 'distance' }],
          outputs: [{ port: 'out1', node: 2 }],
        },
      },
    ],
  };
  const [p] = await createProgramExecutors(power);
  assert.deepEqual(
    p.run({ inputs: [{ node: 0, channels: { distance: { status: 'no-power' } } }] }),
    [{ node: 2, duty: 0, valid: false }],
  );
  assert.deepEqual(
    p.run({ inputs: [{ node: 0, channels: { distance: { status: 'ok', value: 2 } } }] }),
    [{ node: 2, duty: 0.5, valid: true }],
  );
  const cut = structuredClone(power);
  cut.controllers[0].program.inputs = [];
  const [disconnected] = await createProgramExecutors(cut);
  assert.deepEqual(disconnected.run({ inputs: [] }), [{ node: 2, duty: 0, valid: false }]);
});
test('shared decision history retains a regular-controller fault across a repair and new run', async () => {
  const { createControllerHistory } = await import('../src/application/controller-history.mjs');
  const { createSensorWorkshop } = await import('../src/model/fixtures/sensor-workshop.mjs');
  const w = await createWorkshop(createSensorWorkshop('range'));
  const history = createControllerHistory();
  try {
    await w.act({ type: 'run' });
    w.step();
    w.step();
    const f = structuredClone(w.observe().frames[0]);
    const sensor = f.metadata.blueprint.parts.findIndex((p) => p.id === 'sensor');
    f.sensors.readings.find((r) => r.node === sensor).channels.distance = { status: 'no-power' };
    history.ingest({ ok: true, cursor: { epoch: 1 }, frames: [f] });
    const row = history.read('sensor-range', 'rules')[0];
    assert.equal(row.inputs[0].status, 'no-power');
    assert.equal(row.sampleTick, f.tick - 1);
    assert.ok(row.outputs.every((o) => Number.isFinite(o.applied)));
    await w.act({ type: 'build' });
    await w.act({ type: 'run' });
    w.step();
    w.step();
    history.ingest({ ok: true, cursor: { epoch: 2 }, frames: w.observe().frames });
    assert.equal(row.inputs[0].status, 'no-power');
    assert.equal(history.read('sensor-range', 'rules').length, 2);
    assert.ok(Object.isFrozen(row));
  } finally {
    w.dispose();
  }
});
