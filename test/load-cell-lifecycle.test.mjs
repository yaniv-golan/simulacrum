import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly, proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
import { emptyControllerProgram, editControllerDraft } from '../src/model/controller-authoring.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createProgramExecutors } from '../src/scripting/controller-executors.mjs';

const frame = (s) => s.observe().frames[0];
const reading = (s) => frame(s).sensors.readings.find((r) => r.node === 1).channels;
const receiver = (s) => frame(s).receiverControl.receivers[0];
const motor = (s) => frame(s).power.motors[0];
function wire(b, kind, source, sourcePort, target, targetPort) {
  b.connections.push({
    id: 'wire-' + b.connections.length,
    kind,
    a: { part: source, port: sourcePort },
    b: { part: target, port: targetPort },
  });
}
function machine() {
  let b = createEmptyBlueprint('force-rules', 'Force Rules');
  b.parts.push(
    createPart('beam', 'support', [0, 2, 0]),
    createPart('loadCellSensor', 'sensor', [2, 2, 0]),
  );
  b = proposeSurfaceMount(b, {
    part: 'sensor',
    sourceRegion: 'left',
    targetPart: 'support',
    targetRegion: 'right',
    id: 'A',
  }).blueprint;
  b.parts.push(createPart('beam', 'payload', [4, 2, 0]));
  b = proposeSurfaceMount(b, {
    part: 'payload',
    sourceRegion: 'left',
    targetPart: 'sensor',
    targetRegion: 'right',
    id: 'B',
  }).blueprint;
  b.parts.push(
    createPart('logicController', 'rules', [2, 2, 2]),
    createPart('commandReceiver', 'receiver', [3, 2, 2]),
    createPart('poweredMotor', 'motor', [4, 2, 2]),
    createPart('gripWheel', 'wheel', [5, 2, 2]),
    createPart('powerCell', 'driveSupply', [6, 2, 2]),
    createPart('powerCell', 'senseSupply', [7, 2, 2]),
  );
  const shaft = { part: 'motor', port: 'shaft' },
    axle = { part: 'wheel', port: 'axle' };
  b = snapConnection(b, shaft, axle);
  b.connections.push({ id: 'shaft', kind: 'shaft', a: shaft, b: axle });
  wire(b, 'power', 'driveSupply', 'power', 'motor', 'power');
  wire(b, 'power', 'senseSupply', 'power', 'sensor', 'power');
  wire(b, 'signal', 'sensor', 'load', 'rules', 'input1');
  wire(b, 'signal', 'rules', 'out1', 'receiver', 'command');
  wire(b, 'signal', 'receiver', 'signal', 'motor', 'signal');
  b.parts.find((p) => p.id === 'rules').controllerProgram = editControllerDraft(
    emptyControllerProgram(),
    {
      type: 'rules',
      rules: [
        { input: 'input1', operator: '<', threshold: 0.1, output: 'out1', duty: 0.5, otherwise: 0 },
      ],
    },
  );
  return b;
}
const configuration = (b = machine()) =>
  compileAssembly(b, { gravity: [0, 0, 0], ground: null }).configuration;
const session = (c) => createSession(c, undefined, undefined, undefined, createProgramExecutors);
function arm(s) {
  s.act({ type: 'receiver-mode', node: 4, mode: 'automatic' });
  s.step();
}

test('repeated physical threshold crossings immediately stop and resume Automatic without smoothing', async () => {
  const s = await session(configuration());
  try {
    s.step(5);
    arm(s);
    const trace = [];
    for (let pulse = 0; pulse < 5; pulse++) {
      assert.equal(
        s.act({ type: 'impulse', body: 2, value: [pulse % 2 ? 0.2 : -0.2, 0, 0] }).ok,
        true,
      );
      for (let tick = 0; tick < 24; tick++) {
        s.step();
        const f = frame(s),
          r = reading(s).load;
        assert.equal(r.status, 'ok');
        const receipt = f.sensors.reactions[0];
        assert.ok(Math.abs(r.value - Math.hypot(...receipt.impulse) * 120) < 1e-10);
        assert.equal(receiver(s).mode, 'automatic');
        const expected = r.value < 0.1 ? 0.5 : 0;
        assert.equal(receiver(s).duty, expected);
        if (!expected) assert.equal(motor(s).torque, 0);
        else
          assert.ok(
            Math.abs(motor(s).torque) > 1e-8,
            'valid low force must restore actual motor torque',
          );
        trace.push({ load: r.value, duty: receiver(s).duty });
      }
    }
    const crossings = trace.slice(1).filter((r, i) => r.duty !== trace[i].duty).length;
    assert.ok(crossings >= 9, `real force produced only ${crossings} crossings`);
    const check = (values) =>
      values.forEach((r, i) => assert.equal(r.duty, trace[i].load < 0.1 ? 0.5 : 0));
    let peak = 0;
    const held = trace.map((r) => {
      peak = Math.max(peak, r.load);
      return { ...r, duty: peak < 0.1 ? 0.5 : 0 };
    });
    assert.throws(
      () => check(held),
      assert.AssertionError,
      'peak-hold control must miss actual restart crossings',
    );
    let filtered = 0;
    const smoothed = trace.map((r) => {
      filtered = 0.9 * filtered + 0.1 * r.load;
      return { ...r, duty: filtered < 0.1 ? 0.5 : 0 };
    });
    assert.throws(
      () => check(smoothed),
      assert.AssertionError,
      'smoothing control must miss actual instantaneous crossings',
    );
  } finally {
    s.dispose();
  }
});

