import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const asset = (name) => new URL(`./fixtures/spring-reference/${name}`, import.meta.url);
const reference = JSON.parse(readFileSync(asset('samples.json'), 'utf8'));
const phi = Math.atan2(-0.8, -0.6);
function fixture(mass, damping) {
  const rotation = [0, 0, Math.sin(phi / 2), Math.cos(phi / 2)];
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
  const pin = (a, b, anchorA, anchorB) => ({
    kind: 'revolute',
    a,
    b,
    anchorA,
    anchorB,
    axisA: [0, 0, 1],
    axisB: [0, 0, 1],
  });
  return {
    gravity: [0, 0, 0],
    bodies: [
      body([0, 0, 0], [0, 0, 0, 1], 1, [0.015, 0.015, 0.015], true),
      body([0.12, 0, 0], [0, 0, 0, 1], mass, [0.06, 0.008, 0.008]),
      body([0, 0.18, 0], rotation, 1, [0.008, 0.02, 0.008]),
      body([0.24, 0, 0], rotation, 1, [0.008, 0.02, 0.008]),
    ],
    joints: [
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
        stiffness: 3,
        damping,
      },
      pin(1, 3, [0.12, 0, 0], [0, 0, 0]),
    ],
  };
}
function compare(actual, expected) {
  const q = expected.q.map(Number),
    v = expected.v.map(Number),
    p = reference.policy;
  for (const [i, body] of actual.slice(1).entries()) {
    const angle = 2 * Math.atan2(body.rotation[2], body.rotation[3]) - (i ? phi : 0);
    const errors = [
      [
        Math.hypot(body.position[0] - q[3 * i], body.position[1] - q[3 * i + 1]),
        p.positionMeters,
        'position',
      ],
      [
        Math.abs(Math.atan2(Math.sin(angle - q[3 * i + 2]), Math.cos(angle - q[3 * i + 2]))),
        p.angleRadians,
        'angle',
      ],
      [
        Math.hypot(body.velocity[0] - v[3 * i], body.velocity[1] - v[3 * i + 1]),
        p.linearVelocityMetersPerSecond,
        'velocity',
      ],
      [
        Math.abs(body.angularVelocity[2] - v[3 * i + 2]),
        p.angularVelocityRadiansPerSecond,
        'angular velocity',
      ],
      [
        Math.max(
          Math.abs(body.position[2]),
          Math.abs(body.velocity[2]),
          ...body.angularVelocity.slice(0, 2).map(Math.abs),
          ...body.rotation.slice(0, 2).map(Math.abs),
        ),
        p.positionMeters,
        'planarity',
      ],
    ];
    for (const [error, limit, field] of errors)
      assert.ok(error <= limit, `tick ${expected.tick}, body ${i}, ${field}: ${error} > ${limit}`);
  }
}
test('spring reference provenance matches the independent equation source', () => {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(asset('regularized_tick.py')))
      .digest('hex'),
    reference.generatorSha256,
  );
});
for (const caseData of reference.cases) {
  test(`spring discrete reference: arm mass ${caseData.massRatio}, damping ${caseData.damping}`, async () => {
    const world = await createPhysicsWorld(
      fixture(Number(caseData.massRatio), Number(caseData.damping)),
    );
    try {
      assert.equal(caseData.ticks, 1200);
      assert.deepEqual(
        caseData.samples.map((s) => s.tick),
        [1, ...Array.from({ length: caseData.ticks / 60 }, (_, i) => (i + 1) * 60)],
      );
      const samples = new Map(caseData.samples.map((s) => [s.tick, s]));
      for (let tick = 1; tick <= caseData.ticks; tick++) {
        world.prepareConstraints();
        world.prepareSprings();
        world.applyPreparedConstraints();
        world.applySprings();
        world.step();
        if (samples.has(tick)) compare(world.read(), samples.get(tick));
        if (tick === 1) {
          const rounded = structuredClone(world.read());
          for (const body of rounded)
            for (const key of ['position', 'rotation', 'velocity', 'angularVelocity'])
              body[key] = body[key].map(Math.fround);
          assert.throws(
            () => compare(rounded, samples.get(tick)),
            /tick 1/,
            'f32 boundary readout must fail the same physical comparison',
          );
        }
      }
    } finally {
      world.dispose();
    }
  });
}
