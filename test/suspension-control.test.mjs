import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { createReceiverArbiter } from '../src/simulation/receiver-arbiter.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { insertAssembly } from '../src/model/reusable-assemblies.mjs';

function authoredControl() {
  const bp = createSpringStrut();
  const sensor = createPart('travelSensor', 'sensor', [2, 2, 0]);
  sensor.springBinding = bp.connections.find((c) => c.kind === 'spring').id;
  bp.parts.push(
    sensor,
    createPart('positionRegulator', 'regulator', [3, 2, 0]),
    createPart('commandReceiver', 'receiver', [4, 2, 0]),
  );
  bp.assemblies[0].ids.push('sensor', 'regulator', 'receiver');
  bp.connections.push(
    {
      id: 'measurement',
      kind: 'signal',
      a: { part: 'sensor', port: 'signal' },
      b: { part: 'regulator', port: 'signal' },
    },
    {
      id: 'regulation',
      kind: 'signal',
      a: { part: 'regulator', port: 'out' },
      b: { part: 'receiver', port: 'command' },
    },
  );
  return bp;
}

test('ordinary bound sensing and automatic ownership survive replay while manual zero takes over', async () => {
  const bp = authoredControl(),
    w = await createWorkshop(bp);
  try {
    await w.act({ type: 'run' });
    assert.equal(
      (await w.act({ type: 'control-mode', id: 'receiver', mode: 'automatic' })).ok,
      true,
    );
    w.step(2);
    const f = w.observe().frames[0];
    assert.equal(f.receiverControl.receivers[0].mode, 'automatic');
    assert.equal(f.sensors.tick, f.tick - 1);
    assert.equal(f.sensors.readings[0].valid, true);
    const cp = w.checkpoint();
    w.step(3);
    const expected = w.observe().frames[0].receiverControl;
    w.restore(cp);
    w.step(3);
    assert.deepEqual(w.observe().frames[0].receiverControl, expected);
    await w.act({ type: 'control', id: 'receiver', duty: 0 });
    w.step();
    assert.equal(w.observe().frames[0].receiverControl.receivers[0].mode, 'manual');
  } finally {
    w.dispose();
  }
});

test('sensor binding follows a library copy and missing binding visibly disables automatic control', async () => {
  const bp = authoredControl();
  const copy = insertAssembly(createEmptyBlueprint('empty', 'Empty'), bp, [0, 2, 0], [0, 0, 0, 1]);
  const sensor = copy.blueprint.parts.find((p) => p.type === 'travelSensor');
  assert.equal(
    sensor.springBinding,
    copy.connectionIdMap[bp.parts.find((p) => p.id === 'sensor').springBinding],
  );
  assert.notEqual(sensor.springBinding, bp.parts.find((p) => p.id === 'sensor').springBinding);
  assert.ok(compileAssembly(copy.blueprint).configuration.power.sensors[0].joint >= 0);
  delete bp.parts.find((p) => p.id === 'sensor').springBinding;
  const w = await createWorkshop(bp);
  try {
    await w.act({ type: 'run' });
    await w.act({ type: 'control-mode', id: 'receiver', mode: 'automatic' });
    w.step();
    const f = w.observe().frames[0];
    assert.equal(f.sensors.readings[0].valid, false);
    assert.equal(f.receiverControl.receivers[0].mode, 'off');
    assert.equal(f.power.sources[0].enabled, false);
  } finally {
    w.dispose();
  }
});

test('synthetic release preserves automatic ownership, while suspend plus release latches Off', () => {
  const a = createReceiverArbiter(configuration());
  a.step(1, sample(1), [mode('automatic')]);
  assert.equal(a.step(2, sample(2), [{ type: 'release', node: 3, duty: 0 }])[0].mode, 'automatic');
  assert.equal(
    a.step(3, sample(3), [{ type: 'suspend' }, { type: 'release', node: 3, duty: 0 }])[0].mode,
    'off',
  );
});

test('a press and release within one tick take Manual ownership and finish with released duty', () => {
  const a = createReceiverArbiter(configuration());
  a.step(1, sample(1), [mode('automatic')]);
  const output = a.step(2, sample(2), [manual(1), { type: 'release', node: 3, duty: 0 }])[0];
  assert.equal(output.mode, 'manual');
  assert.equal(output.duty, 0);
  assert.equal(a.step(3, sample(3), [])[0].duty, 0);
});

