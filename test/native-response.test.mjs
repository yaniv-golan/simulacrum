import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import R from '@dimforge/rapier3d-deterministic-compat';
const advance = (w) => {
  w.prepareConstraints();
  w.prepareSprings();
  w.applyPreparedConstraints();
  w.applySprings();
  w.step();
};
const decode = (bytes) => {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  return {
    meta: JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size))),
    payload: bytes.slice(12 + size),
  };
};
const encode = ({ meta, payload }) => {
  const metadata = new TextEncoder().encode(JSON.stringify(meta)),
    bytes = new Uint8Array(12 + metadata.length + payload.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x53494d31);
  view.setUint32(4, metadata.length);
  bytes.set(metadata, 12);
  bytes.set(payload, 12 + metadata.length);
  let h = 2166136261;
  for (const b of bytes.subarray(12)) h = Math.imul(h ^ b, 16777619);
  view.setUint32(8, h >>> 0);
  return bytes;
};
test('f64 runtime identity and old envelopes reject before deserialization', async () => {
  const w = await createPhysicsWorld(fixture({ grounded: false }));
  try {
    assert.equal(R.version(), '0.20.0-simulacrum.spring.10.f64');
    const cp = w.snapshot(),
      saved = decode(cp);
    assert.equal(saved.meta.version, 9);
    assert.equal(saved.meta.backend, R.version());
    const original = R.World.restoreSnapshot;
    let calls = 0;
    R.World.restoreSnapshot = () => {
      calls++;
      throw Error('native deserialization called');
    };
    try {
      const legacy = structuredClone(saved);
      legacy.meta.version = 3;
      delete legacy.meta.backend;
      assert.throws(() => w.restore(encode(legacy)));
      assert.equal(calls, 0);
      const wrong = structuredClone(saved);
      wrong.meta.backend = 'another-f64-build';
      assert.throws(() => w.restore(encode(wrong)));
      assert.equal(calls, 0);
    } finally {
      R.World.restoreSnapshot = original;
    }
    const previousIterations = R.World.restoreSnapshot(saved.payload);
    try {
      assert.equal(previousIterations.integrationParameters.numInternalPgsIterations, 32);
      previousIterations.integrationParameters.numInternalPgsIterations = 1;
      const wrongIterations = encode({
        meta: saved.meta,
        payload: previousIterations.takeSnapshot(),
      });
      const before = w.snapshot();
      assert.throws(() => w.restore(wrongIterations), /snapshot.*mismatch/);
      assert.deepEqual(
        w.snapshot(),
        before,
        'different contact convergence settings reject atomically',
      );
    } finally {
      previousIterations.free();
    }
    advance(w);
    const next = w.read();
    w.restore(cp);
    advance(w);
    assert.deepEqual(w.read(), next);
  } finally {
    w.dispose();
  }
});
test('owned native response is copied and read-only after mutation and world disposal', async () => {
  const w = await createPhysicsWorld(fixture({ grounded: false, tilted: true })),
    saved = decode(w.snapshot());
  w.dispose();
  const native = R.World.restoreSnapshot(saved.payload),
    ids = [];
  native.impulseJoints.forEach((j) => ids.push(j.handle));
  let factor,
    freed = false;
  try {
    const before = native.takeSnapshot();
    factor = native.impulseJoints.raw.prepareBilateralResponse(
      native.bodies.raw,
      new Float64Array(saved.meta.handles),
      new Float64Array(ids),
      native.integrationParameters.raw,
    );
    const force = new Float64Array(saved.meta.handles.length * 6);
    force[3] = 0.003;
    force[9] = -0.003;
    const result = factor.response(force),
      expected = Array.from(result);
    assert.ok(expected.every(Number.isFinite));
    assert.ok(expected.some((x) => x !== 0));
    result.fill(999);
    assert.deepEqual(Array.from(factor.response(force)), expected);
    assert.deepEqual(native.takeSnapshot(), before);
    native.step();
    assert.deepEqual(Array.from(factor.response(force)), expected);
    native.free();
    freed = true;
    assert.deepEqual(Array.from(factor.response(force)), expected);
  } finally {
    factor?.free();
    if (!freed) native.free();
  }
});
test('a previously admitted tree larger than 128 bodies uses the same response path', async () => {
  const count = 130,
    config = {
      gravity: [0, 0, 0],
      bodies: Array.from({ length: count }, (_, i) => ({
        shape: 'box',
        position: [i * 0.1, 0, 0],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        mass: 1,
        halfExtents: [0.004, 0.003, 0.002],
        fixed: false,
        friction: 0,
        restitution: 0,
      })),
      joints: [],
    };
  for (let i = 1; i < count; i++)
    config.joints.push(
      i === count - 1
        ? {
            kind: 'spring',
            a: i - 1,
            b: i,
            anchorA: [0, 0, 0],
            anchorB: [0, 0, 0],
            axisA: [1, 0, 0],
            axisB: [1, 0, 0],
            limits: [0.08, 0.4],
            restLength: 0.1,
            stiffness: 3,
            damping: 0,
          }
        : {
            kind: 'fixed',
            a: i - 1,
            b: i,
            anchorA: [0.1, 0, 0],
            anchorB: [0, 0, 0],
            rotationA: [0, 0, 0, 1],
            rotationB: [0, 0, 0, 1],
          },
    );
  const w = await createPhysicsWorld(config);
  try {
    advance(w);
    const a = account(w.read(), config);
    assert.ok(a.L.every(Number.isFinite));
    assert.ok(Math.hypot(...a.L) < 2e-6);
  } finally {
    w.dispose();
  }
});

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const rotate = (q, v) => {
  const t = cross(q.slice(0, 3), v).map((x) => 2 * x),
    u = cross(q.slice(0, 3), t);
  return v.map((x, i) => x + q[3] * t[i] + u[i]);
};
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function fixture({
  closed = true,
  stiffness = 3,
  damping = 0,
  grounded = true,
  tilted = false,
  reversed = false,
  reverseJoints = false,
  massRatio = 1,
  skew = 0,
} = {}) {
  const phi = Math.atan2(-0.8, -0.6),
    q = [0, 0, Math.sin(phi / 2), Math.cos(phi / 2)];
  const body = (position, rotation, mass, halfExtents, fixed = false) => ({
    shape: 'box',
    position,
    rotation,
    velocity: [0, 0, 0],
    mass,
    halfExtents,
    fixed,
    friction: 0,
    restitution: 0,
  });
  const bodies = [
    body([0, 0, 0], [0, 0, 0, 1], 1, [0.015, 0.015, 0.015], grounded),
    body([0.12, 0, 0], [0, 0, 0, 1], massRatio, [0.06, 0.008, 0.008]),
    body([0, 0.18, 0], q, 1, [0.008, 0.02, 0.008]),
    body([0.24, 0, 0], q, 1, [0.008, 0.02, 0.008]),
  ];
  const pin = (a, b, anchorA, anchorB) => ({
    kind: 'revolute',
    a,
    b,
    anchorA,
    anchorB,
    axisA: [0, 0, 1],
    axisB: [0, 0, 1],
  });
  const joints = [
    pin(0, 1, [0, 0, 0], [-0.12, 0, 0]),
    pin(0, 2, [0, 0.18, 0], [0, 0, 0]),
    {
      kind: 'spring',
      a: 2,
      b: 3,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [0.08, 0.4],
      restLength: 0.32,
      stiffness,
      damping,
    },
  ];
  if (closed) {
    const j = pin(1, 3, [0.12, 0, 0], [0, 0, 0]);
    j.axisA = [Math.sin(skew), 0, Math.cos(skew)];
    j.axisB = rotate([-q[0], -q[1], -q[2], q[3]], j.axisA);
    joints.push(j);
  }
  if (tilted) {
    const a = [1, 2, 3].map((x) => x / Math.sqrt(14)),
      t = [...a.map((x) => x * Math.sin(0.365)), Math.cos(0.365)];
    for (const b of bodies) {
      b.position = rotate(t, b.position);
      b.rotation = mul(t, b.rotation);
    }
  }
  if (reversed) {
    bodies.reverse();
    for (const j of joints) {
      j.a = 3 - j.a;
      j.b = 3 - j.b;
    }
  }
  if (reverseJoints) joints.reverse();
  return { gravity: [0, 0, 0], bodies, joints };
}
function account(rows, config) {
  let E = 0,
    P = [0, 0, 0],
    L = [0, 0, 0];
  for (let i = 0; i < rows.length; i++) {
    const b = config.bodies[i],
      r = rows[i];
    if (b.fixed) continue;
    const m = b.mass,
      h = b.halfExtents,
      I =
        b.shape === 'cylinder'
          ? [
              0.5 * m * h[1] ** 2,
              (m * (3 * h[1] ** 2 + 4 * h[0] ** 2)) / 12,
              (m * (3 * h[1] ** 2 + 4 * h[0] ** 2)) / 12,
            ]
          : [
              (m * (h[1] ** 2 + h[2] ** 2)) / 3,
              (m * (h[0] ** 2 + h[2] ** 2)) / 3,
              (m * (h[0] ** 2 + h[1] ** 2)) / 3,
            ],
      w = rotate(
        [-r.rotation[0], -r.rotation[1], -r.rotation[2], r.rotation[3]],
        r.angularVelocity,
      ),
      spin = rotate(
        r.rotation,
        w.map((x, k) => x * I[k]),
      ),
      p = r.velocity.map((x) => x * m),
      orbit = cross(r.position, p);
    E +=
      0.5 * m * r.velocity.reduce((s, x) => s + x * x, 0) +
      0.5 * w.reduce((s, x, k) => s + x * x * I[k], 0);
    for (let k = 0; k < 3; k++) {
      P[k] += p[k];
      L[k] += spin[k] + orbit[k];
    }
  }
  for (const j of config.joints) {
    if (j.kind !== 'spring') continue;
    const a = rows[j.a],
      b = rows[j.b],
      n = rotate(a.rotation, j.axisA),
      pa = rotate(a.rotation, j.anchorA).map((x, k) => x + a.position[k]),
      pb = rotate(b.rotation, j.anchorB).map((x, k) => x + b.position[k]),
      length = n.reduce((s, x, k) => s + x * (pb[k] - pa[k]), 0);
    E += 0.5 * j.stiffness * (length - j.restLength) ** 2;
  }
  return { E, P, L };
}

