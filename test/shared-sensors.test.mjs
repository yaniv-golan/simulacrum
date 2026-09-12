import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSensor } from '../src/simulation/sensors.mjs';
import { SENSOR_DEFINITIONS, channelDefinition } from '../src/model/sensors.mjs';
const body = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [2, 3, 4],
  angularVelocity: [0, 2, 0],
};
const base = { tick: 1, dt: 1 / 120, bodies: [body], gravity: [0, -9.81, 0], powered: true };
test('all first-phase sensor families declare units and frames', () => {
  for (const kind of [
    'rotation',
    'travel',
    'range',
    'linearMotion',
    'tilt',
    'jointAngle',
    'contact',
  ])
    assert.ok(SENSOR_DEFINITIONS[kind]);
  assert.equal(channelDefinition('range', 'closingSpeed').unit, 'm/s');
  assert.throws(() => channelDefinition('range', 'targetIdentity'));
});
test('sensor point motion includes angular velocity and uses local axes', () => {
  const r = sampleSensor({ node: 0, kind: 'linearMotion', body: 0, origin: [0, 0, 1] }, base);
  assert.equal(r.channels.velocityX.value, 4);
  assert.equal(r.channels.velocityY.value, 3);
  const rotated = {
    ...body,
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    angularVelocity: [0, 0, 0],
  };
  const q = sampleSensor(
    { node: 0, kind: 'linearMotion', body: 0, origin: [0, 0, 0] },
    { ...base, bodies: [rotated] },
  );
  assert.ok(Math.abs(q.channels.velocityX.value - 3) < 1e-12);
  assert.ok(Math.abs(q.channels.velocityY.value + 2) < 1e-12);
});
test('range rate requires consecutive compatible returns and never invents zero', () => {
  const sensor = { node: 0, kind: 'range', body: 0, origin: [0, 0, 0], axis: [0, 0, 1], range: 10 };
  const first = sampleSensor(sensor, { ...base, ray: () => ({ distance: 3, surface: 4 }) });
  assert.equal(first.channels.distance.value, 3);
  assert.equal(first.channels.closingSpeed.status, 'initializing');
  const second = sampleSensor(sensor, {
    ...base,
    tick: 2,
    previous: first,
    ray: () => ({ distance: 2.99, surface: 4 }),
  });
  assert.ok(Math.abs(second.channels.closingSpeed.value - 1.2) < 1e-12);
  assert.equal(
    sampleSensor(sensor, {
      ...base,
      tick: 2,
      previous: first,
      ray: () => ({ distance: 2, surface: 5 }),
    }).channels.closingSpeed.status,
    'initializing',
  );
  const missing = sampleSensor(sensor, { ...base, ray: () => null });
  assert.deepEqual(missing.channels.distance, { status: 'no-return' });
  assert.deepEqual(
    sampleSensor(sensor, { ...base, powered: false, previous: first }).channels.distance,
    { status: 'no-power' },
  );
});
test('tilt is gravity-relative and joint sensor only measures its explicit joint', () => {
  const t = sampleSensor({ node: 0, kind: 'tilt', body: 0 }, base);
  assert.equal(t.channels.tiltX.value, 0);
  assert.equal(t.channels.angularVelocityY.value, 2);
  assert.equal(
    sampleSensor({ node: 0, kind: 'tilt', body: 0 }, { ...base, gravity: [0, 0, 0] }).channels.tiltX
      .status,
    'unavailable',
  );
  const joint = sampleSensor(
    { node: 0, kind: 'jointAngle', joint: 3, zero: 0.2, sign: -1 },
    {
      ...base,
      joint: (i) => {
        assert.equal(i, 3);
        return { angle: 0.5, speed: 2 };
      },
    },
  );
  assert.ok(Math.abs(joint.channels.angle.value + 0.3) < 1e-12);
  assert.equal(joint.channels.angularSpeed.value, -2);
});
test('contact reads only the authored exposed face and interval impulse becomes load', () => {
  const sensor = {
    node: 0,
    kind: 'contact',
    body: 0,
    origin: [0, 0, 0.01],
    axis: [0, 0, 1],
    halfWidth: 0.02,
    halfHeight: 0.02,
  };
  const r = sampleSensor(sensor, {
    ...base,
    contact: (spec) => {
      assert.equal(spec.body, 0);
      return { touching: true, normalImpulse: 0.1 };
    },
  });
  assert.equal(r.channels.touching.value, 1);
  assert.equal(r.channels.normalLoad.value, 12);
  assert.equal(
    sampleSensor(sensor, { ...base, powered: false }).channels.touching.status,
    'no-power',
  );
});

