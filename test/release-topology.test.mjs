import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (x, velocity = [0, 0, 0]) => ({
  shape: 'box',
  position: [x, 1, 0],
  rotation: [0, 0, 0, 1],
  velocity,
  mass: 1,
  halfExtents: [0.025, 0.025, 0.025],
  fixed: false,
  friction: 0,
  restitution: 0,
});
const fixed = (a, b, d) => ({
  kind: 'fixed',
  a,
  b,
  anchorA: [d, 0, 0],
  anchorB: [0, 0, 0],
  rotationA: [0, 0, 0, 1],
  rotationB: [0, 0, 0, 1],
});
const step = (w) => {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  w.step();
};
test('opening a fixed joint preserves moving body state and releases only its response', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, [2, 0, 0]), body(0.1, [2, 0, 0]), body(0.2, [2, 0, 0])],
    joints: [fixed(0, 1, 0.1), fixed(1, 2, 0.1)],
  });
  try {
    for (let i = 0; i < 3; i++) step(w);
    const before = w.read();
    assert.deepEqual(w.planReleases([1]), [{ joint: 1, reasonCode: 'OK' }]);
    w.prepareConstraints();
    w.commitReleases();
    assert.deepEqual(w.read(), before, 'no motion writes');
    w.applyPreparedConstraints();
    w.step();
    w.applyImpulse(2, [1, 0, 0]);
    step(w);
    assert.ok(Math.abs(w.read()[0].velocity[0] - 2) < 1e-10);
    assert.ok(Math.abs(w.read()[2].velocity[0] - 3) < 1e-10);
    assert.deepEqual(w.openedJoints(), [1]);
  } finally {
    w.dispose();
  }
});
test('previously filtered contacts reactivate immediately and released snapshots continue exactly', async () => {
  const c = {
    gravity: [0, 0, 0],
    bodies: [
      body(0),
      body(0.03),
      body(0.06),
      body(1),
      body(1.03),
      { ...body(2), fixed: true },
      body(2.03),
    ],
    joints: [
      fixed(0, 1, 0.03),
      fixed(1, 2, 0.03),
      {
        kind: 'revolute',
        a: 3,
        b: 4,
        anchorA: [0.03, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [1, 0, 0],
        axisB: [1, 0, 0],
      },
    ],
  };
  const w = await createPhysicsWorld(c);
  try {
    const pairs = () => w.contacts().rows.map((r) => [r.a, r.b].sort((a, b) => a - b).join(':'));
    step(w);
    assert.ok(pairs().includes('5:6'), 'external pair collides before release');
    assert.ok(!pairs().includes('0:1') && !pairs().includes('1:2'));
    assert.ok(!pairs().includes('3:4'), 'native articulated connection filters its own pair');
    const cp = w.snapshot();
    w.planReleases([1]);
    w.prepareConstraints();
    w.commitReleases();
    w.applyPreparedConstraints();
    assert.throws(() => w.snapshot(), /completed/);
    w.step();
    assert.ok(
      w.contacts().rows.some((r) => r.b === 2),
      'new contacts after removal',
    );
    assert.ok(
      w.contacts().rows.every((r) => !(r.a === 0 && r.b === 1)),
      'retained pair stays filtered',
    );
    assert.ok(!pairs().includes('3:4'), 'release does not enable articulated self-contact');
    assert.ok(pairs().includes('5:6'), 'release does not suppress unrelated external contact');
    const expected = w.snapshot();
    w.restore(cp);
    w.planReleases([1]);
    w.prepareConstraints();
    w.commitReleases();
    w.applyPreparedConstraints();
    w.step();
    assert.deepEqual(w.snapshot(), expected);
    const after = w.snapshot();
    step(w);
    const next = w.snapshot();
    w.restore(after);
    step(w);
    assert.deepEqual(w.snapshot(), next);
  } finally {
    w.dispose();
  }
});
test('alternate fixed path remains rigid after opening one latch; invalid requests are atomic', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0), body(0.03), body(0.06)],
    joints: [fixed(0, 1, 0.03), fixed(1, 2, 0.03), fixed(0, 2, 0.06)],
  });
  try {
    const cp = w.snapshot();
    assert.throws(() => w.planReleases([99]));
    assert.deepEqual(w.snapshot(), cp);
    w.planReleases([1]);
    w.prepareConstraints();
    w.commitReleases();
    w.applyPreparedConstraints();
    w.step();
    assert.equal(w.contacts().rows.length, 0);
    assert.deepEqual(w.planReleases([1]), [{ joint: 1, reasonCode: 'ALREADY_OPEN' }]);
  } finally {
    w.dispose();
  }
});
import { createGearLift } from '../src/model/fixtures/gear-lift.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import R from '@dimforge/rapier3d-deterministic-compat';
const lightSpring = () => ({
  gravity: [0, 0, 0],
  bodies: [
    { ...body(0), fixed: true },
    { ...body(0.12), mass: 0.001 },
    { ...body(0.22), mass: 10 },
  ],
  joints: [
    {
      kind: 'spring',
      a: 0,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
      stiffness: 300,
      damping: 0,
      restLength: 0.12,
      limits: [0.08, 0.4],
    },
    fixed(1, 2, 0.1),
  ],
});
function forgeOpen(bytes, index) {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4),
    meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size))),
    native = R.World.restoreSnapshot(bytes.slice(12 + size));
  let payload;
  try {
    const handles = [];
    native.impulseJoints.forEach((j) => handles.push(j.handle));
    native.removeImpulseJoint(native.getImpulseJoint(handles[index]), true);
    payload = native.takeSnapshot();
  } finally {
    native.free();
  }
  Object.assign(meta, { version: 6, opened: [index], gearState: [] });
  const m = new TextEncoder().encode(JSON.stringify(meta)),
    out = new Uint8Array(12 + m.length + payload.length),
    view = new DataView(out.buffer);
  view.setUint32(0, 0x53494d31);
  view.setUint32(4, m.length);
  out.set(m, 12);
  out.set(payload, 12 + m.length);
  let h = 2166136261;
  for (const b of out.subarray(12)) h = Math.imul(h ^ b, 16777619);
  view.setUint32(8, h >>> 0);
  return out;
}
test('released restore rejects frequency-unsafe ballast removal before swapping plant', async () => {
  const w = await createPhysicsWorld(lightSpring());
  try {
    const cp = w.snapshot();
    assert.deepEqual(w.planReleases([1]), [{ joint: 1, reasonCode: 'RELEASE_SUPPORT_BLOCKED' }]);
    assert.throws(() => w.restore(forgeOpen(cp, 1)), /frequency/);
    assert.deepEqual(w.snapshot(), cp);
  } finally {
    w.dispose();
  }
});
test('gear carrier split is blocked but release of complete supported carrier is allowed', async () => {
  const b = createGearLift(),
    c = compileAssembly(b).configuration,
    w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints });
  try {
    const bearing = b.parts.findIndex((p) => p.id === 'bearing'),
      bad = c.joints.findIndex((j) => j.kind === 'fixed' && [j.a, j.b].includes(bearing));
    const cp = w.snapshot();
    assert.deepEqual(w.planReleases([bad]), [
      { joint: bad, reasonCode: 'RELEASE_SUPPORT_BLOCKED' },
    ]);
    assert.deepEqual(w.snapshot(), cp);
    const carrier = b.parts.findIndex((p) => p.id === 'carrier'),
      base = b.parts.findIndex((p) => p.id === 'base'),
      good = c.joints.findIndex((j) => [j.a, j.b].includes(carrier) && [j.a, j.b].includes(base));
    assert.deepEqual(w.planReleases([good]), [{ joint: good, reasonCode: 'OK' }]);
    w.prepareConstraints();
    w.commitReleases();
    w.applyPreparedConstraints();
    w.applyGears();
    w.step();
    assert.deepEqual(w.openedJoints(), [good]);
  } finally {
    w.dispose();
  }
});
test('loaded rotating pair opens without linear angular momentum or energy injection', async () => {
  const c = {
      gravity: [0, 0, 0],
      bodies: [
        { ...body(0), mass: 2 },
        { ...body(0.2), mass: 5 },
        { ...body(2), fixed: true },
      ],
      joints: [fixed(0, 1, 0.2)],
    },
    w = await createPhysicsWorld(c);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const totals = () =>
    w
      .read()
      .slice(0, 2)
      .reduce(
        (sum, b, i) => {
          const m = c.bodies[i].mass,
            I = (m * (0.05 ** 2 + 0.05 ** 2)) / 12,
            p = b.velocity.map((v) => m * v),
            orbital = cross(b.position, p);
          return {
            p: sum.p.map((v, k) => v + p[k]),
            l: sum.l.map((v, k) => v + orbital[k] + I * b.angularVelocity[k]),
            e:
              sum.e +
              0.5 * m * b.velocity.reduce((v, x) => v + x * x, 0) +
              0.5 * I * b.angularVelocity.reduce((v, x) => v + x * x, 0),
          };
        },
        { p: [0, 0, 0], l: [0, 0, 0], e: 0 },
      );
  try {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applyTorquePair(2, 0, [0, 0, 1], 0.3);
    for (let i = 0; i < 10; i++) step(w);
    const initial = totals();
    assert.ok(initial.e > 0);
    const bodies = w.read();
    w.planReleases([0]);
    w.prepareConstraints();
    w.commitReleases();
    assert.deepEqual(w.read(), bodies);
    assert.deepEqual(totals(), initial);
    w.applyPreparedConstraints();
    w.step();
    const beforeImpulse = totals(),
      r = w.read()[1].position,
      impulse = [0.01, 0.02, 0.03];
    w.applyImpulse(1, impulse);
    const externalWork = totals().e - beforeImpulse.e;
    for (let i = 0; i < 10; i++) step(w);
    const after = totals(),
      externalMoment = cross(r, impulse);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(after.p[k] - initial.p[k] - impulse[k]) < 1e-10);
      assert.ok(Math.abs(after.l[k] - initial.l[k] - externalMoment[k]) < 1e-9);
    }
    assert.ok(Math.abs(after.e - initial.e - externalWork) < 1e-10);
  } finally {
    w.dispose();
  }
});
