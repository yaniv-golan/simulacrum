import { performance } from "node:perf_hooks";
import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";

const environment = createTestingPlaygroundEnvironment(),
  compileStarted = performance.now(),
  physics = createWorkshopPhysicsWorld({
    surfaceSampleAt: environment.surfaceSampleAt,
    footprint: environment.testSite.footprint,
  }),
  compileMs = performance.now() - compileStarted,
  triangleCounts = physics.fieldBody.userData.triangleCounts,
  triangleCount = Object.values(triangleCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

const narrowphaseMethods = new Set(
    Object.getOwnPropertyNames(CANNON.Narrowphase.prototype),
  ),
  trimeshIndexProbe = new CANNON.Trimesh(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 2],
  );
assert.ok(trimeshIndexProbe.indices instanceof Int16Array);
assert.ok(narrowphaseMethods.has("sphereTrimesh"));
assert.equal(narrowphaseMethods.has("boxTrimesh"), false);
assert.equal(narrowphaseMethods.has("convexTrimesh"), false);
for (const method of [
  "sphereHeightfield",
  "boxHeightfield",
  "convexHeightfield",
  "heightfieldCylinder",
])
  assert.ok(
    narrowphaseMethods.has(method),
    `Cannon omitted required ${method} reserve contact support`,
  );

assert.equal(physics.terrainElementSize, 2);
assert.equal(physics.fieldBody.shapes.length, 1);
assert.equal(physics.fieldBody.shapes[0].type, CANNON.Shape.types.HEIGHTFIELD);
assert.equal(triangleCount, 86_400);
assert.equal(physics.fieldBody.userData.vertexCount, 43_621);
assert.ok(
  compileMs < 1_000,
  `full-reserve collision compilation exceeded 1 s (${compileMs.toFixed(1)} ms)`,
);
assert.ok(
  physics.fieldBody.shapes.every(
    (shape) =>
      shape.type === CANNON.Shape.types.HEIGHTFIELD && shape.userData?.shapeId,
  ),
  "reserve collider contains an unbounded or unidentified shape",
);
assert.equal(
  physics.world.bodies.length,
  2,
  "reserve compilation created more than the plate and one partitioned terrain body",
);
assert.equal(
  typeof physics.fieldBody.userData.broadphaseCandidateFilter,
  "function",
  "reserve collider omitted its bounded heightfield candidate filter",
);

const probes = [
  [-92, 108],
  [-70, 108],
  [65, 95],
  [108, 95],
  [150, 95],
  [72, 60],
  [116, 58],
  [154, 70],
  [-175, -62],
  [-175, -20],
  [-165, 82],
  [-140, -125],
  [-181, -94],
  [192, -18],
  [104, -43],
  [-30, -135],
].map(([x, z], index) => {
  const body = new CANNON.Body({
    mass: 18 + index,
    material: physics.debrisMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(0.28, 0.28, 0.28)),
    position: new CANNON.Vec3(x, environment.surfaceHeightAt(x, z) + 1.2, z),
  });
  body.userData = { externalBodyId: `test-site-performance:${index}` };
  physics.world.addBody(body);
  return body;
});

const stepMs = [];
for (let tick = 1; tick <= 360; tick++) {
  const started = performance.now();
  physics.worldAdapter.integrate(1 / 120, { tick });
  stepMs.push(performance.now() - started);
}
assert.ok(
  probes.every((body) =>
    [
      body.position.x,
      body.position.y,
      body.position.z,
      body.velocity.x,
      body.velocity.y,
      body.velocity.z,
    ].every(Number.isFinite),
  ),
  "full-reserve stress sample produced non-finite body state",
);
const orderedStepMs = [...stepMs].sort((left, right) => left - right),
  p95StepMs = orderedStepMs[Math.ceil(orderedStepMs.length * 0.95) - 1];
assert.ok(
  p95StepMs < 8,
  `full-reserve 16-body p95 fixed step exceeded 8 ms (${p95StepMs.toFixed(2)} ms)`,
);

for (const body of probes) physics.world.removeBody(body);
assert.equal(
  physics.world.bodies.length,
  2,
  "reserve stress teardown retained dynamic probe bodies",
);

console.log(
  `test-site performance passed (${triangleCount} triangles, one multi-material heightfield, ${compileMs.toFixed(1)} ms compile, ${p95StepMs.toFixed(2)} ms p95 fixed step)`,
);
