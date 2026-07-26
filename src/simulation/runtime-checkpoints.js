import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
} from "../model/mechanism-artifact-identity.js";
import { decodeCheckpointOrThrow } from "../model/mechanism-artifacts.js";
import { DomainValidationError, stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import { CANNON_SOLVER_TRANSACTION_ID } from "./cannon-solver-transaction.js";
import { stripRouteEvidenceCapabilities } from "./telemetry.js";

const encoder = new TextEncoder();

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
  }

  #requireCommittedSession() {
    const context = this.session?.context;
    if (
      !context ||
      context.clock.tick !== this.worldAdapter.telemetry().integratedTick
    )
      throw new DomainValidationError(
        "CHECKPOINT_REQUIRES_COMMITTED_TICK",
        "Checkpoint capture is allowed only after a fully integrated fixed tick",
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

  #materialResourceExport(context) {
    return {
      version: 2,
      network: context.materialResourceNetwork
        ? context.materialResourceNetwork.exportState()
        : { kind: "no-material-resource-network-v1" },
      propulsion: this.#pressureNozzleSystem()
        ? this.#pressureNozzleSystem().exportState(context)
        : { kind: "no-pressure-nozzle-runtime-v1" },
    };
  }

  #materialResourceImport(context, state) {
    if (state?.version !== 2 || !state.network || !state.propulsion)
      throw new DomainValidationError(
        "INVALID_MATERIAL_RESOURCE_OWNER_CHECKPOINT",
        "Material-resource owner checkpoint must use version 2",
      );
    if (context.materialResourceNetwork)
      context.materialResourceNetwork.importState(
        state.network,
        context.runGraph,
      );
    this.#pressureNozzleSystem()?.importState(context, state.propulsion);
  }

  #articulatedController() {
    return (
      this.articulatedDrive ||
      this.session.context?.services?.articulatedController ||
      null
    );
  }

  #terrainExport() {
    if (!this.terrainState)
      return {
        version: 1,
        reconstruction: "environment-sample-owned-by-session-v1",
      };
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
      flexibleLines: this.flexibleLineRuntime?.exportState() ?? {
        kind: "no-flexible-line-runtime-v1",
      },
      bodyRegistry: context.bodyRegistry.exportState(),
      structure: this.#structureSystem()?.exportState() ?? null,
      aerothermal: this.aerothermalAblationOwner?.exportState() ?? null,
      releaseCouplers:
        this.#releaseCouplerSystem()?.exportState(context) ?? null,
      materialResources: this.#materialResourceExport(context),
      articulated: this.#articulatedController()?.exportState?.() ?? null,
      commandBus: context.commandBus.exportState(),
      inputCursor: this.inputCursor?.capture?.() ?? null,
      sensors: this.sensorBank?.exportState() ?? null,
      controllers: this.controllerManager?.exportState() ?? null,
      terrain: this.terrainState?.exportState?.() ?? null,
      session: this.session.exportState(),
      worldAdapter: this.worldAdapter.exportState(),
      motorEnergySettlement:
        this.#motorEnergySettlementSystem()?.exportState() ?? {
          version: 1,
          lastSettledTick: 0,
          totals: [],
        },
    };
  }

  #applyMutableState(context, state) {
    context.runGraph.importState(state.runGraph);
    this.multibodyRuntime.importState(state.physics);
    if (this.flexibleLineRuntime && state.flexibleLines?.version === 1)
      this.flexibleLineRuntime.importState(state.flexibleLines);
    context.bodyRegistry.importState(state.bodyRegistry);
    if (state.structure) this.#structureSystem()?.importState(state.structure);
    if (state.aerothermal)
      this.aerothermalAblationOwner?.importState(state.aerothermal);
    if (state.releaseCouplers)
      this.#releaseCouplerSystem()?.importState(context, state.releaseCouplers);
    if (state.materialResources)
      this.#materialResourceImport(context, state.materialResources);
    if (state.articulated)
      this.#articulatedController()?.importState?.(state.articulated);
    context.commandBus.importState(state.commandBus);
    this.inputCursor?.restore?.(state.inputCursor);
    if (state.sensors) this.sensorBank?.importState(state.sensors);
    if (state.controllers)
      this.controllerManager?.importState(state.controllers);
    if (state.terrain) this.terrainState?.importState?.(state.terrain);
    this.session.importState(state.session);
    this.worldAdapter.importState(state.worldAdapter);
    if (state.motorEnergySettlement)
      this.#motorEnergySettlementSystem()?.importState(
        state.motorEnergySettlement,
      );
    this.session.resynchronizeAfterCheckpointRestore();
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
        "solver-contact": {
          statePolicy: physics.solverStatePolicy,
          constraintIds: physics.entries.map((entry) => entry.id),
          collisionExclusionIds: physics.exclusionStates.map(
            (entry) => entry.id,
          ),
        },
        "tire-carcass": {
          owner: "physics-world",
          contactIds: physics.entries
            .filter((entry) => entry.kind === "rolling-contact-v1")
            .map((entry) => entry.id),
        },
        "body-registry": context.bodyRegistry.exportState(),
        "structure-failure": this.#structureSystem()?.exportState() ?? {
          version: 1,
          initialBodyComponents: [],
          overloadSeconds: [],
        },
        "energy-power-signal": {
          version: 1,
          reconstruction: "resolve-from-run-graph-before-next-actuator-v1",
          graphRevision: runGraph.graphRevision,
          power: context.powerNetwork?.telemetry?.() ?? null,
          signals: context.signalNetwork?.telemetry?.() ?? null,
          motorEnergySettlement:
            this.#motorEnergySettlementSystem()?.exportState() ?? {
              version: 1,
              lastSettledTick: 0,
              totals: [],
            },
        },
        "release-couplers": this.#releaseCouplerSystem()?.exportState(
          context,
        ) ?? {
          version: 1,
          states: [],
        },
        "material-resources": this.#materialResourceExport(context),
        "thermal-ablation": this.aerothermalAblationOwner
          ? this.aerothermalAblationOwner.exportState()
          : { kind: "no-aerothermal-runtime-v1" },
        "articulated-drive": this.#articulatedController()?.exportState?.() ?? {
          version: 1,
          reconstruction: "no-articulated-runtime-v1",
        },
        sensors: this.sensorBank?.exportState() ?? {
          kind: "no-controller-sensor-bank-v1",
        },
        controllers: this.controllerManager?.exportState() ?? {
          kind: "no-controller-runtime-v1",
        },
        "terrain-environment": this.#terrainExport(),
        "telemetry-event-ids": {
          tick: context.clock.tick,
          telemetry: stripRouteEvidenceCapabilities(context.telemetry),
          previousTelemetry: stripRouteEvidenceCapabilities(
            context.previousTelemetry,
          ),
          runEventCount: context.runGraph.events().length,
        },
      },
      checkpoint = {
        format: "simulacrum-checkpoint",
        version: 1,
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
    if (
      !context ||
      compiled.transactionId !== CANNON_SOLVER_TRANSACTION_ID ||
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

    const baseline = this.#captureMutableState(context),
      physics = payloads.get("physics-world"),
      target = {
        runGraph: payloads.get("run-graph"),
        physics,
        flexibleLines: this.flexibleLineRuntime
          ? payloads.get("flexible-line-runtime")
          : null,
        bodyRegistry: payloads.get("body-registry"),
        structure: payloads.get("structure-failure"),
        aerothermal: this.aerothermalAblationOwner
          ? payloads.get("thermal-ablation")
          : null,
        releaseCouplers: this.#releaseCouplerSystem()
          ? payloads.get("release-couplers")
          : null,
        materialResources: context.materialResourceNetwork
          ? payloads.get("material-resources")
          : null,
        articulated: this.#articulatedController()
          ? payloads.get("articulated-drive")
          : null,
        commandBus: payloads.get("input-command-bus").commandBus,
        inputCursor: payloads.get("input-command-bus").inputCursor,
        sensors: this.sensorBank ? payloads.get("sensors") : null,
        controllers: this.controllerManager
          ? payloads.get("controllers")
          : null,
        terrain: this.terrainState ? payloads.get("terrain-environment") : null,
        session: payloads.get("session"),
        worldAdapter: physics.worldAdapter,
        motorEnergySettlement: payloads.get("energy-power-signal")
          .motorEnergySettlement,
      };
    if (target.aerothermal)
      this.aerothermalAblationOwner.validateState(target.aerothermal);
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
    return checkpoint;
  }
}
