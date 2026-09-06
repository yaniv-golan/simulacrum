import test from 'node:test';
import assert from 'node:assert/strict';
import {
  destinationTransition,
  signedAdvance,
  loopMetrics,
  forbiddenImpulse,
  wheelSlipStep,
  saturationSample,
  l1a,
  sealRobustness,
  openRobustness,
  qualificationPass,
} from '../scripts/course-contract.mjs';

test('crossing latches until two distinct loaded supports arrive beyond the line', () => {
  const supports = [
    { shapeId: 'left', surface: 'ground', load: 10 },
    { shapeId: 'right', surface: 'ground', load: 10 },
  ];
  const crossed = destinationTransition(false, true, [], 'ground', 100, true);
  assert.deepEqual(crossed, { passed: true, ready: false });
  assert.equal(
    destinationTransition(crossed.passed, false, supports, 'ground', 100, true).ready,
    true,
  );
  assert.equal(destinationTransition(true, false, supports, 'ground', 100, false).ready, false);
  assert.equal(
    destinationTransition(true, false, [supports[0], supports[0]], 'ground', 100, true).ready,
    false,
  );
  assert.equal(
    destinationTransition(
      true,
      false,
      [supports[0], { ...supports[1], surface: 'ramp' }],
      'ground',
      100,
      true,
    ).ready,
    false,
  );
});
test('advance rejects distance accumulated by pacing', () => {
  assert.equal(signedAdvance([0, 0], [0, 0], [1, 0], 0.2), false);
  assert.equal(signedAdvance([0, 0], [1, 0], [1, 0], 0.2), true);
});
const circle = (close = true) =>
  Array.from({ length: close ? 121 : 91 }, (_, i) => [
    Math.cos((i * Math.PI) / 60),
    Math.sin((i * Math.PI) / 60),
  ]);
