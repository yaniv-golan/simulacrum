import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (x, fixed, velocity = 0) => ({
  shape: 'sphere',
  position: [x, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [velocity, 0, 0],
  mass: 1,
  halfExtents: [0.01, 0.01, 0.01],
  fixed,
  friction: 0,
  restitution: 0,
  collision: false,
});
const config = (x, v, gravity) => ({
  gravity,
  bodies: [body(0, true), body(x, false, v)],
  joints: [
    {
      kind: 'rope',
      a: 0,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      restLength: 1,
      stiffness: 100,
      damping: 100,
      strength: 1e6,
      maxStrain: 0.1,
    },
  ],
});
test('completed applied tension includes damping and survives snapshot restore', async () => {
  const w = await createPhysicsWorld(config(1.001, 1, [0, 0, 0]));
  try {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applyRopes();
    w.step();
    const row = w.ropes()[0],
      actual = (1 - w.read()[1].velocity[0]) * 120;
    assert.ok(Math.abs(row.appliedTension - actual) < 1e-9);
    assert.ok(row.appliedTension > row.elasticTension * 10);
    const cp = w.snapshot();
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applyRopes();
    w.step();
    w.restore(cp);
    assert.deepEqual(w.ropes()[0], row);
  } finally {
    w.dispose();
  }
});
test('static gravity equilibrium does not claim predictor energy as actual loss', async () => {
  const w = await createPhysicsWorld(config(1.0981, 0, [9.81, 0, 0]));
  try {
    const before = w.mechanicalEnergy();
    w.prepareConstraints();
    w.applyPreparedConstraints();
    const receipt = w.applyRopes();
    w.step();
    const after = w.mechanicalEnergy();
    assert.ok(
      Math.abs(
        after.kineticJ +
          after.potentialJ +
          after.ropePotentialJ -
          before.kineticJ -
          before.potentialJ -
          before.ropePotentialJ,
      ) < 1e-12,
    );
    assert.equal(Object.hasOwn(receipt, 'numericalLossJ'), false);
    assert.equal(Object.hasOwn(receipt, 'kineticDeltaJ'), false);
  } finally {
    w.dispose();
  }
});
test('taut small oscillations follow the analytical damped oscillator', async () => {
  const c = config(1.06, 0, [0.2, 0, 0]);
  Object.assign(c.joints[0], { stiffness: 4, damping: 0.2 });
  const w = await createPhysicsWorld(c);
  try {
    const omega = Math.sqrt(4 - 0.1 ** 2);
    for (let i = 1; i <= 1200; i++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applyRopes();
      w.step();
      const t = i / 120,
        expected =
          1.05 +
          0.01 * Math.exp(-0.1 * t) * (Math.cos(omega * t) + (0.1 / omega) * Math.sin(omega * t));
      // First-order force integration: O(dt*omega) displacement plus accumulated
      // extra damping (positionFactor-1/2)*k*dt, bounded for this ten-second trace.
      const tolerance = 0.01 * ((2 * omega) / 120 + (((0.125 * 4) / 120) * t) / 2);
      assert.ok(Math.abs(w.read()[1].position[0] - expected) < tolerance);
    }
  } finally {
    w.dispose();
  }
});
test('rechecksummed invalid applied-force state is rejected before native restore', async () => {
  const w = await createPhysicsWorld(config(1.001, 1, [0, 0, 0]));
  try {
    const before = w.snapshot(),
      dv = new DataView(before.buffer),
      size = dv.getUint32(4),
      meta = JSON.parse(new TextDecoder().decode(before.slice(12, 12 + size)));
    meta.ropeState = [-1];
    const head = new TextEncoder().encode(JSON.stringify(meta)),
      bad = new Uint8Array(12 + head.length + before.length - 12 - size),
      view = new DataView(bad.buffer);
    view.setUint32(0, 0x53494d31);
    view.setUint32(4, head.length);
    bad.set(head, 12);
    bad.set(before.slice(12 + size), 12 + head.length);
    let h = 2166136261;
    for (const b of bad.subarray(12)) h = Math.imul(h ^ b, 16777619);
    view.setUint32(8, h >>> 0);
    assert.throws(() => w.restore(bad));
    assert.deepEqual(w.snapshot(), before);
  } finally {
    w.dispose();
  }
});
test('segment reversal rejects before any force can push along its current axis', async () => {
  const c = config(0.015625, -5, [0, 0, 0]);
  c.bodies[1].mass = 0.001;
  Object.assign(c.joints[0], {
    restLength: 0.015625,
    stiffness: 1e6,
    damping: 1e3,
    strength: 10000,
  });
  const w = await createPhysicsWorld(c);
  try {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    const before = w.read();
    assert.throws(
      () => w.applyRopes(),
      (e) => e.reasonCode === 'ROPE_MOTION_LIMIT',
    );
    assert.deepEqual(w.read(), before);
  } finally {
    w.dispose();
  }
});
