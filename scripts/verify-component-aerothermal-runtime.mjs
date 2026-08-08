import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { createPhysicalFlightServices } from "../src/simulation/physical-flight-services.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { AerodynamicSystem } from "../src/simulation/systems/aerodynamic-system.js";
import { MassPropertyCommitSystem } from "../src/simulation/systems/mass-property-commit-system.js";
import { PhysicalFlightTelemetrySystem } from "../src/simulation/systems/physical-flight-telemetry-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { ThermalSystem } from "../src/simulation/systems/thermal-system.js";
import { boundsDimensions } from "../src/model/component-geometry-contract.js";

const assembly = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "heatshield",
        pos: [0, 1000, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 2, y: 0.5, z: 2 },
        config: {},
      },
    ],
    connections: [],
  },
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  worldAdapter = new CannonWorldAdapter(world),
  multibody = new MultibodyRuntime({
    world,
    worldAdapter,
    material: new CANNON.Material("test-part"),
    catalog: TYPES,
  });

multibody.start(JSON.stringify(assembly));
const body = multibody.bodyByPart.get(1),
  descriptor = multibody.compiled.bodies.find(
    (candidate) => candidate.partId === 1,
  ),
  bodyCount = world.bodies.length,
  physicalAssemblyIndex = new PhysicalAssemblyIndex(multibody.compiled),
  flightServices = createPhysicalFlightServices({
    multibodyRuntime: multibody,
    physicalAssemblyIndex,
    windAt: () => ({ x: 0, y: 0, z: 0 }),
  }),
  session = new SimulationSession({
    systems: [
      new AerodynamicSystem(),
      new RigidBodySystem(),
      new ThermalSystem(),
      new MassPropertyCommitSystem(),
      new PhysicalFlightTelemetrySystem(),
    ],
  });
session.start(assembly, {
  catalog: TYPES,
  multibodyRuntime: multibody,
  worldAdapter,
  ...flightServices,
  physicalAssemblyIndex,
});

const descriptorDimensions = boundsDimensions(
  descriptor.geometry.collisionBoundsPartM,
);
assert.deepEqual(
  flightServices.physicalFlightModel.parts[0].size,
  {
    x: descriptorDimensions[0],
    y: descriptorDimensions[1],
    z: descriptorDimensions[2],
  },
  "aerodynamics reintroduced dimensions outside the geometry descriptor",
);
assert.equal(
  world.bodies.length,
  bodyCount,
  "flight runtime created a second physical body",
);

const initialMass = body.mass;
for (let tick = 1; tick <= 480; tick++) {
  body.position.set(0, 1000, 0);
  body.velocity.set(2500, 0, 0);
  session.stepFixed();
}

const telemetry = session.telemetry(),
  aerodynamicRecord = telemetry.systems.aerodynamics.records[0],
  thermal = telemetry.systems.aerothermal.parts[0].thermal,
  massRecord = telemetry.systems.massProperties.records.find(
    (record) => record.partId === 1,
  );
assert.ok(thermal.heatFlux > 100_000, "high-speed airflow produced no heating");
assert.equal(aerodynamicRecord.tick, 480);
assert.deepEqual(aerodynamicRecord.applicationPointWorldM, {
  x: 0,
  y: 1000,
  z: 0,
});
assert.ok(
  aerodynamicRecord.dragMagnitudeN > 0 &&
    aerodynamicRecord.magnitudeN >= aerodynamicRecord.dragMagnitudeN,
  "aerodynamic force record did not retain its resolved drag contribution",
);
assert.ok(
  thermal.ablatedMass > 0,
  "heat shield absorbed no energy by ablation",
);
assert.ok(
  body.mass < initialMass && Math.abs(body.mass - massRecord.massKg) < 1e-6,
  "ablated material did not reduce Cannon mass through the shared mass transaction",
);
assert.equal(
  telemetry.systems.massProperties.timingPolicy,
  "post-thermal-for-next-tick-v1",
);
assert.equal(
  worldAdapter.telemetry().integrationCount,
  480,
  "aerothermal processing bypassed the sole integration owner",
);
assert.equal(
  world.bodies.length,
  bodyCount,
  "aerothermal processing created detached/manual bodies",
);

session.dispose();
flightServices.physicalFlightModel.dispose();
multibody.dispose();
assert.equal(world.bodies.length, 0, "component bodies leaked after disposal");
console.log(
  `component aerothermal runtime passed (${thermal.ablatedMass.toFixed(3)} kg ablated, ${initialMass.toFixed(3)} kg -> ${body.mass.toFixed(3)} kg)`,
);
