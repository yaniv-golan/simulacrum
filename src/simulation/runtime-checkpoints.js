import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
} from "../model/mechanism-artifact-identity.js";
import { decodeCheckpointOrThrow } from "../model/mechanism-artifacts.js";
import { DomainValidationError, stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import { CANNON_SOLVER_TRANSACTION_ID } from "./cannon-solver-transaction.js";

const encoder = new TextEncoder();
const NO_FLEXIBLE_LINE_RUNTIME = Object.freeze({
  kind: "no-flexible-line-runtime-v1",
});
const NO_PNEUMATIC_NETWORK = Object.freeze({
  kind: "no-pneumatic-network-v1",
});
const NO_AEROTHERMAL_RUNTIME = Object.freeze({
  kind: "no-aerothermal-runtime-v1",
});
const NO_ARTICULATED_RUNTIME = Object.freeze({
  version: 2,
  reconstruction: "no-articulated-runtime-v1",
});
const NO_SENSOR_BANK = Object.freeze({
  kind: "no-controller-sensor-bank-v1",
});
const NO_CONTROLLER_RUNTIME = Object.freeze({
  kind: "no-controller-runtime-v1",
});
const NO_TERRAIN_RUNTIME = Object.freeze({
  version: 2,
  reconstruction: "environment-sample-owned-by-session-v1",
});
const NO_STRUCTURE_RUNTIME = Object.freeze({
  kind: "no-structure-runtime-v1",
});
const NO_RELEASE_COUPLER_RUNTIME = Object.freeze({
  kind: "no-release-coupler-runtime-v1",
});
const NO_MOTOR_ENERGY_RUNTIME = Object.freeze({
  kind: "no-motor-energy-settlement-runtime-v1",
});
const NO_MATERIAL_RESOURCE_NETWORK = Object.freeze({
  kind: "no-material-resource-network-v1",
});
const NO_PRESSURE_NOZZLE_RUNTIME = Object.freeze({
  kind: "no-pressure-nozzle-runtime-v1",
});
const SOLVER_CONTACT_RECONSTRUCTION = Object.freeze({
  version: 2,
  reconstruction: "cold-start-from-physics-world-v1",
});
const TIRE_CARCASS_RECONSTRUCTION = Object.freeze({
  version: 2,
  reconstruction: "from-physics-world-entry-state-v1",
});

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function exactCheckpointValue(value, expected) {
  return stableStringify(value) === stableStringify(expected);
}

function assertAbsentOwnerState(owner, state, absentState, label) {
  if (owner) {
    if (stableStringify(state) === stableStringify(absentState))
      throw new DomainValidationError(
        "CHECKPOINT_OWNER_PRESENCE_MISMATCH",
        `${label} checkpoint is absent while its live owner is present`,
      );
    return owner;
  }
  if (stableStringify(state) !== stableStringify(absentState))
    throw new DomainValidationError(
      "CHECKPOINT_OWNER_PRESENCE_MISMATCH",
      `${label} checkpoint payload does not match the live owner set`,
    );
  return null;
}

function ownerRecord(ownerId, payload) {
  const payloadJson = stableStringify(payload);
  return {
    ownerId,
    ownerVersion: CHECKPOINT_STATE_OWNER_VERSIONS[ownerId],
    payloadJson,
    payloadByteLength: encoder.encode(payloadJson).byteLength,
    payloadSha256: sha256Hex(payloadJson),
  };
}

function ownerPayloads(checkpoint) {
  return new Map(
    checkpoint.stateOwners.map((owner) => [
      owner.ownerId,
      JSON.parse(owner.payloadJson),
    ]),
  );
}

/** Captures and restores complete state only at committed fixed-step boundaries. */
export class RuntimeCheckpointCoordinator {
  constructor({
    session,
    multibodyRuntime,
    flexibleLineRuntime = null,
    worldAdapter,
    sensorBank = null,
    controllerManager = null,
    aerothermalAblationOwner = null,
    articulatedDrive = null,
    terrainState = null,
    inputCursor = null,
  }) {
    this.session = session;
    this.multibodyRuntime = multibodyRuntime;
    this.flexibleLineRuntime = flexibleLineRuntime;
    this.worldAdapter = worldAdapter;
    this.sensorBank = sensorBank;
    this.controllerManager = controllerManager;
    this.aerothermalAblationOwner = aerothermalAblationOwner;
    this.articulatedDrive = articulatedDrive;
    this.terrainState = terrainState;
    this.inputCursor = inputCursor;
    this.session.context?.runGraph?.setCheckpointInternalEdgeIds(
      (this.multibodyRuntime.compiled?.flexibleLines || []).flatMap((line) =>
        line.internalEdges.map((edge) => edge.id),
      ),
    );
  }

  #requireCommittedSession() {
    const context = this.session?.context,
      integration = this.worldAdapter.telemetry(),
      completedTick = context?.clock.tick === integration.integratedTick,
      initializedBoundary =
        context?.clock.tick === 0 &&
        context.clock.time === 0 &&
        integration.tick === 0 &&
        integration.integratedTick === -1 &&
        integration.integrationCount === 0;
    if (!context || (!completedTick && !initializedBoundary))
      throw new DomainValidationError(
        "CHECKPOINT_REQUIRES_COMMITTED_TICK",
        "Checkpoint capture is allowed only at the initialized run boundary or after a fully integrated fixed tick",
      );
    return context;
  }

  #structureSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "structure-failure",
    );
  }

  #pressureNozzleSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "chemical-propulsion",
    );
  }

  #releaseCouplerSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "release-couplers",
    );
  }

  #motorEnergySettlementSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "motor-energy-settlement",
    );
  }

  #massPropertyCommitSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "mass-properties",
    );
  }

  #bodyRegistryProjectionSystem() {
    return this.session.systems.find(
      (system) => system.checkpointOwner === "body-registry-projection",
    );
  }

  #requireBodyRegistryProjectionSystem() {
    const system = this.#bodyRegistryProjectionSystem();
    if (typeof system?.reconstructAfterPhysicsRestore !== "function")
      throw new DomainValidationError(
        "BODY_REGISTRY_PROJECTION_OWNER_MISSING",
        "Checkpoint restore requires the body-registry projection system",
      );
    return system;
  }

  #requireMassPropertyCommitSystem(context) {
    const required = Boolean(
        context.materialResourceNetwork ||
        context.pneumaticNetwork ||
        this.aerothermalAblationOwner,
      ),
      system = this.#massPropertyCommitSystem();
    if (
      required &&
      typeof system?.reconstructAfterCheckpointOwners !== "function"
    )
      throw new DomainValidationError(
        "MASS_PROPERTY_CHECKPOINT_OWNER_MISSING",
        "Checkpoint restore requires the explicit mass-properties owner when material, pneumatic, or aerothermal mass can change",
      );
    return system;
  }

  #materialResourceExport(context) {
    return {
      version: 2,
      network: context.materialResourceNetwork
        ? context.materialResourceNetwork.exportState()
        : NO_MATERIAL_RESOURCE_NETWORK,
      propulsion: this.#pressureNozzleSystem()
        ? this.#pressureNozzleSystem().exportState(context)
        : NO_PRESSURE_NOZZLE_RUNTIME,
    };
  }

  #materialResourceImport(context, state) {
    if (state?.version !== 2 || !state.network || !state.propulsion)
      throw new DomainValidationError(
        "INVALID_MATERIAL_RESOURCE_OWNER_CHECKPOINT",
        "Material-resource owner checkpoint must use version 2",
      );
    context.materialResourceNetwork?.importState(
      state.network,
      context.runGraph,
    );
    this.#pressureNozzleSystem()?.importState(context, state.propulsion);
  }

  #materialResourceValidate(context, state) {
    if (
      state?.version !== 2 ||
      !checkpointKeysMatch(state, ["version", "network", "propulsion"]) ||
      !state.network ||
      !state.propulsion
    )
      throw new DomainValidationError(
        "INVALID_MATERIAL_RESOURCE_OWNER_CHECKPOINT",
        "Material-resource owner checkpoint must use version 2",
      );
    const network = assertAbsentOwnerState(
        context.materialResourceNetwork,
        state.network,
        NO_MATERIAL_RESOURCE_NETWORK,
        "Material-resource network",
      ),
      propulsion = assertAbsentOwnerState(
        this.#pressureNozzleSystem(),
        state.propulsion,
        NO_PRESSURE_NOZZLE_RUNTIME,
        "Pressure-nozzle runtime",
      );
    network?.validateState(state.network);
    propulsion?.validateState(context, state.propulsion);
  }

  #articulatedController() {
    return (
      this.articulatedDrive ||
      this.session.context?.services?.articulatedController ||
      null
    );
  }

  #terrainExport() {
    if (!this.terrainState) return NO_TERRAIN_RUNTIME;
    if (typeof this.terrainState.exportState !== "function")
      throw new DomainValidationError(
        "TERRAIN_CHECKPOINT_OWNER_MISSING",
        "Terrain runtime must expose exportState for checkpoint capture",
      );
    return this.terrainState.exportState();
  }

  #captureMutableState(context) {
    return {
      runGraph: context.runGraph.exportState(),
      physics: this.multibodyRuntime.exportState(),
      flexibleLines:
        this.flexibleLineRuntime?.exportState() ?? NO_FLEXIBLE_LINE_RUNTIME,
      bodyRegistry: context.bodyRegistry.exportCheckpointState(),
      structure: this.#structureSystem()?.exportState() ?? NO_STRUCTURE_RUNTIME,
      aerothermal:
        this.aerothermalAblationOwner?.exportState() ?? NO_AEROTHERMAL_RUNTIME,
      releaseCouplers:
        this.#releaseCouplerSystem()?.exportState(context) ??
        NO_RELEASE_COUPLER_RUNTIME,
      materialResources: this.#materialResourceExport(context),
      pneumatics:
        context.pneumaticNetwork?.exportState() ?? NO_PNEUMATIC_NETWORK,
      articulated:
        this.#articulatedController()?.exportState?.() ??
        NO_ARTICULATED_RUNTIME,
      commandBus: context.commandBus.exportState(),
      inputCursor: this.inputCursor?.capture?.() ?? null,
      sensors: this.sensorBank?.exportState() ?? NO_SENSOR_BANK,
      controllers:
        this.controllerManager?.exportState() ?? NO_CONTROLLER_RUNTIME,
      terrain: this.#terrainExport(),
      session: this.session.exportState(),
      telemetry: this.session.exportTelemetryState(),
      worldAdapter: this.worldAdapter.exportState(),
      motorEnergySettlement:
        this.#motorEnergySettlementSystem()?.exportState() ??
        NO_MOTOR_ENERGY_RUNTIME,
    };
  }

  #applyMutableState(context, state) {
    context.runGraph.importState(state.runGraph);
    this.#materialResourceImport(context, state.materialResources);
    context.pneumaticNetwork?.importState(state.pneumatics);
    this.aerothermalAblationOwner?.importState(state.aerothermal);
    this.aerothermalAblationOwner?.synchronizeBodyRegistry(
      context.bodyRegistry,
    );
    this.session.importState(state.session);
    this.session.importTelemetryState(state.telemetry);
    this.#requireMassPropertyCommitSystem(
      context,
    )?.reconstructAfterCheckpointOwners(context);
    this.multibodyRuntime.importState(state.physics);
    this.#requireBodyRegistryProjectionSystem().reconstructAfterPhysicsRestore(
      context,
    );
    this.flexibleLineRuntime?.importState(state.flexibleLines);
    context.bodyRegistry.importCheckpointState(state.bodyRegistry);
    this.#structureSystem()?.importState(state.structure);
    this.#releaseCouplerSystem()?.importState(context, state.releaseCouplers);
    this.#articulatedController()?.importState?.(state.articulated);
    context.commandBus.importState(state.commandBus);
    this.inputCursor?.restore?.(state.inputCursor);
    this.sensorBank?.importState(state.sensors);
    this.controllerManager?.importState(state.controllers, { notify: false });
    this.terrainState?.importState?.(state.terrain);
    this.worldAdapter.importState(state.worldAdapter);
    this.#motorEnergySettlementSystem()?.importState(
      state.motorEnergySettlement,
    );
    this.session.resynchronizeAfterCheckpointRestore();
  }

  #validateMutableState(context, state) {
    this.#requireBodyRegistryProjectionSystem();
    context.runGraph.validateState(state.runGraph);
    this.multibodyRuntime.validateState(state.physics);
    const flexibleLineRuntime = assertAbsentOwnerState(
      this.flexibleLineRuntime,
      state.flexibleLines,
      NO_FLEXIBLE_LINE_RUNTIME,
      "Flexible-line runtime",
    );
    flexibleLineRuntime?.validateState(state.flexibleLines);
    context.bodyRegistry.validateCheckpointState(state.bodyRegistry);
    const structure = assertAbsentOwnerState(
      this.#structureSystem(),
      state.structure,
      NO_STRUCTURE_RUNTIME,
      "Structure runtime",
    );
    structure?.validateState(state.structure);
    const aerothermal = assertAbsentOwnerState(
      this.aerothermalAblationOwner,
      state.aerothermal,
      NO_AEROTHERMAL_RUNTIME,
      "Aerothermal runtime",
    );
    aerothermal?.validateState(state.aerothermal);
    const releaseCouplers = assertAbsentOwnerState(
      this.#releaseCouplerSystem(),
      state.releaseCouplers,
      NO_RELEASE_COUPLER_RUNTIME,
      "Release-coupler runtime",
    );
    releaseCouplers?.validateState(context, state.releaseCouplers);
    this.#materialResourceValidate(context, state.materialResources);
    const pneumaticNetwork = assertAbsentOwnerState(
      context.pneumaticNetwork,
      state.pneumatics,
      NO_PNEUMATIC_NETWORK,
      "Pneumatic network",
    );
    pneumaticNetwork?.validateState(state.pneumatics);
    this.#requireMassPropertyCommitSystem(context);
    const articulated = assertAbsentOwnerState(
      this.#articulatedController(),
      state.articulated,
      NO_ARTICULATED_RUNTIME,
      "Articulated runtime",
    );
    if (articulated) {
      if (typeof articulated?.validateState !== "function")
        throw new DomainValidationError(
          "CHECKPOINT_OWNER_VALIDATOR_MISSING",
          "Articulated checkpoint owner must support pure validation",
        );
      articulated.validateState(state.articulated, {
        physicsState: state.physics,
      });
    }
    context.commandBus.validateState(state.commandBus);
    if (this.inputCursor) {
      if (state.inputCursor == null)
        throw new DomainValidationError(
          "CHECKPOINT_OWNER_PRESENCE_MISMATCH",
          "Input cursor checkpoint is absent while its live owner is present",
        );
      this.inputCursor.validateState(state.inputCursor);
    } else if (state.inputCursor !== null)
      throw new DomainValidationError(
        "CHECKPOINT_OWNER_PRESENCE_MISMATCH",
        "Input cursor checkpoint is present without a live owner",
      );
    const sensors = assertAbsentOwnerState(
      this.sensorBank,
      state.sensors,
      NO_SENSOR_BANK,
      "Controller sensor bank",
    );
    sensors?.validateState(state.sensors);
    const controllers = assertAbsentOwnerState(
      this.controllerManager,
      state.controllers,
      NO_CONTROLLER_RUNTIME,
      "Controller runtime",
    );
    controllers?.validateState(state.controllers);
    const terrain = assertAbsentOwnerState(
      this.terrainState,
      state.terrain,
      NO_TERRAIN_RUNTIME,
      "Terrain runtime",
    );
    terrain?.validateState(state.terrain);
    this.session.validateState(state.session);
    this.session.validateTelemetryState(state.telemetry);
    this.worldAdapter.validateState(state.worldAdapter, {
      externalBodyPlans: terrain
        ? [this.terrainState.checkpointExternalBodyPlan(state.terrain)]
        : [],
    });
    const motorEnergy = assertAbsentOwnerState(
      this.#motorEnergySettlementSystem(),
      state.motorEnergySettlement,
      NO_MOTOR_ENERGY_RUNTIME,
      "Motor-energy settlement runtime",
    );
    motorEnergy?.validateState(state.motorEnergySettlement);
  }

  #validateDeclarativeOwnerPayloads(payloads) {
    const input = payloads.get("input-command-bus"),
      compiled = payloads.get("compiled-topology"),
      solver = payloads.get("solver-contact"),
      tire = payloads.get("tire-carcass"),
      energy = payloads.get("energy-power-signal");
    if (!checkpointKeysMatch(input, ["commandBus", "inputCursor"]))
      throw new DomainValidationError(
        "INVALID_INPUT_COMMAND_CHECKPOINT",
        "Input-command checkpoint exceeds its mutable owner projection",
      );
    if (
      !checkpointKeysMatch(compiled, [
        "version",
        "sourceRevision",
        "bodyIds",
        "constraintIds",
        "contactRegionIds",
        "flexibleEntityIds",
        "flexibleEdgeIds",
        "transactionId",
      ]) ||
      compiled.version !== 2 ||
      ![
        compiled.bodyIds,
        compiled.constraintIds,
        compiled.contactRegionIds,
        compiled.flexibleEntityIds,
        compiled.flexibleEdgeIds,
      ].every((ids) => Array.isArray(ids) && new Set(ids).size === ids.length)
    )
      throw new DomainValidationError(
        "CHECKPOINT_COMPILED_TOPOLOGY_MISMATCH",
        "Compiled-topology checkpoint must be an exact unique identity projection",
      );
    if (!exactCheckpointValue(solver, SOLVER_CONTACT_RECONSTRUCTION))
      throw new DomainValidationError(
        "INVALID_SOLVER_CONTACT_CHECKPOINT",
        "Solver-contact state must reconstruct from the physics owner",
      );
    if (!exactCheckpointValue(tire, TIRE_CARCASS_RECONSTRUCTION))
      throw new DomainValidationError(
        "INVALID_TIRE_CARCASS_CHECKPOINT",
        "Tire-carcass state must reconstruct from the physics owner",
      );
    if (
      !checkpointKeysMatch(energy, [
        "version",
        "reconstruction",
        "motorEnergySettlement",
      ]) ||
      energy.version !== 2 ||
      energy.reconstruction !== "resolve-from-run-graph-before-next-actuator-v1"
    )
      throw new DomainValidationError(
        "INVALID_ENERGY_NETWORK_CHECKPOINT",
        "Energy, power, and signal checkpoint exceeds its mutable owner projection",
      );
  }

  #validateOwnerTimeCoherence(checkpoint, payloads) {
    const committedTick = checkpoint.committedTick,
      session = payloads.get("session"),
      bodyRegistry = payloads.get("body-registry"),
      physics = payloads.get("physics-world"),
      adapter = physics?.worldAdapter,
      telemetry = payloads.get("telemetry-event-ids"),
      material = payloads.get("material-resources")?.network,
      pneumatics = payloads.get("pneumatic-gas"),
      input = payloads.get("input-command-bus")?.inputCursor,
      controllers = payloads.get("controllers"),
      flexible = payloads.get("flexible-line-runtime"),
      motorEnergy = payloads.get("energy-power-signal")?.motorEnergySettlement,
      expectedIntegratedTick = committedTick === 0 ? -1 : committedTick,
      expectedTime = committedTick * session?.fixedDt,
      materialTick = material?.lastCommittedAllocationTick,
      inputRecords = Array.isArray(input?.records) ? input.records : [],
      controllerRecords = Array.isArray(controllers) ? controllers : [],
      coherent =
        Number.isSafeInteger(committedTick) &&
        committedTick >= 0 &&
        session?.clock?.tick === committedTick &&
        bodyRegistry?.tick === committedTick &&
        adapter?.tick === committedTick &&
        adapter?.integratedTick === expectedIntegratedTick &&
        adapter?.integrationCount === committedTick &&
        physics?.world?.stepnumber === committedTick &&
        telemetry?.tick === committedTick &&
        (materialTick === undefined ||
          materialTick === null ||
          (Number.isSafeInteger(materialTick) &&
            materialTick <= committedTick)) &&
        (pneumatics?.kind === "no-pneumatic-network-v1" ||
          pneumatics?.transactionCursor === committedTick) &&
        inputRecords.every(
          (record) =>
            Number.isSafeInteger(record.tick) && record.tick <= committedTick,
        ) &&
        controllerRecords.every(
          (record) =>
            Number.isSafeInteger(record.tick) && record.tick <= committedTick,
        ) &&
        (flexible?.kind === "no-flexible-line-runtime-v1" ||
          flexible?.lastDissipationTick === null ||
          (Number.isSafeInteger(flexible?.lastDissipationTick) &&
            flexible.lastDissipationTick <= committedTick)) &&
        (motorEnergy?.kind === "no-motor-energy-settlement-runtime-v1" ||
          (Number.isSafeInteger(motorEnergy?.lastSettledTick) &&
            motorEnergy.lastSettledTick <= committedTick)) &&
        Number.isFinite(expectedTime) &&
        Math.abs(session?.clock?.time - expectedTime) <= 1e-12 &&
        Math.abs(session?.time - expectedTime) <= 1e-12 &&
        Math.abs(physics?.world?.time - expectedTime) <= 1e-12;
    if (!coherent)
      throw new DomainValidationError(
        "CHECKPOINT_OWNER_TIME_MISMATCH",
        "Checkpoint owners do not describe one committed fixed-step boundary",
      );
  }

  capture({
    runConfigurationFingerprint,
    blueprintFingerprint,
    compiledTopologyFingerprint,
  }) {
    const context = this.#requireCommittedSession(),
      physics = this.multibodyRuntime.exportState(),
      runGraph = context.runGraph.exportState();
    physics.worldAdapter = this.worldAdapter.exportState();
    const payload = {
        session: this.session.exportState(),
        "input-command-bus": {
          commandBus: context.commandBus.exportState(),
          inputCursor: this.inputCursor?.capture?.() ?? null,
        },
        "run-graph": runGraph,
        "compiled-topology": {
          version: 2,
          sourceRevision: this.multibodyRuntime.compiled.sourceRevision,
          bodyIds: this.multibodyRuntime.compiled.bodies
            .map((body) => body.id)
            .sort(),
          constraintIds: this.multibodyRuntime.compiled.constraints
            .map((constraint) => constraint.id)
            .sort(),
          contactRegionIds: this.multibodyRuntime.compiled.contactRegions
            .map((region) => region.id)
            .sort(),
          flexibleEntityIds: (
            this.multibodyRuntime.compiled.flexibleLines || []
          )
            .flatMap((line) => line.entities.map((entity) => entity.id))
            .sort(),
          flexibleEdgeIds: (this.multibodyRuntime.compiled.flexibleLines || [])
            .flatMap((line) => line.internalEdges.map((edge) => edge.id))
            .sort(),
          transactionId: CANNON_SOLVER_TRANSACTION_ID,
        },
        "physics-world": physics,
        "flexible-line-runtime": this.flexibleLineRuntime?.exportState() ?? {
          kind: "no-flexible-line-runtime-v1",
        },
        "solver-contact": SOLVER_CONTACT_RECONSTRUCTION,
        "tire-carcass": TIRE_CARCASS_RECONSTRUCTION,
        "body-registry": context.bodyRegistry.exportCheckpointState(),
        "structure-failure":
          this.#structureSystem()?.exportState() ?? NO_STRUCTURE_RUNTIME,
        "energy-power-signal": {
          version: 2,
          reconstruction: "resolve-from-run-graph-before-next-actuator-v1",
          motorEnergySettlement:
            this.#motorEnergySettlementSystem()?.exportState() ??
            NO_MOTOR_ENERGY_RUNTIME,
        },
        "release-couplers":
          this.#releaseCouplerSystem()?.exportState(context) ??
          NO_RELEASE_COUPLER_RUNTIME,
        "material-resources": this.#materialResourceExport(context),
        "pneumatic-gas": context.pneumaticNetwork?.exportState() ?? {
          kind: "no-pneumatic-network-v1",
        },
        "thermal-ablation": this.aerothermalAblationOwner
          ? this.aerothermalAblationOwner.exportState()
          : { kind: "no-aerothermal-runtime-v1" },
        "articulated-drive": this.#articulatedController()?.exportState?.() ?? {
          version: 2,
          reconstruction: "no-articulated-runtime-v1",
        },
        sensors: this.sensorBank?.exportState() ?? {
          kind: "no-controller-sensor-bank-v1",
        },
        controllers: this.controllerManager?.exportState() ?? {
          kind: "no-controller-runtime-v1",
        },
        "terrain-environment": this.#terrainExport(),
        "telemetry-event-ids": this.session.exportTelemetryState(),
      },
      checkpoint = {
        format: "simulacrum-checkpoint",
        version: 2,
        runConfigurationFingerprint,
        blueprintFingerprint,
        compiledTopologyFingerprint,
        committedTick: context.clock.tick,
        committed: true,
        stateOwners: CHECKPOINT_STATE_OWNER_IDS.map((ownerId) =>
          ownerRecord(ownerId, payload[ownerId]),
        ),
        stateDigest: "0".repeat(64),
      };
    checkpoint.stateDigest = checkpointStateDigest(checkpoint);
    return decodeCheckpointOrThrow(checkpoint).wire;
  }

  restore(
    input,
    {
      runConfigurationFingerprint,
      blueprintFingerprint,
      compiledTopologyFingerprint,
    },
  ) {
    const checkpoint = decodeCheckpointOrThrow(input).wire,
      expected = {
        runConfigurationFingerprint,
        blueprintFingerprint,
        compiledTopologyFingerprint,
      };
    for (const [field, value] of Object.entries(expected))
      if (checkpoint[field] !== value)
        throw new DomainValidationError(
          "CHECKPOINT_RUNTIME_IDENTITY_MISMATCH",
          `Checkpoint ${field} does not match the running simulation`,
          { path: [field] },
        );
    const context = this.session?.context,
      payloads = ownerPayloads(checkpoint),
      compiled = payloads.get("compiled-topology"),
      currentBodies = this.multibodyRuntime.compiled.bodies
        .map((body) => body.id)
        .sort(),
      currentConstraints = this.multibodyRuntime.compiled.constraints
        .map((constraint) => constraint.id)
        .sort(),
      currentContactRegions = this.multibodyRuntime.compiled.contactRegions
        .map((region) => region.id)
        .sort(),
      currentFlexibleEntities = (
        this.multibodyRuntime.compiled.flexibleLines || []
      )
        .flatMap((line) => line.entities.map((entity) => entity.id))
        .sort(),
      currentFlexibleEdges = (
        this.multibodyRuntime.compiled.flexibleLines || []
      )
        .flatMap((line) => line.internalEdges.map((edge) => edge.id))
        .sort();
    this.#validateDeclarativeOwnerPayloads(payloads);
    if (!context)
      throw new DomainValidationError(
        "CHECKPOINT_COMPILED_TOPOLOGY_MISMATCH",
        "Checkpoint compiled topology does not match the running simulation",
      );
    if (compiled.transactionId !== CANNON_SOLVER_TRANSACTION_ID)
      throw new DomainValidationError(
        "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
        "Checkpoint Cannon solver transaction identity changed",
      );
    if (
      compiled.sourceRevision !==
        this.multibodyRuntime.compiled.sourceRevision ||
      stableStringify(compiled.bodyIds) !== stableStringify(currentBodies) ||
      stableStringify(compiled.constraintIds) !==
        stableStringify(currentConstraints) ||
      stableStringify(compiled.contactRegionIds) !==
        stableStringify(currentContactRegions) ||
      stableStringify(compiled.flexibleEntityIds || []) !==
        stableStringify(currentFlexibleEntities) ||
      stableStringify(compiled.flexibleEdgeIds || []) !==
        stableStringify(currentFlexibleEdges)
    )
      throw new DomainValidationError(
        "CHECKPOINT_COMPILED_TOPOLOGY_MISMATCH",
        "Checkpoint compiled topology does not match the running simulation",
      );

    const physics = payloads.get("physics-world"),
      target = {
        runGraph: payloads.get("run-graph"),
        physics,
        flexibleLines: payloads.get("flexible-line-runtime"),
        bodyRegistry: payloads.get("body-registry"),
        structure: payloads.get("structure-failure"),
        aerothermal: payloads.get("thermal-ablation"),
        releaseCouplers: payloads.get("release-couplers"),
        materialResources: payloads.get("material-resources"),
        pneumatics: payloads.get("pneumatic-gas"),
        articulated: payloads.get("articulated-drive"),
        commandBus: payloads.get("input-command-bus").commandBus,
        inputCursor: payloads.get("input-command-bus").inputCursor,
        sensors: payloads.get("sensors"),
        controllers: payloads.get("controllers"),
        terrain: payloads.get("terrain-environment"),
        session: payloads.get("session"),
        telemetry: payloads.get("telemetry-event-ids"),
        worldAdapter: physics.worldAdapter,
        motorEnergySettlement: payloads.get("energy-power-signal")
          .motorEnergySettlement,
      };
    this.#validateOwnerTimeCoherence(checkpoint, payloads);
    this.#validateMutableState(context, target);
    const baseline = this.#captureMutableState(context);
    try {
      this.#applyMutableState(context, target);
    } catch (restoreError) {
      try {
        this.#applyMutableState(context, baseline);
      } catch (rollbackError) {
        throw new AggregateError(
          [restoreError, rollbackError],
          "Checkpoint restore failed and rollback could not recover the running state",
          { cause: rollbackError },
        );
      }
      throw restoreError;
    }
    this.session.commitCheckpointRestore();
    this.controllerManager?.publishState();
    return checkpoint;
  }
}
