import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateVector as rotateFixedAnchor, multiplyQuaternion } from '../src/model/transforms.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = {
  shape: 'box',
  position: [0, 10, 0],
  velocity: [1, 0, 0],
  mass: 2,
  halfExtents: [0.1, 0.1, 0.1],
  fixed: false,
  rotation: [0, 0, 0, 1],
  friction: 0.5,
  restitution: 0,
};
const config = { gravity: [0, -9.81, 0], bodies: [body], joints: [] };
test('free fall follows analytical solution within integration discretization bound', async () => {
  const world = await createPhysicsWorld(config);
  try {
    for (let i = 0; i < 120; i++) world.step();
    const state = world.read()[0];
    assert.ok(Math.abs(state.velocity[1] + 9.81) < 1e-4);
    assert.ok(Math.abs(state.position[0] - 1) < 1e-5);
    assert.ok(Math.abs(state.position[1] - (10 - 9.81 / 2)) <= 9.81 / 120);
    assert.ok(Math.abs(state.mass - 2) < 1e-5);
  } finally {
    world.dispose();
  }
});
test('snapshot restore resumes exact body state and serialized continuation', async () => {
  const world = await createPhysicsWorld({
    ...config,
    bodies: [body, { ...body, position: [5, 20, 0], velocity: [-1, 0, 0], mass: 3 }],
  });
  try {
    for (let i = 0; i < 20; i++) world.step();
    const checkpoint = world.snapshot();
    for (let i = 0; i < 30; i++) world.step();
    const expected = world.read();
    const bytes = world.snapshot();
    world.restore(checkpoint);
    for (let i = 0; i < 30; i++) world.step();
    assert.deepEqual(world.read(), expected);
    assert.deepEqual(world.snapshot(), bytes);
  } finally {
    world.dispose();
  }
});
test('all boundary values are copied and failed restore does not mutate live state', async () => {
  const input = structuredClone(config),
    world = await createPhysicsWorld(input);
  try {
    input.gravity[1] = 0;
    input.bodies[0].position[1] = 100;
    const read = world.read();
    read[0].position[1] = 100;
    const bytes = world.snapshot();
    bytes.fill(0);
    assert.equal(world.read()[0].position[1], 10);
    const before = world.snapshot();
    assert.throws(() => world.restore(bytes));
    assert.deepEqual(world.snapshot(), before);
    world.applyImpulse(0, [2, 0, 0]);
    assert.ok(Math.abs(world.read()[0].velocity[0] - 2) < 1e-5);
    world.step();
    assert.ok(world.read()[0].velocity[1] < 0);
    assert.throws(() => world.applyImpulse(-1, [0, 0, 0]));
    assert.throws(() => world.applyImpulse(0, [NaN, 0, 0]));
  } finally {
    world.dispose();
  }
});
test('physics input rejects identity and malformed values', async () => {
  await assert.rejects(createPhysicsWorld({ ...config, name: 'demo' }));
  await assert.rejects(createPhysicsWorld({ ...config, bodies: [{ ...body, role: 'leg' }] }));
  await assert.rejects(createPhysicsWorld({ ...config, bodies: [{ ...body, mass: -1 }] }));
  await assert.rejects(createPhysicsWorld({ ...config, gravity: [0, Infinity, 0] }));
});
test('restore rejects another numeric plant including forged matching metadata', async () => {
  const world = await createPhysicsWorld(config);
  try {
    const original = world.snapshot();
    for (const alternate of [
      { ...config, gravity: [0, -1, 0] },
      { ...config, bodies: [{ ...body, mass: 3 }] },
      { ...config, bodies: [{ ...body, halfExtents: [0.2, 0.1, 0.1] }] },
      { ...config, bodies: [{ ...body, shape: 'cylinder' }] },
    ]) {
      const other = await createPhysicsWorld(alternate);
      try {
        const bytes = other.snapshot();
        assert.throws(() => world.restore(bytes));
        assert.deepEqual(world.snapshot(), original);
        const originalLength = new DataView(original.buffer).getUint32(4),
          otherLength = new DataView(bytes.buffer).getUint32(4);
        const metadata = original.slice(12, 12 + originalLength),
          payload = bytes.slice(12 + otherLength);
        const forged = new Uint8Array(12 + metadata.length + payload.length);
        forged.set(original.slice(0, 12));
        forged.set(metadata, 12);
        forged.set(payload, 12 + metadata.length);
        let hash = 2166136261;
        for (const byte of forged.subarray(12)) hash = Math.imul(hash ^ byte, 16777619);
        new DataView(forged.buffer).setUint32(8, hash >>> 0);
        assert.throws(() => world.restore(forged));
        assert.deepEqual(world.snapshot(), original);
      } finally {
        other.dispose();
      }
    }
  } finally {
    world.dispose();
  }
});

test('fixed joint transmits momentum while preserving relative transform and fresh restore', async () => {
  const configuration = {
    gravity: [0, 0, 0],
    bodies: [
      { ...body, position: [0, 0, 0], velocity: [0, 0, 0] },
      { ...body, position: [1, 0, 0], velocity: [0, 0, 0] },
    ],
    joints: [
      {
        kind: 'fixed',
        a: 0,
        b: 1,
        anchorA: [0.5, 0, 0],
        anchorB: [-0.5, 0, 0],
        rotationA: [0, 0, 0, 1],
        rotationB: [0, 0, 0, 1],
      },
    ],
  };
  const world = await createPhysicsWorld(configuration),
    fresh = await createPhysicsWorld(configuration);
  try {
    world.applyImpulse(0, [4, 0, 0]);
    for (let i = 0; i < 120; i++) world.step();
    const [a, b] = world.read();
    assert.ok(Math.abs(a.velocity[0] - 1) < 1e-4);
    assert.ok(Math.abs(b.velocity[0] - 1) < 1e-4);
    assert.ok(Math.abs(b.position[0] - a.position[0] - 1) < 1e-4);
    assert.ok(Math.abs((a.position[0] + b.position[0]) / 2 - 1.5) < 1e-4);
    fresh.restore(world.snapshot());
    for (let i = 0; i < 30; i++) {
      world.step();
      fresh.step();
    }
    assert.deepEqual(fresh.snapshot(), world.snapshot());
  } finally {
    world.dispose();
    fresh.dispose();
  }
});
test('authored quaternion determines body rotation and invalid joint bindings reject', async () => {
  const rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    world = await createPhysicsWorld({ ...config, bodies: [{ ...body, rotation }] });
  try {
    world.read()[0].rotation.forEach((value, i) => assert.ok(Math.abs(value - rotation[i]) < 1e-6));
  } finally {
    world.dispose();
  }
  await assert.rejects(
    createPhysicsWorld({ ...config, bodies: [{ ...body, rotation: [0, 0, 0, 0] }] }),
  );
  await assert.rejects(
    createPhysicsWorld({
      ...config,
      joints: [
        {
          kind: 'fixed',
          a: 0,
          b: 0,
          anchorA: [0, 0, 0],
          anchorB: [0, 0, 0],
          rotationA: [0, 0, 0, 1],
          rotationB: [0, 0, 0, 1],
        },
      ],
    }),
  );
});

