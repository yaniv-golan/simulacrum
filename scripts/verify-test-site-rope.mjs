import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { TYPES } from "../src/model/component-catalog.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { FlexibleLineRuntime } from "../src/simulation/flexible-line-runtime.js";
import { startMultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import {
  FlexibleLineStructureSystem,
  FlexibleLineSystem,
  FlexibleLineTelemetrySystem,
} from "../src/simulation/systems/flexible-line-system.js";
import { PhysicalAssemblySystem } from "../src/simulation/systems/physical-assembly-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";
import { TestSiteTelemetrySystem } from "../src/simulation/systems/test-site-telemetry-system.js";

const environment = createTestingPlaygroundEnvironment();

function ropePart(id, position, orientation = [0, 0, 0, 1]) {
  return {
    id,
    type: "rope",
    pos: position,
    orientation,
    scale: [1, 1, 1],
    config: {
      ...componentDefaults("rope"),
      lengthM: 3,
      diameterM: 0.06,
      targetElementLengthM: 0.25,
    },
  };
}

function runDrop({
  position,
  orientation,
  fixtures = [],
  windEnabled = false,
}) {
  const physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    fixtureBodies = createTestSiteFixtureBodies({
      fixtures,
      terrainHeightAt: environment.terrainHeightAt,
      groundMaterial: physics.groundMaterial,
    });
  for (const body of fixtureBodies) physics.world.addBody(body);
  const snapshot = {
      revision: 1,
      parts: [ropePart(1, position, orientation)],
      connections: [],
    },
    multibodyRuntime = startMultibodyRuntime(JSON.stringify(snapshot), {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      catalog: TYPES,
    }),
    flexibleLineRuntime = new FlexibleLineRuntime({
      world: physics.world,
      materialForKey: physics.materialForKey,
      multibodyRuntime,
    }).start(multibodyRuntime.compiled);
  let telemetry = null;
  const encounteredMaterialKeys = new Set();
  for (let tick = 1; tick <= 600; tick++) {
    flexibleLineRuntime.beforeIntegration(1 / 120);
    physics.worldAdapter.integrate(1 / 120, { tick });
    telemetry = flexibleLineRuntime.afterIntegration(tick, {
      pondAt: environment.pondAt,
      windEnabled,
    });
    for (const sample of telemetry.lines[0].contactSamples)
      if (sample.otherMaterialKey)
        encounteredMaterialKeys.add(sample.otherMaterialKey);
  }
  return {
    line: telemetry.lines[0],
    encounteredMaterialKeys,
    dispose() {
      flexibleLineRuntime.dispose();
      multibodyRuntime.dispose();
      for (const body of fixtureBodies) physics.world.removeBody(body);
      assert.equal(
        physics.world.bodies.length,
        2,
        "Test Reserve Rope fixture leaked physical bodies",
      );
    },
  };
}

for (const materialKey of ["dry-asphalt", "saturated-mud"]) {
  const lane = environment.testSite.surfaceRegions.find(
      (region) =>
        region.id.startsWith("lane-") && region.materialKey === materialKey,
    ),
    x = lane.shape.centerM[0],
    z = lane.shape.centerM[1],
    result = runDrop({
      position: [x, environment.terrainHeightAt(x, z) + 2, z],
      orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    }),
    materials = result.encounteredMaterialKeys;
  assert.ok(
    result.line.contactCount > 0,
    `${materialKey} Rope made no contact`,
  );
  assert.ok(
    materials.has(materialKey),
    `Rope contact did not retain canonical ${materialKey} provenance: ${JSON.stringify([...materials])}`,
  );
  assert.equal(result.line.validity, "valid");
  result.dispose();
}

{
  const lane = environment.testSite.surfaceRegions.find(
      (region) =>
        region.id.startsWith("lane-") && region.materialKey === "dry-asphalt",
    ),
    x = lane.shape.centerM[0],
    z = lane.shape.centerM[1],
    physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    snapshot = {
      revision: 1,
      parts: [
        ropePart(
          1,
          [x, environment.terrainHeightAt(x, z) + 2, z],
          [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        ),
      ],
      connections: [],
    },
    multibodyRuntime = startMultibodyRuntime(JSON.stringify(snapshot), {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      catalog: TYPES,
    }),
    flexibleLineRuntime = new FlexibleLineRuntime({
      world: physics.world,
      materialForKey: physics.materialForKey,
      multibodyRuntime,
    }).start(multibodyRuntime.compiled),
    physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    session = new SimulationSession({
      systems: [
        new FlexibleLineSystem(),
        new RigidBodySystem(),
        new FlexibleLineStructureSystem(),
        new StructureSystem(),
        new FlexibleLineTelemetrySystem(),
        new PhysicalAssemblySystem(),
        new TestSiteTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      flexibleLineRuntime,
      physicalAssemblyIndex,
      testSite: environment.testSite,
      surfaceSampleAt: environment.surfaceSampleAt,
    });
  session.stepFixed(600);
  const testSite = session.telemetry().systems.testSite,
    component = testSite.components[0];
  assert.ok(
    component,
    "completed Test Reserve telemetry omitted Rope entities",
  );
  assert.ok(component.partIds.includes(1));
  assert.equal(component.materialKey, "dry-asphalt");
  assert.ok(component.supportMaterialKeys.includes("dry-asphalt"));
  session.dispose();
  flexibleLineRuntime.dispose();
  multibodyRuntime.dispose();
}

const log = environment.testSite.staticFixtures.find(
    (fixture) => fixture.id === "trail-log-1",
  ),
  logX = log.pose.positionM[0],
  logZ = log.pose.positionM[2],
  acrossLog = new CANNON.Vec3(
    -Math.sin(log.pose.headingRad),
    0,
    Math.cos(log.pose.headingRad),
  ),
  orientation = new CANNON.Quaternion();
orientation.setFromVectors(new CANNON.Vec3(0, -1, 0), acrossLog);
const fixtureResult = runDrop({
    position: [logX, environment.terrainHeightAt(logX, logZ) + 2.2, logZ],
    orientation: [orientation.x, orientation.y, orientation.z, orientation.w],
    fixtures: [log],
  }),
  fixtureMaterials = fixtureResult.encounteredMaterialKeys;
assert.ok(
  fixtureMaterials.has("wood-bark"),
  `Rope did not contact the canonical Test Reserve log: ${JSON.stringify([...fixtureMaterials])}`,
);
fixtureResult.dispose();

const unsupportedWind = runDrop({
  position: [0, 2, 0],
  orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  windEnabled: true,
});
assert.equal(unsupportedWind.line.validity, "unsupported-envelope");
assert.deepEqual(unsupportedWind.line.unsupportedEffects, ["aerodynamic-drag"]);
unsupportedWind.dispose();

const water = environment.testSite.fluidRegions[0],
  waterX = water.shape.centerM[0],
  waterZ = water.shape.centerM[1],
  unsupportedWater = runDrop({
    position: [waterX, water.waterHeightM + 1, waterZ],
    orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  });
assert.equal(unsupportedWater.line.validity, "unsupported-envelope");
assert.ok(
  unsupportedWater.line.unsupportedEffects.includes("fluid-drag-and-buoyancy"),
);
unsupportedWater.dispose();

console.log(
  "Test Reserve Rope passed (dry asphalt, saturated mud, canonical log fixture, bounded contact provenance, explicit wind/water validity)",
);
