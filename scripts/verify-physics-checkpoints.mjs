import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import {
  CHECKPOINT_STATE_OWNER_IDS,
  checkpointStateDigest,
} from "../src/model/mechanism-artifacts.js";
import { TYPES } from "../src/model/component-catalog.js";
import { stableStringify } from "../src/model/primitives.js";
import { sha256Hex } from "../src/model/sha256.js";
import { instantiateSubassembly } from "../src/model/subassemblies.js";
import { createControllerSensorCapture } from "../src/application/controller-sensor-capture.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { TerrainCollisionStream } from "../src/simulation/environment/terrain-collision-stream.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { createPhysicalFlightServices } from "../src/simulation/physical-flight-services.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { PhysicalAssemblySystem } from "../src/simulation/systems/physical-assembly-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { ControllerSystem } from "../src/simulation/systems/controller-system.js";
import { AerodynamicSystem } from "../src/simulation/systems/aerodynamic-system.js";
import { PhysicalFlightTelemetrySystem } from "../src/simulation/systems/physical-flight-telemetry-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { RollingContactSystem } from "../src/simulation/systems/rolling-contact-system.js";
import { SensorSystem } from "../src/simulation/systems/sensor-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";
import { ThermalSystem } from "../src/simulation/systems/thermal-system.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";

const DT = 1 / 120,
  SPLIT_TICK = 144,
  FINAL_TICK = 260,
  IDENTITIES = Object.freeze({
    runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
    blueprintFingerprint: `sim-sha256-${"2".repeat(64)}`,
    compiledTopologyFingerprint: `sim-sha256-${"3".repeat(64)}`,
  }),
  assembly = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  motorIds = assembly.parts
    .filter((part) => part.type === "motor")
    .map((part) => part.id);

const FAILURE_STRONG = {
    ultimateForceN: 2_000_000,
    ultimateTorqueNm: 500_000,
  },
  failureAssembly = {
    revision: 4,
    parts: [
      [-1.25, 0],
      [-0.65, 0.2],
      [-0.25, 0],
      [1.15, 0],
    ].map(([x, y], index) => ({
      id: index + 1,
      type: "beam",
      pos: [x, y, 0],
      orientation: [0, 0, 0, 1],
      config: { linearDamping: 0, angularDamping: 0 },
    })),
    connections: [
      ["loop-12", 1, 2, [0.3, 0.1, 0], [-0.3, -0.1, 0]],
      ["loop-23", 2, 3, [0.2, -0.1, 0], [-0.2, 0.1, 0]],
      ["loop-31", 3, 1, [-0.25, 0, 0], [0.75, 0, 0]],
      ["weak-link", 1, 4, [1.2, 0, 0], [-1.2, 0, 0]],
    ].map(([id, a, b, anchorA, anchorB]) => ({
      id,
      a,
      b,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA,
      anchorB,
      capacity:
        id === "weak-link"
          ? { ultimateForceN: 1_200, ultimateTorqueNm: 250 }
          : FAILURE_STRONG,
    })),
  };

function createRuntime() {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("checkpoint-assembly"),
    groundMaterial = new CANNON.Material("checkpoint-ground"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(60, 0.25, 60)),
      position: new CANNON.Vec3(0, -0.25, 0),
    }),
    worldAdapter = new CannonWorldAdapter(world),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material,
      catalog: TYPES,
      groundBody: ground,
      fieldBody: ground,
      surfaceHeightAt: () => 0,
      terrainHeightAt: () => 0,
      fixedDt: DT,
    });
  ground.userData = {
    externalBodyId: "fixture:checkpoint-ground",
    surface: "checkpoint ground",
    materialKey: "workshop-steel",
  };
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  world.addBody(ground);
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, groundMaterial, {
      friction: 0.68,
      restitution: 0.02,
    }),
  );
  multibodyRuntime.start(assembly);
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    structureSystem = new StructureSystem(),
    session = new SimulationSession({
      systems: [
        new PowerSystem(),
        new MechanismSystem(),
        new RollingContactSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        structureSystem,
        new PhysicalAssemblySystem(),
        new TelemetrySystem(),
      ],
    }).start(assembly, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      physicalAssemblyIndex,
      connectionValid: (connection) => !connection.failed,
      partMass: (part) => TYPES[part.type]?.mass || 0,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      worldAdapter,
    });
  return {
    world,
    worldAdapter,
    multibodyRuntime,
    physicalAssemblyIndex,
    structureSystem,
    session,
    coordinator,
    dispose() {
      session.dispose();
      multibodyRuntime.dispose();
      world.removeBody(ground);
    },
  };
}