test('revolute torque obeys tau equals inertia times angular acceleration and opposite momentum', async () => {
  const rotor = { ...body, position: [0, 0, 0], velocity: [0, 0, 0] },
    joint = {
      kind: 'revolute',
      a: 0,
      b: 1,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    };
  const configuration = { gravity: [0, 0, 0], bodies: [rotor, rotor], joints: [joint] },
    world = await createPhysicsWorld(configuration);
  try {
    const inertia = (2 * (0.1 ** 2 + 0.1 ** 2)) / 3,
      torque = 0.01;
    assert.ok(Math.abs(world.getAxisInverseInertia(0, [1, 0, 0]) - 1 / inertia) < 1e-4);
    for (let i = 0; i < 120; i++) {
      world.applyTorquePair(0, 1, [1, 0, 0], torque);
      world.step();
    }
    const [a, b] = world.read(),
      state = world.jointState(0);
    assert.ok(Math.abs(b.angularVelocity[0] - torque / inertia) < 1e-4);
    assert.ok(Math.abs(a.angularVelocity[0] + b.angularVelocity[0]) < 1e-6);
    assert.ok(Math.abs(state.speed - (2 * torque) / inertia) < 2e-4);
    assert.ok(state.angle > 0.7 && state.angle < 0.8);
    assert.ok(Math.abs(state.effectiveInverseInertia - 2 / inertia) < 1e-4);
    const fresh = await createPhysicsWorld(configuration);
    try {
      fresh.restore(world.snapshot());
      world.step();
      fresh.step();
      assert.deepEqual(fresh.jointState(0), world.jointState(0));
      assert.deepEqual(fresh.snapshot(), world.snapshot());
    } finally {
      fresh.dispose();
    }
  } finally {
    world.dispose();
  }
});
test('torque inputs reject invalid indices axes and nonfinite allocation', async () => {
  const world = await createPhysicsWorld({
    ...config,
    bodies: [body, { ...body, position: [2, 10, 0] }],
  });
  try {
    assert.equal(typeof world.applyTorquePair, 'function');
    const before = world.snapshot();
    assert.throws(() => world.applyTorquePair(0, 99, [1, 0, 0], 1));
    assert.throws(() => world.applyTorquePair(0, 1, [0, 0, 0], 1));
    assert.throws(() => world.applyTorquePair(0, 1, [1, 0, 0], Infinity));
    assert.deepEqual(world.snapshot(), before);
  } finally {
    world.dispose();
  }
});

test('cylinder local X inertia and torque match one half mass radius squared; fresh restore exact', async () => {
  const cylinder = {
      ...body,
      shape: 'cylinder',
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      halfExtents: [0.05, 0.2, 0.2],
    },
    stator = { ...body, fixed: true, position: [-1, 0, 0], velocity: [0, 0, 0] };
  const configuration = { gravity: [0, 0, 0], bodies: [stator, cylinder], joints: [] },
    world = await createPhysicsWorld(configuration),
    fresh = await createPhysicsWorld(configuration);
  try {
    const inertia = 0.5 * cylinder.mass * 0.2 ** 2;
    assert.ok(Math.abs(world.getAxisInverseInertia(1, [1, 0, 0]) - 1 / inertia) < 1e-4);
    for (let tick = 0; tick < 60; tick++) {
      world.applyTorquePair(0, 1, [1, 0, 0], 0.02);
      world.step();
    }
    assert.ok(Math.abs(world.read()[1].angularVelocity[0] - (0.02 / inertia) * 0.5) < 1e-4);
    fresh.restore(world.snapshot());
    for (let i = 0; i < 10; i++) {
      fresh.step();
      world.step();
    }
    assert.deepEqual(fresh.snapshot(), world.snapshot());
  } finally {
    world.dispose();
    fresh.dispose();
  }
});
test('shape discriminator and cylinder equal radial dimensions are strict', async () => {
  const missing = { ...body };
  delete missing.shape;
  await assert.rejects(createPhysicsWorld({ ...config, bodies: [missing] }));
  await assert.rejects(createPhysicsWorld({ ...config, bodies: [{ ...body, shape: 'sphere' }] }));
  await assert.rejects(
    createPhysicsWorld({
      ...config,
      bodies: [{ ...body, shape: 'cylinder', halfExtents: [0.05, 0.2, 0.3] }],
    }),
  );
});

