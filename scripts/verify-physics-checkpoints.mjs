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
import { commitBodyRegistryMassProperties } from "../src/simulation/body-registry.js";
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
import { MassPropertyCommitSystem } from "../src/simulation/systems/mass-property-commit-system.js";
import {
  PneumaticCommitSystem,
  PneumaticSystem,
} from "../src/simulation/systems/pneumatic-system.js";

const DT = 1 / 120,
  SPLIT_TICK = 144,
  FINAL_TICK = 260,
  IDENTITIES = Object.freeze({
    runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
    blueprintFingerprint: `sim-sha256-${"2".repeat(64)}`,
    compiledTopologyFingerprint: `sim-sha256-${"3".repeat(64)}`,
  }),
  IDENTITIES_JSON = JSON.stringify(IDENTITIES),
  assembly = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  motorIds = assembly.parts
    .filter((part) => part.type === "motor")
    .map((part) => part.id);

const importMultibodyState = (runtime, state) =>
    runtime.importState(JSON.stringify(state)),
  restoreCheckpoint = (coordinator, checkpointState, identities) =>
    coordinator.restore(
      JSON.stringify(checkpointState),
      JSON.stringify(identities),
    );

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
          : structuredClone(FAILURE_STRONG),
    })),
  };

function createRuntime({
  assemblySnapshot = assembly,
  includeMutableMassOwners = true,
  extraSystems = [],
} = {}) {
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
    checkpointPolicy: "reconstruct-from-owner-v1",
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
  multibodyRuntime.start(JSON.stringify(assemblySnapshot));
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    structureSystem = new StructureSystem(),
    session = new SimulationSession({
      systems: [
        new PowerSystem(),
        new MechanismSystem(),
        ...(includeMutableMassOwners ? [new PneumaticSystem()] : []),
        new RollingContactSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        ...(includeMutableMassOwners ? [new PneumaticCommitSystem()] : []),
        ...(includeMutableMassOwners ? [new MassPropertyCommitSystem()] : []),
        structureSystem,
        new PhysicalAssemblySystem(),
        new TelemetrySystem(),
        ...extraSystems,
      ],
    }).start(assemblySnapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      compiledAssembly: multibodyRuntime.compiled,
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
  const bodyRegistry = run.session.context.bodyRegistry.exportState();
  return stableStringify({
    session: run.session.exportState(),
    physics: run.multibodyRuntime.exportState(),
    bodyRegistry,
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

function mutateOwnerPayload(checkpoint, ownerId, mutate) {
  const owner = checkpoint.stateOwners.find(
      (candidate) => candidate.ownerId === ownerId,
    ),
    payload = JSON.parse(owner.payloadJson);
  mutate(payload);
  owner.payloadJson = stableStringify(payload);
  owner.payloadByteLength = new TextEncoder().encode(
    owner.payloadJson,
  ).byteLength;
  owner.payloadSha256 = sha256Hex(owner.payloadJson);
  checkpoint.stateDigest = checkpointStateDigest(checkpoint);
}

let midStepRun = null,
  midStepCheckpoint = null,
  midStepAttempts = 0;
const midStepRestoreProbe = {
    phase: "sensors",
    step() {
      midStepAttempts++;
      const accumulatorBeforeReentrantStep = midStepRun.session.accumulator;
      assert.throws(
        () =>
          restoreCheckpoint(
            midStepRun.coordinator,
            midStepCheckpoint,
            IDENTITIES,
          ),
        (error) => error?.code === "CHECKPOINT_REQUIRES_COMMITTED_TICK",
        "checkpoint restore was callable from inside an uncommitted fixed step",
      );
      assert.throws(
        () => midStepRun.session.step(0),
        (error) => error?.code === "SIMULATION_SESSION_NOT_COMMITTED",
        "a reentrant variable step was callable from inside an uncommitted fixed step",
      );
      assert.equal(
        midStepRun.session.accumulator,
        accumulatorBeforeReentrantStep,
        "a refused reentrant variable step mutated the fixed-step accumulator",
      );
    },
  },
  midStepCaptureProbe = {
    phase: "structures",
    step() {
      midStepAttempts++;
      assert.throws(
        () => midStepRun.coordinator.capture(IDENTITIES_JSON),
        (error) => error?.code === "CHECKPOINT_REQUIRES_COMMITTED_TICK",
        "checkpoint capture was callable after integration but before fixed-step commit",
      );
    },
  };
midStepRun = createRuntime({
  extraSystems: [midStepRestoreProbe, midStepCaptureProbe],
});
midStepCheckpoint = midStepRun.coordinator.capture(IDENTITIES_JSON);
assert.equal(
  midStepRun.session.step(midStepRun.session.fixedDt),
  1,
  "variable-time stepping did not complete exactly one fixed tick",
);
assert.equal(midStepAttempts, 2, "mid-step checkpoint probes did not execute");
assert.equal(
  midStepRun.session.stepFixed(),
  1,
  "direct fixed stepping did not complete exactly one fixed tick",
);
assert.equal(
  midStepAttempts,
  4,
  "mid-step checkpoint probes did not execute through both step APIs",
);
assert.doesNotThrow(
  () => midStepRun.coordinator.capture(IDENTITIES_JSON),
  "checkpoint capture remained unavailable after the complete fixed step committed",
);
midStepRun.dispose();

let reentrantRestoreRun = null,
  reentrantRestoreCheckpoint = null,
  reentrantRestoreCallbacks = 0,
  failNextRestoreCallback = false;
const reentrantRestoreProbe = {
  phase: "sensors",
  afterCheckpointRestore() {
    reentrantRestoreCallbacks++;
    const tickBeforeAttempts = reentrantRestoreRun.session.context.clock.tick,
      accumulatorBeforeAttempts = reentrantRestoreRun.session.accumulator,
      contextBeforeAttempts = reentrantRestoreRun.session.context;
    assert.throws(
      () => reentrantRestoreRun.coordinator.capture(IDENTITIES_JSON),
      (error) => error?.code === "CHECKPOINT_REQUIRES_COMMITTED_TICK",
      "checkpoint capture was callable from a restore callback",
    );
    assert.throws(
      () =>
        restoreCheckpoint(
          reentrantRestoreRun.coordinator,
          reentrantRestoreCheckpoint,
          IDENTITIES,
        ),
      (error) => error?.code === "CHECKPOINT_REQUIRES_COMMITTED_TICK",
      "checkpoint restore was recursively callable from a restore callback",
    );
    assert.throws(
      () => reentrantRestoreRun.session.step(0),
      (error) => error?.code === "SIMULATION_SESSION_NOT_COMMITTED",
      "variable stepping was callable from a restore callback",
    );
    assert.throws(
      () => reentrantRestoreRun.session.stepFixed(),
      (error) => error?.code === "SIMULATION_SESSION_NOT_COMMITTED",
      "fixed stepping was callable from a restore callback",
    );
    assert.throws(
      () => reentrantRestoreRun.session.start(assembly),
      (error) => error?.code === "SIMULATION_SESSION_MUTATION_REENTRANT",
      "session restart was callable from a restore callback",
    );
    assert.throws(
      () => reentrantRestoreRun.session.dispose(),
      (error) => error?.code === "SIMULATION_SESSION_MUTATION_REENTRANT",
      "session disposal was callable from a restore callback",
    );
    assert.strictEqual(
      reentrantRestoreRun.session.context,
      contextBeforeAttempts,
      "refused restore-callback lifecycle reentry replaced the running context",
    );
    assert.equal(
      reentrantRestoreRun.session.context.clock.tick,
      tickBeforeAttempts,
      "refused restore-callback reentry advanced the committed tick",
    );
    assert.equal(
      reentrantRestoreRun.session.accumulator,
      accumulatorBeforeAttempts,
      "refused restore-callback reentry mutated the fixed-step accumulator",
    );
    if (failNextRestoreCallback) {
      failNextRestoreCallback = false;
      throw new Error("synthetic restore callback failure");
    }
  },
};
reentrantRestoreRun = createRuntime({ extraSystems: [reentrantRestoreProbe] });
reentrantRestoreCheckpoint =
  reentrantRestoreRun.coordinator.capture(IDENTITIES_JSON);
reentrantRestoreRun.session.stepFixed(2);
restoreCheckpoint(
  reentrantRestoreRun.coordinator,
  reentrantRestoreCheckpoint,
  IDENTITIES,
);
assert.equal(
  reentrantRestoreCallbacks,
  1,
  "successful restore did not execute its hostile callback exactly once",
);
assert.doesNotThrow(
  () => reentrantRestoreRun.coordinator.capture(IDENTITIES_JSON),
  "successful restore did not recover the committed checkpoint boundary",
);
reentrantRestoreRun.session.stepFixed(2);
const beforeRestoreCallbackFailure = observedState(reentrantRestoreRun),
  beforeRestoreCallbackFailureTelemetry =
    reentrantRestoreRun.session.telemetry(),
  beforeRestoreCallbackFailurePreviousTelemetry =
    reentrantRestoreRun.session.context.previousTelemetry;
failNextRestoreCallback = true;
assert.throws(
  () =>
    restoreCheckpoint(
      reentrantRestoreRun.coordinator,
      reentrantRestoreCheckpoint,
      IDENTITIES,
    ),
  /synthetic restore callback failure/u,
  "restore callback failure did not escape coordinated restore",
);
assert.equal(
  reentrantRestoreCallbacks,
  3,
  "failed restore did not execute one target callback and one rollback callback",
);
assert.equal(
  observedState(reentrantRestoreRun),
  beforeRestoreCallbackFailure,
  "restore callback failure did not roll back exact owner state",
);
assert.strictEqual(
  reentrantRestoreRun.session.telemetry(),
  beforeRestoreCallbackFailureTelemetry,
  "restore callback failure replaced the exact public telemetry frame",
);
assert.strictEqual(
  reentrantRestoreRun.session.context.previousTelemetry,
  beforeRestoreCallbackFailurePreviousTelemetry,
  "restore callback failure replaced the prior public telemetry frame",
);
assert.doesNotThrow(
  () => reentrantRestoreRun.coordinator.capture(IDENTITIES_JSON),
  "rolled-back restore callback failure left the session boundary unavailable",
);
assert.equal(
  reentrantRestoreRun.session.stepFixed(),
  1,
  "rolled-back restore callback failure left fixed stepping unavailable",
);
reentrantRestoreRun.dispose();

const missingCompiledMassOwners = createRuntime({
  includeMutableMassOwners: false,
});
assert.throws(
  () => missingCompiledMassOwners.coordinator.capture(IDENTITIES_JSON),
  (error) => error?.code === "MASS_PROPERTY_CHECKPOINT_OWNER_MISSING",
  "checkpoint capture accepted a compiled pneumatic mass contributor without its owners",
);
missingCompiledMassOwners.dispose();

const ownerlessStaticAssembly = {
    revision: 1,
    parts: [
      {
        ...structuredClone(failureAssembly.parts[0]),
        id: "ownerless-static-body",
      },
    ],
    connections: [],
  },
  ownerlessStaticRun = createRuntime({
    assemblySnapshot: ownerlessStaticAssembly,
    includeMutableMassOwners: false,
  }),
  ownerlessStaticCheckpoint =
    ownerlessStaticRun.coordinator.capture(IDENTITIES_JSON),
  ownerlessStaticBaseline = observedState(ownerlessStaticRun),
  forgedAbsentPneumaticOwner = structuredClone(ownerlessStaticCheckpoint);
mutateOwnerPayload(forgedAbsentPneumaticOwner, "pneumatic-gas", (payload) => {
  delete payload.kind;
  payload.ghost = 1;
});
assert.throws(
  () =>
    restoreCheckpoint(
      ownerlessStaticRun.coordinator,
      forgedAbsentPneumaticOwner,
      IDENTITIES,
    ),
  (error) => error?.code === "CHECKPOINT_ABSENT_OWNER_STATE_MISMATCH",
  "checkpoint restore accepted a recomputed payload for an absent mass owner",
);
assert.equal(
  observedState(ownerlessStaticRun),
  ownerlessStaticBaseline,
  "absent-owner payload rejection mutated the running simulation",
);
ownerlessStaticRun.dispose();

const initialSource = createRuntime(),
  initialCheckpoint = initialSource.coordinator.capture(IDENTITIES_JSON),
  initialState = observedState(initialSource),
  initialRestored = createRuntime();

const identityTrapCounts = {
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
  },
  hostileIdentities = new Proxy(structuredClone(IDENTITIES), {
    get(target, key, receiver) {
      identityTrapCounts.get++;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      identityTrapCounts.getOwnPropertyDescriptor++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      identityTrapCounts.getPrototypeOf++;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      identityTrapCounts.ownKeys++;
      return Reflect.ownKeys(target);
    },
  }),
  initialIdentityBoundaryState = observedState(initialSource);
assert.throws(
  () => initialSource.coordinator.capture(hostileIdentities),
  (error) => error?.code === "INVALID_CHECKPOINT_RUNTIME_IDENTITIES",
  "checkpoint capture accepted arbitrary executable identity input",
);
assert.throws(
  () =>
    initialSource.coordinator.restore(
      JSON.stringify(initialCheckpoint),
      hostileIdentities,
    ),
  (error) => error?.code === "INVALID_CHECKPOINT_RUNTIME_IDENTITIES",
  "checkpoint restore accepted arbitrary executable identity input",
);
assert.deepEqual(
  identityTrapCounts,
  { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 },
  "checkpoint identity rejection invoked an input Proxy trap",
);
assert.equal(
  observedState(initialSource),
  initialIdentityBoundaryState,
  "checkpoint identity rejection mutated the running simulation",
);

function assertRejectedOwnerMutation(ownerId, mutate, code, message) {
  const forged = structuredClone(initialCheckpoint),
    before = observedState(initialSource);
  mutateOwnerPayload(forged, ownerId, mutate);
  assert.throws(
    () => restoreCheckpoint(initialSource.coordinator, forged, IDENTITIES),
    (error) => error?.code === code,
    message,
  );
  assert.equal(
    observedState(initialSource),
    before,
    `${message}: rejection mutated the running simulation`,
  );
}

assertRejectedOwnerMutation(
  "solver-contact",
  (payload) => {
    payload.unowned = true;
  },
  "INVALID_SOLVER_CONTACT_CHECKPOINT",
  "checkpoint accepted an undeclared solver-contact field",
);
assertRejectedOwnerMutation(
  "tire-carcass",
  (payload) => {
    payload.unowned = true;
  },
  "INVALID_SOLVER_CONTACT_CHECKPOINT",
  "checkpoint accepted an undeclared tire-carcass field",
);
assertRejectedOwnerMutation(
  "tire-carcass",
  (payload) => {
    payload.contactIds.push("forged-contact");
  },
  "CHECKPOINT_SOLVER_CONTACT_IDENTITY_MISMATCH",
  "checkpoint accepted tire-carcass identities that disagree with physics",
);
assertRejectedOwnerMutation(
  "energy-power-signal",
  (payload) => {
    payload.graphRevision++;
  },
  "CHECKPOINT_NETWORK_GRAPH_REVISION_MISMATCH",
  "checkpoint accepted an energy projection from another graph revision",
);
assertRejectedOwnerMutation(
  "energy-power-signal",
  (payload) => {
    payload.power = {};
  },
  "INVALID_ENERGY_NETWORK_CHECKPOINT",
  "checkpoint accepted a legacy derived power read model",
);
const forgedContactAtTick = (tick) => ({
  tick,
  contactId: "forged-contact",
  normalForceValid: true,
  frictionCoefficientValid: false,
  frictionCoefficient: 0,
  observationFrame: null,
  point: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  forceN: 0,
  impulseNs: 0,
  relativeVelocity: { x: 0, y: 0, z: 0 },
  forceWorldN: { x: 0, y: 0, z: 0 },
  materialKey: null,
  shapeId: null,
  otherBodyId: null,
  otherMaterialKey: null,
  otherShapeId: null,
  supportShapeId: null,
  surfaceRegionId: null,
  featureId: null,
  featureValidity: "unavailable",
  tireEvidence: null,
  validity: "unavailable",
  surface: null,
});
assertRejectedOwnerMutation(
  "body-registry",
  (payload) => {
    payload.bodies[0].contacts.push({
      ...forgedContactAtTick(payload.tick),
      unowned: true,
    });
  },
  "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "checkpoint accepted caller-defined contact evidence fields",
);
assertRejectedOwnerMutation(
  "body-registry",
  (payload) => {
    payload.bodies[0].contacts.push(forgedContactAtTick(payload.tick + 1));
  },
  "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "checkpoint accepted contact evidence from another tick",
);
assertRejectedOwnerMutation(
  "body-registry",
  (payload) => {
    payload.bodies[0].loads.push({
      connectionId: "ghost-edge",
      forceN: 0,
      torqueNm: 0,
    });
  },
  "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "checkpoint accepted a load outside the running topology",
);
assertRejectedOwnerMutation(
  "body-registry",
  (payload) => {
    payload.revision = 1_000_000;
  },
  "BODY_REGISTRY_CHECKPOINT_FIELD_MISMATCH",
  "checkpoint accepted a caller-controlled body-registry cache revision",
);
assert.equal(
  typeof initialSource.session.context.bodyRegistry.validateCheckpointState,
  "undefined",
  "public BodyRegistry retained checkpoint validation authority",
);
assert.equal(
  typeof initialSource.session.context.bodyRegistry.importCheckpointState,
  "undefined",
  "public BodyRegistry retained checkpoint import authority",
);
assertRejectedOwnerMutation(
  "telemetry-event-ids",
  (payload) => {
    payload.telemetry = { forged: true };
  },
  "INVALID_TELEMETRY_CHECKPOINT",
  "checkpoint accepted an arbitrary telemetry read model",
);
assertRejectedOwnerMutation(
  "telemetry-event-ids",
  (payload) => {
    payload.poweredPartIds = ["ghost-part"];
  },
  "INVALID_CONTROLLER_POWER_DELAY_CHECKPOINT",
  "checkpoint accepted a controller power delay for an unknown part",
);
assertRejectedOwnerMutation(
  "session",
  (payload) => {
    payload.sensors = { forged: true };
  },
  "INVALID_SESSION_CHECKPOINT",
  "checkpoint accepted caller-controlled session sensor state",
);
assertRejectedOwnerMutation(
  "physics-world",
  (payload) => {
    payload.worldAdapter.session = 0;
  },
  "INVALID_CANNON_WORLD_CHECKPOINT_COUNTER",
  "checkpoint accepted an unreachable Cannon session zero",
);
assertRejectedOwnerMutation(
  "physics-world",
  (payload) => {
    payload.worldAdapter.session += 1;
  },
  "INVALID_CANNON_CHECKPOINT_COUNTER_RELATION",
  "checkpoint accepted a Cannon state from another adapter session",
);
{
  const sessionState = initialSource.session.exportState(),
    nearTime = structuredClone(sessionState);
  nearTime.time = 5e-13;
  nearTime.clock.time = 5e-13;
  assert.throws(
    () => initialSource.session.validateState(JSON.stringify(nearTime)),
    (error) => error?.code === "INVALID_SESSION_CHECKPOINT",
    "session accepted a near-equal time not derived from tick zero",
  );
  for (const accumulator of [1e100, -1e100, sessionState.fixedDt]) {
    const unreachableAccumulator = structuredClone(sessionState);
    unreachableAccumulator.accumulator = accumulator;
    assert.throws(
      () =>
        initialSource.session.validateState(
          JSON.stringify(unreachableAccumulator),
        ),
      (error) => error?.code === "INVALID_SESSION_CHECKPOINT",
      `session accepted unreachable accumulator ${accumulator}`,
    );
  }
  let accessorReads = 0;
  const accessorState = {};
  Object.defineProperty(accessorState, "version", {
    enumerable: true,
    get() {
      accessorReads++;
      return 2;
    },
  });
  assert.throws(
    () => initialSource.session.validateState(accessorState),
    (error) => error?.code === "INVALID_SESSION_CHECKPOINT_INPUT",
  );
  assert.equal(accessorReads, 0, "session validator executed a state accessor");
  let proxyReads = 0;
  const stateProxy = new Proxy(structuredClone(sessionState), {
    get() {
      proxyReads++;
      return undefined;
    },
    getPrototypeOf() {
      proxyReads++;
      return Object.prototype;
    },
    ownKeys() {
      proxyReads++;
      return [];
    },
    getOwnPropertyDescriptor() {
      proxyReads++;
      return undefined;
    },
  });
  assert.throws(
    () => initialSource.session.validateState(stateProxy),
    (error) => error?.code === "INVALID_SESSION_CHECKPOINT_INPUT",
  );
  assert.equal(proxyReads, 0, "session validator executed a Proxy trap");
}
const missingRestoreMassOwners = createRuntime({
    includeMutableMassOwners: false,
  }),
  missingRestoreMassOwnersBaseline = observedState(missingRestoreMassOwners);
assert.throws(
  () =>
    restoreCheckpoint(
      missingRestoreMassOwners.coordinator,
      initialCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "MASS_PROPERTY_CHECKPOINT_OWNER_MISSING",
  "checkpoint restore accepted compiled pneumatic mass without its owners",
);
assert.equal(
  observedState(missingRestoreMassOwners),
  missingRestoreMassOwnersBaseline,
  "missing-owner restore rejection mutated the running simulation",
);
missingRestoreMassOwners.dispose();
assert.equal(initialCheckpoint.committedTick, 0);
assert.equal(initialCheckpoint.committed, true);
assert.equal(initialSource.worldAdapter.telemetry().integratedTick, -1);
assert.equal(initialSource.worldAdapter.telemetry().integrationCount, 0);
restoreCheckpoint(initialRestored.coordinator, initialCheckpoint, IDENTITIES);
assert.equal(
  observedState(initialRestored),
  initialState,
  `restored run-start state did not match the committed tick-zero anchor: ${JSON.stringify(
    firstDifference(observedState(initialRestored), initialState),
  )}`,
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
    checkpoint = uninterrupted.coordinator.capture(IDENTITIES_JSON);
    checkpointState = observedState(uninterrupted);
    assert.equal(checkpoint.committedTick, tick);
    assert.deepEqual(
      checkpoint.stateOwners.map((owner) => owner.ownerId),
      CHECKPOINT_STATE_OWNER_IDS,
    );
    const bodyRegistryOwner = checkpoint.stateOwners.find(
      (owner) => owner.ownerId === "body-registry",
    );
    assert.equal(bodyRegistryOwner.ownerVersion, 6);
    assert.equal(JSON.parse(bodyRegistryOwner.payloadJson).schemaVersion, 6);
  } else if (tick > SPLIT_TICK)
    expected.set(tick, observedState(uninterrupted));
}
assert.ok(checkpoint, "checkpoint was not captured");

const registryDivergence = createRuntime(),
  registryDivergencePhysics = registryDivergence.multibodyRuntime.exportState(),
  registryTarget = registryDivergencePhysics.bodies[0],
  registryForeign = registryDivergencePhysics.bodies.find(
    (candidate) =>
      stableStringify(candidate.massProperties) !==
      stableStringify(registryTarget.massProperties),
  );
assert.ok(
  registryForeign,
  "checkpoint fixture lacks distinct mass projections",
);
const liveScalarBody = registryDivergence.multibodyRuntime.bodyByPart.get(
    registryTarget.partId,
  ),
  liveScalarMass = liveScalarBody.mass;
liveScalarBody.mass += 1;
assert.throws(
  () => registryDivergence.coordinator.capture(IDENTITIES_JSON),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture digested contradictory live scalar and projected mass",
);
liveScalarBody.mass = liveScalarMass;
assert.doesNotThrow(
  () => registryDivergence.coordinator.capture(IDENTITIES_JSON),
  "checkpoint capture did not recover after restoring live scalar mass",
);
const registryTargetBody =
    registryDivergence.session.context.bodyRegistry.bodyForPart(
      registryTarget.partId,
    ),
  registryOriginalMassProperties = registryTargetBody.massProperties;
assert.throws(
  () =>
    registryDivergence.session.context.bodyRegistry.setMassProperties(
      registryTargetBody.bodyId,
      registryForeign.massProperties,
    ),
  (error) => error?.code === "MASS_PROPERTY_OWNER_REQUIRED",
  "public body-registry mass setter remained an independent authority",
);
commitBodyRegistryMassProperties(
  registryDivergence.session.context.bodyRegistry,
  [
    {
      bodyId: registryTargetBody.bodyId,
      massProperties: registryForeign.massProperties,
    },
  ],
);
assert.throws(
  () => registryDivergence.coordinator.capture(IDENTITIES_JSON),
  (error) => error?.code === "MASS_PROPERTY_CHECKPOINT_AUTHORITY_MISMATCH",
  "checkpoint capture serialized divergent registry and physics mass authority",
);
commitBodyRegistryMassProperties(
  registryDivergence.session.context.bodyRegistry,
  [
    {
      bodyId: registryTargetBody.bodyId,
      massProperties: registryOriginalMassProperties,
    },
  ],
);
assert.doesNotThrow(
  () => registryDivergence.coordinator.capture(IDENTITIES_JSON),
  "checkpoint capture did not recover after exact mass authority restoration",
);
const registryStateBeforeGhostImport =
    registryDivergence.session.context.bodyRegistry.exportState(),
  hostilePublicRegistryState = structuredClone(registryStateBeforeGhostImport);
hostilePublicRegistryState.bodies[0].loads.push({
  connectionId: "ghost-edge",
  forceN: 0,
  torqueNm: 0,
});
assert.throws(
  () =>
    registryDivergence.session.context.bodyRegistry.importState(
      JSON.stringify(hostilePublicRegistryState),
    ),
  (error) => error?.code === "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "public full-state import accepted a load outside constructor-owned topology",
);
assert.deepEqual(
  registryDivergence.session.context.bodyRegistry.exportState(),
  registryStateBeforeGhostImport,
  "rejected public registry import mutated live state",
);
registryDivergence.dispose();

const restored = createRuntime();
for (let tick = 1; tick <= 4; tick++) {
  commandAtTick(restored, tick);
  restored.session.stepFixed();
}
const beforeRejectedRestore = observedState(restored);
assert.throws(
  () =>
    restoreCheckpoint(restored.coordinator, checkpoint, {
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
  () =>
    restoreCheckpoint(
      restored.coordinator,
      oldTransactionCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
  "checkpoint from the previous solver transaction was accepted",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "transaction identity rejection mutated the running simulation",
);
const hostileSolverContactCheckpoint = structuredClone(checkpoint),
  solverContactOwner = hostileSolverContactCheckpoint.stateOwners.find(
    (owner) => owner.ownerId === "solver-contact",
  ),
  hostileSolverContact = JSON.parse(solverContactOwner.payloadJson);
hostileSolverContact.collisionExclusionIds.push("forged-exclusion-id");
solverContactOwner.payloadJson = stableStringify(hostileSolverContact);
solverContactOwner.payloadByteLength = new TextEncoder().encode(
  solverContactOwner.payloadJson,
).byteLength;
solverContactOwner.payloadSha256 = sha256Hex(solverContactOwner.payloadJson);
hostileSolverContactCheckpoint.stateDigest = checkpointStateDigest(
  hostileSolverContactCheckpoint,
);
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileSolverContactCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "CHECKPOINT_SOLVER_CONTACT_IDENTITY_MISMATCH",
  "forged solver-contact exclusion identity was accepted",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "solver-contact identity rejection mutated the running simulation",
);
const hostileCompiledSemanticsCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(
  hostileCompiledSemanticsCheckpoint,
  "compiled-topology",
  (payload) => {
    payload.physicalSemanticsFingerprint = `sim-sha256-${"5".repeat(64)}`;
  },
);
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileCompiledSemanticsCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "CHECKPOINT_COMPILED_TOPOLOGY_MISMATCH",
  "forged compiled physical semantics were accepted",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "compiled-semantics rejection mutated the running simulation",
);
const hostileSolverSemanticsCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(
  hostileSolverSemanticsCheckpoint,
  "solver-contact",
  (payload) => {
    payload.physicalSemanticsFingerprint = `sim-sha256-${"6".repeat(64)}`;
  },
);
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileSolverSemanticsCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "CHECKPOINT_SOLVER_CONTACT_IDENTITY_MISMATCH",
  "forged solver-contact physical semantics were accepted",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "solver semantics rejection mutated the running simulation",
);
const directPhysicsCheckpoint = restored.multibodyRuntime.exportState(),
  hostileDirectPhysicsCheckpoint = structuredClone(directPhysicsCheckpoint);
hostileDirectPhysicsCheckpoint.compiledPhysicalSemanticsFingerprint = `sim-sha256-${"7".repeat(64)}`;
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectPhysicsCheckpoint,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_PHYSICAL_SEMANTICS_MISMATCH",
  "direct multibody restore accepted forged compiled physical semantics",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct physical-semantics rejection mutated the running physics state",
);
const hostileDirectDuplicateBodyCheckpoint = structuredClone(
  directPhysicsCheckpoint,
);
hostileDirectDuplicateBodyCheckpoint.bodies.push({
  ...structuredClone(hostileDirectDuplicateBodyCheckpoint.bodies[0]),
  position: {
    ...hostileDirectDuplicateBodyCheckpoint.bodies[0].position,
    x: hostileDirectDuplicateBodyCheckpoint.bodies[0].position.x + 17,
  },
});
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectDuplicateBodyCheckpoint,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
  "direct multibody restore accepted duplicate body identity",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct duplicate-body rejection mutated the running physics state",
);
const hostileDirectShapeCheckpoint = structuredClone(directPhysicsCheckpoint);
hostileDirectShapeCheckpoint.bodies[0].position.x += 19;
hostileDirectShapeCheckpoint.bodies[0].shapeOffsets.pop();
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectShapeCheckpoint,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
  "direct multibody restore accepted a changed shape-frame set",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct late shape-frame rejection mutated the running physics state",
);
const hostileDirectShapeValueCheckpoint = structuredClone(
  directPhysicsCheckpoint,
);
hostileDirectShapeValueCheckpoint.bodies[0].shapeOffsets[0].y += 10;
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectShapeValueCheckpoint,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
  "direct multibody restore accepted forged same-length collision geometry",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct collision-frame rejection mutated the running physics state",
);
const hostileDirectEndpointProvenance = structuredClone(
    directPhysicsCheckpoint,
  ),
  hostileDirectEndpointBody = hostileDirectEndpointProvenance.bodies[0];