function commandAtTick(run, tick) {
  run.session.context.commandBus.clearTick();
  const throttle = tick < 80 ? 0 : tick < 175 ? 0.72 : -0.28;
  for (const motorId of motorIds)
    run.session.context.commandBus.writeRemote(motorId, "throttle", throttle);
}

function observedState(run) {
  return stableStringify({
    session: run.session.exportState(),
    physics: run.multibodyRuntime.exportState(),
    bodyRegistry: run.session.context.bodyRegistry.exportState(),
    runGraph: run.session.context.runGraph.exportState(),
    structure: run.structureSystem.exportState(),
    adapter: run.worldAdapter.exportState(),
    controllers: run.controllerManager?.exportState() ?? null,
    sensors: run.sensorBank?.exportState() ?? null,
    aerothermal: run.aerothermalAblationOwner?.exportState() ?? null,
    physicalAssembly: run.physicalAssemblyIndex?.snapshot() ?? null,
    terrain: run.terrainState?.exportState() ?? null,
  });
}

function firstDifference(leftJson, rightJson) {
  const visit = (left, right, path) => {
    if (Object.is(left, right)) return null;
    if (
      !left ||
      !right ||
      typeof left !== "object" ||
      typeof right !== "object"
    )
      return { path, left, right };
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    for (const key of keys) {
      const difference = visit(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  };
  return visit(JSON.parse(leftJson), JSON.parse(rightJson), "state");
}

const initialSource = createRuntime(),
  initialCheckpoint = initialSource.coordinator.capture(IDENTITIES),
  initialState = observedState(initialSource),
  initialRestored = createRuntime();
assert.equal(initialCheckpoint.committedTick, 0);
assert.equal(initialCheckpoint.committed, true);
assert.equal(initialSource.worldAdapter.telemetry().integratedTick, -1);
assert.equal(initialSource.worldAdapter.telemetry().integrationCount, 0);
initialRestored.coordinator.restore(initialCheckpoint, IDENTITIES);
assert.equal(
  observedState(initialRestored),
  initialState,
  "restored run-start state did not match the committed tick-zero anchor",
);
commandAtTick(initialSource, 1);
commandAtTick(initialRestored, 1);
initialSource.session.stepFixed();
initialRestored.session.stepFixed();
assert.equal(initialSource.worldAdapter.telemetry().integrationCount, 1);
assert.equal(initialRestored.worldAdapter.telemetry().integrationCount, 1);
assert.equal(
  observedState(initialRestored),
  observedState(initialSource),
  "tick-zero restore diverged on the first integrated tick",
);
initialSource.dispose();
initialRestored.dispose();

const uninterrupted = createRuntime();
let checkpoint = null;
let checkpointState = null;
const expected = new Map();
for (let tick = 1; tick <= FINAL_TICK; tick++) {
  commandAtTick(uninterrupted, tick);
  uninterrupted.session.stepFixed();
  if (tick === SPLIT_TICK) {
    checkpoint = uninterrupted.coordinator.capture(IDENTITIES);
    checkpointState = observedState(uninterrupted);
    assert.equal(checkpoint.committedTick, tick);
    assert.deepEqual(
      checkpoint.stateOwners.map((owner) => owner.ownerId),
      CHECKPOINT_STATE_OWNER_IDS,
    );
  } else if (tick > SPLIT_TICK)
    expected.set(tick, observedState(uninterrupted));
}
assert.ok(checkpoint, "checkpoint was not captured");

const restored = createRuntime(),
  beforeRejectedRestore = observedState(restored);
assert.throws(
  () =>
    restored.coordinator.restore(checkpoint, {
      ...IDENTITIES,
      compiledTopologyFingerprint: `sim-sha256-${"4".repeat(64)}`,
    }),
  (error) => error?.code === "CHECKPOINT_RUNTIME_IDENTITY_MISMATCH",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "rejected checkpoint identity partially mutated the running simulation",
);
const oldTransactionCheckpoint = structuredClone(checkpoint),
  compiledOwner = oldTransactionCheckpoint.stateOwners.find(
    (owner) => owner.ownerId === "compiled-topology",
  ),
  oldCompiled = JSON.parse(compiledOwner.payloadJson);
oldCompiled.transactionId =
  "simulacrum-owned-cannon-solver-transaction-v2-motor-energy";
compiledOwner.payloadJson = stableStringify(oldCompiled);
compiledOwner.payloadByteLength = new TextEncoder().encode(
  compiledOwner.payloadJson,
).byteLength;
compiledOwner.payloadSha256 = sha256Hex(compiledOwner.payloadJson);
oldTransactionCheckpoint.stateDigest = checkpointStateDigest(
  oldTransactionCheckpoint,
);
assert.throws(
  () => restored.coordinator.restore(oldTransactionCheckpoint, IDENTITIES),
  (error) => error?.code === "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
  "checkpoint from the previous solver transaction was accepted",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "transaction identity rejection mutated the running simulation",
);
const hostileCheckpoint = structuredClone(checkpoint),
  physicsOwner = hostileCheckpoint.stateOwners.find(
    (owner) => owner.ownerId === "physics-world",
  ),
  hostilePhysics = JSON.parse(physicsOwner.payloadJson);
hostilePhysics.bodies.pop();
physicsOwner.payloadJson = stableStringify(hostilePhysics);
physicsOwner.payloadByteLength = new TextEncoder().encode(
  physicsOwner.payloadJson,
).byteLength;
physicsOwner.payloadSha256 = sha256Hex(physicsOwner.payloadJson);
hostileCheckpoint.stateDigest = checkpointStateDigest(hostileCheckpoint);
assert.throws(
  () => restored.coordinator.restore(hostileCheckpoint, IDENTITIES),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "failed checkpoint import was not rolled back atomically",
);
restored.coordinator.restore(checkpoint, IDENTITIES);
assert.equal(
  observedState(restored),
  checkpointState,
  "restored state did not match the captured committed tick",
);
for (let tick = SPLIT_TICK + 1; tick <= FINAL_TICK; tick++) {
  commandAtTick(restored, tick);
  restored.session.stepFixed();
  const actual = observedState(restored),
    expectedState = expected.get(tick);
  assert.equal(
    actual,
    expectedState,
    `restored physics diverged at committed tick ${tick}: ${JSON.stringify(firstDifference(actual, expectedState))}`,
  );
}

uninterrupted.dispose();
restored.dispose();

async function createActiveRuntime() {
  const record = builtInMechanismSubassemblies().find(
      (candidate) => candidate.asset.name === "Active leveling suspension",
    ),
    instance = instantiateSubassembly(record.asset, {
      position: [-3, 0, 0],
    }),
    snapshot = {
      revision: 1,
      parts: instance.parts,
      connections: instance.connections,
    },
    world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("checkpoint-active-assembly"),
    groundMaterial = new CANNON.Material("checkpoint-active-ground"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(10, 0.25, 6)),
      position: new CANNON.Vec3(0, -0.25, 0),
    }),
    worldAdapter = new CannonWorldAdapter(world),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material,
      catalog: TYPES,
      groundBody: ground,
      fieldBody: ground,
      fixedDt: DT,
    }),
    outputs = new Map(),
    controllerManager = new ControllerRuntimeManager({
      onCommands: (controllerId, commands) =>
        outputs.set(controllerId, Object.fromEntries(commands)),
    }),
    sensorBank = new ControllerSensorBank(),
    controllers = snapshot.parts.filter((part) => part.type === "computer"),
    readSensors = createControllerSensorCapture({
      sampleWind: () => ({ x: 0, y: 0, z: 0 }),
      sensorBank,
    });
  assert.ok(record, "active checkpoint fixture is missing");
  ground.userData = {
    externalBodyId: "fixture:active-checkpoint-ground",
    surface: "active checkpoint ground",
    materialKey: "workshop-steel",
  };
  world.solver.iterations = 50;
  world.solver.tolerance = 0.0001;
  world.addBody(ground);
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, groundMaterial, {
      friction: 0.68,
      restitution: 0.02,
    }),
  );
  multibodyRuntime.start(snapshot);
  for (const controller of controllers)
    controllerManager.attach(
      controller.id,
      await prepareTypeScriptController(
        controller.scriptSources.typescript,
        controllerBindingManifest(
          controller,
          snapshot.parts,
          snapshot.connections,
        ),
      ),
      "CHECKPOINT LEVELING",
    );
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    structureSystem = new StructureSystem(),
    session = new SimulationSession({
      systems: [
        new SensorSystem(),
        new ControllerSystem(),
        new PowerSystem(),
        new SignalSystem(),
        new CommandRoutingSystem(),
        new MechanismSystem(),
        new RollingContactSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        structureSystem,
        new PhysicalAssemblySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      physicalAssemblyIndex,
      readSensors,
      tickControllers: (dt, sensorSnapshot = {}) => {
        for (const controller of controllers)
          controllerManager.tick(
            controller.id,
            dt,
            sensorSnapshot.controllers?.[controller.id] || {},
          );
      },
      readCommandCandidates: () => ({
        remote: [],
        scripts: controllers.flatMap((controller) => {
          const bindings = new Map(
            controller.controllerBindings.map((binding) => [
              binding.id,
              binding,
            ]),
          );
          return Object.entries(outputs.get(controller.id) || {}).map(
            ([bindingId, value]) => {
              const binding = bindings.get(bindingId);
              return {
                controllerId: controller.id,
                bindingId,
                targetId: binding?.endpointPartId,
                endpointPortId: binding?.endpointPortId,
                channel: binding?.channel,
                value,
              };
            },
          );
        }),
      }),
      controllerTelemetry: () => ({
        onlineControllerIds: controllerManager.ids(),
      }),
      connectionValid: (connection) => !connection.failed,
      partMass: (part) => TYPES[part.type]?.mass || 0,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      worldAdapter,
      sensorBank,
      controllerManager,
    });
  return {
    world,
    worldAdapter,
    multibodyRuntime,
    physicalAssemblyIndex,
    structureSystem,
    session,
    coordinator,
    controllerManager,
    sensorBank,
    dispose() {
      session.dispose();
      controllerManager.disposeAll();
      multibodyRuntime.dispose();
      world.removeBody(ground);
    },
  };
}