test('completed contact normal impulse matches static load and immediate impact momentum', async () => {
  const makeBody = (position, fixed = false, velocity = [0, 0, 0]) => ({
    shape: 'box',
    position,
    rotation: [0, 0, 0, 1],
    velocity,
    mass: 1,
    halfExtents: [0.5, 0.5, 0.5],
    fixed,
    friction: 0,
    restitution: 0,
  });
  for (const gravity of [
    [0, -9.81, 0],
    [0, 0, 0],
  ]) {
    const w = await createPhysicsWorld({
      gravity,
      joints: [],
      bodies: [
        makeBody([0, -0.5, 0], true),
        makeBody([0, 0.55, 0], false, gravity[1] ? [0, 0, 0] : [0, -2, 0]),
      ],
    });
    try {
      let sawContact = false;
      for (let tick = 0; tick < 120; tick++) {
        const before = w.read()[1].velocity[1];
        w.step();
        const after = w.read()[1].velocity[1];
        const contacts = w.contacts();
        const expected = after - before - gravity[1] / 120;
        assert.ok(contacts.available);
        if (contacts.available) {
          const normal = contacts.rows.reduce((sum, row) => sum + (row.normalImpulse?.[1] ?? 0), 0);
          assert.ok(Math.abs(normal - expected) < 2e-6, JSON.stringify({ tick, normal, expected }));
          sawContact ||= normal > 1e-4;
        }
      }
      assert.ok(sawContact);
    } finally {
      w.dispose();
    }
  }
});

test('contact friction is counted once and canonical body order preserves momentum', async () => {
  for (const mass of [0.01, 1, 100])
    for (const reverse of [false, true]) {
      const ground = {
        ...body,
        position: [0, -0.5, 0],
        halfExtents: [10, 0.5, 10],
        velocity: [0, 0, 0],
        fixed: true,
        mass,
      };
      const slider = {
        ...body,
        position: [0, 0.5, 0],
        halfExtents: [0.5, 0.5, 0.5],
        velocity: [2, 0, 1],
        mass,
      };
      const w = await createPhysicsWorld({
        gravity: [0, -9.81, 0],
        joints: [],
        bodies: reverse ? [slider, ground] : [ground, slider],
      });
      try {
        const index = reverse ? 0 : 1;
        let wrongError = 0,
          frictionSamples = 0;
        for (let tick = 0; tick < 120; tick++) {
          const before = w.read()[index].velocity;
          w.step();
          const after = w.read()[index].velocity,
            sample = w.contacts();
          assert.ok(sample.available);
          const expected = after.map((x, i) => mass * (x - before[i] + (i === 1 ? 9.81 / 120 : 0)));
          const impulse = [0, 0, 0],
            duplicated = [0, 0, 0];
          for (const row of sample.rows) {
            assert.ok(row.a < row.b);
            const sign = row.b === index ? 1 : -1;
            for (let i = 0; i < 3; i++) {
              impulse[i] +=
                sign * ((row.normalImpulse?.[i] ?? 0) + (row.frictionImpulse?.[i] ?? 0));
              duplicated[i] +=
                sign *
                ((row.normalImpulse?.[i] ?? 0) +
                  (row.frictionImpulse?.[i] ?? 0) * row.frictionGroupSize);
            }
            frictionSamples += Number(Math.hypot(...(row.frictionImpulse ?? [])) > 1e-8 * mass);
          }
          for (let i = 0; i < 3; i++) {
            assert.ok(Math.abs(impulse[i] - expected[i]) < 2e-5 * mass);
            wrongError = Math.max(wrongError, Math.abs(duplicated[i] - expected[i]));
          }
        }
        assert.ok(frictionSamples > 0);
        assert.ok(
          wrongError > 1e-3 * mass,
          'duplicating shared friction must violate the independent momentum oracle',
        );
      } finally {
        w.dispose();
      }
    }
});

test('contact observations restore immediately and continue exactly without aliases', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, -9.81, 0],
    joints: [],
    bodies: [
      {
        ...body,
        position: [0, -0.5, 0],
        halfExtents: [10, 0.5, 10],
        velocity: [0, 0, 0],
        fixed: true,
      },
      { ...body, position: [0, 0.5, 0], halfExtents: [0.5, 0.5, 0.5] },
    ],
  });
  try {
    for (let i = 0; i < 20; i++) w.step();
    const cp = w.snapshot(),
      sample = w.contacts();
    assert.ok(sample.rows.some((r) => r.solved));
    const alias = w.contacts();
    alias.rows[0].normal.fill(999);
    assert.deepEqual(w.contacts(), sample);
    w.step();
    const next = w.contacts(),
      physics = w.read();
    w.restore(cp);
    assert.deepEqual(w.contacts(), sample);
    w.step();
    assert.deepEqual(w.contacts(), next);
    assert.deepEqual(w.read(), physics);
  } finally {
    w.dispose();
  }
});