hostileDirectEndpointBody.massProperties.endpointPointMasses = [
  {
    sourcePartId: "ghost-source",
    sourceConnectionId: "ghost-edge",
    sourcePortId: "A",
    targetPartId: hostileDirectEndpointBody.partId,
    targetPortId: "B",
    positionFramePartId: hostileDirectEndpointBody.partId,
    massKg: 100,
    positionPartM: [999, 0, 0],
  },
];
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectEndpointProvenance,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_PHYSICAL_AUTHORITY_MISMATCH",
  "direct multibody restore accepted forged endpoint mass provenance",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct endpoint-provenance rejection mutated the running physics state",
);
const hostileMissingConstraintScalar = structuredClone(directPhysicsCheckpoint),
  hostileHingeEntry = hostileMissingConstraintScalar.entries.find((entry) =>
    Object.hasOwn(entry.values, "angle"),
  );
assert.ok(hostileHingeEntry, "checkpoint fixture lacks a hinge scalar owner");
delete hostileHingeEntry.values.angle;
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileMissingConstraintScalar,
    ),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
  "direct multibody restore accepted a missing constraint scalar",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "missing constraint-scalar rejection mutated the running physics state",
);
const hostileTireSchema = structuredClone(directPhysicsCheckpoint),
  hostileTireEntry = hostileTireSchema.entries.find(
    (entry) => entry.kind === "rolling-contact-v1",
  );