const activeUninterrupted = await createActiveRuntime(),
  activeExpected = new Map();
let activeCheckpoint = null,
  activeCheckpointState = null;
for (let tick = 1; tick <= 150; tick++) {
  activeUninterrupted.session.stepFixed();
  if (tick === 72) {
    activeCheckpoint = activeUninterrupted.coordinator.capture(IDENTITIES);
    activeCheckpointState = observedState(activeUninterrupted);
  } else if (tick > 72)
    activeExpected.set(tick, observedState(activeUninterrupted));
}
const activeRestored = await createActiveRuntime();
activeRestored.coordinator.restore(activeCheckpoint, IDENTITIES);
assert.equal(observedState(activeRestored), activeCheckpointState);
for (let tick = 73; tick <= 150; tick++) {
  activeRestored.session.stepFixed();
  const actual = observedState(activeRestored),
    expectedState = activeExpected.get(tick);
  assert.equal(
    actual,
    expectedState,
    `restored controller physics diverged at committed tick ${tick}: ${JSON.stringify(firstDifference(actual, expectedState))}`,
  );
}
activeUninterrupted.dispose();
activeRestored.dispose();

function createFailureRuntime() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    material = new CANNON.Material("checkpoint-failure-material"),
    impactor = new CANNON.Body({
      mass: 600,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(0.2, 2, 2)),
      position: new CANNON.Vec3(3.2, 0, 0),
    }),
    worldAdapter = new CannonWorldAdapter(world),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material,
      catalog: TYPES,
      fixedDt: DT,
    });
  world.solver.iterations = 50;
  world.solver.tolerance = 1e-9;
  world.defaultContactMaterial.friction = 0;
  world.defaultContactMaterial.restitution = 0.05;
  impactor.linearDamping = 0;
  impactor.angularDamping = 0;
  impactor.allowSleep = false;
  impactor.userData = {
    externalBodyId: "fixture:checkpoint-impactor",
    surface: "checkpoint impactor",
    materialKey: "workshop-steel",
  };
  world.addBody(impactor);
  multibodyRuntime.start(failureAssembly);
  for (const body of multibodyRuntime.bodyByPart.values())
    body.velocity.set(6, 0, 0);
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    structureSystem = new StructureSystem(),
    session = new SimulationSession({
      systems: [
        new RigidBodySystem(),
        structureSystem,
        new PhysicalAssemblySystem(),
        new TelemetrySystem(),
      ],
    }).start(failureAssembly, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      physicalAssemblyIndex,
      connectionValid: (connection) => !connection.failed,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      worldAdapter,
    });
  return {
    world,
    worldAdapter,
    multibodyRuntime,
    physicalAssemblyIndex,
    structureSystem,
    session,
    coordinator,
    dispose() {
      session.dispose();
      multibodyRuntime.dispose();
      world.removeBody(impactor);
    },
  };
}

