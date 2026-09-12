import test from 'node:test';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-deterministic-compat';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (position, fixed = false, halfExtents = [0.025, 0.025, 0.025]) => ({
  shape: 'box',
  position,
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass: 1,
  halfExtents,
  fixed,
  friction: 0.5,
  restitution: 0,
});
const joint = (a, b, delta, kind = 'fixed') => ({
  kind,
  a,
  b,
  anchorA: kind === 'spring' ? [delta[0] - 0.12, delta[1], delta[2]] : delta,
  anchorB: [0, 0, 0],
  ...(kind === 'fixed'
    ? { rotationA: [0, 0, 0, 1], rotationB: [0, 0, 0, 1] }
    : {
        axisA: [1, 0, 0],
        axisB: [1, 0, 0],
        ...(kind === 'spring'
          ? { stiffness: 0, damping: 0, restLength: 0.12, limits: [0.08, 0.2] }
          : {}),
      }),
});
const fixture = (kind = 'fixed') => ({
  gravity: [0, 0, 0],
  bodies: [0, 0.03, 0.06].map((x) => body([x, 1, 0])),
  joints: [joint(0, 1, [0.03, 0, 0]), joint(1, 2, [0.03, 0, 0], kind)],
});
const advance = (w) => {
  w.prepareConstraints();
  w.prepareSprings();
  w.applyPreparedConstraints();
  w.applySprings();
  w.step();
};
test('fixed-chain self contacts disappear and exact checkpoint continuation retains filter', async () => {
  const w = await createPhysicsWorld(fixture());
  try {
    advance(w);
    assert.equal(w.contacts().rows.length, 0, 'transitive fixed endpoints cannot contact');
    const cp = w.snapshot();
    advance(w);
    const expected = w.snapshot();
    w.restore(cp);
    advance(w);
    assert.deepEqual(w.snapshot(), expected);
  } finally {
    w.dispose();
  }
});
test('articulated endpoints and distinct grounded fixed components retain contacts', async () => {
  for (const kind of ['revolute', 'spring', 'separate-grounded']) {
    const c =
      kind === 'separate-grounded'
        ? {
            gravity: [0, 0, 0],
            bodies: [
              body([-1, 1, 0], true),
              body([1, 1, 0], true),
              body([0, 1, 0]),
              body([0.06, 1, 0]),
            ],
            joints: [joint(0, 2, [1, 0, 0]), joint(1, 3, [-0.94, 0, 0])],
          }
        : fixture(kind);
    const w = await createPhysicsWorld(c);
    try {
      advance(w);
      const [a, b] = kind === 'separate-grounded' ? [2, 3] : [0, 2];
      assert.ok(
        w.contacts().rows.some((r) => r.a === a && r.b === b),
        kind,
      );
    } finally {
      w.dispose();
    }
  }
});
test('loaded fixed chain keeps external support impulses and bounded energy', async () => {
  const c = fixture();
  c.gravity = [0, -9.81, 0];
  for (const b of c.bodies) b.position[1] = 0.025;
  c.bodies.push(body([0, -0.05, 0], true, [1, 0.05, 1]));
  const w = await createPhysicsWorld(c);
  try {
    let support = 0,
      maxGain = 0;
    const initial = w.mechanicalEnergy();
    for (let i = 0; i < 240; i++) {
      advance(w);
      const e = w.mechanicalEnergy();
      maxGain = Math.max(
        maxGain,
        e.kineticJ + e.potentialJ - initial.kineticJ - initial.potentialJ,
      );
      if (i >= 120)
        support += w
          .contacts()
          .rows.filter((r) => r.b === 3 && r.normalImpulse)
          .reduce((sum, r) => sum + Math.abs(r.normalImpulse[1]), 0);
      assert.ok(w.contacts().rows.every((r) => r.b === 3));
    }
    assert.ok(Math.abs(support - 3 * 9.81) < 0.02, `support ${support}`);
    assert.ok(maxGain < 0.002, `energy gain ${maxGain}`);
  } finally {
    w.dispose();
  }
});
test('snapshot with missing filter flags rejects atomically', async () => {
  const w = await createPhysicsWorld(fixture());
  try {
    const before = w.snapshot(),
      view = new DataView(before.buffer, before.byteOffset, before.byteLength),
      size = view.getUint32(4),
      native = R.World.restoreSnapshot(before.slice(12 + size));
    let payload;
    try {
      native.colliders.forEach((c) => c.setActiveHooks(0));
      payload = native.takeSnapshot();
    } finally {
      native.free();
    }
    const forged = new Uint8Array(12 + size + payload.length);
    forged.set(before.subarray(0, 12 + size));
    forged.set(payload, 12 + size);
    let h = 2166136261;
    for (const b of forged.subarray(12)) h = Math.imul(h ^ b, 16777619);
    new DataView(forged.buffer).setUint32(8, h >>> 0);
    assert.throws(() => w.restore(forged), /physical plant mismatch/);
    assert.deepEqual(w.snapshot(), before);
  } finally {
    w.dispose();
  }
});
