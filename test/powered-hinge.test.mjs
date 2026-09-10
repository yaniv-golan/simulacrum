import { rotateVector } from '../src/model/transforms.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { snapConnection, compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import * as motorLaw from '../src/simulation/physics/law/motor.mjs';
import { createPowerNetwork } from '../src/simulation/power.mjs';

test('disabled receiver opens the drive at nonzero speed and never commands a centered servo', () => {
  for (const speed of [-3, 3]) {
    const c = fixture().power;
    const n = createPowerNetwork(c),
      dt = 1 / 120,
      node = c.motors[0].node;
    const result = n.step(
      dt,
      [{ node, speed, angle: 0.3 }],
      [{ node: 4, duty: 0, enabled: false }],
      [{ node, inertia: 0.1 }],
    );
    assert.equal(result.torques[0].value, 0);
    const state = n.completeStep(dt, [
      {
        node,
        speedBefore: speed,
        speedAfter: speed,
        workJ: 0,
        kineticDeltaJ: 0,
        kineticBeforeJ: 0.45,
        kineticAfterJ: 0.45,
        angle: 0.3,
      },
    ]);
    assert.equal(state.motors[0].current, 0);
    assert.equal(state.motors[0].shaftWorkJ, 0);
    assert.equal(state.motors[0].position.integralDuty, 0);
    assert.equal(state.cells[0].energyJ, c.cells[0].initialJ);
    const resumed = createPowerNetwork(c);
    resumed.restore(n.snapshot());
    assert.equal(
      resumed.step(dt, [{ node, speed, angle: 0.3 }], [], [{ node, inertia: 0.1 }]).torques[0]
        .value,
      0,
    );
    const positive = createPowerNetwork(c);
    assert.notEqual(
      positive.step(
        dt,
        [{ node, speed, angle: 0.3 }],
        [{ node: 4, duty: 0 }],
        [{ node, inertia: 0.1 }],
      ).torques[0].value,
      0,
    );
  }
});
function fixture() {
  let b = createEmptyBlueprint('hinge-test', 'Hinge test');
  b.parts = [
    ['poweredHinge', 'hinge'],
    ['wheelHub', 'hub'],
    ['gripWheel', 'wheel'],
    ['powerCell', 'cell'],
    ['commandReceiver', 'receiver'],
  ].map(([type, id], i) => createPart(type, id, [i, 2, 0]));
  const connect = (a, binding, kind) => {
    if (kind === 'shaft') b = snapConnection(b, a, binding);
    b.connections.push({ id: `c${b.connections.length}`, kind, a, b: binding });
  };
  connect({ part: 'hinge', port: 'shaft' }, { part: 'hub', port: 'steering' }, 'shaft');
  connect({ part: 'hub', port: 'shaft' }, { part: 'wheel', port: 'axle' }, 'shaft');
  connect({ part: 'cell', port: 'power' }, { part: 'hinge', port: 'power' }, 'power');
  connect({ part: 'receiver', port: 'signal' }, { part: 'hinge', port: 'signal' }, 'signal');
  return compileAssembly(b, { gravity: [0, 0, 0], ground: null }).configuration;
}
test('ordinary powered hinge and passive wheel hub compile distinct authored axes and limits', () => {
  const c = fixture();
  assert.ok(c.power.motors[0].axis.every((v, i) => Math.abs(v - [0, 1, 0][i]) < 1e-12));
  assert.equal(c.joints.length, 2);
  assert.deepEqual(c.joints[0].limits, [-0.6, 0.6]);
  assert.ok(
    rotateVector(c.bodies[1].rotation, c.joints[1].axisA).every(
      (v, i) => Math.abs(v - [1, 0, 0][i]) < 1e-12,
    ),
  );
  assert.ok(
    Math.abs(c.bodies[2].position[1] - c.bodies[0].position[1]) < 1e-12,
    'default wheel axle matches hinge mounting height',
  );
});
test('powered position hinge converges in both directions and checkpoints the full control state', async () => {
  const c = fixture(),
    s = await createSession(c);
  try {
    for (const duty of [0.5, -0.5, 0]) {
      s.act({ type: 'receiver', node: 4, duty });
      s.step(360);
      const f = s.observe().frames[0],
        p = f.power.motors[0];
      assert.ok(Math.abs(p.position.angle - duty * 0.6) < 0.03, JSON.stringify(p));
      assert.equal(p.position.targetAngle, duty * 0.6);
      assert.ok(f.power.cells[0].energyJ < c.power.cells[0].initialJ);
    }
    const cp = s.checkpoint();
    s.act({ type: 'receiver', node: 4, duty: 0.4 });
    s.step(30);
    const expected = s.observe().frames[0];
    s.restore(cp);
    s.act({ type: 'receiver', node: 4, duty: 0.4 });
    s.step(30);
    assert.deepEqual(s.observe().frames[0].power, expected.power);
    assert.deepEqual(s.observe().frames[0].physics, expected.physics);
  } finally {
    s.dispose();
  }
});
test('target commands cannot move a disconnected or depleted hinge', async () => {
  for (const edit of [(c) => (c.power.wires = []), (c) => (c.power.cells[0].initialJ = 0)]) {
    const c = fixture();
    edit(c);
    const s = await createSession(c);
    try {
      s.act({ type: 'receiver', node: 4, duty: 1 });
      s.step(240);
      const m = s.observe().frames[0].power.motors[0];
      assert.equal(m.torque, 0);
      assert.equal(m.shaftWorkJ, 0);
      assert.ok(Math.abs(m.position.angle) < 1e-6);
    } finally {
      s.dispose();
    }
  }
});
test('hinge physical angular stops bound positive and negative targets', async () => {
  const c = fixture(),
    s = await createSession(c);
  try {
    for (const duty of [1, -1]) {
      s.act({ type: 'receiver', node: 4, duty });
      let max = 0;
      for (let i = 0; i < 360; i++) {
        s.step();
        max = Math.max(max, Math.abs(s.observe().frames[0].power.motors[0].position.angle));
      }
      assert.ok(max < 0.63, `angular stop escaped: ${max}`);
      assert.ok(
        Math.abs(s.observe().frames[0].power.motors[0].position.angle - duty * 0.6) < 0.035,
      );
    }
  } finally {
    s.dispose();
  }
});
test('hinge checkpoint rejects a forged completed angle without changing world state', async () => {
  const s = await createSession(fixture());
  try {
    s.act({ type: 'receiver', node: 4, duty: 0.5 });
    s.step(60);
    const before = s.checkpoint(),
      bad = structuredClone(before);
    bad.power.motors[0].position.angle += 0.1;
    assert.throws(() => s.restore(bad));
    assert.deepEqual(s.checkpoint(), before);
  } finally {
    s.dispose();
  }
});
test('physical hinge stops resist external torque even with no powered driver', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const body = (fixed) => ({
    shape: 'box',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.1, 0.1, 0.1],
    fixed,
    friction: 0,
    restitution: 0,
  });
  for (const torque of [-2, 2]) {
    const w = await createPhysicsWorld({
      gravity: [0, 0, 0],
      bodies: [body(true), body(false)],
      joints: [
        {
          kind: 'revolute',
          a: 0,
          b: 1,
          anchorA: [0, 0, 0],
          anchorB: [0, 0, 0],
          axisA: [0, 1, 0],
          axisB: [0, 1, 0],
          limits: [-0.2, 0.3],
        },
      ],
    });
    try {
      for (let i = 0; i < 120; i++) {
        w.applyTorquePair(0, 1, [0, 1, 0], torque);
        w.step();
        const a = w.jointState(0).angle;
        assert.ok(a >= -0.23 && a <= 0.33, `stop failed: ${a}`);
      }
      assert.ok(Math.abs(w.jointState(0).angle - (torque > 0 ? 0.3 : -0.2)) < 0.03);
    } finally {
      w.dispose();
    }
  }
});
test('hinge numeric configuration and checkpoint fields are strict', async () => {
  for (const edit of [
    (c) => (c.power.motors[0].positionControl.extra = 1),
    (c) => (c.power.motors[0].positionControl.dampingGain = -1),
    (c) => (c.power.motors[0].positionControl.lowerLimit = 0),
    (c) => (c.joints[0].limits = [-0.5, 0.6]),
  ]) {
    const c = fixture();
    edit(c);
    await assert.rejects(createSession(c));
  }
  const s = await createSession(fixture());
  try {
    const before = s.checkpoint();
    for (const mutate of [
      (p) => (p.extra = 0),
      (p) => (p.controlDuty = 2),
      (p) => (p.targetAngle = 4),
      (p) => (p.angle = '0'),
    ]) {
      const bad = structuredClone(before);
      mutate(bad.power.motors[0].position);
      assert.throws(() => s.restore(bad));
      assert.deepEqual(s.checkpoint(), before);
    }
  } finally {
    s.dispose();
  }
});
test('bounded hinge trim stops winding at a blocked limit and clears without power', async () => {
  const { createPowerNetwork } = await import('../src/simulation/power.mjs');
  const c = fixture(),
    p = createPowerNetwork(c.power),
    node = c.power.motors[0].node,
    dt = 1 / 120;
  function tick(angle, duty) {
    const t = p.step(dt, [{ node, speed: 0, angle }], [{ node: 4, duty }], [{ node, inertia: 1 }])
      .torques[0].value;
    const after = t * dt,
      work = (t * dt * after) / 2;
    return p.completeStep(dt, [
      {
        node,
        speedBefore: 0,
        speedAfter: after,
        workJ: work,
        kineticDeltaJ: work,
        kineticBeforeJ: 0,
        kineticAfterJ: work,
        angle,
      },
    ]).motors[0].position;
  }
  for (let i = 0; i < 480; i++) tick(-0.6, 1);
  assert.equal(p.read().motors[0].position.integralDuty, 0, 'saturated blocked hinge winds up');
  for (let i = 0; i < 1200; i++) tick(0.27, 0.5);
  const held = p.read().motors[0].position.integralDuty;
  assert.ok(held > 0.6 && held < 0.71, `bounded held trim ${held}`);
  const cp = p.snapshot();
  cp.cells[0].energyJ = 0;
  p.restore(cp);
  assert.equal(tick(0.27, 0.5).integralDuty, 0, 'unpowered driver retains trim');
});
test('loaded hinge releases its stored trim without excessive overshoot', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const { createPowerNetwork } = await import('../src/simulation/power.mjs');
  const c = fixture();
  c.bodies[0].fixed = true;
  const w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints }),
    p = createPowerNetwork(c.power),
    m = c.power.motors[0],
    dt = 1 / 120;
  let peak = -Infinity,
    loaded;
  try {
    for (let i = 0; i < 960; i++) {
      const sample = w.jointState(m.joint);
      const t = p.step(
        dt,
        [{ node: m.node, speed: sample.speed, angle: sample.angle }],
        [{ node: 4, duty: 0.5 }],
        [{ node: m.node, inertia: 1 / sample.effectiveInverseInertia }],
      ).torques[0];
      const receipt = w.applyTorquePair(t.body, t.rotor, [0, 1, 0], t.value);
      if (i < 480) w.applyTorquePair(t.body, t.rotor, [0, 1, 0], -0.5);
      w.step();
      const angle = w.jointState(m.joint).angle;
      const state = p.completeStep(dt, [{ node: m.node, ...receipt, angle }]);
      if (i === 479) loaded = state.motors[0].position;
      if (i >= 480) peak = Math.max(peak, angle);
    }
    assert.ok(loaded.integralDuty > 0.05, 'external load did not exercise integral trim');
    assert.ok(peak < 0.35, `load release overshoot ${peak}`);
    assert.ok(Math.abs(w.jointState(m.joint).angle - 0.3) < 0.03);
  } finally {
    w.dispose();
  }
});
test('sampled position driver solves implicit motor speed and midpoint angle analytically', () => {
  const args = [0.15, 0.1, 0.2, 10, 0.1, 0.05, 0.02, 0.6, 24, 2, 1 / 120];
  assert.equal(typeof motorLaw.sampledPositionDuty, 'function');
  const [target, angle, speed, kp, kd, trim, inertia, k, voltage, resistance, dt] = args;
  const a = (k * voltage) / resistance,
    b = (k * k) / resistance,
    h = dt / (inertia + b * dt);
  const expected =
    (kp * (target - angle) - (kp * dt + kd) * speed + trim + ((kp * dt) / 2 + kd) * h * b * speed) /
    (1 + ((kp * dt) / 2 + kd) * h * a);
  assert.ok(expected > 0 && expected < 1);
  assert.ok(Math.abs(motorLaw.sampledPositionDuty(...args) - expected) < 1e-12);
  const reversed = [-target, -angle, -speed, kp, kd, -trim, inertia, k, voltage, resistance, dt];
  assert.equal(motorLaw.sampledPositionDuty(...reversed), -motorLaw.sampledPositionDuty(...args));
  assert.throws(() =>
    motorLaw.sampledPositionDuty(target, angle, speed, kp, kd, trim, 0, k, voltage, resistance, dt),
  );
});

