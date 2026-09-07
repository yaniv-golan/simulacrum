import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
const body = () => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass: 1,
  shape: 'box',
  halfExtents: [0.1, 0.1, 0.1],
  fixed: false,
  friction: 0,
  restitution: 0,
});
export const motorConfiguration = () => ({
  gravity: [0, 0, 0],
  bodies: [body(), body(), { ...body(), position: [10, 0, 0] }],
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
  ],
  power: {
    cells: [
      { node: 2, voltage: 12, capacityJ: 1000, initialJ: 1000, resistance: 1, currentLimit: 2 },
    ],
    motors: [
      {
        node: 0,
        body: 0,
        rotor: 1,
        joint: 0,
        axis: [1, 0, 0],
        torqueConstant: 0.1,
        resistance: 1,
        currentLimit: 2,
        defaultDuty: 1,
      },
    ],
    wires: [[2, 0]],
    signalWires: [],
    receivers: [],
    controllers: [],
    sensors: [],
  },
});
test('physical power turns a rotor, uses charge, accounts circuit heat, and restores continuation', async () => {
  const s = await createSession(motorConfiguration());
  try {
    s.step(120);
    const f = s.observe().frames[0];
    assert.ok(f.physics[1].angularVelocity[0] > 1);
    assert.ok(Math.abs(f.physics[0].angularVelocity[0] + f.physics[1].angularVelocity[0]) < 1e-5);
    assert.ok(f.power.cells[0].energyJ < 1000);
    assert.ok(f.power.motors[0].heatJ > 0);
    const cp = s.checkpoint();
    s.step(20);
    const expected = s.observe().frames[0];
    s.restore(cp);
    s.step(20);
    assert.deepEqual(s.observe().frames[0].physics, expected.physics);
    assert.deepEqual(s.observe().frames[0].power, expected.power);
  } finally {
    s.dispose();
  }
});
test('disconnected and depleted negative controls never supply motor torque', async () => {
  for (const change of [(c) => (c.power.wires = []), (c) => (c.power.cells[0].initialJ = 0)]) {
    const c = motorConfiguration();
    change(c);
    const s = await createSession(c);
    try {
      s.step(120);
      assert.equal(s.observe().frames[0].physics[1].angularVelocity[0], 0);
    } finally {
      s.dispose();
    }
  }
});
test('controller phase gets only declared completed sensor state and records receiver outputs', async () => {
  const c = motorConfiguration();
  c.bodies.push(
    { ...body(), position: [20, 0, 0] },
    { ...body(), position: [30, 0, 0] },
    { ...body(), position: [40, 0, 0] },
  );
  c.power.receivers = [{ node: 3, duty: 0 }];
  c.power.controllers = [{ node: 4, duty: 0 }];
  c.power.sensors = [{ node: 5, body: 5, axis: [1, 0, 0] }];
  c.power.signalWires = [
    [5, 4],
    [4, 3],
    [3, 0],
  ];
  c.bodies[5].position = [0.2, 0, 0];
  c.joints.push({
    kind: 'fixed',
    a: 1,
    b: 5,
    anchorA: [0.2, 0, 0],
    anchorB: [0, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  const views = [];
  const s = await createSession(c, {}, { secret: 'not a sensor' }, [
    {
      node: 4,
      run(view) {
        views.push(view);
        return [{ node: 3, duty: 1 }];
      },
    },
  ]);
  try {
    s.step(1);
    const completed = s.observe().frames[0];
    assert.equal(views.length, 1);
    assert.deepEqual(views[0], { tick: 0, inputs: [{ node: 5, speed: 0 }] });
    assert.ok(Object.isFrozen(views[0].inputs[0]));
    assert.ok(completed.physics[1].angularVelocity[0] > 0);
    s.step(1);
    assert.equal(views[1].tick, 1);
    assert.ok(views[1].inputs[0].speed > 0);
    assert.equal(views[1].inputs[0].speed, completed.physics[5].angularVelocity[0]);
    assert.equal(views[0].inputs[0].speed, 0);
  } finally {
    s.dispose();
  }
});
test('receiver commands cannot bypass a missing power wire and checkpoint rejection is atomic', async () => {
  const c = motorConfiguration();
  c.bodies.push({ ...body(), position: [20, 0, 0] });
  c.power.receivers = [{ node: 3, duty: 0 }];
  c.power.signalWires = [[3, 0]];
  c.power.wires = [];
  const s = await createSession(c);
  try {
    assert.equal(s.act({ type: 'receiver', node: 3, duty: 1 }).ok, true);
    s.step(1);
    assert.equal(s.observe().frames[0].physics[1].angularVelocity[0], 0);
    const cp = s.checkpoint(),
      bad = structuredClone(cp);
    bad.power.cells[0].energyJ = 1001;
    assert.throws(() => s.restore(bad));
    assert.deepEqual(s.checkpoint(), cp);
  } finally {
    s.dispose();
  }
});
test('numeric power bindings reject ghost components and mismatched joint axes', async () => {
  for (const edit of [
    (c) => {
      c.power.cells[0].node = 999;
      c.power.wires = [[999, 1]];
    },
    (c) => {
      c.power.receivers = [{ node: 999, duty: 1 }];
      c.power.signalWires = [[999, 1]];
    },
    (c) => (c.power.motors[0].axis = [0, 1, 0]),
    (c) => c.power.wires.push([1, 999]),
  ]) {
    const c = motorConfiguration();
    edit(c);
    await assert.rejects(createSession(c));
  }
});
test('attached passive inertia does not disappear from measured circuit energy', async () => {
  const c = motorConfiguration();
  c.bodies.push({ ...body(), position: [0.2, 0, 0] });
  c.joints.push({
    kind: 'fixed',
    a: 1,
    b: 3,
    anchorA: [0.2, 0, 0],
    anchorB: [0, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  const s = await createSession(c);
  try {
    s.step(1);
    const f = s.observe().frames[0];
    const kinetic = f.physics.reduce(
      (sum, b) =>
        sum +
        0.5 * b.mass * b.velocity.reduce((a, v) => a + v * v, 0) +
        0.5 * ((b.mass * 0.02) / 3) * b.angularVelocity.reduce((a, v) => a + v * v, 0),
      0,
    );
    const dissipated =
      f.power.cells[0].heatJ + f.power.motors[0].heatJ + (f.power.motors[0].driverHeatJ ?? 0);
    const impulse = f.power.motors[0].torque / 120,
      I = 0.02 / 3;
    // Rotor and identical passive load share momentum: K=.5*J²/I + .5*J²/(2I).
    assert.ok(Math.abs(kinetic - (0.75 * impulse ** 2) / I) < 1e-7);
    assert.ok(Math.abs(f.energy.integrationDeltaJ) < 1e-7);
    assert.ok(Math.abs(f.energy.constraintDissipationJ) < 1e-7);
    assert.ok(
      Math.abs(
        1000 - f.power.cells[0].energyJ - kinetic - dissipated + f.energy.integrationDeltaJ,
      ) < 1e-7,
    );
    assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-7);
  } finally {
    s.dispose();
  }
});
test('separately powered motors sharing a rotor account for coupled kicks and replay', async () => {
  const c = motorConfiguration();
  c.bodies.push({ ...body(), position: [0, 0, 0] }, { ...body(), position: [20, 0, 0] });
  c.joints.push({
    kind: 'revolute',
    a: 3,
    b: 1,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
  });
  c.power.cells.push({ ...c.power.cells[0], node: 4 });
  c.power.motors.push({ ...c.power.motors[0], node: 3, body: 3, joint: 1 });
  c.power.wires.push([4, 3]);
  for (const cell of c.power.cells) {
    cell.voltage = 1;
    cell.currentLimit = 100;
  }
  for (const motor of c.power.motors) motor.currentLimit = 100;
  const s = await createSession(c);
  try {
    s.step(1);
    const first = s.observe().frames[0];
    const inertia = 0.02 / 3,
      dt = 1 / 120,
      k = 0.1;
    const current1 = 1 / (2 + (k * k * dt * 2) / inertia);
    const current2 = (1 - k * ((k * current1 * dt) / inertia)) / (2 + (k * k * dt * 2) / inertia);
    assert.ok(Math.abs(first.power.motors[0].current - current1) < 1e-7);
    assert.ok(
      Math.abs(first.power.motors[1].current - current2) < 1e-7,
      'shared rotor changes the second current allocation',
    );
    s.step(119);
    const frame = s.observe().frames[0];
    assert.equal(frame.tick, 120);
    assert.ok(frame.power.motors.every((m) => m.shaftWorkJ > 0));
    assert.ok(frame.power.cells.every((cell) => cell.energyJ < 1000));
    assert.ok(Math.abs(frame.energy.balanceResidualJ) < 1e-6);
    const checkpoint = s.checkpoint();
    s.step(20);
    const expected = s.observe().frames[0];
    s.restore(checkpoint);
    s.step(20);
    assert.deepEqual(s.observe().frames[0].physics, expected.physics);
    assert.deepEqual(s.observe().frames[0].power, expected.power);
  } finally {
    s.dispose();
  }
});
