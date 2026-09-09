import test from 'node:test';
import assert from 'node:assert/strict';
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