const failureUninterrupted = createFailureRuntime(),
  failureExpected = new Map();
let failureCheckpoint = null,
  failureCheckpointState = null,
  failureTick = null;
for (let tick = 1; tick <= 80; tick++) {
  failureUninterrupted.session.stepFixed();
  if (
    failureUninterrupted.session
      .telemetry()
      .systems.structures?.newlyFailed?.includes("weak-link")
  )
    failureTick = tick;
  if (tick === 10) {
    failureCheckpoint = failureUninterrupted.coordinator.capture(IDENTITIES);
    failureCheckpointState = observedState(failureUninterrupted);
  } else if (tick > 10)
    failureExpected.set(tick, observedState(failureUninterrupted));
}
assert.equal(failureTick, 14, "failure checkpoint fixture changed transition");
const failureRestored = createFailureRuntime();
failureRestored.coordinator.restore(failureCheckpoint, IDENTITIES);
assert.equal(observedState(failureRestored), failureCheckpointState);
for (let tick = 11; tick <= 80; tick++) {
  failureRestored.session.stepFixed();
  const actual = observedState(failureRestored),
    expectedState = failureExpected.get(tick);
  assert.equal(
    actual,
    expectedState,
    `restored failure physics diverged at committed tick ${tick}: ${JSON.stringify(firstDifference(actual, expectedState))}`,
  );
}
assert.deepEqual(
  failureRestored.session.context.runGraph.events().map((event) => ({
    failed: event.failedConnectionIds,
    detached: event.detachedPartIds,
    tick: Math.round(event.time / DT),
  })),
  [{ failed: ["weak-link"], detached: [4], tick: 14 }],
);
failureUninterrupted.dispose();
failureRestored.dispose();