test('contact admission distinguishes predictive, unprocessed and measured zero samples', async () => {
  const { readContacts } = await import('../src/simulation/physics/read-contacts.mjs');
  const xyz = (x = 0, y = 0, z = 0) => ({ x, y, z });
  let normal = xyz(0, 1),
    impulse,
    solverContacts = 1,
    friction,
    group = 0;
  const m = {
    normal: () => normal,
    numContacts: () => 1,
    numSolverContacts: () => solverContacts,
    contactAppliedNormalImpulse: () => impulse,
    contactAppliedFrictionImpulse: () => friction,
    contactAppliedTwistImpulse: () => (friction ? xyz() : undefined),
    contactAppliedFrictionGroupSize: () => group,
    localContactPoint1: () => xyz(),
    localContactPoint2: () => xyz(),
    contactDist: () => 0.001,
  };
  let connected = true;
  const reader = {
    integrationParameters: { maxCcdSubsteps: 1 },
    getRigidBody: (handle) => ({ collider: () => ({ handle }) }),
    getCollider: (handle) => ({ handle }),
    contactPairsWith: (c, fn) => {
      if (connected) fn({ handle: 1 - c.handle });
    },
    contactPair: (a, b, fn) => fn(m, false),
  };
  const read = () => readContacts(reader, [0, 1]);
  assert.equal(read().available, false, 'sleeping or unprocessed contact cannot imply zero load');
  assert.equal(read().rows[0].normalImpulse, null);
  solverContacts = 0;
  assert.equal(
    read().available,
    true,
    'predictive geometry without a solver row is a known zero contribution',
  );
  assert.equal(read().rows[0].solved, false);
  solverContacts = 1;
  impulse = 0;
  friction = xyz();
  group = 1;
  assert.equal(read().available, true);
  assert.deepEqual(read().rows[0].normalImpulse, [0, 0, 0]);
  assert.deepEqual(
    read(),
    JSON.parse(JSON.stringify(read())),
    'contact transport preserves signed-zero canonicalization',
  );
  m.localContactPoint1 = () => xyz(-0, -0, -0);
  m.localContactPoint2 = () => xyz(-0, -0, -0);
  m.contactDist = () => -0;
  normal = xyz(-0, 1, -0);
  for (const flipped of [false, true]) {
    reader.contactPair = (a, b, fn) => fn(m, flipped);
    assert.deepEqual(read(), JSON.parse(JSON.stringify(read())));
  }
  reader.contactPair = (a, b, fn) => fn(m, false);
  impulse = 0.1;
  friction = xyz(0.02);
  group = 1;
  const loaded = read();
  assert.equal(loaded.available, true);
  impulse = undefined;
  friction = undefined;
  group = 0;
  assert.equal(read().available, false, 'a subsequent unavailable sample cannot retain the load');
  assert.equal(loaded.rows[0].normalImpulse[1], 0.1, 'completed copies remain unchanged');
  connected = false;
  assert.deepEqual(read().rows, []);
  assert.equal(read().available, true);
  connected = true;
  impulse = 0.1;
  friction = xyz();
  group = 1;
  for (normal of [xyz(), xyz(0, 2), xyz(0, NaN)]) assert.throws(read, /contact/);
  normal = xyz(0, 1);
  for (const invalid of [null, false, NaN, Infinity]) {
    m.contactDist = () => invalid;
    assert.throws(read, /non-finite contact/);
  }
  m.contactDist = () => 0;
  reader.integrationParameters.maxCcdSubsteps = 2;
  assert.equal(read().available, false);
  reader.integrationParameters.maxCcdSubsteps = 1;
  m.numContacts = () => 0;
  normal = xyz(); // Empty manifolds have no meaningful contact normal.
  solverContacts = 1;
  assert.deepEqual(read(), { intervalSeconds: 1 / 120, available: false, rows: [] });
  solverContacts = 0;
  assert.deepEqual(read(), { intervalSeconds: 1 / 120, available: true, rows: [] });
});

test('contact collection admits its bound and fails closed on overflow', async () => {
  const { readContacts } = await import('../src/simulation/physics/read-contacts.mjs');
  let pairs = 1024;
  const m = {
    normal: () => ({ x: 0, y: 1, z: 0 }),
    numContacts: () => 4,
    numSolverContacts: () => 4,
    contactAppliedNormalImpulse: () => 0.1,
    contactAppliedFrictionImpulse: (i) => (i === 0 ? { x: 0, y: 0, z: 0 } : undefined),
    contactAppliedTwistImpulse: (i) => (i === 0 ? { x: 0, y: 0, z: 0 } : undefined),
    contactAppliedFrictionGroupSize: (i) => (i === 0 ? 4 : 0),
    localContactPoint1: (i) => ({ x: i, y: 0, z: 0 }),
    localContactPoint2: (i) => ({ x: i, y: 0, z: 0 }),
    contactDist: () => 0,
  };
  const reader = {
    integrationParameters: { maxCcdSubsteps: 1 },
    getRigidBody: (handle) => ({ collider: () => ({ handle }) }),
    getCollider: (handle) => ({ handle }),
    contactPairsWith: (c, fn) => {
      if (c.handle === 0) for (let i = 1; i <= pairs; i++) fn({ handle: i });
    },
    contactPair: (a, b, fn) => fn(m, false),
  };
  const mapping = Array.from({ length: 1026 }, (_, i) => i);
  assert.equal(readContacts(reader, mapping).rows.length, 4096);
  pairs++;
  assert.throws(() => readContacts(reader, mapping), /capacity/);
});

test('native contact callbacks reject invalid data and overflow after normal cleanup', async () => {
  const { default: R } = await import('@dimforge/rapier3d-deterministic-compat');
  const { readContacts } = await import('../src/simulation/physics/read-contacts.mjs');
  await R.init();
  const native = new R.World({ x: 0, y: 0, z: 0 });
  try {
    const a = native.createRigidBody(R.RigidBodyDesc.fixed());
    const b = native.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(0, 0.19, 0).setCanSleep(false),
    );
    native.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1), a);
    native.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1).setMass(1), b);
    native.step();
    const mapping = [a.handle, b.handle],
      read = () => readContacts(native, mapping);
    const positive = read(),
      before = native.takeSnapshot();
    assert.ok(positive.rows.length > 0);
    assert.throws(() => readContacts(native, [a.handle]), /unmapped contact collider/);
    assert.deepEqual(read(), positive, 'outer callback failure must not poison the next query');
    const original = native.contactPair.bind(native);
    let mode = 'normal',
      repetitions = 1,
      returned = 0;
    native.contactPair = (a, b, callback) =>
      original(a, b, (manifold, flipped) => {
        const view = new Proxy(manifold, {
          get(target, key) {
            if (key === 'normal' && mode !== 'normal')
              return () => {
                if (mode === 'falsy') throw undefined;
                return { x: 0, y: 0, z: 0 };
              };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        for (let i = 0; i < repetitions; i++) {
          callback(view, flipped);
          returned++;
        }
      });
    mode = 'invalid';
    assert.throws(read, /invalid contact normal/);
    assert.ok(returned > 0, 'collection failure must return normally to native cleanup');
    mode = 'falsy';
    let caught = false;
    try {
      read();
    } catch (error) {
      caught = true;
      assert.equal(error, undefined);
    }
    assert.equal(caught, true, 'a falsy thrown value must still reject');
    mode = 'normal';
    assert.deepEqual(read(), positive, 'a failed query must not poison the next query');
    assert.equal(4096 % positive.rows.length, 0);
    repetitions = 4096 / positive.rows.length;
    assert.equal(read().rows.length, 4096);
    repetitions++;
    returned = 0;
    assert.throws(read, /capacity/);
    assert.ok(returned > 0, 'overflow must unwind normally before rethrowing');
    repetitions = 1;
    assert.deepEqual(read(), positive);
    assert.deepEqual(
      native.takeSnapshot(),
      before,
      'all reads and rejected reads are non-mutating',
    );
  } finally {
    native.free();
  }
});

