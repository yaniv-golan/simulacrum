import { performance } from "node:perf_hooks";
import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createTestSiteCollisionBody } from "../src/simulation/environment/test-site-collision.js";

const environment = createTestingPlaygroundEnvironment(),
  featureProbes = [
    [65.2, 95.3],
    [108.2, 95.3],
    [150.2, 95.3],
    [72.2, 60.3],
    [116.2, 58.3],
    [154.2, 70.3],
    [-174.8, -61.7],
    [-174.8, -19.7],
    [-139.8, -124.7],
    [-104.8, -124.7],
    [-181.2, -93.7],
    [104.2, -111.7],
  ],
  dynamicProbes = [
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
  ];

function canonicalNormal(x, z) {
  const deltaM = 0.01,
    dx =
      (environment.terrainHeightAt(x + deltaM, z) -
        environment.terrainHeightAt(x - deltaM, z)) /
      (deltaM * 2),
    dz =
      (environment.terrainHeightAt(x, z + deltaM) -
        environment.terrainHeightAt(x, z - deltaM)) /
      (deltaM * 2),
    normal = new CANNON.Vec3(-dx, 1, -dz);
  normal.normalize();
  return normal;
}

function percentile95(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

function spike(elementSizeM) {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    groundMaterial = new CANNON.Material(`terrain-${elementSizeM}`),
    compileStarted = performance.now(),
    collision = createTestSiteCollisionBody({
      sampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
      fallbackMaterial: groundMaterial,
      targetElementSizeM: elementSizeM,
    }),
    compileMs = performance.now() - compileStarted;
  world.addBody(collision.body);

  let maximumHeightErrorM = 0,
    minimumNormalDot = 1;
  for (const [x, z] of featureProbes) {
    const result = new CANNON.RaycastResult();
    assert.equal(
      world.raycastClosest(
        new CANNON.Vec3(x, 40, z),
        new CANNON.Vec3(x, -20, z),
        { skipBackfaces: false },
        result,
      ),
      true,
      `resolution ${elementSizeM} missed terrain at ${x}, ${z}`,
    );
    maximumHeightErrorM = Math.max(
      maximumHeightErrorM,
      Math.abs(result.hitPointWorld.y - environment.terrainHeightAt(x, z)),
    );
    minimumNormalDot = Math.min(
      minimumNormalDot,
      result.hitNormalWorld.dot(canonicalNormal(x, z)),
    );
  }

  for (const [index, [x, z]] of dynamicProbes.entries()) {
    const body = new CANNON.Body({
      mass: 18 + index,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(0.28, 0.28, 0.28)),
      position: new CANNON.Vec3(x, environment.terrainHeightAt(x, z) + 1.2, z),
    });
    world.addBody(body);
  }
  const stepMs = [];
  for (let tick = 0; tick < 360; tick++) {
    const started = performance.now();
    world.step(1 / 120);
    stepMs.push(performance.now() - started);
  }
  return Object.freeze({
    requestedElementSizeM: elementSizeM,
    actualElementSizeM: collision.elementSize,
    triangles: collision.segmentsX * collision.segmentsZ * 2,
    vertices: collision.vertexCount,
    compileMs,
    maximumHeightErrorM,
    minimumNormalDot,
    fixedStepP95Ms: percentile95(stepMs),
  });
}

const results = [2.5, 2, 1.25].map(spike),
  selected = results[1];
console.log(JSON.stringify({ selectedElementSizeM: 2, results }, null, 2));
assert.equal(selected.actualElementSizeM, 2);
assert.ok(selected.compileMs < 1_000);
assert.ok(selected.fixedStepP95Ms < 8);
assert.ok(selected.maximumHeightErrorM < 0.025);
assert.ok(selected.minimumNormalDot > 0.99);
