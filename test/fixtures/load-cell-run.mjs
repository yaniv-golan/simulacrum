import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';

const q = [0, 0, 0, 1];
const box = (position, mass = 1, fixed = false) => ({
  shape: 'box',
  position,
  rotation: q,
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.02, 0.02, 0.02],
  fixed,
  friction: 0,
  restitution: 0,
});
const fixed = (a, b) => ({
  kind: 'fixed',
  a,
  b,
  anchorA: [0.05, 0, 0],
  anchorB: [-0.05, 0, 0],
  rotationA: q,
  rotationB: q,
});
const configuration = {
  gravity: [0, -1, 0],
  bodies: [
    box([0, 3, 0], 1, true),
    box([0.1, 3, 0]),
    box([0.2, 3, 0]),
    box([0.2, 3.3, 0], 0.3),
    box([3, 3, 0], 1, true),
  ],
  joints: [
    fixed(0, 1),
    fixed(1, 2),
    {
      kind: 'spring',
      a: 2,
      b: 3,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [0.08, 0.4],
      restLength: 0.3,
      stiffness: 100,
      damping: 2,
    },
  ],
  power: {
    cells: [
      { node: 4, voltage: 6, capacityJ: 100, initialJ: 0.012, resistance: 2, currentLimit: 1 },
    ],
    sensors: [{ node: 1, body: 1, kind: 'loadCell', joint: 1, support: 0, sign: -1 }],
    motors: [],
    receivers: [],
    controllers: [],
    wires: [[4, 1]],
    signalWires: [],
  },
};
configuration.bodies[3].velocity = [0, 0.2, 0];
const driver = process.argv[2];
assert.ok(['step', 'elapsed'].includes(driver));
const omitImpulse = process.argv[3] === 'omit-impulse';
const s = await createSession(configuration);
const observe = () => s.observe().frames[0];
const hash = () =>
  createHash('sha256')
    .update(JSON.stringify(deterministicProjection(observe())))
    .digest('hex');
const advance = () => {
  if (observe().tick === 20 && !omitImpulse)
    assert.equal(s.act({ type: 'impulse', body: 3, value: [0, -0.08, 0] }).ok, true);
  if (driver === 'elapsed') {
    s.advanceTime(DT * 250);
    s.advanceTime(DT * 750);
  } else s.step();
};
try {
  const hashes = [],
    readings = [],
    checkpoints = [s.checkpoint()];
  for (let tick = 1; tick <= 180; tick++) {
    advance();
    assert.equal(observe().tick, tick);
    assert.equal(observe().status, 'ready');
    hashes.push(hash());
    readings.push(observe().sensors.readings[0].channels.load);
    if ([12, 35, 80].includes(tick)) checkpoints.push(s.checkpoint());
  }
  assert.ok(readings.some((r) => r.status === 'ok' && r.value > 0.1));
  const values = readings.filter((r) => r.status === 'ok').map((r) => r.value);
  assert.ok(
    Math.max(...values) - Math.min(...values) > 0.1,
    'fixture must exercise changing physical force',
  );
  const depletedAt = readings.findIndex((r, i) => i > 2 && r.status === 'no-power');
  assert.ok(depletedAt > 20 && depletedAt < 80, 'battery must deplete after valid force sensing');
  for (const checkpoint of checkpoints) {
    s.restore(checkpoint);
    for (let offset = 0; offset < 24; offset++) {
      advance();
      assert.equal(
        hash(),
        hashes[checkpoint.tick + offset],
        `restored ${driver} tick ${checkpoint.tick + offset + 1}`,
      );
    }
  }
  console.log(
    JSON.stringify({
      pid: process.pid,
      hashes,
      depletedAt,
      checkpointTicks: checkpoints.map((c) => c.tick),
    }),
  );
} finally {
  s.dispose();
}