test('rolling convex wheels retain local paired contact witnesses through simplex reduction', async () => {
  const { default: R } = await import('@dimforge/rapier3d-deterministic-compat');
  await R.init();
  const radius = 0.1,
    halfWidth = 0.025,
    supportRadius = Math.hypot(radius, halfWidth);
  const vertices = new Float64Array(
    Array.from({ length: 128 }, (_, i) => {
      const angle = ((i % 64) * Math.PI) / 32;
      return [i < 64 ? -halfWidth : halfWidth, radius * Math.cos(angle), radius * Math.sin(angle)];
    }).flat(),
  );
  for (const reflected of [false, true])
    for (const groundFirst of [false, true]) {
      for (const rolling of [false, true]) {
        const sign = reflected ? -1 : 1;
        const native = new R.World({ x: 0, y: -9.81, z: 0 });
        native.timestep = 1 / 120;
        try {
          // An ordinary slightly tilted wheel. The still case is the positive control;
          // rolling repeatedly reduces the GJK simplex as the supporting facet changes.
          const q = {
            x: -0.3325913919597106 * sign,
            y: 0.007119667302311628 * sign,
            z: -0.005389694997666216,
            w: -0.9430287522231964,
          };
          const addWheel = () => {
            const body = native.createRigidBody(
              R.RigidBodyDesc.dynamic()
                .setTranslation(0.3630529641497985, 0.1002579876918331, 0.6750923117217447 * sign)
                .setRotation(q)
                .setCanSleep(false),
            );
            const collider = native.createCollider(
              R.ColliderDesc.convexHull(vertices).setMass(1),
              body,
            );
            body.setLinvel({ x: 0, y: 0, z: rolling ? sign : 0 }, true);
            body.setAngvel({ x: rolling ? 10 * sign : 0, y: 0, z: 0 }, true);
            return { body, collider };
          };
          const addGround = () =>
            native.createCollider(
              R.ColliderDesc.cuboid(100, 0.1, 100),
              native.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)),
            );
          let wheel, ground;
          if (groundFirst) {
            ground = addGround();
            wheel = addWheel();
          } else {
            wheel = addWheel();
            ground = addGround();
          }
          let contacts = 0,
            maxContactPoints = 0;
          for (let tick = 0; tick < 120; tick++) {
            const before = wheel.body.translation();
            native.step();
            const after = wheel.body.translation(),
              points = [];
            native.contactPair(wheel.collider, ground, (manifold, flipped) => {
              for (let i = 0; i < manifold.numContacts(); i++)
                points.push({
                  wheel: flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i),
                  ground: flipped ? manifold.localContactPoint1(i) : manifold.localContactPoint2(i),
                });
            });
            maxContactPoints = Math.max(maxContactPoints, points.length);
            const movement = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
            for (let i = 0; i < points.length; i++)
              for (let j = 0; j < i; j++) {
                const a = points[i],
                  b = points[j];
                const scale = Math.max(
                  Math.hypot(before.x, before.y, before.z),
                  ...[a.wheel, a.ground, b.wheel, b.ground].map((p) => Math.hypot(p.x, p.y, p.z)),
                );
                const roundoff = ((64 * Number.EPSILON) / (1 - 64 * Number.EPSILON)) * scale;
                const separation = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
                assert.ok(
                  separation(a.wheel, b.wheel) > roundoff ||
                    separation(a.ground, b.ground) > roundoff,
                  'coincident paired witnesses must not carry independent warmstart histories',
                );
              }
            for (const point of points) {
              contacts++;
              assert.ok(
                Math.hypot(point.wheel.x, point.wheel.y, point.wheel.z) <= supportRadius + 1e-10,
              );
              // The ground witness must be next to this wheel. Allow the entire shape
              // radius, native prediction distance and this completed step's translation.
              const distance = Math.hypot(
                point.ground.x - before.x,
                point.ground.y - 0.1 - before.y,
                point.ground.z - before.z,
              );
              assert.ok(
                distance <=
                  supportRadius +
                    native.integrationParameters.normalizedPredictionDistance +
                    movement +
                    1e-10,
                `remote contact witness: ${JSON.stringify({ reflected, groundFirst, rolling, tick, distance, movement })}`,
              );
            }
          }
          assert.ok(contacts > 0, 'positive control must exercise real wheel/ground contacts');
          assert.ok(maxContactPoints >= 2, 'distinct support witnesses must survive deduplication');
        } finally {
          native.free();
        }
      }
    }
});