test('loop must close; mirroring preserves metrics; remote loops cannot finish at foot', () => {
  const opts = { foot: [1, 0], headingError: 0, sweep: 2 * Math.PI };
  assert.equal(loopMetrics(circle(), opts).pass, true);
  assert.equal(loopMetrics(circle(false), opts).pass, false);
  assert.equal(
    loopMetrics(
      circle().map(([x, y]) => [x, -y]),
      { ...opts, sweep: -2 * Math.PI },
    ).pass,
    true,
  );
  assert.equal(loopMetrics(circle(), { ...opts, foot: [9, 0] }).pass, false);
});
test('only noneligible machine external sides count once', () => {
  const contacts = [
    { id: 1, a: 'torso', b: 'floor', impulse: 2 },
    { id: 1, a: 'floor', b: 'torso', impulse: 2 },
    { id: 2, a: 'foot', b: 'floor', impulse: 8 },
    { id: 3, a: 'torso', b: 'foot', impulse: 3 },
  ];
  assert.equal(forbiddenImpulse(contacts, ['torso', 'foot'], ['foot']), 2);
});
test('wheel low-speed anchor survives threshold chatter and detects lateral sliding', () => {
  let a = wheelSlipStep(null, {
    contact: true,
    position: [0, 0],
    rollingSpeed: 0,
    forwardSpeed: 0,
    surface: 'ground',
  });
  a = wheelSlipStep(a.state, {
    contact: true,
    position: [0, 0.021],
    rollingSpeed: 0,
    forwardSpeed: 0,
    surface: 'ground',
  });
  assert.equal(a.pass, false);
  assert.equal(
    wheelSlipStep(null, {
      contact: true,
      position: [0, 0],
      rollingSpeed: 0.1,
      forwardSpeed: 0,
      surface: 'ground',
    }).pass,
    false,
  );
  assert.equal(
    wheelSlipStep(null, {
      contact: true,
      position: [0, 0],
      rollingSpeed: 1,
      forwardSpeed: 1,
      surface: 'ground',
    }).pass,
    true,
  );
});
test('saturation uses targets and units per mode and does not invent torque commanded speed', () => {
  const t = { angle: 0.1, rate: 0.1, motionFloor: 0.05, torque: 0.01 };
  assert.equal(
    saturationSample({ mode: 'torque', target: 1, torque: 1, speed: 0, atLimit: true }, t, {
      minimumSpeed: 0,
    }),
    false,
  );
  assert.equal(
    saturationSample({ mode: 'torque', target: 1, torque: 1, speed: 0, atLimit: true }, t, {
      minimumSpeed: 0.2,
    }),
    true,
  );
  assert.equal(
    saturationSample({ mode: 'velocity', target: 1, speed: 0, atLimit: false }, t),
    false,
  );
  assert.equal(
    saturationSample({ mode: 'position', target: 1, position: 0, atLimit: true }, t),
    true,
  );
});
const good = () => ({
  dt: 1 / 120,
  L: 0.2,
  displacement: 0.2,
  initialHold: { startTick: -600, endTick: 0 },
  terminalHold: { startTick: 6600, endTick: 7200 },
  invariants: {
    finite: true,
    noFall: true,
    noDamage: true,
    noForbiddenSupport: true,
    noSaturation: true,
    noReset: true,
  },
  touchdowns: Array.from({ length: 8 }, (_, i) => ({
    tick: 60 * (i + 1),
    pad: i % 2,
    forward: 0.001,
  })),
});
test('L1a requires ordered nonoverlapping holds and touchdowns within deadline', () => {
  assert.equal(l1a(good()), true);
  for (const mutate of [
    (x) => x.touchdowns.pop(),
    (x) => (x.touchdowns[2].forward = 0),
    (x) => (x.terminalHold.startTick = 6601),
    (x) => (x.terminalHold.endTick = 7201),
    (x) => (x.invariants.noDamage = false),
    (x) => (x.touchdowns[2].pad = 1),
    (x) => (x.terminalHold = { startTick: 0, endTick: 600 }),
    (x) => (x.touchdowns[3].tick = x.touchdowns[2].tick),
    (x) => (x.touchdowns[0].tick = -1),
    (x) => (x.initialHold.endTick = 100),
    (x) => (x.touchdowns[7].tick = 6600),
  ]) {
    const x = good();
    mutate(x);
    assert.equal(l1a(x), false);
  }
});
test('saturation rejects nonpositive tolerances and negative motion expectations', () => {
  const s = { mode: 'velocity', target: 1, speed: 0, atLimit: true },
    t = { angle: 0.1, rate: 0.1, motionFloor: 0.05, torque: 0.01 };
  for (const key of Object.keys(t))
    for (const value of [0, -1]) assert.throws(() => saturationSample(s, { ...t, [key]: value }));
  assert.throws(() => saturationSample(s, t, { minimumSpeed: -1 }));
});
test('robustness is bounded, sealed, reproducible and requires every heldout case at frozen identity', () => {
  const levels = Object.fromEntries(
    [
      'startX',
      'startY',
      'heading',
      'mass',
      'payload',
      'slope',
      'friction',
      'disturbance',
      'mirror',
    ].map((k) => [k, [0, -1, 1]]),
  );
  const a = sealRobustness(levels, 'seed', 'keeper secret');
  const b = sealRobustness(levels, 'seed', 'keeper secret');
  assert.deepEqual(a.tuning, b.tuning);
  assert.equal(a.commitment, b.commitment);
  assert.equal('heldout' in a, false);
  const held = openRobustness(a, 'keeper secret');
  assert.ok(held.length > 0);
  assert.ok(held.length <= 38);
  assert.throws(() => openRobustness(a, 'wrong key'));
  const evidence = held.map((c) => ({ caseId: c.id, pass: true, identity: 'frozen' }));
  assert.equal(qualificationPass(held, evidence, 'frozen'), true);
  assert.equal(qualificationPass(held, evidence.slice(1), 'frozen'), false);
  evidence[0].identity = 'edited';
  assert.equal(qualificationPass(held, evidence, 'frozen'), false);
});

test('forbidden support includes intermittent braces over rolling two seconds', async () => {
  const { forbiddenSupportFailure, saturationFailure, loopReachable } = await import(
    '../scripts/course-contract.mjs'
  );
  const brush = Array(240).fill(0);
  brush[0] = 0.001;
  assert.equal(forbiddenSupportFailure(brush, 100), false);
  assert.equal(
    forbiddenSupportFailure(
      Array.from({ length: 240 }, (_, i) => (i % 10 === 9 ? 0 : 0.06)),
      100,
    ),
    true,
  );
  assert.equal(saturationFailure(Array(59).fill(true)), false);
  assert.equal(saturationFailure(Array(60).fill(true)), true);
  assert.equal(loopReachable([0.8, 0], [0, 0]), true);
  assert.equal(loopReachable([1.01, 0], [0, 0]), false);
});