// A numerical apparatus isolates spring work on a motor axis without contacts.
function springMotorFixture(stiffness) {
  const c = fixture();
  c.bodies = [
    [0, 0, 0],
    [0.3, 0, 0],
    [0.3, 0, -0.2],
    [3, 0, 0],
    [4, 0, 0],
  ].map((position, i) => ({
    shape: 'box',
    position,
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.01, 0.01, 0.01],
    fixed: i === 0,
    friction: 0,
    restitution: 0,
  }));
  // Keep the compiled electrical indices: cell 3 and receiver 4.
  c.joints = [
    {
      kind: 'revolute',
      a: 0,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [-0.3, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [-0.6, 0.6],
    },
    {
      kind: 'spring',
      a: 2,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
      limits: [0.08, 0.4],
      restLength: 0.3,
      stiffness,
      damping: stiffness ? 2 : 0,
    },
  ];
  return c;
}

test('power allocation includes spring-induced motor speed before actuator work', async () => {
  for (const [stiffness, charge, restLength, velocity] of [
    [0, 36000, 0.3, 0],
    [100, 36000, 0.3, 0],
    [100, 0, 0.3, 0],
    [100, 36000, 0.1, 0.5],
    [100, 36000, 0.3, -0.5],
    [100, 0, 0.1, 0.5],
  ]) {
    for (const duty of [-0.5, 0.5]) {
      const c = springMotorFixture(stiffness);
      c.power.cells[0].initialJ = charge;
      c.joints[1].restLength = restLength;
      c.bodies[1].velocity = [velocity, 0, velocity];
      c.joints[1].damping = stiffness ? 30 : 0;
      const s = await createSession(c);
      try {
        s.act({ type: 'receiver', node: 4, duty });
        assert.doesNotThrow(() => s.step(120), `stiffness=${stiffness}, duty=${duty}`);
        assert.ok(Number.isFinite(s.observe().frames[0].power.motors[0].shaftWorkJ));
        if (charge === 0) {
          assert.equal(s.observe().frames[0].power.motors[0].torque, 0);
          assert.equal(s.observe().frames[0].power.motors[0].shaftWorkJ, 0);
        }
        const cp = s.checkpoint();
        s.step(12);
        const expected = s.observe().frames[0];
        s.restore(cp);
        s.step(12);
        assert.deepEqual(s.observe().frames[0].power, expected.power);
        assert.deepEqual(s.observe().frames[0].physics, expected.physics);
        assert.deepEqual(s.observe().frames[0].energy, expected.energy);
      } finally {
        s.dispose();
      }
    }
  }
});