const configuration = () => [
  {
    node: 3,
    duty: 0.25,
    regulator: {
      node: 2,
      sensor: 1,
      target: 0.25,
      minTarget: 0.1,
      maxTarget: 0.4,
      proportionalGain: 4,
      dampingGain: 0.2,
      polarity: 1,
      neutral: 0,
      maxRate: 12,
      enabled: true,
    },
  },
];
const sample = (tick, length = 0.2, speed = 0) => ({
  tick: tick - 1,
  readings: [{ node: 1, valid: true, length, speed }],
});
const mode = (value) => ({ type: 'mode', node: 3, mode: value });
const manual = (duty) => ({ type: 'manual', node: 3, duty });

test('receiver arbitration defaults Manual and requires explicit Automatic rearming', () => {
  const a = createReceiverArbiter(configuration());
  assert.equal(a.step(1, sample(1), [])[0].duty, 0.25);
  assert.equal(a.step(2, sample(2), [mode('automatic')])[0].mode, 'automatic');
  const overridden = a.step(3, sample(3), [manual(0), mode('automatic')])[0];
  assert.equal(overridden.mode, 'manual');
  assert.equal(overridden.duty, 0);
  assert.equal(a.step(4, sample(4), [])[0].mode, 'manual');
  assert.equal(a.step(5, sample(5), [mode('automatic')])[0].mode, 'automatic');
});

test('Off wins all event permutations and is a disabled drive, not a zero target', () => {
  for (const events of [
    [mode('off'), manual(1), mode('automatic')],
    [mode('automatic'), manual(1), mode('off')],
    [manual(1), mode('off'), mode('automatic')],
  ]) {
    const a = createReceiverArbiter(configuration());
    const output = a.step(1, sample(1), events)[0];
    assert.equal(output.mode, 'off');
    assert.equal(output.enabled, false);
    assert.equal(output.duty, 0);
  }
});

test('stale, missing, invalid and suspended automatic sensing latch Off', () => {
  for (const bad of [
    { tick: 0, readings: sample(1).readings },
    { tick: 1, readings: [] },
    { tick: 1, readings: [{ node: 1, valid: false, length: 0, speed: 0 }] },
  ]) {
    const a = createReceiverArbiter(configuration());
    a.step(1, sample(1), [mode('automatic')]);
    assert.equal(a.step(2, bad, [])[0].enabled, false);
    assert.equal(a.step(3, sample(3), [])[0].mode, 'off');
    assert.equal(a.step(4, sample(4), [mode('automatic')])[0].enabled, true);
  }
  const a = createReceiverArbiter(configuration());
  a.step(1, sample(1), [mode('automatic')]);
  assert.equal(a.step(2, sample(2), [{ type: 'suspend' }])[0].mode, 'off');
  assert.equal(a.step(3, sample(3), [])[0].enabled, false);
});

test('regulator uses only wired measured travel with polarity, damping and authored slew limit', () => {
  const config = configuration();
  config[0].duty = 0;
  const a = createReceiverArbiter(config);
  let output = a.step(1, sample(1), [mode('automatic')])[0];
  assert.equal(output.duty, 0.1); // 12 ratios/s at 120 Hz
  output = a.step(2, sample(2), [])[0];
  assert.ok(Math.abs(output.duty - 0.2) < 1e-14);
  output = a.step(3, sample(3, 0.25, 0.5), [])[0];
  assert.ok(Math.abs(output.duty - 0.1) < 1e-14);
  const reversed = configuration();
  reversed[0].duty = 0;
  reversed[0].regulator.polarity = -1;
  assert.equal(
    createReceiverArbiter(reversed).step(1, sample(1), [mode('automatic')])[0].duty,
    -0.1,
  );
});

test('checkpoint continuation is exact and rejected input or checkpoint is atomic', () => {
  const a = createReceiverArbiter(configuration());
  a.step(1, sample(1), [mode('automatic')]);
  const checkpoint = a.snapshot();
  const b = createReceiverArbiter(configuration());
  b.restore(checkpoint);
  assert.deepEqual(a.step(2, sample(2, 0.22), []), b.step(2, sample(2, 0.22), []));
  const before = a.snapshot();
  assert.throws(() => a.step(3, sample(3), [manual(NaN)]));
  assert.deepEqual(a.snapshot(), before);
  const bad = structuredClone(before);
  bad.receivers[0].mode = 'forged';
  assert.throws(() => a.restore(bad));
  assert.deepEqual(a.snapshot(), before);
  assert.throws(() => {
    checkpoint.receivers[0].duty = 0.99;
  }, TypeError);
  assert.notEqual(b.snapshot().receivers[0].duty, 0.99);
});