assert.ok(hostileTireEntry, "checkpoint fixture lacks rolling-contact state");
hostileTireEntry.tireState = { ghost: 1 };
assert.throws(
  () => importMultibodyState(restored.multibodyRuntime, hostileTireSchema),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
  "direct multibody restore accepted a forged tire-state schema",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "tire-schema rejection mutated the running physics state",
);
const hostileNestedTireSchema = structuredClone(directPhysicsCheckpoint),
  hostileNestedTireEntry = hostileNestedTireSchema.entries.find(
    (entry) => entry.kind === "rolling-contact-v1",
  );
hostileNestedTireEntry.tireState.contactRoles = [{ ghost: 1 }];
assert.throws(
  () =>
    importMultibodyState(restored.multibodyRuntime, hostileNestedTireSchema),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
  "direct multibody restore accepted an invalid nested tire-state element",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "nested tire-schema rejection mutated the running physics state",
);
const hostileConnectionLoads = structuredClone(directPhysicsCheckpoint);
hostileConnectionLoads.loadByConnection.push(["ghost-edge", 123]);
hostileConnectionLoads.torqueByConnection.push(["ghost-edge", 456]);
assert.throws(
  () => importMultibodyState(restored.multibodyRuntime, hostileConnectionLoads),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_RUNTIME_STATE",
  "direct multibody restore accepted uncompiled physical load identities",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "connection-load rejection mutated the running physics state",
);
const hostileDirectWorldAdapter = structuredClone(directPhysicsCheckpoint);
hostileDirectWorldAdapter.worldAdapter = { ghost: 1 };
assert.throws(
  () =>
    importMultibodyState(restored.multibodyRuntime, hostileDirectWorldAdapter),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT",
  "direct multibody restore accepted an owner-extraneous world adapter",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "extraneous-owner rejection mutated the running physics state",
);
const hostileDirectNonfiniteCheckpoint = structuredClone(
  directPhysicsCheckpoint,
);
hostileDirectNonfiniteCheckpoint.bodies[0].position.x = Infinity;
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectNonfiniteCheckpoint,
    ),
  "direct multibody restore accepted non-finite body state",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct non-finite rejection mutated the running physics state",
);
const hostileDirectNegativeMassCheckpoint = structuredClone(
  directPhysicsCheckpoint,
);
hostileDirectNegativeMassCheckpoint.bodies[0].mass = -5;
hostileDirectNegativeMassCheckpoint.bodies[0].invMass = -0.2;
hostileDirectNegativeMassCheckpoint.bodies[0].inertia.x = -7;
hostileDirectNegativeMassCheckpoint.bodies[0].invInertia.x = -1 / 7;
assert.throws(
  () =>
    importMultibodyState(
      restored.multibodyRuntime,
      hostileDirectNegativeMassCheckpoint,
    ),
  (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_BODY_STATE",
  "direct multibody restore accepted negative mass and inertia",
);
assert.deepEqual(
  restored.multibodyRuntime.exportState(),
  directPhysicsCheckpoint,
  "direct nonphysical-body rejection mutated the running physics state",
);
for (const { label, mutate } of [
  {
    label: "scalar mass",
    mutate: (body) => {
      body.mass += 5e-11;
    },
  },
  {
    label: "center of mass",
    mutate: (body) => {
      body.massFrame.comPart.x += 5e-11;
    },
  },
  {
    label: "principal inertia",
    mutate: (body) => {
      body.inertia.x += 5e-11;
    },
  },
  {
    label: "full inertia tensor",
    mutate: (body) => {
      body.massProperties.inertiaTensorAtComPartKgM2.xx += 5e-11;
    },
  },
  {
    label: "near-unit orientation",
    mutate: (body) => {
      body.quaternion.w += 5e-10;
    },
  },
]) {
  const hostile = structuredClone(directPhysicsCheckpoint);
  mutate(hostile.bodies[0]);
  assert.throws(
    () => importMultibodyState(restored.multibodyRuntime, hostile),
    (error) =>
      error?.code === "INVALID_MULTIBODY_CHECKPOINT_BODY_STATE" ||
      error?.code === "MULTIBODY_CHECKPOINT_PHYSICAL_AUTHORITY_MISMATCH",
    `direct multibody restore accepted an approximately equal ${label}`,
  );
  assert.deepEqual(
    restored.multibodyRuntime.exportState(),
    directPhysicsCheckpoint,
    `rejected approximately equal ${label} mutated running physics`,
  );
}
const hostileDuplicateBodyCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(
  hostileDuplicateBodyCheckpoint,
  "physics-world",
  (payload) => {
    payload.bodies.push({
      ...structuredClone(payload.bodies[0]),
      position: {
        ...payload.bodies[0].position,
        x: payload.bodies[0].position.x + 23,
      },
    });
  },
);
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileDuplicateBodyCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
  "coordinated restore accepted duplicate physics body identity",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "coordinated duplicate-body rejection mutated the running simulation",
);
const hostileShapeCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(hostileShapeCheckpoint, "physics-world", (payload) => {
  payload.bodies[0].position.x += 29;
  payload.bodies[0].shapeOffsets.pop();
});
assert.throws(
  () =>
    restoreCheckpoint(restored.coordinator, hostileShapeCheckpoint, IDENTITIES),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
  "coordinated restore accepted a changed physics shape-frame set",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "coordinated late shape-frame rejection mutated the running simulation",
);
const hostileShapeValueCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(hostileShapeValueCheckpoint, "physics-world", (payload) => {
  payload.bodies[0].shapeOffsets[0].y += 10;
});
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileShapeValueCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
  "coordinated restore accepted forged same-length collision geometry",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "coordinated collision-frame rejection mutated the running simulation",
);
const hostileEndpointProvenanceCheckpoint = structuredClone(checkpoint);
mutateOwnerPayload(
  hostileEndpointProvenanceCheckpoint,
  "physics-world",
  (payload) => {
    const body = payload.bodies[0];
    body.massProperties.endpointPointMasses = [
      {
        sourcePartId: "ghost-source",
        sourceConnectionId: "ghost-edge",
        sourcePortId: "A",
        targetPartId: body.partId,
        targetPortId: "B",
        positionFramePartId: body.partId,
        massKg: 100,
        positionPartM: [999, 0, 0],
      },
    ];
  },
);
assert.throws(
  () =>
    restoreCheckpoint(
      restored.coordinator,
      hostileEndpointProvenanceCheckpoint,
      IDENTITIES,
    ),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_PHYSICAL_AUTHORITY_MISMATCH",
  "coordinated restore accepted forged endpoint mass provenance",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "coordinated endpoint-provenance rejection mutated the running simulation",
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
  () => restoreCheckpoint(restored.coordinator, hostileCheckpoint, IDENTITIES),
  (error) => error?.code === "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
);
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "failed checkpoint import was not rolled back atomically",
);
const originalWorldAdapterImportState = restored.worldAdapter.importState.bind(
    restored.worldAdapter,
  ),
  beforeLateFailureTelemetry = restored.session.telemetry(),
  beforeLateFailurePreviousTelemetry =
    restored.session.context.previousTelemetry;