function createHybridTerrainRuntime() {
  const snapshot = structuredClone(assembly);
  for (const part of snapshot.parts) part.pos[0] += 400;
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("checkpoint-hybrid-assembly"),
    terrainMaterial = new CANNON.Material("checkpoint-hybrid-terrain"),
    worldAdapter = new CannonWorldAdapter(world),
    terrainState = new TerrainCollisionStream({
      world,
      heightAt: (x, z) =>
        Math.sin(x * 0.013) * 0.08 + Math.cos(z * 0.017) * 0.06,
      material: terrainMaterial,
      tileSize: 80,
      segments: 16,
      neighborhood: 1,
    }),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material,
      catalog: TYPES,
      surfaceHeightAt: () => 0,
      terrainHeightAt: (x, z) =>
        Math.sin(x * 0.013) * 0.08 + Math.cos(z * 0.017) * 0.06,
      fixedDt: DT,
    });
  world.solver.iterations = 35;
  world.solver.tolerance = 0.0002;
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, terrainMaterial, {
      friction: 0.68,
      restitution: 0.02,
    }),
  );
  multibodyRuntime.start(snapshot);
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    flightServices = createPhysicalFlightServices({
      multibodyRuntime,
      physicalAssemblyIndex,
      terrainCollisionStream: terrainState,
      windAt: () => ({ x: 0, y: 0, z: 0 }),
    });
  const structureSystem = new StructureSystem(),
    session = new SimulationSession({
      systems: [
        new PowerSystem(),
        new MechanismSystem(),
        new RollingContactSystem(),
        new AerodynamicSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        structureSystem,
        new ThermalSystem(),
        new PhysicalAssemblySystem(),
        new PhysicalFlightTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      ...flightServices,
      physicalAssemblyIndex,
      connectionValid: (connection) => !connection.failed,
      partMass: (part) => TYPES[part.type]?.mass || 0,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      worldAdapter,
      aerothermalAblationOwner: flightServices.aerothermalAblationOwner,
      terrainState,
    });
  return {
    world,
    worldAdapter,
    multibodyRuntime,
    structureSystem,
    session,
    coordinator,
    ...flightServices,
    physicalAssemblyIndex,
    terrainState,
    dispose() {
      session.dispose();
      flightServices.physicalFlightModel.dispose();
      terrainState.dispose();
      multibodyRuntime.dispose();
    },
  };
}

