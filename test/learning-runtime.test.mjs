import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import {
  createLearningDispatcher,
  targetReading,
} from '../src/simulation/learning-controllers.mjs';
import {
  createReceiverArbiter,
  receiverControlConfiguration,
} from '../src/simulation/receiver-arbiter.mjs';
import { receiverAllowsManual } from '../src/model/connection-test-paths.mjs';
export function learningFixture() {
  const bp = createEmptyBlueprint('learn', 'Learning test');
  bp.parts = [
    ['targetSensor', 'sensor'],
    ['learningController', 'learner'],
    ['commandReceiver', 'receiver'],
    ['chassis', 'target'],
    ['powerCell', 'supply'],
  ].map(([type, id], i) => createPart(type, id, [i, 1, 0]));
  bp.parts[0].targetBinding = 'target';
  bp.connections = [
    ['sensor', 'distance', 'learner', 'input1'],
    ['sensor', 'speed', 'learner', 'input2'],
    ['learner', 'out1', 'receiver', 'command'],
  ].map(([a, ap, b, bp], i) => ({
    id: `wire${i}`,
    kind: 'signal',
    a: { part: a, port: ap },
    b: { part: b, port: bp },
  }));
  bp.connections.push({
    id: 'sensor-power',
    kind: 'power',
    a: { part: 'supply', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  });
  return bp;
}
const model = {
  version: 1,
  inputs: [
    { port: 'input1', channel: 'distance', unit: 'm', scale: 4 },
    { port: 'input2', channel: 'speed', unit: 'm/s', scale: 2 },
  ],
  outputs: [{ port: 'out1', channel: 'duty', unit: 'ratio' }],
  hidden: 6,
  scaling: 'fixed-physical-no-clipping-v1',
  weights: [...Array(18).fill(0), 0.5, ...Array(6).fill(0)],
};
test('paired sensing has radial sign, missing/out-of-range states, and no identity inputs', () => {
  const bodies = [
    { position: [0, 0, 0], velocity: [1, 0, 0] },
    { position: [3, 0, 0], velocity: [0, 0, 0] },
  ];
  assert.deepEqual(targetReading({ node: 0, body: 0, target: 1, range: 5 }, bodies), {
    node: 0,
    valid: true,
    distance: 3,
    speed: 1,
  });
  assert.equal(targetReading({ node: 0, body: 0, target: -1, range: 5 }, bodies).valid, false);
  assert.equal(targetReading({ node: 0, body: 0, target: 1, range: 2 }, bodies).valid, false);
});
test('connected frozen model requires explicit enable, manual takeover persists, suspension latches off', () => {
  const bp = learningFixture();
  bp.parts[1].learningModel = model;
  const power = compileAssembly(bp).configuration.power;
  const dispatcher = createLearningDispatcher(power),
    arbiter = createReceiverArbiter(receiverControlConfiguration(power));
  const demand = dispatcher.run([{ node: 0, valid: true, distance: 3, speed: 1 }])[0];
  const step = (tick, events = []) =>
    arbiter.step(tick, { tick: tick - 1, readings: [] }, [
      { type: 'learned', ...demand },
      ...events,
    ])[0];
  assert.equal(step(1).duty, 0);
  assert.ok(step(2, [{ type: 'mode', node: 2, mode: 'learned' }]).duty > 0.4);
  assert.equal(step(3, [{ type: 'manual', node: 2, duty: -0.2 }]).duty, -0.2);
  assert.equal(step(4).duty, -0.2);
  assert.ok(receiverAllowsManual(bp, 'receiver'));
  step(5, [{ type: 'mode', node: 2, mode: 'learned' }]);
  assert.equal(step(6, [{ type: 'suspend' }]).mode, 'off');
  assert.equal(step(7).mode, 'off');
  assert.equal(dispatcher.run([{ node: 0, valid: false, distance: 0, speed: 0 }])[0].valid, false);
});
test('install is atomic, Build-only, undoable and saved independently of dataset; replay continues', async () => {
  const workshop = await createWorkshop(learningFixture());
  try {
    assert.equal(
      (await workshop.act({ type: 'install-learning-model', id: 'learner', model })).ok,
      true,
    );
    const saved = workshop.observe().frames[0].metadata.blueprint;
    assert.equal(
      (
        await workshop.act({
          type: 'install-learning-model',
          id: 'learner',
          model: { ...model, weights: [1] },
        })
      ).ok,
      false,
    );
    assert.deepEqual(workshop.observe().frames[0].metadata.blueprint, saved);
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.equal(workshop.observe().frames[0].metadata.blueprint.parts[1].learningModel, undefined);
    assert.equal((await workshop.act({ type: 'redo' })).ok, true);
    assert.equal((await workshop.act({ type: 'run' })).ok, true);
    assert.equal(
      (await workshop.act({ type: 'install-learning-model', id: 'learner', model })).ok,
      false,
    );
    workshop.step(2); // Complete physical sensor power before explicitly arming.
    assert.equal(
      (await workshop.act({ type: 'control-mode', id: 'receiver', mode: 'learned' })).ok,
      true,
    );
    workshop.step(2);
    assert.equal(workshop.observe().frames[0].status, 'ready');
    assert.ok(workshop.observe().frames[0].receiverControl.receivers[0].duty > 0.4);
  } finally {
    workshop.dispose();
  }
});
test('learned inference checkpoint continuation and failure replay regenerate identical commands', async () => {
  const { createSession } = await import('../src/simulation/session.mjs');
  const { replayBundle } = await import('../scripts/replay.mjs');
  const { deterministicProjection } = await import('../src/model/tick.mjs');
  const bp = learningFixture();
  bp.parts[1].learningModel = model;
  const session = await createSession(compileAssembly(bp).configuration);
  try {
    session.act({ type: 'receiver-mode', node: 2, mode: 'learned' });
    session.step(3);
    const cp = session.checkpoint();
    session.step(2);
    const first = deterministicProjection(session.observe().frames[0]);
    session.restore(cp);
    session.step(2);
    assert.deepEqual(deterministicProjection(session.observe().frames[0]), first);
    session.act({ type: 'impulse', body: 0, value: [1e200, 0, 0] });
    assert.throws(() => session.step());
    assert.equal((await replayBundle(session.failureBundle())).matched, true);
  } finally {
    session.dispose();
  }
});
test('copying paired sensors remaps internal targets and clears omitted targets', async () => {
  const { proposeMirroredAssembly } = await import('../src/model/mirror-assembly.mjs');
  const { captureAssembly, insertAssembly } = await import('../src/model/reusable-assemblies.mjs');
  const bp = learningFixture(),
    mirror = proposeMirroredAssembly(bp, { ids: ['sensor'], referenceId: 'target', axis: 'x' });
  assert.equal(
    mirror.blueprint.parts.find((p) => p.id === mirror.idMap.sensor).targetBinding,
    undefined,
  );
  const definition = captureAssembly(bp, {
    name: 'Paired sensors',
    ids: ['sensor', 'target'],
    ports: [],
  }).definition;
  const inserted = insertAssembly(
    createEmptyBlueprint('other', 'Other'),
    definition,
    [0, 1, 5],
    [0, 0, 0, 1],
  );
  const output = inserted.blueprint ?? inserted;
  const sensor = output.parts.find((p) => p.type === 'targetSensor');
  assert.ok(sensor.targetBinding);
  assert.notEqual(sensor.targetBinding, 'target');
  assert.ok(output.parts.some((p) => p.id === sensor.targetBinding));
});