function fixedMountingChain({ gravity, reflected, reversed }) {
  const sign = reflected ? -1 : 1;
  const body = {
    shape: 'box',
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.01, 0.01, 0.08],
    fixed: false,
    rotation: [0, 0, 0, 1],
    friction: 0.6,
    restitution: 0,
  };
  const bodies = [
    { ...body, position: [0, 1, 0], fixed: true },
    { ...body, position: [0.09 * sign, 1, 0], mass: 0.1728 },
    { ...body, position: [0.19 * sign, 1, 0], mass: 0.704, halfExtents: [0.02, 0.2, 0.02] },
    { ...body, position: [0.29 * sign, 1, 0], mass: 0.1728 },
    { ...body, position: [0.38 * sign, 1, 0], mass: 6, halfExtents: [0.08, 0.03, 0.08] },
  ];
  const joints = bodies.slice(1).map((_, i) => ({
    kind: 'fixed',
    a: i,
    b: i + 1,
    anchorA: [(bodies[i + 1].position[0] - bodies[i].position[0]) / 2, 0, 0],
    anchorB: [(bodies[i].position[0] - bodies[i + 1].position[0]) / 2, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  }));
  if (reversed) {
    bodies.reverse();
    joints.reverse();
    for (const j of joints) {
      j.a = 4 - j.a;
      j.b = 4 - j.b;
    }
  }
  return { gravity: gravity ? [0, -9.81, 0] : [0, 0, 0], bodies, joints };
}
test('loaded fixed mounting chains preserve rigid geometry without an active elastic motor', async () => {
  // An anchored fixed mechanism has no physical free mode. Ten micrometres is
  // 0.05% of its smallest 20 mm member; the 0.1 mm load-motion budget allows
  // accumulated numerical error across the four joints. Both budgets are frozen
  // before evaluating the coupled-solver candidate. The no-gravity case is the
  // initial-geometry positive control, not a substitute for the loaded cases.
  for (const gravity of [false, true])
    for (const reflected of [false, true])
      for (const reversed of [false, true]) {
        const config = fixedMountingChain({ gravity, reflected, reversed }),
          world = await createPhysicsWorld(config);
        try {
          let maximumGap = 0,
            maximumMovement = 0;
          for (let tick = 0; tick < 360; tick++) {
            world.step();
            const state = world.read();
            for (const j of config.joints) {
              const a = state[j.a],
                b = state[j.b],
                ra = rotateFixedAnchor(a.rotation, j.anchorA),
                rb = rotateFixedAnchor(b.rotation, j.anchorB);
              maximumGap = Math.max(
                maximumGap,
                Math.hypot(
                  ...a.position.map(
                    (value, axis) => value + ra[axis] - b.position[axis] - rb[axis],
                  ),
                ),
              );
            }
            for (let i = 0; i < state.length; i++)
              maximumMovement = Math.max(
                maximumMovement,
                Math.hypot(
                  ...state[i].position.map(
                    (value, axis) => value - config.bodies[i].position[axis],
                  ),
                ),
              );
          }
          assert.ok(
            Number.isFinite(maximumGap) && maximumGap <= 1e-5,
            `fixed anchors separated: ${JSON.stringify({ gravity, reflected, reversed, maximumGap })}`,
          );
          assert.ok(
            Number.isFinite(maximumMovement) && maximumMovement <= 1e-4,
            `fixed mechanism moved: ${maximumMovement}`,
          );
        } finally {
          world.dispose();
        }
      }
});

test('tangent parallel convex cylinders retain a separating contact normal under ordering and rotation', async (t) => {
  // These are ordinary snapped poses. Their roundoff-sized axial/rotational
  // differences must not turn radial contact into a near-axial impulse. The
  // admissible radial normal cone is the half-angle of a 64-sided polygon face;
  // 1e-8 covers pose arithmetic, not a geometrically wrong contact direction.
  const small = {
    shape: 'cylinder',
    position: [-0.3549999999999999, 0.0999999999999983, -4.163336342344376e-17],
    rotation: [-0.5000000000000001, 0.49999999999999983, 0.5000000000000001, 0.49999999999999994],
    velocity: [0, 0, 0],
    mass: 0.43196898986859666,
    halfExtents: [0.025, 0.05, 0.05],
    fixed: false,
    friction: 0.9,
    restitution: 0.2,
  };
  const large = {
    ...small,
    position: [-0.5049999999999999, 0.1, -4.163336342344376e-17],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    mass: 1.7278759594743867,
    halfExtents: [0.025, 0.1, 0.1],
  };
  // A strict roundoff-only tangency correction missed these two nearby cases.
  // Keep them distinct: unequal widths with a positive gap, and a tilted,
  // reversed pair with tiny real overlap. Neither changes the physical normal cone.
  const tilt = [...Array(3).fill(Math.sin(0.71 / 2) / Math.sqrt(3)), Math.cos(0.71 / 2)];
  for (const scenario of [
    {
      name: 'unequal-width positive near-touch gap',
      gap: 1e-12,
      widths: [0.007, 0.05],
      tilted: false,
      reversed: false,
    },
    {
      name: 'tilted reversed near-touch overlap',
      gap: -1e-12,
      widths: [0.025, 0.025],
      tilted: true,
      reversed: true,
    },
  ])
    await t.test(scenario.name, async () => {
      const bodies = structuredClone([small, large]);
      bodies[1].position[0] -= scenario.gap;
      for (let i = 0; i < bodies.length; i++) bodies[i].halfExtents[0] = scenario.widths[i];
      const rotation = scenario.tilted ? tilt : [0, 0, 0, 1];
      if (scenario.tilted)
        for (const b of bodies) {
          b.position = rotateFixedAnchor(rotation, b.position);
          b.rotation = multiplyQuaternion(rotation, b.rotation);
        }
      if (scenario.reversed) bodies.reverse();
      const radial = rotateFixedAnchor(rotation, [scenario.reversed ? 1 : -1, 0, 0]);
      const axial = rotateFixedAnchor(rotation, [0, 0, 1]);
      const world = await createPhysicsWorld({ gravity: [0, 0, 0], bodies, joints: [] });
      try {
        world.step();
        const sample = world.contacts();
        assert.equal(sample.available, true);
        assert.ok(sample.rows.length > 0, 'near-touch witness must produce a real manifold');
        for (const contact of sample.rows) {
          const radialProjection = contact.normal.reduce(
            (sum, value, axis) => sum + value * radial[axis],
            0,
          );
          const axialProjection = contact.normal.reduce(
            (sum, value, axis) => sum + value * axial[axis],
            0,
          );
          assert.ok(
            radialProjection >= Math.cos(Math.PI / 64) - 1e-8,
            `near-touch normal left the facet cone: ${JSON.stringify({ scenario, normal: contact.normal, radialProjection, axialProjection })}`,
          );
          assert.ok(Math.abs(axialProjection) <= 1e-8, 'near-touch normal must remain radial');
        }
      } finally {
        world.dispose();
      }
    });
  for (const gap of [0.00025, 0])
    for (const turned of [false, true])
      for (const reversed of [false, true]) {
        const bodies = structuredClone([small, large]);
        bodies[1].position[0] -= gap;
        if (turned)
          for (const b of bodies) {
            const [x, y, z, w] = b.rotation;
            b.rotation = [z, w, -x, -y];
            b.position = [-b.position[0], b.position[1], -b.position[2]];
          }
        if (reversed) bodies.reverse();
        const world = await createPhysicsWorld({ gravity: [0, 0, 0], bodies, joints: [] });
        try {
          world.step();
          const contacts = world.contacts();
          assert.equal(contacts.available, true);
          assert.ok(
            contacts.rows.length > 0,
            'nearby positive control must exercise a real manifold',
          );
          const direction = Math.sign(bodies[1].position[0] - bodies[0].position[0]);
          for (const contact of contacts.rows) {
            assert.ok(
              contact.normal[0] * direction >= Math.cos(Math.PI / 64) - 1e-8,
              `nonseparating cylinder normal: ${JSON.stringify({ gap, turned, reversed, normal: contact.normal })}`,
            );
            assert.ok(
              Math.abs(contact.normal[2]) <= 1e-8,
              'overlapping axial intervals require a radial separating normal',
            );
          }
          if (gap !== 0) continue;
          for (let tick = 0; tick < 12; tick++) {
            world.applyImpulse(reversed ? 1 : 0, [turned ? 0.005 : -0.005, 0, 0]);
            world.step();
            const [a, b] = world.read();
            assert.ok(
              Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) >=
                0.15 - 0.001,
              'loaded rollers stay within the one-millimetre contact allowance',
            );
          }
        } finally {
          world.dispose();
        }
      }
});

