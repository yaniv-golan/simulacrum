import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstraintProjection } from '../src/simulation/physics/law/constraints.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-11, `${a} != ${b}`);
test('mass projection gives constrained inertia and passive nonincrease with an exact work receipt', () => {
  const p = createConstraintProjection(
      [
        [0.5, 0],
        [0, 1 / 3],
      ],
      [[1, -1]],
    ),
    r = p.response([1, 0]);
  close(r.velocity[0], 0.2);
  close(r.velocity[1], 0.2);
  assert.notEqual(r.velocity[0], 0.5);
  const v = [2, -1],
    step = p.project(v),
    after = v.map((x, i) => x + step.velocity[i]),
    ke = (x) => 0.5 * (2 * x[0] ** 2 + 3 * x[1] ** 2);
  close(after[0], 0.2);
  close(after[1], 0.2);
  close(ke(v) - ke(after), 5.4);
  const next = after.map((x, i) => x + 0.3 * r.velocity[i]);
  close(ke(next) - ke(after), (0.3 * (after[0] + next[0])) / 2);
});
test('projection is symmetric positive semidefinite, idempotent and handles redundant rows', () => {
  const M = [
      [0.5, 0, 0],
      [0, 1 / 3, 0],
      [0, 0, 0.25],
    ],
    p = createConstraintProjection(M, [
      [1, -1, 0],
      [2, -2, 0],
    ]);
  assert.equal(p.rank, 1);
  for (let i = 0; i < 30; i++) {
    const a = [Math.sin(i), Math.cos(i), Math.sin(i * 2)],
      b = [Math.cos(i * 2), Math.sin(i), Math.cos(i)];
    const ra = p.response(a).velocity,
      rb = p.response(b).velocity,
      dot = (x, y) => x.reduce((s, v, k) => s + v * y[k], 0);
    close(dot(a, rb), dot(b, ra));
    assert.ok(dot(a, ra) >= -1e-12);
    const projected = a.map((x, k) => x + p.project(a).velocity[k]);
    close(p.residual(projected), 0);
    p.project(projected).velocity.forEach((x) => close(x, 0));
  }
  close(p.response([0, 0, 1]).velocity[2], 0.25);
  assert.deepEqual(createConstraintProjection(M, []).response([1, 0, 0]).velocity, [0.5, 0, 0]);
});
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (x, velocity = [0, 0, 0]) => ({
  shape: 'box',
  position: [x, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity,
  mass: 1,
  halfExtents: [0.1, 0.1, 0.1],
  fixed: false,
  friction: 0,
  restitution: 0,
});
const chain = () => ({
  gravity: [0, 0, 0],
  bodies: [body(0), body(0), body(0.2)],
  joints: [
    {
      kind: 'revolute',
      a: 0,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    },
    {
      kind: 'fixed',
      a: 1,
      b: 2,
      anchorA: [0.2, 0, 0],
      anchorB: [0, 0, 0],
      rotationA: [0, 0, 0, 1],
      rotationB: [0, 0, 0, 1],
    },
  ],
});
test('physics door funds attached rigid inertia and reports independent constrained kick work', async () => {
  const w = await createPhysicsWorld(chain());
  try {
    const free = w.jointState(0).effectiveInverseInertia;
    assert.ok(Math.abs(free - 300) < 4e-5);
    const before = w.read();
    w.prepareConstraints();
    assert.deepEqual(w.read(), before);
    close(w.applyPreparedConstraints(), 0);
    assert.ok(Math.abs(w.jointState(0).effectiveInverseInertia - 225) < 4e-5);
    const xy = w.torquePairResponse(0, 1, [1, 0, 0], 0, 2, [1, 0, 0]),
      yx = w.torquePairResponse(0, 2, [1, 0, 0], 0, 1, [1, 0, 0]);
    close(xy, yx);
    assert.ok(Math.abs(xy - 225) < 4e-5);
    const r = w.applyTorquePair(0, 1, [1, 0, 0], 0.12);
    assert.ok(Math.abs(r.workJ - 0.5 * 0.001 ** 2 * 225) < 1e-9);
    assert.ok(Math.abs(r.kineticDeltaJ - r.workJ) < 1e-9);
    const state = w.read();
    assert.ok(Math.abs(state[1].angularVelocity[0] - state[2].angularVelocity[0]) < 1e-7);
  } finally {
    w.dispose();
  }
});
test('passive bilateral preparation conserves momentum, loses no negative energy, and ignores body ordering', async () => {
  const c = chain();
  c.bodies[0].velocity = [0.2, 1, -0.4];
  c.bodies[1].velocity = [-0.3, -0.5, 0.2];
  c.bodies[2].velocity = [0.7, 0.2, 0.1];
  // Deliberate anchor drift must not create angular momentum through reaction lever arms.
  c.bodies[1].position[1] = 0.004;
  const permutation = [2, 0, 1],
    remap = (i) => permutation.indexOf(i),
    other = {
      ...c,
      bodies: permutation.map((i) => c.bodies[i]),
      joints: c.joints.map((j) => ({ ...j, a: remap(j.a), b: remap(j.b) })),
    };
  const a = await createPhysicsWorld(c),
    b = await createPhysicsWorld(other);
  const cross = (r, v) => [
    r[1] * v[2] - r[2] * v[1],
    r[2] * v[0] - r[0] * v[2],
    r[0] * v[1] - r[1] * v[0],
  ];
  const momentum = (s) =>
    s.reduce(
      (sum, p) => {
        const orbital = cross(p.position, p.velocity);
        return sum.map(
          (x, i) =>
            x + (i < 3 ? p.velocity[i] : orbital[i - 3] + (0.02 / 3) * p.angularVelocity[i - 3]),
        );
      },
      [0, 0, 0, 0, 0, 0],
    );
  try {
    const before = a.read(),
      energy = a.mechanicalEnergy().kineticJ;
    a.prepareConstraints();
    const loss = a.applyPreparedConstraints();
    b.prepareConstraints();
    b.applyPreparedConstraints();
    assert.ok(loss > 0.1);
    assert.ok(a.mechanicalEnergy().kineticJ <= energy + 1e-8);
    const after = a.read();
    momentum(before).forEach((x, i) => assert.ok(Math.abs(x - momentum(after)[i]) < 1e-7));
    after.forEach((p, i) => {
      const q = b.read()[remap(i)];
      p.velocity.forEach((v, k) => assert.ok(Math.abs(v - q.velocity[k]) < 1e-7));
      p.angularVelocity.forEach((v, k) => assert.ok(Math.abs(v - q.angularVelocity[k]) < 1e-6));
    });
    a.prepareConstraints();
    assert.ok(
      a.applyPreparedConstraints() < 1e-7,
      'repeated projection damps an admissible velocity',
    );
  } finally {
    a.dispose();
    b.dispose();
  }
});
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
test('passive constraints have the same behavior with no actuator and an unpowered actuator, and replay exactly', async () => {
  const c = chain();
  c.bodies[2].velocity = [0, 0.3, 0.2];
  c.power = {
    cells: [],
    motors: [],
    wires: [],
    signalWires: [],
    receivers: [],
    controllers: [],
    sensors: [],
  };
  const d = structuredClone(c);
  d.power.motors = [
    {
      node: 0,
      body: 0,
      rotor: 1,
      joint: 0,
      axis: [1, 0, 0],
      torqueConstant: 0.4,
      resistance: 2,
      currentLimit: 4,
      defaultDuty: 0,
    },
  ];
  const a = await createSession(c),
    b = await createSession(d);
  try {
    a.step();
    b.step();
    assert.deepEqual(a.observe().frames[0].physics, b.observe().frames[0].physics);
    assert.deepEqual(a.observe().frames[0].energy, b.observe().frames[0].energy);
    assert.ok(a.observe().frames[0].energy.constraintDissipationJ > 0);
    const cp = a.checkpoint();
    a.step(20);
    const expected = a.observe().frames[0];
    a.restore(cp);
    a.step(20);
    assert.deepEqual(
      deterministicProjection(a.observe().frames[0]),
      deterministicProjection(expected),
    );
    const bad = a.checkpoint();
    bad.energy.constraintDissipationJ = -1;
    assert.throws(() => a.restore(bad));
  } finally {
    a.dispose();
    b.dispose();
  }
});
import { motorStep, sharedPowerStep } from '../src/simulation/physics/law/motor.mjs';
test('a zero-mobility winding draws resistive stall current and heat with no work', () => {
  const r = motorStep(12, 0, 0.4, 2, 100, Infinity, 1 / 120);
  close(r.current, 6);
  close(r.nextSpeed, 0);
  close(r.mechanicalEnergy, 0);
  close(r.heatEnergy, 0.6);
  const shared = sharedPowerStep(
    [{ voltage: 12, resistance: 1, limit: 100, energy: 100 }],
    [0, 1].map(() => ({
      cell: 0,
      duty: 1,
      speed: 0,
      inertia: Infinity,
      k: 0.4,
      resistance: 2,
      limit: 100,
      active: true,
    })),
    [],
    1 / 120,
  );
  shared.currents.forEach((i) => close(i, 3));
  shared.speeds.forEach((i) => close(i, 0));
});
test('an admitted fixed path locking a powered shaft heats the winding without motion', async () => {
  const c = chain();
  c.joints.push({
    kind: 'fixed',
    a: 0,
    b: 1,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  c.power = {
    cells: [
      { node: 2, voltage: 12, resistance: 1, currentLimit: 100, capacityJ: 100, initialJ: 100 },
    ],
    motors: [
      {
        node: 0,
        body: 0,
        rotor: 1,
        joint: 0,
        axis: [1, 0, 0],
        torqueConstant: 0.4,
        resistance: 2,
        currentLimit: 100,
        defaultDuty: 1,
      },
    ],
    wires: [[2, 0]],
    signalWires: [],
    receivers: [],
    controllers: [],
    sensors: [],
  };
  const s = await createSession(c);
  try {
    s.step();
    const f = s.observe().frames[0],
      m = f.power.motors[0];
    close(m.current, 4);
    close(m.shaftWorkJ, 0);
    assert.ok(m.heatJ > 0);
    f.physics.forEach((b) => b.angularVelocity.forEach((x) => close(x, 0)));
  } finally {
    s.dispose();
  }
});
