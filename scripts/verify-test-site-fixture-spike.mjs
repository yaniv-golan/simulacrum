import * as CANNON from "cannon-es";
import { performance } from "node:perf_hooks";
import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import { testSiteVegetationFixtures } from "../src/model/test-site-vegetation.js";
import { createSurfaceField } from "../src/simulation/environment/surface-field.js";

const fixtures = [
    ...WORKSHOP_TEST_SITE.staticFixtures,
    ...testSiteVegetationFixtures(WORKSHOP_TEST_SITE),
  ],
  field = createSurfaceField(WORKSHOP_TEST_SITE),
  terrainHeightAt = (x, z) => field.sample({ x, z }).heightM,
  groundMaterial = new CANNON.Material("fixture-spike-ground"),
  compile = (grouped) => {
    const start = performance.now();
    const bodies = grouped
      ? createTestSiteFixtureBodies({
          fixtures,
          terrainHeightAt,
          groundMaterial,
        })
      : fixtures.flatMap((fixture) =>
          createTestSiteFixtureBodies({
            fixtures: [fixture],
            terrainHeightAt,
            groundMaterial,
          }),
        );
    return { bodies, compileMs: performance.now() - start };
  },
  measureWorld = (bodies) => {
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    });
    world.broadphase = new CANNON.SAPBroadphase(world);
    const plane = new CANNON.Body({ type: CANNON.Body.STATIC });
    plane.addShape(new CANNON.Plane());
    plane.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(plane);
    for (const body of bodies) world.addBody(body);
    for (let index = 0; index < 16; index++) {
      const body = new CANNON.Body({
        mass: 20,
        shape: new CANNON.Sphere(0.4),
        position: new CANNON.Vec3(-30 + index * 4, 2 + (index % 3), 20),
      });
      world.addBody(body);
    }
    const samples = [];
    for (let tick = 0; tick < 260; tick++) {
      const start = performance.now();
      world.step(1 / 120);
      if (tick >= 60) samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    return samples[Math.floor(samples.length * 0.95)];
  },
  individual = compile(false),
  grouped = compile(true),
  result = {
    fixtureCount: fixtures.length,
    shapeCount: grouped.bodies.reduce(
      (total, body) => total + body.shapes.length,
      0,
    ),
    individual: {
      bodyCount: individual.bodies.length,
      compileMs: individual.compileMs,
      fixedStepP95Ms: measureWorld(individual.bodies),
    },
    grouped: {
      bodyCount: grouped.bodies.length,
      compileMs: grouped.compileMs,
      fixedStepP95Ms: measureWorld(grouped.bodies),
      maximumShapesPerBody: Math.max(
        ...grouped.bodies.map(({ shapes }) => shapes.length),
      ),
    },
  };

assert.equal(result.fixtureCount, 362);
assert.equal(result.shapeCount, 371);
assert.equal(result.individual.bodyCount, 362);
assert.equal(result.grouped.bodyCount, 32);
assert.equal(result.grouped.maximumShapesPerBody, 24);
assert.ok(result.grouped.bodyCount < result.individual.bodyCount / 10);
console.log(JSON.stringify(result, null, 2));