let worldAdapterImportAttempts = 0;
restored.worldAdapter.importState = (state) => {
  worldAdapterImportAttempts++;
  if (worldAdapterImportAttempts === 1)
    throw new Error("synthetic late checkpoint owner failure");
  return originalWorldAdapterImportState(state);
};
assert.throws(
  () => restoreCheckpoint(restored.coordinator, checkpoint, IDENTITIES),
  /synthetic late checkpoint owner failure/u,
  "late owner failure did not escape coordinated checkpoint application",
);
delete restored.worldAdapter.importState;
assert.equal(
  observedState(restored),
  beforeRejectedRestore,
  "late restore failure did not roll back the exact registry revision and state",
);
assert.strictEqual(
  restored.session.telemetry(),
  beforeLateFailureTelemetry,
  "late restore failure replaced the exact public telemetry frame",
);
assert.strictEqual(
  restored.session.context.previousTelemetry,
  beforeLateFailurePreviousTelemetry,
  "late restore failure replaced the prior public telemetry frame",
);
restoreCheckpoint(restored.coordinator, checkpoint, IDENTITIES);
const restoredCheckpointState = observedState(restored);
assert.equal(
  restoredCheckpointState,
  checkpointState,
  `restored state did not match the captured committed tick: ${JSON.stringify(firstDifference(restoredCheckpointState, checkpointState))}`,
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
    checkpointPolicy: "reconstruct-from-owner-v1",
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
  multibodyRuntime.start(JSON.stringify(snapshot));
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
        new PneumaticSystem(),
        new RollingContactSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        new PneumaticCommitSystem(),
        new MassPropertyCommitSystem(),
        structureSystem,
        new PhysicalAssemblySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      compiledAssembly: multibodyRuntime.compiled,
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
    activeCheckpoint = activeUninterrupted.coordinator.capture(IDENTITIES_JSON);
    activeCheckpointState = observedState(activeUninterrupted);
  } else if (tick > 72)
    activeExpected.set(tick, observedState(activeUninterrupted));
}
const activeDirectPhysicsState =
  activeUninterrupted.multibodyRuntime.exportState();
