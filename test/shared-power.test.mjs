import test from 'node:test';
import assert from 'node:assert/strict';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const dt = 1 / 120,
  close = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const config = () => ({
  cells: [
    { node: 0, voltage: 12, capacityJ: 100, initialJ: 100, resistance: 1, currentLimit: 100 },
  ],
  motors: [1, 2].map((node) => ({
    node,
    body: node,
    rotor: node + 3,
    joint: node - 1,
    axis: [1, 0, 0],
    torqueConstant: 0.1,
    resistance: 2,
    currentLimit: 100,
    defaultDuty: 1,
  })),
  wires: [
    [0, 1],
    [0, 2],
  ],
  signalWires: [],
  receivers: [],
  controllers: [],
  sensors: [],
});
function run(c, coupling = []) {
  const n = createPowerNetwork(c),
    speeds = c.motors.map((m) => ({ node: m.node, speed: 0 }));
  const a = n.step(
    dt,
    speeds,
    [],
    c.motors.map((m) => ({ node: m.node, inertia: 0.1 })),
    coupling,
  );
  const receipts = c.motors.map((m, i) => {
    const before = coupling
        .filter((e) => e.target === i)
        .reduce((v, e) => v + e.response * a.torques[e.source].value * dt, 0),
      after = before + (a.torques[i].value * dt) / 0.1,
      work = (a.torques[i].value * (before + after) * dt) / 2;
    return {
      node: m.node,
      speedBefore: before,
      speedAfter: after,
      workJ: work,
      kineticDeltaJ: work,
      kineticBeforeJ: 0,
      kineticAfterJ: work,
    };
  });
  return { state: n.completeStep(dt, receipts), allocation: a };
}
test('shared cell solves total voltage drop and includes cross-term resistive heat', () => {
  const c = config(),
    { state: s } = run(c),
    current = 12 / (2 + (0.1 ** 2 * dt) / 0.1 + 2);
  for (const m of s.motors) close(m.current, current);
  close(s.cells[0].heatJ, (2 * current) ** 2 * dt);
  close(100 - s.cells[0].energyJ, 12 * 2 * current * dt);
  close(
    100 - s.cells[0].energyJ,
    s.cells[0].heatJ +
      s.motors.reduce(
        (v, m) => v + m.heatJ + m.driverHeatJ + m.mechanicalEnergy + m.energyResidualJ,
        0,
      ),
  );
});
test('shared current and remaining charge caps allocate without array-order starvation', () => {
  for (const initialJ of [100, 0.00001]) {
    const c = config();
    c.cells[0].currentLimit = 2;
    c.cells[0].initialJ = initialJ;
    const s = run(c).state;
    close(s.motors[0].current, s.motors[1].current);
    assert.ok(s.motors.every((m) => m.current > 0));
    assert.ok(
      s.motors.reduce((v, m) => v + m.current, 0) <= Math.min(2, initialJ / (12 * dt)) + 1e-10,
    );
    assert.ok(s.cells[0].energyJ >= 0);
    c.motors.reverse();
    const reversed = run(c).state;
    for (const m of s.motors)
      close(m.current, reversed.motors.find((x) => x.node === m.node).current);
  }
});
test('shared supply preserves sequential mechanical receipts for coupled motors', () => {
  const s = run(config(), [{ source: 0, target: 1, response: 5 }]).state;
  assert.ok(s.motors.every((m) => m.current > 0 && m.driverHeatJ >= 0));
  assert.ok(s.motors[1].current < s.motors[0].current);
});
test('shared and separate cells solve interleaved mechanical allocation', () => {
  const c = config();
  c.cells.push({ ...c.cells[0], node: 8, voltage: 10 });
  c.motors.splice(1, 0, { ...c.motors[0], node: 7, body: 7, rotor: 9, joint: 3 });
  c.wires.push([8, 7]);
  const s = run(c, [
    { source: 0, target: 1, response: 3 },
    { source: 1, target: 2, response: 3 },
  ]).state;
  assert.ok(s.motors.every((m) => m.current > 0));
  assert.ok(s.cells.every((x) => x.energyJ < 100));
});
test('shared cell and shared physical rotor conserve measured kicks through replay', async () => {
  const { createSession } = await import('../src/simulation/session.mjs');
  const body = (x = 0) => ({
    position: [x, 0, 0],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 1,
    shape: 'box',
    halfExtents: [0.1, 0.1, 0.1],
    fixed: false,
    friction: 0,
    restitution: 0,
  });
  const c = config();
  c.motors = c.motors.map((m, i) => ({
    ...m,
    node: i === 0 ? 0 : 3,
    body: i === 0 ? 0 : 3,
    rotor: 1,
  }));
  c.cells[0].node = 2;
  c.wires = [
    [2, 0],
    [2, 3],
  ];
  const s = await createSession({
    gravity: [0, 0, 0],
    bodies: [body(), body(), body(10), body()],
    joints: [0, 3].map((a) => ({
      kind: 'revolute',
      a,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    })),
    power: c,
  });
  try {
    s.step(120);
    const f = s.observe().frames[0];
    assert.ok(f.power.motors.every((m) => m.shaftWorkJ > 0));
    assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-5);
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
test('different signed duties share the same terminal voltage without regeneration', () => {
  const c = config();
  c.motors[0].defaultDuty = -0.4;
  c.motors[1].defaultDuty = 0.7;
  c.motors[1].resistance = 3;
  const s = run(c).state,
    conductance = c.motors.reduce(
      (v, m) => v + m.defaultDuty ** 2 / (m.resistance + (m.torqueConstant ** 2 * dt) / 0.1),
      0,
    ),
    total = (12 * conductance) / (1 + conductance),
    terminal = 12 - total;
  for (const [i, m] of c.motors.entries())
    close(
      s.motors[i].current,
      (m.defaultDuty * terminal) / (m.resistance + (m.torqueConstant ** 2 * dt) / 0.1),
    );
  close(s.cells[0].heatJ, total ** 2 * dt);
  assert.ok(s.motors.every((m) => m.electricalEnergy > 0));
  c.motors[0].defaultDuty = 0;
  const stopped = run(c).state;
  assert.equal(stopped.motors[0].current, 0);
  assert.ok(stopped.motors[1].current > 0);
});