test('physics range stops at the first physical occluder including before the first step', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const body = {
    shape: 'box',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.1, 0.1, 0.1],
    fixed: true,
    rotation: [0, 0, 0, 1],
    friction: 0.5,
    restitution: 0,
  };
  const world = await createPhysicsWorld({
    gravity: [0, 0, 0],
    joints: [],
    bodies: [body, { ...body, position: [0, 0, 2] }, { ...body, position: [0, 0, 4] }],
  });
  try {
    assert.deepEqual(
      world.rangeSample({ body: 0, origin: [0, 0, 0], axis: [0, 0, 1], range: 10 }),
      { distance: 1.9, surface: 1 },
    );
    assert.equal(
      world.rangeSample({ body: 0, origin: [0, 0, 0], axis: [0, 0, -1], range: 10 }),
      null,
    );
    assert.equal(
      world.rangeSample({ body: 0, origin: [0, 0, 0], axis: [0, 0, 1], range: 1 }),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('physical pad reports normal load on its exposed face and rejects back-face support', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const body = {
    shape: 'box',
    position: [0, 0.025, 0],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.025, 0.015, 0.025],
    fixed: false,
    rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    friction: 0.5,
    restitution: 0,
  };
  for (const front of [true, false]) {
    const world = await createPhysicsWorld({
      gravity: [0, -9.81, 0],
      joints: [],
      bodies: [
        { ...body, rotation: [front ? Math.SQRT1_2 : -Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
        {
          ...body,
          position: [0, -0.1, 0],
          rotation: [0, 0, 0, 1],
          fixed: true,
          halfExtents: [2, 0.1, 2],
        },
      ],
    });
    try {
      for (let i = 0; i < 60; i++) world.step();
      const sample = world.contactPadSample({
        body: 0,
        origin: [0, 0, 0.025],
        axis: [0, 0, 1],
        halfWidth: 0.025,
        halfHeight: 0.015,
      });
      assert.equal(sample.available, true);
      assert.equal(sample.touching, front);
      if (front) assert.ok(Math.abs(sample.normalImpulse / (1 / 120) - 9.81) < 0.1);
      else assert.equal(sample.normalImpulse, 0);
    } finally {
      world.dispose();
    }
  }
});

test('tilt singular axes stay unavailable and encoder zero/sign are wrapped', () => {
  const t = sampleSensor({ node: 0, kind: 'tilt', body: 0 }, { ...base, gravity: [9.81, 0, 0] });
  assert.equal(t.channels.tiltX.status, 'unavailable');
  assert.equal(t.channels.tiltZ.status, 'ok');
  const j = sampleSensor(
    { node: 0, kind: 'jointAngle', joint: 0, zero: -3, sign: 1 },
    { ...base, joint: () => ({ angle: 3, speed: 2 }) },
  );
  assert.ok(Math.abs(j.channels.angle.value - (6 - 2 * Math.PI)) < 1e-12);
  assert.equal(j.channels.angularSpeed.value, 2);
});
test('physical ray boundaries and ties are exact; rotating beams change range without translation', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const box = {
    shape: 'box',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.1, 0.1, 0.1],
    fixed: true,
    rotation: [0, 0, 0, 1],
    friction: 0,
    restitution: 0,
  };
  const world = await createPhysicsWorld({
    gravity: [0, 0, 0],
    joints: [],
    bodies: [
      box,
      { ...box, position: [0, 0, 2], halfExtents: [5, 5, 0.1] },
      { ...box, position: [0, 0, 2], halfExtents: [5, 5, 0.1] },
    ],
  });
  try {
    const spec = { body: 0, origin: [0, 0, 0], axis: [0, 0, 1], range: 10 };
    const hit = world.rangeSample(spec);
    assert.equal(hit.surface, 1);
    assert.equal(hit.distance, 1.9);
    assert.deepEqual(world.rangeSample({ ...spec, range: hit.distance }), hit);
    assert.equal(world.rangeSample({ ...spec, range: hit.distance - 1e-8 }), null);
    assert.equal(world.rangeSample({ ...spec, origin: [0, 0, 2] }).distance, 0);
    const sensor = { ...spec, node: 0, kind: 'range' };
    const first = sampleSensor(sensor, {
      ...base,
      bodies: [{ ...body, velocity: [0, 0, 0] }],
      ray: (q) => world.rangeSample(q),
    });
    const angle = 0.2;
    const second = sampleSensor(sensor, {
      ...base,
      tick: 2,
      previous: first,
      bodies: [
        {
          ...body,
          velocity: [0, 0, 0],
          rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
        },
      ],
      ray: (q) => world.rangeSample(q),
    });
    assert.ok(Math.abs(second.channels.distance.value - 1.9 / Math.cos(angle)) < 1e-12);
    assert.ok(
      second.channels.closingSpeed.value < 0,
      'a stationary origin can have nonzero range rate',
    );
  } finally {
    world.dispose();
  }
});
test('wheel spin cannot substitute for linear motion on a slipping trace', () => {
  const stationary = { ...body, velocity: [0, 0, 0], angularVelocity: [10, 0, 0] };
  const context = { ...base, bodies: [stationary] };
  assert.equal(
    sampleSensor({ node: 0, kind: 'rotation', axis: [1, 0, 0] }, context).channels.angularSpeed
      .value,
    10,
  );
  assert.equal(
    sampleSensor({ node: 0, kind: 'linearMotion', origin: [0, 0, 0] }, context).channels.velocityZ
      .value,
    0,
  );
});
test('one pad aggregates two supporting bodies and completed contact cache resets each step', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const box = {
    shape: 'box',
    mass: 1,
    velocity: [0, 0, 0],
    fixed: true,
    rotation: [0, 0, 0, 1],
    friction: 0.5,
    restitution: 0,
  };
  const w = await createPhysicsWorld({
    gravity: [0, -9.81, 0],
    joints: [],
    bodies: [
      {
        ...box,
        fixed: false,
        position: [0, 0.025, 0],
        halfExtents: [0.025, 0.015, 0.025],
        rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      },
      ...[-1, 1].map((sign) => ({
        ...box,
        position: [sign * 0.0125, -0.1, 0],
        halfExtents: [0.0125, 0.1, 0.2],
      })),
    ],
  });
  const pad = {
    body: 0,
    origin: [0, 0, 0.025],
    axis: [0, 0, 1],
    halfWidth: 0.025,
    halfHeight: 0.015,
  };
  try {
    assert.equal(w.contactPadSample(pad).normalImpulse, 0);
    for (let i = 0; i < 120; i++) w.step();
    const r = w.contactPadSample(pad);
    assert.equal(r.touching, true);
    assert.ok(Math.abs(r.normalImpulse * 120 - 9.81) < 0.15);
    assert.deepEqual(w.contactPadSample(pad), r);
  } finally {
    w.dispose();
  }
});