for (const { field, value } of [
  { field: "temperatureK", value: -1 },
  { field: "temperatureK", value: null },
  { field: "thermalDerate", value: 2 },
  { field: "actuatorElectricalEnergyJ", value: -1 },
  { field: "actuatorDissipatedEnergyJ", value: -1 },
  { field: "elasticPotentialJ", value: -1 },
  { field: "dampingWorkJ", value: 1 },
]) {
  const hostile = structuredClone(activeDirectPhysicsState),
    entry = hostile.entries.find((candidate) =>
      Object.hasOwn(candidate.values, field),
    );
  assert.ok(entry, `active checkpoint fixture lacks ${field}`);
  entry.values[field] = value;
  assert.throws(
    () => importMultibodyState(activeUninterrupted.multibodyRuntime, hostile),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    `direct multibody restore accepted nonphysical ${field}`,
  );
  assert.deepEqual(
    activeUninterrupted.multibodyRuntime.exportState(),
    activeDirectPhysicsState,
    `rejected ${field} checkpoint mutated active physical state`,
  );
}
{
  const hostile = structuredClone(activeDirectPhysicsState),
    entry = hostile.entries.find(
      (candidate) =>
        Object.hasOwn(candidate.values, "actuatorElectricalEnergyJ") &&
        Object.hasOwn(candidate.values, "actuatorMechanicalWorkJ") &&
        Object.hasOwn(candidate.values, "actuatorDissipatedEnergyJ"),
    );
  assert.ok(entry, "active checkpoint fixture lacks an actuator energy ledger");
  entry.values.actuatorElectricalEnergyJ += 1;
  assert.throws(
    () => importMultibodyState(activeUninterrupted.multibodyRuntime, hostile),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    "direct multibody restore accepted missing actuator dissipation",
  );
  assert.deepEqual(
    activeUninterrupted.multibodyRuntime.exportState(),
    activeDirectPhysicsState,
    "rejected non-conserving actuator ledger mutated active physical state",
  );
}
const activeRestored = await createActiveRuntime();
restoreCheckpoint(activeRestored.coordinator, activeCheckpoint, IDENTITIES);
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
    checkpointPolicy: "world-kinematics-v1",
    surface: "checkpoint impactor",
    materialKey: "workshop-steel",
  };
  world.addBody(impactor);
  multibodyRuntime.start(JSON.stringify(failureAssembly));
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
    failureCheckpoint =
      failureUninterrupted.coordinator.capture(IDENTITIES_JSON);
    failureCheckpointState = observedState(failureUninterrupted);
  } else if (tick > 10)
    failureExpected.set(tick, observedState(failureUninterrupted));
}
assert.equal(failureTick, 14, "failure checkpoint fixture changed transition");
const failureRestored = createFailureRuntime();
restoreCheckpoint(failureRestored.coordinator, failureCheckpoint, IDENTITIES);
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
  multibodyRuntime.start(JSON.stringify(snapshot));
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
        new PneumaticSystem(),
        new RollingContactSystem(),
        new AerodynamicSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        structureSystem,
        new ThermalSystem(),
        new PneumaticCommitSystem(),
        new MassPropertyCommitSystem(),
        new PhysicalAssemblySystem(),
        new PhysicalFlightTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      compiledAssembly: multibodyRuntime.compiled,
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
    hybridCheckpoint = hybridUninterrupted.coordinator.capture(IDENTITIES_JSON);
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
    restoreCheckpoint(
      hybridRestored.coordinator,
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
restoreCheckpoint(hybridRestored.coordinator, hybridCheckpoint, IDENTITIES);
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
