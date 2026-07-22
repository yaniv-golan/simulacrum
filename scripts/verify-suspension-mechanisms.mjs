import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { TYPES } from "../src/model/component-catalog.js";
import { instantiateSubassembly } from "../src/model/subassemblies.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { MobilityTelemetrySystem } from "../src/simulation/systems/mobility-telemetry-system.js";
import { PhysicalAssemblySystem } from "../src/simulation/systems/physical-assembly-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120;
const expectedTopologies = Object.freeze({
  "Rigid axle suspension": {
    damper: 1,
    fixed: 4,
    "linear-guide": 1,
    revolute: 1,
    spring: 1,
    wheels: 2,
  },
  "Trailing arm suspension": {
    damper: 1,
    fixed: 3,
    revolute: 2,
    spring: 1,
    wheels: 1,
  },
  "Double wishbone corner": {
    damper: 1,
    fixed: 6,
    revolute: 5,
    spring: 1,
    wheels: 1,
  },
  "Rocker-bogie suspension": {
    fixed: 8,
    revolute: 5,
    wheels: 3,
  },
  "Active leveling suspension": {
    damper: 4,
    fixed: 4,
    "linear-actuator": 4,
    revolute: 4,
    spring: 4,
    wheels: 4,
  },
});

function countKinds(compiled) {
  const counts = {};
  for (const descriptor of compiled.constraints)
    counts[descriptor.kind] = (counts[descriptor.kind] || 0) + 1;
  return {
    ...Object.fromEntries(Object.entries(counts).sort()),
    wheels: compiled.contactRegions.length,
  };
}

function canonicalState(runtime) {
  return [...runtime.bodyByPart.entries()]
    .sort(([left], [right]) => left - right)
    .map(([partId, body]) => ({
      partId,
      position: [body.position.x, body.position.y, body.position.z].map(
        (value) => Number(value.toFixed(9)),
      ),
      quaternion: [
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      ].map((value) => Number(value.toFixed(9))),
      velocity: [body.velocity.x, body.velocity.y, body.velocity.z].map(
        (value) => Number(value.toFixed(9)),
      ),
      angularVelocity: [
        body.angularVelocity.x,
        body.angularVelocity.y,
        body.angularVelocity.z,
      ].map((value) => Number(value.toFixed(9))),
    }));
}

function runCourse(record) {
  const instance = instantiateSubassembly(record.asset, {
      position: [-2.5, 0, 0],
    }),
    snapshot = {
      revision: 1,
      parts: instance.parts,
      connections: instance.connections,
    },
    world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("suspension-course"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(8, 0.25, 4)),
      position: new CANNON.Vec3(0, -0.25, 0),
    }),
    curb = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(0.06, 0.08, 4)),
      position: new CANNON.Vec3(0, 0.08, 0),
    }),
    adapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      material,
      catalog: TYPES,
      groundBody: ground,
      fieldBody: ground,
      fixedDt: DT,
    });
  for (const [body, id, surface] of [
    [ground, "ground", "flat-course"],
    [curb, "curb", "course-curb"],
  ]) {
    body.userData = {
      externalBodyId: `fixture:${id}`,
      surface,
      materialKey: "workshop-steel",
    };
    world.addBody(body);
  }
  world.solver.iterations = 40;
  world.solver.tolerance = 0.0002;
  runtime.start(snapshot);
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(runtime.compiled),
    session = new SimulationSession({
      systems: [
        new RigidBodySystem(),
        new StructureSystem(),
        new PhysicalAssemblySystem(),
        new MobilityTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter: adapter,
      catalog: TYPES,
      multibodyRuntime: runtime,
      physicalAssemblyIndex,
      connectionValid: (connection) => !connection.failed,
    });
  for (const body of runtime.bodyByPart.values()) body.velocity.x = 1.8;
  let maximumTravelM = 0,
    contactTicks = 0;
  for (let tick = 1; tick <= 600; tick++) {
    session.stepFixed();
    const mechanisms = session.telemetry().systems.mechanisms;
    for (const state of mechanisms?.twoFrameMechanisms || []) {
      assert.ok(
        [
          state.coordinateM,
          state.rateMPerS,
          state.reactionForceN,
          state.forceN,
        ].every(Number.isFinite),
        `${record.asset.name} produced non-finite mechanism telemetry: ${JSON.stringify(state)}`,
      );
      if (state.kind === "linear-guide")
        maximumTravelM = Math.max(maximumTravelM, state.coordinateM);
    }
    if (
      session
        .telemetry()
        .systems.mobility?.assemblies?.some((assembly) =>
          assembly.wheelStates.some((wheel) => wheel.touching),
        )
    )
      contactTicks++;
  }
  assert.deepEqual(
    session.context.runGraph.events(),
    [],
    `${record.asset.name} failed on the bounded course`,
  );
  const state = canonicalState(runtime);
  assert.ok(
    state
      .flatMap((body) => [
        ...body.position,
        ...body.quaternion,
        ...body.velocity,
        ...body.angularVelocity,
      ])
      .every(Number.isFinite),
    `${record.asset.name} ended with non-finite body state`,
  );
  assert.ok(
    contactTicks > 0,
    `${record.asset.name} never contacted the course`,
  );
  session.dispose();
  runtime.dispose();
  world.removeBody(curb);
  world.removeBody(ground);
  return { state, contactTicks, maximumTravelM };
}

const records = builtInMechanismSubassemblies();
assert.deepEqual(
  records.map((record) => record.asset.name),
  Object.keys(expectedTopologies),
  "built-in suspension family is incomplete",
);
for (const record of records) {
  assert.equal(record.origin.kind, "BUILT_IN");
  const instance = instantiateSubassembly(record.asset),
    compiled = compileAssembly(
      {
        revision: 1,
        parts: instance.parts,
        connections: instance.connections,
      },
      TYPES,
    );
  assert.equal(compiled.stats.errorCount, 0, record.asset.name);
  assert.deepEqual(
    countKinds(compiled),
    expectedTopologies[record.asset.name],
    `${record.asset.name} topology changed`,
  );
  const forbiddenIdentity = record.asset.name
    .toLowerCase()
    .replaceAll(" ", "-");
  assert.ok(
    !JSON.stringify(compiled).toLowerCase().includes(forbiddenIdentity),
    `${record.asset.name} leaked mechanism identity into runtime dispatch`,
  );
  const first = runCourse(record),
    second = runCourse(record);
  assert.deepEqual(
    second.state,
    first.state,
    `${record.asset.name} course was nondeterministic`,
  );
  assert.equal(second.contactTicks, first.contactTicks);
  assert.equal(second.maximumTravelM, first.maximumTravelM);
}

console.log(
  `suspension mechanisms passed (${records.length} ordinary strict subassemblies, deterministic bounded course)`,
);