test('launcher roller contacts resolve near-rest and bounded fast impacts without crossing or energy creation', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const bp = createSpringLauncher(),
    configuration = compileAssembly(bp).configuration;
  const authored = (id) =>
    structuredClone(configuration.bodies[bp.parts.findIndex((p) => p.id === id)]);
  // 6 m/s exceeds sqrt(2*6.615/(0.9*.431969))=5.834 m/s: all stored
  // energy plus the alternative-source allowance placed in the lightest roller.
  // 0.01 m/s moves only83 micrometres per tick. These isolated geometry tests
  // qualify these contact speeds, not every preload or whole-machine impact.
  const spring = configuration.joints.find((j) => j.kind === 'spring');
  const anchor = (index, local) =>
    rotateFixedAnchor(configuration.bodies[index].rotation, local).map(
      (v, k) => v + configuration.bodies[index].position[k],
    );
  const pointA = anchor(spring.a, spring.anchorA),
    pointB = anchor(spring.b, spring.anchorB);
  const initialLength = rotateFixedAnchor(
    configuration.bodies[spring.a].rotation,
    spring.axisA,
  ).reduce((sum, v, k) => sum + v * (pointB[k] - pointA[k]), 0);
  const stored = 0.5 * spring.stiffness * (spring.restLength - initialLength) ** 2;
  assert.ok(
    Math.sqrt(
      (2 * stored) / 0.9 / Math.min(authored('pusher-roller').mass, authored('gate-roller').mass),
    ) <= 6,
  );
  const kinetic = (bodies, states) =>
    states.reduce((sum, state, i) => {
      const {
        mass,
        halfExtents: [halfLength, radius],
      } = bodies[i];
      const local = rotateFixedAnchor(
        state.rotation.map((v, k) => (k < 3 ? -v : v)),
        state.angularVelocity,
      );
      const transverse = (mass * (3 * radius ** 2 + 4 * halfLength ** 2)) / 12;
      const inertia = [(mass * radius ** 2) / 2, transverse, transverse];
      return (
        sum +
        (mass * state.velocity.reduce((s, v) => s + v * v, 0)) / 2 +
        local.reduce((s, v, k) => s + inertia[k] * v * v, 0) / 2
      );
    }, 0);
  const extentX = (body, state) => {
    const axis = rotateFixedAnchor(state.rotation, [1, 0, 0]);
    return (
      body.halfExtents[0] * Math.abs(axis[0]) + body.halfExtents[1] * Math.hypot(axis[1], axis[2])
    );
  };
  const assess = ({ rows, transfer, initialEnergy }, moving) => {
    for (const row of rows) {
      assert.ok(
        Number.isFinite(row.gap) && row.gap >= -0.001,
        'completed contact overlap exceeds the existing one-millimetre allowance',
      );
      // Reuse the independent impulse energy oracle's1e-8 J bound. Include
      // rotation: an off-centre collision cannot hide energy in angular speed.
      assert.ok(
        Number.isFinite(row.energy) && row.energy <= initialEnergy + 1e-8,
        'isolated passive contact creates kinetic energy',
      );
    }
    if (moving) assert.ok(transfer > 0, 'real contact must transfer signed outward impulse');
    else assert.ok(Math.abs(transfer) <= 1e-10, 'rest control has no impact impulse');
  };
  for (const id of ['pusher-roller', 'gate-roller'])
    for (const speed of [0, 0.01, 6])
      for (const turned of [false, true])
        for (const reversed of [false, true]) {
          const bodies = [authored('projectile'), authored(id)];
          let direction = Math.sign(bodies[0].position[0] - bodies[1].position[0]);
          bodies[1].velocity = [direction * speed, 0, 0];
          if (turned) {
            direction *= -1;
            for (const b of bodies) {
              const [x, y, z, w] = b.rotation;
              b.rotation = [z, w, -x, -y];
              b.position = [-b.position[0], b.position[1], -b.position[2]];
              b.velocity[0] *= -1;
            }
          }
          if (reversed) bodies.reverse();
          const projectile = reversed ? 1 : 0,
            mover = 1 - projectile;
          const world = await createPhysicsWorld({ gravity: [0, 0, 0], bodies, joints: [] });
          try {
            const trial = { rows: [], transfer: 0, initialEnergy: kinetic(bodies, world.read()) };
            for (let tick = 0; tick < 24; tick++) {
              world.step();
              const states = world.read(),
                contacts = world.contacts();
              assert.equal(contacts.available, true);
              for (const contact of contacts.rows)
                if (contact.normalImpulse) {
                  assert.ok(contact.normalImpulse.every(Number.isFinite));
                  trial.transfer +=
                    (contact.a === projectile ? -1 : 1) * direction * contact.normalImpulse[0];
                }
              trial.rows.push({
                gap:
                  (states[projectile].position[0] - states[mover].position[0]) * direction -
                  extentX(bodies[projectile], states[projectile]) -
                  extentX(bodies[mover], states[mover]),
                energy: kinetic(bodies, states),
              });
            }
            assess(trial, speed > 0);
            if (speed > 0) {
              assert.throws(
                () => assess({ ...trial, transfer: 0 }, true),
                /signed outward impulse/,
              );
              assert.throws(
                () => assess({ ...trial, rows: [{ gap: -0.002, energy: 0 }] }, true),
                /overlap/,
              );
              assert.throws(
                () =>
                  assess(
                    { ...trial, rows: [{ gap: 0, energy: trial.initialEnergy + 1e-6 }] },
                    true,
                  ),
                /creates kinetic energy/,
              );
            }
          } finally {
            world.dispose();
          }
        }
});