test('Pause reserves one idempotent suspension at full input capacity and survives restore', async () => {
  const w = await createWorkshop(authoredControl());
  try {
    await w.act({ type: 'run' });
    await w.act({ type: 'control-mode', id: 'receiver', mode: 'automatic' });
    w.step();
    const before = w.observe().frames[0];
    for (let i = 0; i < 64; i++)
      assert.equal(
        (await w.act({ type: 'regulator-target', id: 'receiver', target: 0.25 })).ok,
        true,
      );
    assert.equal(
      (await w.act({ type: 'regulator-target', id: 'receiver', target: 0.25 })).reasonCode,
      'INPUT_LIMIT',
    );
    assert.equal((await w.act({ type: 'pause' })).ok, true);
    const paused = w.observe().frames[0];
    assert.equal(paused.metadata.mode, 'paused');
    assert.equal(paused.tick, before.tick, 'Pause never advances physics');
    assert.deepEqual(paused.physics, before.physics);
    const cp = w.checkpoint();
    assert.equal(cp.pending.length, 65);
    assert.equal((await w.act({ type: 'suspend-controls' })).ok, true);
    assert.deepEqual(w.checkpoint().pending, cp.pending, 'repeat blur/pause is idempotent');
    w.restore(cp);
    await w.act({ type: 'run' });
    w.step();
    assert.equal(w.observe().frames[0].receiverControl.receivers[0].mode, 'off');
    assert.equal(w.observe().frames[0].power.sources[0].enabled, false);
    w.step();
    assert.equal(w.observe().frames[0].receiverControl.receivers[0].mode, 'off');
  } finally {
    w.dispose();
  }
});

test('receiver checkpoint rejects power authority disagreement atomically', async () => {
  const w = await createWorkshop(authoredControl());
  try {
    await w.act({ type: 'run' });
    await w.act({ type: 'control-mode', id: 'receiver', mode: 'off' });
    w.step();
    const cp = w.checkpoint();
    for (const replacement of [{ duty: 1 }, { duty: 0, enabled: true }]) {
      const bad = structuredClone(cp);
      const source = bad.power.sources[0];
      bad.power.sources[0] = { node: source.node, ...replacement };
      assert.throws(() => w.restore(bad));
      assert.deepEqual(w.checkpoint(), cp);
    }
    w.restore(cp);
    assert.deepEqual(w.checkpoint(), cp);
  } finally {
    w.dispose();
  }
});

test('compiled regulator sensor must match its authored measurement wire', async () => {
  const good = compileAssembly(authoredControl()).configuration;
  const session = await createSession(good);
  session.dispose();
  for (const sensor of [-1, 999]) {
    const bad = structuredClone(good);
    bad.power.regulators[0].sensor = sensor;
    await assert.rejects(createSession(bad), /INVALID_RECEIVER_CONTROL/);
  }
});

test('Pause clears queued held manual drive even when its release cannot enter a full queue', async () => {
  const bp = createEmptyBlueprint('pause', 'Pause');
  bp.parts.push(createPart('commandReceiver', 'receiver', [0, 1, 0]));
  const w = await createWorkshop(bp);
  try {
    await w.act({ type: 'run' });
    for (let i = 0; i < 64; i++)
      assert.equal((await w.act({ type: 'control', id: 'receiver', duty: 1 })).ok, true);
    assert.equal((await w.act({ type: 'pause' })).ok, true);
    assert.equal(
      (await w.act({ type: 'control-release', id: 'receiver', duty: 0 })).reasonCode,
      'INPUT_LIMIT',
    );
    await w.act({ type: 'run' });
    w.step();
    assert.equal(w.observe().frames[0].receiverControl.receivers[0].duty, 0);
    w.step();
    assert.equal(w.observe().frames[0].receiverControl.receivers[0].duty, 0);
    await w.act({ type: 'control', id: 'receiver', duty: 1 });
    w.step();
    assert.equal(
      w.observe().frames[0].receiverControl.receivers[0].duty,
      1,
      'fresh input still drives',
    );
  } finally {
    w.dispose();
  }
});
