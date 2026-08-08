import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { TYPES } from "../src/model/component-catalog.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";

const environment = createTestingPlaygroundEnvironment();

function fluidFixture(x, z, y, speedMps = 0) {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("test-site-fluid-probe"),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: new CannonWorldAdapter(world),
      material,
      catalog: TYPES,
      pondAt: environment.pondAt,
      terrainHeightAt: environment.terrainHeightAt,
      surfaceHeightAt: environment.surfaceHeightAt,
    }),
    assembly = {
      revision: 1,
      parts: [
        {
          id: 1,
          type: "beam",
          pos: [x, y, z],
          orientation: [0, 0, 0, 1],
          config: { linearDamping: 0, angularDamping: 0 },
        },
      ],
      connections: [],
    };
  runtime.start(JSON.stringify(assembly));
  runtime.bodyByPart.get(1).velocity.set(speedMps, 0, 0);
  return runtime.applyFluidForces();
}

const deep = environment.pondAt(-140, -125),
  shallow = environment.pondAt(-181, -94),
  deepState = fluidFixture(-140, -125, deep.waterY, 0.4),
  shallowState = fluidFixture(-181, -94, shallow.waterY, 0.2),
  dryState = fluidFixture(104, -112, 0, 4);

assert.equal(deep.id, "deep-pool");
assert.equal(shallow.id, "shallow-ford");
assert.equal(deep.depth, 3.2);
assert.equal(shallow.depth, 0.6);
assert.equal(environment.terrainHeightAt(-140, -125), deep.waterY - deep.depth);
assert.equal(
  environment.terrainHeightAt(-181, -94),
  shallow.waterY - shallow.depth,
);
assert.equal(deepState.inWater, true);
assert.equal(shallowState.inWater, true);
assert.equal(deepState.wetBodies, 1);
assert.equal(shallowState.wetBodies, 1);
assert.ok(deepState.buoyancyN > 0);
assert.ok(shallowState.buoyancyN > 0);
assert.ok(deepState.hydrodynamicDragN > shallowState.hydrodynamicDragN);
assert.ok(Math.abs(deepState.waterDepth - 3.2) < 1e-12);
assert.ok(Math.abs(shallowState.waterDepth - 0.6) < 1e-12);
assert.equal(dryState.inWater, false);
assert.equal(dryState.buoyancyN, 0);
assert.equal(dryState.hydrodynamicDragN, 0);
assert.equal(dryState.waterDepth, 0);

console.log(
  `test-site fluid runtime passed (${shallowState.waterDepth} m ford, ${deepState.waterDepth} m pool, ${deepState.buoyancyN.toFixed(1)} N buoyancy)`,
);