test('Retry starts a new Load Cell epoch without retaining the previous loaded reaction', async () => {
  const { createWorkshop } = await import('../src/core/workshop.mjs');
  const { createRetry } = await import('../src/application/retry.mjs');
  let bp = createEmptyBlueprint('retry-force', 'Retry force');
  bp.parts.push(
    createPart('chassis', 'support', [0, 0.02, 0]),
    createPart('loadCellSensor', 'sensor', [0, 1, 0]),
  );
  bp = proposeSurfaceMount(bp, {
    part: 'sensor',
    sourceRegion: 'left',
    targetPart: 'support',
    targetRegion: 'top',
    id: 'A',
  }).blueprint;
  bp.parts.push(createPart('beam', 'payload', [0, 2, 0]));
  bp = proposeSurfaceMount(bp, {
    part: 'payload',
    sourceRegion: 'left',
    targetPart: 'sensor',
    targetRegion: 'right',
    id: 'B',
  }).blueprint;
  bp.parts.push(createPart('powerCell', 'supply', [2, 0.1, 0]));
  wire(bp, 'power', 'supply', 'power', 'sensor', 'power');
  const w = await createWorkshop(bp);
  try {
    const saved = w.save();
    assert.equal((await w.act({ type: 'run' })).ok, true);
    const retry = createRetry({ prepare() {}, execute: (command) => w.act(command), finish() {} });
    let previousLoaded;
    const freshPrefix = [];
    const checkPrefix = (sensors, tick) => assert.deepEqual(sensors, freshPrefix[tick - 1]);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let tick = 1; tick <= 5; tick++) {
        w.step();
        const sensors = frame(w).sensors;
        if (cycle === 0) freshPrefix.push(structuredClone(sensors));
        else {
          checkPrefix(sensors, tick);
          if (tick <= 2) {
            const stalePrefix = structuredClone(sensors);
            // A stale cache can relabel an old value with the new tick. Check values,
            // not only epoch/tick metadata, against an independently fresh run.
            stalePrefix.reactions[0].impulse = [...previousLoaded.reactions[0].impulse];
            stalePrefix.readings.find((r) => r.node === 1).channels = structuredClone(
              previousLoaded.readings.find((r) => r.node === 1).channels,
            );
            assert.throws(
              () => checkPrefix(stalePrefix, tick),
              assert.AssertionError,
              'a relabelled stale reaction during only the first two ticks must fail',
            );
          }
        }
      }
      w.step(55);
      const before = w.observe(),
        loaded = reading(w).load;
      assert.equal(loaded.status, 'ok');
      assert.ok(loaded.value > 5, 'ordinary ground-supported payload must physically load B');
      if (previousLoaded) assert.deepEqual(frame(w).sensors, previousLoaded);
      previousLoaded = frame(w).sensors;
      assert.equal((await retry.run()).ok, true);
      const after = w.observe();
      const checkReset = (observation) => {
        assert.ok(observation.cursor.epoch > before.cursor.epoch);
        assert.equal(observation.cursor.tick, 0);
        const sensors = observation.frames[0].sensors;
        for (const channel of Object.values(sensors.readings.find((r) => r.node === 1).channels)) {
          assert.notEqual(channel.status, 'ok');
          assert.equal(Object.hasOwn(channel, 'value'), false);
        }
        assert.equal(sensors.reactions[0].status, 'initializing');
        assert.equal(sensors.reactions[0].tick, 0);
        assert.equal(Object.hasOwn(sensors.reactions[0], 'impulse'), false);
      };
      checkReset(after);
      assert.deepEqual(w.save(), saved);
      const stale = structuredClone(after);
      stale.frames[0].sensors = structuredClone(previousLoaded);
      assert.throws(
        () => checkReset(stale),
        assert.AssertionError,
        'retained force control must fail Retry reset',
      );
      const oldEpoch = structuredClone(after);
      oldEpoch.cursor.epoch = before.cursor.epoch;
      assert.throws(
        () => checkReset(oldEpoch),
        assert.AssertionError,
        'same-epoch restart control must fail',
      );
    }
  } finally {
    w.dispose();
  }
});