test('loaded wheel axles settle with bounded constrained velocity residuals', async (t) => {
  // The mounting precision is 10 micrometres and 100 microradians per completed
  // 120 Hz tick. Check both actual anchor error and the drift predicted by the
  // remaining constrained velocity; a small pose error alone can hide chatter.
  const linearPrecision = 1e-5,
    angularPrecision = 1e-4,
    dt = 1 / 120;
  const subtract = (a, b) => a.map((value, k) => value - b[k]);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const configuration = (ratio, reversed, gravity) => {
    const common = {
      ...body,
      velocity: [0, 0, 0],
      friction: 0.6,
      restitution: 0,
    };
    const bodies = [
      { ...common, mass: ratio * 2, position: [0, 0.15, 0], halfExtents: [0.15, 0.04, 0.25] },
    ];
    const joints = [];
    for (const x of [-0.2, 0.2])
      for (const z of [-0.2, 0.2]) {
        joints.push({
          kind: 'revolute',
          a: 0,
          b: bodies.length,
          anchorA: [x, -0.05, z],
          anchorB: [0, 0, 0],
          axisA: [1, 0, 0],
          axisB: [1, 0, 0],
        });
        bodies.push({
          ...common,
          shape: 'cylinder',
          mass: 2,
          position: [x, 0.1, z],
          halfExtents: [0.025, 0.1, 0.1],
        });
      }
    if (gravity)
      bodies.push({
        ...common,
        mass: 1,
        fixed: true,
        position: [0, -0.1, 0],
        halfExtents: [10, 0.1, 10],
      });
    if (reversed) {
      bodies.reverse();
      joints.reverse();
      for (const joint of joints) {
        joint.a = bodies.length - 1 - joint.a;
        joint.b = bodies.length - 1 - joint.b;
      }
    }
    return { gravity: [0, gravity ? -9.81 : 0, 0], bodies, joints };
  };
  const assess = (states, joints) => {
    for (const joint of joints) {
      const a = states[joint.a],
        b = states[joint.b];
      const ra = rotateFixedAnchor(a.rotation, joint.anchorA),
        rb = rotateFixedAnchor(b.rotation, joint.anchorB);
      const va = cross(a.angularVelocity, ra).map((value, k) => value + a.velocity[k]),
        vb = cross(b.angularVelocity, rb).map((value, k) => value + b.velocity[k]);
      const axis = rotateFixedAnchor(a.rotation, joint.axisA),
        angular = subtract(a.angularVelocity, b.angularVelocity),
        freeSpeed = angular.reduce((sum, value, k) => sum + value * axis[k], 0);
      assert.ok(
        Math.hypot(...ra.map((value, k) => value + a.position[k] - rb[k] - b.position[k])) <=
          linearPrecision,
        'axle anchor precision',
      );
      assert.ok(
        Math.hypot(...subtract(va, vb)) * dt <= linearPrecision,
        'remaining constrained velocity exceeds one-tick mounting precision',
      );
      assert.ok(
        Math.hypot(...angular.map((value, k) => value - freeSpeed * axis[k])) * dt <=
          angularPrecision,
        'remaining transverse spin exceeds one-tick angular precision',
      );
    }
  };
  for (const ratio of [1, 25])
    for (const reversed of [false, true])
      await t.test(`frame/tire mass ratio ${ratio}, reversed ${reversed}`, async () => {
        const config = configuration(ratio, reversed, true),
          world = await createPhysicsWorld(config);
        try {
          for (let tick = 1; tick <= 480; tick++) {
            world.step();
            if (tick <= 240) continue;
            const contacts = world.contacts();
            assert.equal(contacts.available, true);
            assert.ok(
              contacts.rows.some((row) => row.normalImpulse?.some((value) => value !== 0)),
              'settled static equilibrium still carries the gravitational load',
            );
            assess(world.read(), config.joints);
          }
        } finally {
          world.dispose();
        }
      });
  await t.test('unloaded free-axis spin is preserved', async () => {
    const config = configuration(25, false, false),
      world = await createPhysicsWorld(config);
    try {
      world.applyTorquePair(0, 1, [1, 0, 0], 0.12);
      const initial = world.read(),
        initialSpin = initial[1].angularVelocity[0] - initial[0].angularVelocity[0];
      assert.ok(initialSpin > 0.09, 'the positive control actually excites the permitted axis');
      for (let tick = 0; tick < 240; tick++) world.step();
      const states = world.read(),
        axis = rotateFixedAnchor(states[0].rotation, [1, 0, 0]);
      const spin = subtract(states[1].angularVelocity, states[0].angularVelocity).reduce(
        (sum, value, k) => sum + value * axis[k],
        0,
      );
      assert.ok(spin > 0.09, 'settling must not lock or damp the free axle');
      assess(states, config.joints);
      const wrong = structuredClone(states);
      wrong[1].angularVelocity[2] += 1;
      assert.throws(() => assess(wrong, config.joints), /transverse spin/);
    } finally {
      world.dispose();
    }
  });
});
