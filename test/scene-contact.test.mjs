import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { loadSave, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { environmentObstacles, sceneLayout } from '../src/model/environment.mjs';
import { rotateVector, multiplyQuaternion } from '../src/model/transforms.mjs';
// Frozen development protocol: 1 kg, 5 cm half-size, 0.5 m/s approach,
// 120 Hz samples for 1 s. Coplanar seams must differ by <2 mm and <0.01 m/s
// from a continuous plane; energy gain must remain <0.02 J. Intentional edges
// have separate ballistic assertions. These fixtures do not qualify larger courses.
const body = {
  shape: 'box',
  halfExtents: [0.05, 0.05, 0.05],
  position: [0, 0.1, -0.25],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0.5],
  mass: 1,
  fixed: false,
  friction: 0,
  restitution: 0,
};
async function trace(bodies, ticks = 120) {
  const w = await createPhysicsWorld({ gravity: [0, -9.81, 0], bodies, joints: [] });
  try {
    const result = [];
    for (let t = 0; t < ticks; t++) {
      w.step();
      result.push(w.read()[0]);
    }
    return result;
  } finally {
    w.dispose();
  }
}
const platform = (z, length, y = 0) => ({
  ...environmentObstacles(sceneLayout('steps'))[0],
  position: [0, y, z],
  halfExtents: [0.3, 0.025, length],
  friction: 0,
});
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
function compareSeam(a, b) {
  for (let t = 24; t < a.length; t++) {
    assert.ok(distance(a[t].position, b[t].position) < 0.002, 'seam trajectory');
    assert.ok(distance(a[t].velocity, b[t].velocity) < 0.01, 'seam velocity');
  }
}
test('coplanar split platform matches continuous contact and detects a raised seam', async () => {
  const sled = { ...body, position: [0, 0.075, -0.25] };
  const continuous = await trace([sled, platform(0, 1)]);
  const joined = sceneLayout('flat');
  joined.objects = [-0.5, 0.5].map((z, i) => ({
    id: `slab-${i}`,
    name: 'Slab',
    shape: 'box',
    halfExtents: [0.3, 0.025, 0.5],
    position: [0, 0, z],
    rotation: [0, 0, 0, 1],
    material: 'steel',
    friction: 0,
    restitution: 0,
    fixed: true,
  }));
  const split = await trace([sled, ...environmentObstacles(joined)]);
  compareSeam(continuous, split);
  for (const magnitude of [-1, 1 - 1e-9, 1 - 4e-9]) {
    const altered = structuredClone(joined);
    altered.objects[1].rotation[3] = magnitude;
    const loaded = loadSave({
      ...createEmptyBlueprint('precision', 'Precision'),
      environment: altered,
    });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.blueprint.environment, altered, 'admission retains authored precision');
    const solids = environmentObstacles(loaded.blueprint.environment);
    assert.equal(solids.length, 1, 'equivalent admitted orientations remove the internal face');
    compareSeam(continuous, await trace([sled, ...solids]));
    assert.deepEqual(
      loaded.blueprint.environment,
      altered,
      'compilation does not rewrite the save',
    );
  }

  const raised = await trace([sled, platform(-0.5, 0.5), platform(0.5, 0.5, 0.02)]);
  assert.throws(() => compareSeam(continuous, raised));
  for (const s of split)
    assert.ok(
      0.5 * s.velocity.reduce((sum, v) => sum + v * v, 0) + 9.81 * s.position[1] <
        0.5 * 0.5 ** 2 + 9.81 * 0.075 + 0.02,
    );
});
test('authored incline has correct endpoints and analytical low-grip acceleration in rotated frames', async () => {
  const ramp = environmentObstacles(sceneLayout('hill'))[0];
  const low = rotateVector(ramp.rotation, [0, ramp.halfExtents[1], -ramp.halfExtents[2]]);
  const high = rotateVector(ramp.rotation, [0, ramp.halfExtents[1], ramp.halfExtents[2]]);
  assert.ok(Math.abs(low[1] + ramp.position[1]) < 1e-12);
  assert.ok(Math.abs(high[1] - low[1] - Math.sin(0.15)) < 1e-12);
  for (const sign of [-1, 1])
    for (const yaw of [0, Math.PI / 2, 0.73]) {
      const theta = sign * 0.15,
        rotation = multiplyQuaternion(
          [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
          [Math.sin(-theta / 2), 0, 0, Math.cos(theta / 2)],
        );
      const normal = rotateVector(rotation, [0, 1, 0]);
      const support = {
        ...ramp,
        rotation,
        position: [0, 0, 0],
        halfExtents: [0.3, 0.01, 2],
        friction: 0,
      };
      const sled = {
        ...body,
        rotation,
        velocity: [0, 0, 0],
        position: normal.map((v) => v * 0.06),
      };
      const samples = await trace([sled, support], 60);
      const tangent = rotateVector(rotation, [0, 0, 1]);
      const speed = samples.at(-1).velocity.reduce((s, v, i) => s + v * tangent[i], 0);
      assert.ok(Math.abs(speed + 9.81 * Math.sin(theta) * 0.5) < 0.025);
      assert.ok(
        Math.abs(speed - 9.81 * Math.sin(theta) * 0.5) > 0.5,
        'wrong slope direction must fail',
      );
      const resting = await trace(
        [
          { ...sled, friction: 1 },
          { ...support, friction: 1 },
        ],
        60,
      );
      assert.ok(distance(resting.at(-1).position, sled.position) < 0.003);
    }
});
test('an intentional platform edge permits a ballistic drop without energy creation', async () => {
  const samples = await trace(
    [{ ...body, position: [0, 0.075, -0.15] }, platform(-0.25, 0.25)],
    120,
  );
  const airborne = samples.findIndex((s) => s.position[2] > 0.1);
  assert.ok(airborne > 0);
  const initial = samples[airborne];
  for (let n = 1; n <= 12; n++) {
    const next = samples[airborne + n],
      time = n / 120;
    assert.ok(
      Math.abs(
        next.position[1] -
          (initial.position[1] + initial.velocity[1] * time - (9.81 * time * time) / 2),
      ) < 0.003,
    );
  }
  const wrong = structuredClone(samples);
  wrong[airborne + 12].position[1] += 0.04;
  const n = 12,
    time = n / 120;
  assert.ok(
    Math.abs(
      wrong[airborne + n].position[1] -
        (initial.position[1] + initial.velocity[1] * time - (9.81 * time * time) / 2),
    ) > 0.003,
  );
});

test('admitted size extrema and materials support ordinary loads in rotated box and cylinder frames', async () => {
  for (const material of ['aluminium', 'steel', 'rubber'])
    for (const shape of ['box', 'cylinder'])
      for (const extent of [0.005, 0.03, 2])
        for (const yaw of [0, 0.73]) {
          const scene = sceneLayout('flat');
          scene.objects.push({
            id: 'support',
            name: 'Support',
            shape,
            halfExtents: [extent, extent, extent],
            position: [0, extent, 0],
            rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
            material,
            friction: 0.8,
            restitution: 0,
            fixed: true,
          });
          const radius = extent / 4,
            height = 2 * extent + radius;
          const load = {
            ...body,
            shape: 'sphere',
            halfExtents: [radius, radius, radius],
            position: [0, height, 0],
            velocity: [0, 0, 0],
          };
          const samples = await trace([load, ...environmentObstacles(scene)], 48);
          const tolerance = Math.max(0.0002, extent * 0.015);
          for (const sample of samples) {
            assert.ok(
              Math.abs(sample.position[1] - height) < tolerance,
              `${shape}/${material}/${extent}/${yaw}: support`,
            );
            assert.ok(
              Math.abs(sample.velocity[1]) < 0.025,
              'supported load cannot acquire vertical speed',
            );
          }
          assert.ok(
            Math.abs(samples.at(-1).position[1] - (height + 2 * tolerance)) > tolerance,
            'wrong support height rejected',
          );
        }
});

test('floor to authored ramp and bump traversals bound excess energy without forbidding a failed climb', async () => {
  const ground = {
    ...platform(0, 4),
    position: [0, -0.1, 0],
    halfExtents: [4, 0.1, 4],
    friction: 0,
  };
  for (const kind of ['hill', 'bump']) {
    const scene = sceneLayout(kind);
    scene.objects[0].position[0] = 0;
    scene.objects[0].position[2] = 0;
    scene.objects[0].friction = 0;
    const sled = {
      ...body,
      halfExtents: [0.025, 0.025, 0.025],
      position: [0, 0.025, -0.7],
      velocity: [0, 0, 0.5],
    };
    const samples = await trace([sled, ground, ...environmentObstacles(scene)], 300);
    const energy = (sample) =>
      0.5 * sample.velocity.reduce((s, v) => s + v * v, 0) + 9.81 * sample.position[1];
    const initial = energy(sled);
    assert.ok(
      samples.some((s) => s.position[2] + sled.halfExtents[2] > (kind === 'hill' ? -0.5 : -0.03)),
      `${kind}: the load must reach the contact transition; maxZ=${Math.max(...samples.map((s) => s.position[2]))}, maxY=${Math.max(...samples.map((s) => s.position[1]))}`,
    );
    assert.ok(
      samples.some((s) => s.position[1] > 0.026),
      'the obstacle must affect the actual trajectory',
    );
    for (const s of samples) assert.ok(energy(s) - initial < 0.03, `${kind}: excess energy`);
    const wrong = structuredClone(samples.at(-1));
    wrong.position[1] += 0.1;
    assert.ok(energy(wrong) - initial > 0.03, 'an artificial lift must fail');
  }
});
