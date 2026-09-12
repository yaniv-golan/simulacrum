import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateVector } from '../src/model/transforms.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (position, radius = 0.03, fixed = false, mass = 1) => ({
  shape: 'cylinder',
  position,
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.01, radius, radius],
  fixed,
  friction: 0,
  restitution: 0,
});
export const fixture = (fixed = true, rA = 0.06, rB = 0.12) => ({
  gravity: [0, 0, 0],
  bodies: [
    body([-0.05, 0, 0], 0.02, fixed, 10),
    body([0, 0, 0], rA - 0.01),
    body([0, rA + rB, 0], rB - 0.01),
  ],
  joints: [
    {
      kind: 'revolute',
      a: 0,
      b: 1,
      anchorA: [0.05, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    },
    {
      kind: 'revolute',
      a: 0,
      b: 2,
      anchorA: [0.05, rA + rB, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    },
    {
      kind: 'gear',
      a: 1,
      b: 2,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
      radiusA: rA,
      radiusB: rB,
      stiffness: 20000,
      damping: 20,
    },
  ],
});
const tick = (w, drive = 0, load = 0, axis = [1, 0, 0]) => {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  if (drive) w.applyTorquePair(0, 1, axis, drive);
  if (load) w.applyTorquePair(0, 2, axis, load);
  const receipt = w.applyGears();
  w.step();
  return receipt;
};
test('mesh drives opposite ratio, measures energy and replays checkpoint exactly', async () => {
  const w = await createPhysicsWorld(fixture());
  try {
    for (let i = 0; i < 120; i++) {
      const r = tick(w, 0.01);
      assert.ok(Math.abs(r.kineticDeltaJ - r.rawWorkJ - r.constraintWorkJ) < 1e-9);
      assert.ok(
        Math.abs(r.rawWorkJ + r.potentialDeltaJ + r.dampingWorkJ + r.numericalLossJ) < 1e-9,
      );
    }
    const a = w.jointState(0).speed,
      b = w.jointState(1).speed;
    assert.ok(a > 0.1);
    assert.ok(Math.abs(b / a + 0.5) < 0.01, `${a},${b}`);
    const cp = w.snapshot(),
      energy = w.mechanicalEnergy();
    tick(w, 0.01);
    const next = w.snapshot();
    w.restore(cp, energy);
    tick(w, 0.01);
    assert.deepEqual(w.snapshot(), next);
    assert.ok(Math.abs(w.gears()[0].splitDriftM) < 0.005);
  } finally {
    w.dispose();
  }
});
test('gear admission rejects free unsupported, invalid placement and numeric configuration', async () => {
  for (const alter of [
    (c) => {
      c.joints = c.joints.slice(2);
    },
    (c) => {
      c.bodies[2].position[1] += 0.1;
    },
    (c) => {
      c.joints[2].stiffness = -1;
    },
  ]) {
    const c = fixture();
    alter(c);
    await assert.rejects(() => createPhysicsWorld(c));
  }
});

test('reverse and equal ratios follow radii and disconnected/no-power controls do not transmit', async () => {
  for (const [rA, rB] of [
    [0.12, 0.06],
    [0.06, 0.06],
  ]) {
    const w = await createPhysicsWorld(fixture(true, rA, rB));
    try {
      for (let i = 0; i < 240; i++) tick(w, 0.005);
      const a = w.jointState(0).speed,
        b = w.jointState(1).speed;
      assert.ok(Math.abs(b / a + rA / rB) < 0.02);
    } finally {
      w.dispose();
    }
  }
  const config = fixture();
  config.joints.pop();
  const disconnected = await createPhysicsWorld(config),
    unpowered = await createPhysicsWorld(fixture());
  try {
    for (let i = 0; i < 60; i++) {
      tick(disconnected, 0.01);
      tick(unpowered);
    }
    assert.ok(disconnected.jointState(0).speed > 0);
    assert.ok(Math.abs(disconnected.jointState(1).speed) < 1e-12);
    assert.equal(unpowered.mechanicalEnergy().kineticJ, 0);
  } finally {
    disconnected.dispose();
    unpowered.dispose();
  }
});

test('reduction transmits twice motor torque against a load that defeats a direct ratio', async () => {
  const reduced = await createPhysicsWorld(fixture()),
    direct = await createPhysicsWorld(fixture(true, 0.06, 0.06));
  try {
    for (let i = 0; i < 240; i++) {
      tick(reduced, 0.01, 0.015);
      tick(direct, 0.01, 0.015);
    }
    assert.ok(reduced.jointState(1).speed < -0.1);
    assert.ok(direct.jointState(1).speed > 0.1);
  } finally {
    reduced.dispose();
    direct.dispose();
  }
});

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const momentum = (w, c) =>
  w.read().reduce(
    (sum, b, i) => {
      const q = b.rotation,
        omega = rotateVector([-q[0], -q[1], -q[2], q[3]], b.angularVelocity),
        [h, r] = c.bodies[i].halfExtents,
        inertia = [
          (b.mass * r * r) / 2,
          (b.mass * (3 * r * r + 4 * h * h)) / 12,
          (b.mass * (3 * r * r + 4 * h * h)) / 12,
        ],
        spin = rotateVector(
          q,
          omega.map((x, k) => x * inertia[k]),
        ),
        orbital = cross(
          b.position,
          b.velocity.map((x) => x * b.mass),
        );
      return sum.map((x, k) => x + spin[k] + orbital[k]);
    },
    [0, 0, 0],
  );
test('free carrier preserves total momentum and passive mechanical energy without holding a hidden frame', async () => {
  for (const rotation of [
    [0, 0, 0, 1],
    [0, 0, Math.sin(0.7), Math.cos(0.7)],
  ]) {
    const c = fixture(false),
      axis = rotateVector(rotation, [1, 0, 0]);
    c.bodies = c.bodies.map((b) => ({
      ...b,
      rotation,
      position: rotateVector(rotation, b.position).map((x, i) => x + [3, 2, -1][i]),
    }));
    const w = await createPhysicsWorld(c);
    try {
      tick(w, 0.005, 0, axis);
      const initial = w.mechanicalEnergy(),
        p = momentum(w, c),
        start = initial.kineticJ + initial.gearPotentialJ;
      let maximum = start;
      for (let i = 0; i < 600; i++) {
        tick(w);
        const e = w.mechanicalEnergy();
        maximum = Math.max(maximum, e.kineticJ + e.gearPotentialJ);
        assert.ok(Math.hypot(...momentum(w, c).map((x, k) => x - p[k])) < 1e-7);
        assert.ok(
          Math.hypot(
            ...w
              .read()
              .reduce((sum, b) => sum.map((x, k) => x + b.mass * b.velocity[k]), [0, 0, 0]),
          ) < 1e-7,
        );
      }
      assert.ok(maximum <= start + 1e-7, `${maximum} > ${start}`);
      assert.ok(Math.hypot(...w.read()[0].angularVelocity) > 1e-4);
      assert.ok(Math.abs(w.gears()[0].splitDriftM) < 0.005);
    } finally {
      w.dispose();
    }
  }
});

test('two meshes solve together and connection order does not select a winner', async () => {
  const c = fixture();
  c.bodies.push(body([0, 0.36, 0], 0.05));
  c.joints.push(
    { ...c.joints[0], b: 3, anchorA: [0.05, 0.36, 0] },
    { ...c.joints[2], a: 2, b: 3, radiusA: 0.12, radiusB: 0.06 },
  );
  const w = await createPhysicsWorld(c),
    reverse = await createPhysicsWorld({
      ...c,
      joints: [c.joints[0], c.joints[1], c.joints[3], c.joints[4], c.joints[2]],
    });
  try {
    for (let i = 0; i < 240; i++) {
      tick(w, 0.01);
      tick(reverse, 0.01);
    }
    const v = w.read().map((b) => b.angularVelocity[0]),
      r = reverse.read().map((b) => b.angularVelocity[0]);
    assert.ok(Math.abs(v[1] - v[3]) < 0.005);
    assert.ok(Math.abs(v[2] / v[1] + 0.5) < 0.01);
    v.forEach((x, i) => assert.ok(Math.abs(x - r[i]) < 1e-7));
  } finally {
    w.dispose();
    reverse.dispose();
  }
});

test('gear checkpoint rejects forged strain atomically even with repaired checksum', async () => {
  const w = await createPhysicsWorld(fixture());
  try {
    tick(w, 0.01);
    const saved = w.snapshot(),
      view = new DataView(saved.buffer),
      size = view.getUint32(4),
      metadata = JSON.parse(new TextDecoder().decode(saved.slice(12, 12 + size)));
    metadata.gearState[0].strain = 0.01;
    const text = new TextEncoder().encode(JSON.stringify(metadata)),
      forged = new Uint8Array(12 + text.length + saved.length - 12 - size),
      v = new DataView(forged.buffer);
    v.setUint32(0, 0x53494d31);
    v.setUint32(4, text.length);
    forged.set(text, 12);
    forged.set(saved.slice(12 + size), 12 + text.length);
    let h = 2166136261;
    for (const b of forged.slice(12)) h = Math.imul(h ^ b, 16777619);
    v.setUint32(8, h >>> 0);
    assert.throws(() => w.restore(forged), /gear snapshot/);
    assert.deepEqual(w.snapshot(), saved);
  } finally {
    w.dispose();
  }
});

test('physics door rejects off-axis and noncoaxial support even when centers match', async () => {
  for (const alteration of [
    (c) => {
      c.joints[0].axisA = [0, 1, 0];
      c.joints[0].axisB = [0, 1, 0];
    },
    (c) => {
      c.joints[0].anchorB = [0, 0, 0.02];
    },
  ]) {
    const c = fixture();
    alteration(c);
    await assert.rejects(() => createPhysicsWorld(c), /gear.*support/);
  }
});