function driveHybrid(run, tick) {
  run.session.context.commandBus.clearTick();
  for (const motorId of motorIds)
    run.session.context.commandBus.writeRemote(
      motorId,
      "throttle",
      tick < 55 ? 0.35 : 0.7,
    );
}

const hybridUninterrupted = createHybridTerrainRuntime(),
  hybridExpected = new Map();
let hybridCheckpoint = null,
  hybridCheckpointState = null;
for (let tick = 1; tick <= 110; tick++) {
  driveHybrid(hybridUninterrupted, tick);
  hybridUninterrupted.session.stepFixed();
  if (tick === 48) {
    hybridCheckpoint = hybridUninterrupted.coordinator.capture(IDENTITIES);
    hybridCheckpointState = observedState(hybridUninterrupted);
    assert.equal(hybridUninterrupted.terrainState.tiles.size, 9);
  } else if (tick > 48)
    hybridExpected.set(tick, observedState(hybridUninterrupted));
}
const hybridRestored = createHybridTerrainRuntime(),
  beforeHybridRejectedRestore = observedState(hybridRestored),
  wrongThermalIdentityCheckpoint = structuredClone(hybridCheckpoint),
  thermalOwner = wrongThermalIdentityCheckpoint.stateOwners.find(
    (owner) => owner.ownerId === "thermal-ablation",
  ),
  wrongThermalState = JSON.parse(thermalOwner.payloadJson);
wrongThermalState.parts[0].id = "not-a-live-part";
thermalOwner.payloadJson = stableStringify(wrongThermalState);
thermalOwner.payloadByteLength = new TextEncoder().encode(
  thermalOwner.payloadJson,
).byteLength;
thermalOwner.payloadSha256 = sha256Hex(thermalOwner.payloadJson);
wrongThermalIdentityCheckpoint.stateDigest = checkpointStateDigest(
  wrongThermalIdentityCheckpoint,
);
assert.throws(
  () =>
    hybridRestored.coordinator.restore(
      wrongThermalIdentityCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "AEROTHERMAL_CHECKPOINT_IDENTITY_MISMATCH",
);
assert.equal(
  observedState(hybridRestored),
  beforeHybridRejectedRestore,
  "aerothermal identity rejection mutated an earlier checkpoint owner",
);
hybridRestored.coordinator.restore(hybridCheckpoint, IDENTITIES);
assert.equal(observedState(hybridRestored), hybridCheckpointState);
for (let tick = 49; tick <= 110; tick++) {
  driveHybrid(hybridRestored, tick);
  hybridRestored.session.stepFixed();
  const actual = observedState(hybridRestored),
    expectedState = hybridExpected.get(tick);
  assert.equal(
    actual,
    expectedState,
    `restored hybrid terrain physics diverged at committed tick ${tick}: ${JSON.stringify(firstDifference(actual, expectedState))}`,
  );
}
hybridUninterrupted.dispose();
hybridRestored.dispose();
console.log(
  `physics checkpoints passed (passive ${SPLIT_TICK}->${FINAL_TICK}, active 72->150, failure 10->80, hybrid terrain 48->110, exact committed-tick state)`,
);