test('prepared spring kick is read-only and actuator work matches its independent impulse oracle', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  for (const [stiffness, velocity] of [
    [0, 0],
    [100, 0],
    [100, 0.5],
    [100, -0.5],
  ]) {
    const c = springMotorFixture(stiffness);
    c.bodies[1].velocity = [velocity, 0, velocity];
    c.joints[1].damping = stiffness ? 30 : 0;
    const w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints });
    try {
      w.prepareConstraints();
      const before = w.read(),
        initialSpeed = w.jointState(0).speed;
      w.prepareSprings();
      assert.deepEqual(w.read(), before, 'preparation changed physical state');
      const predicted = w.jointState(0);
      if (stiffness && velocity) assert.ok(Math.abs(predicted.speed - initialSpeed) > 0.1);
      else assert.equal(predicted.speed, initialSpeed);
      w.applyPreparedConstraints();
      w.applySprings();
      const actual = w.jointState(0);
      assert.ok(Math.abs(actual.speed - predicted.speed) < 1e-6);
      const impulse = 0.2 / 120,
        expectedWork =
          impulse * predicted.speed + (impulse ** 2 * predicted.effectiveInverseInertia) / 2,
        receipt = w.applyTorquePair(0, 1, [0, 1, 0], 0.2);
      assert.ok(Math.abs(receipt.workJ - expectedWork) < 1e-8);
      assert.ok(Math.abs(receipt.kineticDeltaJ - expectedWork) < 1e-8);
      const after = w.read();
      assert.throws(() => w.applySprings(), /already applied/);
      assert.deepEqual(w.read(), after, 'duplicate kick changed physical state');
    } finally {
      w.dispose();
    }
  }
});

test('prepared spring allocations reject intervening impulses before state changes', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const c = springMotorFixture(100),
    w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints });
  try {
    w.prepareConstraints();
    w.prepareSprings();
    const before = w.read();
    assert.throws(() => w.applyImpulse(1, [1, 0, 0]), /prepared spring/);
    assert.deepEqual(w.read(), before);
    w.applyPreparedConstraints();
    assert.throws(() => w.applyTorquePair(0, 1, [0, 1, 0], 1), /prepared spring/);
    assert.deepEqual(w.read(), before);
    w.applySprings();
    w.applyTorquePair(0, 1, [0, 1, 0], 1);
    w.step();
    assert.doesNotThrow(() => w.applyImpulse(1, [1, 0, 0]));
  } finally {
    w.dispose();
  }
});