test('finite native motor bounds retain their impulse budget beside bilateral rows', async () => {
  await R.init();
  const budget = 0.006 / 120;
  const respectsBudget = (momentum) => Math.abs(momentum) <= budget * (1 + 1e-12);
  for (const reversed of [false, true]) {
    const w = new R.World({ x: 0, y: 0, z: 0 });
    try {
      w.timestep = 1 / 120;
      const fixed = w.createRigidBody(R.RigidBodyDesc.fixed()),
        body = w.createRigidBody(R.RigidBodyDesc.dynamic());
      w.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1).setMass(1), body);
      const joint = w.createImpulseJoint(
        R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
        reversed ? body : fixed,
        reversed ? fixed : body,
        true,
      );
      joint.configureMotorVelocity(1000, 1);
      joint.setMotorMaxForce(0.006);
      w.step();
      // Independent uniform-box inertia, including the actual motor sign.
      const inertia = (1 * 0.2 * 0.2) / 6,
        momentum = body.angvel().y * inertia;
      assert.ok(respectsBudget(momentum), 'finite motor torque must remain capped');
      assert.ok(Math.abs(momentum - (reversed ? -budget : budget)) < budget * 1e-12);
      assert.equal(
        respectsBudget(momentum * 1000),
        false,
        'an uncapped kick fails the same budget',
      );
    } finally {
      w.free();
    }
  }
});
