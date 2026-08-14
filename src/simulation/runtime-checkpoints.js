import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
} from "../model/mechanism-artifact-identity.js";
import { decodeCheckpointOrThrow } from "../model/mechanism-artifacts.js";
import { compiledPhysicalSemanticsFingerprint } from "../model/compiled-physical-semantics.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import {
  canonicalId,
  compareCanonicalIds,
  DomainValidationError,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import { CANNON_SOLVER_TRANSACTION_ID } from "./cannon-solver-transaction.js";
import { validateCannonStateForCheckpointRestore } from "./cannon-world-adapter.js";
import {
  importBodyRegistryCheckpointStateForRestore,
  validateBodyRegistryCheckpointStateForRestore,
} from "./body-registry.js";
import {
  exportValidatedMultibodyState,
  multibodyMotorEnergyOwnerIds,
  reconstructOwnedMultibodyMotorEnergy,
  validateMultibodyStateForCheckpointRestore,
} from "./multibody-runtime.js";
import {
  beginSimulationSessionCheckpointRestore,
  commitSimulationSessionCheckpointRestore,
  failSimulationSessionCheckpointRestore,
  importSimulationSessionStateForRestore,
  importSimulationSessionTelemetryForRestore,
  resynchronizeSimulationSessionAfterCheckpointRestore,
  rollbackSimulationSessionCheckpointRestore,
} from "./simulation-session.js";
import {
  isMassPropertyCommitSystem,
  planCheckpointMassProperties,
  reconstructMassPropertiesAfterCheckpointOwners,
} from "./systems/mass-property-commit-system.js";

const encoder = new TextEncoder();
const CHECKPOINT_IDENTITY_FIELDS = Object.freeze([
  "runConfigurationFingerprint",
  "blueprintFingerprint",
  "compiledTopologyFingerprint",
]);
const FINGERPRINT_PATTERN = /^sim-sha256-[0-9a-f]{64}$/;
const NO_FLEXIBLE_LINE_RUNTIME = Object.freeze({
  kind: "no-flexible-line-runtime-v1",
});
const NO_MATERIAL_RESOURCE_NETWORK = Object.freeze({
  kind: "no-material-resource-network-v1",
});
const NO_PRESSURE_NOZZLE_RUNTIME = Object.freeze({
  kind: "no-pressure-nozzle-runtime-v1",
});
const NO_PNEUMATIC_NETWORK = Object.freeze({
  kind: "no-pneumatic-network-v1",
});
const NO_AEROTHERMAL_RUNTIME = Object.freeze({
  kind: "no-aerothermal-runtime-v1",
});
// Wire compatibility tombstone only. No runtime may supply articulated drive
// state: joint authority is reconstructed from the generic physical plant.
const RETIRED_ARTICULATED_OWNER_TOMBSTONE = Object.freeze({
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

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

/**
 * Package-internal cross-owner consistency check for axial-effort cumulative
 * energy. Checkpoints are unsigned portable state: this rejects incomplete or
 * internally inconsistent rewrites, but is not authentication against a
 * producer that rewrites every value and digest together.
 */
export function validateAxialEffortEnergyOwnerConsistency(
  multibodyRuntime,
  physics,
  motorEnergySettlement,
) {
  const forceCommandEntries = multibodyRuntime.constraintEntries.filter(
    (entry) =>
      entry.descriptor.mechanism?.commandLaw?.kind === "force-command-v1",
  );
  if (motorEnergySettlement?.kind === "no-motor-energy-settlement-runtime-v1") {
    if (forceCommandEntries.length)
      throw new DomainValidationError(
        "CHECKPOINT_AXIAL_EFFORT_ENERGY_OWNER_MISSING",
        "Axial-effort checkpoints require the motor-settlement energy owner",
      );
    return;
  }
  const expectedOwnerIds = multibodyMotorEnergyOwnerIds(multibodyRuntime),
    totals = Array.isArray(motorEnergySettlement?.totals)
      ? motorEnergySettlement.totals
      : [],
    actualOwnerIds = totals.map((record) => record?.[0]);
  if (
    motorEnergySettlement?.version !== 2 ||
    stableStringify(motorEnergySettlement.ownerIds) !==
      stableStringify(expectedOwnerIds) ||
    stableStringify(actualOwnerIds) !== stableStringify(expectedOwnerIds)
  )
    throw new DomainValidationError(
      "CHECKPOINT_MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
      "Motor-energy checkpoint identities must exactly match every live actuator owner",
    );
  const physicsById = new Map(
      physics.entries.map((record) => [record.id, record.values]),
    ),
    duplicateFields = [
      "actuatorMechanicalWorkJ",
      "actuatorElectricalEnergyJ",
      "actuatorDissipatedEnergyJ",
    ];
  for (const entry of forceCommandEntries) {
    const values = physicsById.get(entry.descriptor.id);
    if (
      !values ||
      duplicateFields.some((field) => Object.hasOwn(values, field))
    )
      throw new DomainValidationError(
        "CHECKPOINT_AXIAL_EFFORT_ENERGY_OWNER_DUPLICATED",
        `Axial-effort cumulative energy must be serialized only by the motor-settlement owner for part ${String(entry.descriptor.sourcePartId)}`,
      );
  }
  const forceOwnerIds = forceCommandEntries
      .map((entry) => entry.descriptor.sourcePartId)
      .sort(compareCanonicalIds),
    totalsByPart = new Map(totals),
    projectionRecords = forceOwnerIds.map((partId) => {
      const values = totalsByPart.get(partId);
      return {
        partId,
        electricalEnergyJ: values.electricalEnergyJ,
        netMechanicalWorkJ:
          values.positiveMechanicalWorkJ - values.absorbedMechanicalWorkJ,
        rejectedHeatJ: values.rejectedHeatJ,
      };
    }),
    ownerProjectionDigest = `axial-effort-energy-sha256-${sha256Hex(
      stableStringify(projectionRecords),
    )}`;
  if (physics.axialEffortEnergyProjectionDigest !== ownerProjectionDigest)
    throw new DomainValidationError(
      "CHECKPOINT_AXIAL_EFFORT_ENERGY_PROJECTION_MISMATCH",
      "Motor-energy totals disagree with the separately captured multibody energy projection",
    );
}

function requireCheckpointIdentities(input) {
  const identities = requireInertPlainData(input, {
    code: "INVALID_CHECKPOINT_RUNTIME_IDENTITIES",
    message:
      "Checkpoint runtime identities must be serialized JSON or an exported immutable data root",
    path: ["identities"],
  });
  if (
    !checkpointKeysMatch(identities, CHECKPOINT_IDENTITY_FIELDS) ||
    CHECKPOINT_IDENTITY_FIELDS.some(
      (field) => !FINGERPRINT_PATTERN.test(identities[field]),
    )
  )
    throw new DomainValidationError(
      "INVALID_CHECKPOINT_RUNTIME_IDENTITIES",
      "Checkpoint runtime identities must be an exact fingerprint projection",
      { path: ["identities"] },
    );
  return identities;
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

function requireExactAbsentOwnerState(actual, expected, ownerId) {
  if (stableStringify(actual) !== stableStringify(expected))
    throw new DomainValidationError(
      "CHECKPOINT_ABSENT_OWNER_STATE_MISMATCH",
      `Checkpoint ${ownerId} payload must use its canonical absent-owner state`,
      { path: ["stateOwners", ownerId] },
    );
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
      requireInertPlainData(owner.payloadJson, {
        code: "INVALID_CHECKPOINT_OWNER_JSON",
        message: `Checkpoint owner ${owner.ownerId} payload must be inert JSON`,
        path: ["stateOwners", owner.ownerId, "payloadJson"],
      }),
    ]),
  );
}

function requireRegistryPhysicsMassAgreement(bodyRegistry, physics) {
  if (!Array.isArray(physics?.bodies))
    throw new DomainValidationError(
      "MASS_PROPERTY_CHECKPOINT_AUTHORITY_MISMATCH",
      "Checkpoint capture requires exported physical body state",
    );
  for (const [index, record] of physics.bodies.entries()) {
    const registered = bodyRegistry.bodyForPart(record.partId);
    if (
      !registered ||
      stableStringify(registered.massProperties) !==
        stableStringify(record.massProperties)
    )
      throw new DomainValidationError(
        "MASS_PROPERTY_CHECKPOINT_AUTHORITY_MISMATCH",
        `Checkpoint body registry disagrees with physical mass authority for part ${String(record.partId)}`,
        { path: ["physics-world", "bodies", index, "massProperties"] },
      );
  }
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
    this.terrainState = terrainState;
    this.inputCursor = inputCursor;
    this.session.context?.runGraph?.setCheckpointInternalEdgeIds(
      (this.multibodyRuntime.compiled?.flexibleLines || []).flatMap((line) =>
        line.internalEdges.map((edge) => edge.id),
      ),
    );
  }

  #requireCommittedSession() {
    const context = this.session?.requireCheckpointBoundary?.(),
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

  #bindMotorEnergyOwnerIdentities() {
    const owner = this.#motorEnergySettlementSystem();
    if (owner)
      owner.bindOwnerIds(multibodyMotorEnergyOwnerIds(this.multibodyRuntime));
    return owner;
  }

  #massPropertyCommitSystem() {
    return this.session.systems.find(isMassPropertyCommitSystem);
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
    const contributorKinds = new Set(
        this.multibodyRuntime.compiled.rigidClusters.flatMap((cluster) =>
          cluster.members.flatMap(
            (member) => member.runtimeMassContributorKinds,
          ),
        ),
      ),
      missingOwners = [],
      requiresMaterial = contributorKinds.has("material-store-v1"),
      requiresAerothermal = contributorKinds.has("ablative-material-v1"),
      requiresPneumatic =
        contributorKinds.has("tire-chamber-v1") ||
        contributorKinds.has("ideal-gas-control-volume-v1"),
      system = this.#massPropertyCommitSystem();
    if (requiresMaterial && !context.materialResourceNetwork)
      missingOwners.push("material-resources");
    if (requiresAerothermal && !this.aerothermalAblationOwner)
      missingOwners.push("thermal-ablation");
    if (requiresPneumatic && !context.pneumaticNetwork)
      missingOwners.push("pneumatic-gas");
    if (contributorKinds.size && !system) missingOwners.push("mass-properties");
    if (missingOwners.length)
      throw new DomainValidationError(
        "MASS_PROPERTY_CHECKPOINT_OWNER_MISSING",
        "Checkpoint requires every mutable-mass owner declared by compiled physical authority",
        { details: { contributorKinds: [...contributorKinds], missingOwners } },
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
    if (context.materialResourceNetwork)
      context.materialResourceNetwork.importState(
        state.network,
        context.runGraph,
      );
    else
      requireExactAbsentOwnerState(
        state.network,
        NO_MATERIAL_RESOURCE_NETWORK,
        "material-resources.network",
      );
    const pressureNozzle = this.#pressureNozzleSystem();
    if (pressureNozzle) pressureNozzle.importState(context, state.propulsion);
    else
      requireExactAbsentOwnerState(
        state.propulsion,
        NO_PRESSURE_NOZZLE_RUNTIME,
        "material-resources.propulsion",
      );
  }

  #materialResourceValidate(context, state) {
    if (
      !checkpointKeysMatch(state, ["version", "network", "propulsion"]) ||
      state.version !== 2
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

  #validateAbsentMassOwnerPayloads(context, state) {
    if (!context.materialResourceNetwork)
      requireExactAbsentOwnerState(
        state.materialResources?.network,
        NO_MATERIAL_RESOURCE_NETWORK,
        "material-resources.network",
      );
    if (!this.#pressureNozzleSystem())
      requireExactAbsentOwnerState(
        state.materialResources?.propulsion,
        NO_PRESSURE_NOZZLE_RUNTIME,
        "material-resources.propulsion",
      );
    if (!context.pneumaticNetwork)
      requireExactAbsentOwnerState(
        state.pneumatics,
        NO_PNEUMATIC_NETWORK,
        "pneumatic-gas",
      );
    if (!this.aerothermalAblationOwner)
      requireExactAbsentOwnerState(
        state.aerothermal,
        NO_AEROTHERMAL_RUNTIME,
        "thermal-ablation",
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
    const physics = exportValidatedMultibodyState(this.multibodyRuntime),
      bodyRegistry = context.bodyRegistry.exportCheckpointState();
    requireRegistryPhysicsMassAgreement(context.bodyRegistry, physics);
    return {
      runGraph: context.runGraph.exportState(),
      physics,
      flexibleLines:
        this.flexibleLineRuntime?.exportState() ?? NO_FLEXIBLE_LINE_RUNTIME,
      bodyRegistry,
      structure: this.#structureSystem()?.exportState() ?? NO_STRUCTURE_RUNTIME,
      aerothermal:
        this.aerothermalAblationOwner?.exportState() ?? NO_AEROTHERMAL_RUNTIME,
      releaseCouplers:
        this.#releaseCouplerSystem()?.exportState(context) ??
        NO_RELEASE_COUPLER_RUNTIME,
      materialResources: this.#materialResourceExport(context),
      pneumatics:
        context.pneumaticNetwork?.exportState() ?? NO_PNEUMATIC_NETWORK,
      articulated: RETIRED_ARTICULATED_OWNER_TOMBSTONE,
      commandBus: context.commandBus.exportState(),
      inputCursor: this.inputCursor?.capture?.() ?? null,
      sensors: this.sensorBank?.exportState() ?? NO_SENSOR_BANK,
      controllers:
        this.controllerManager?.exportState() ?? NO_CONTROLLER_RUNTIME,
      terrain: this.terrainState?.exportState?.() ?? NO_TERRAIN_RUNTIME,
      session: this.session.exportState(),
      telemetry: this.session.exportTelemetryState(),
      worldAdapter: this.worldAdapter.exportState(),
      motorEnergySettlement:
        this.#bindMotorEnergyOwnerIdentities()?.exportState() ??
        NO_MOTOR_ENERGY_RUNTIME,
    };
  }

  #applyMutableState(context, state, restoreTransaction) {
    context.runGraph.importState(state.runGraph);
    this.#materialResourceImport(context, state.materialResources);
    context.pneumaticNetwork?.importState(state.pneumatics);
    this.aerothermalAblationOwner?.importState(state.aerothermal);
    this.aerothermalAblationOwner?.synchronizeBodyRegistry(
      context.bodyRegistry,
    );
    importSimulationSessionStateForRestore(
      this.session,
      state.session,
      restoreTransaction,
    );
    importSimulationSessionTelemetryForRestore(
      this.session,
      state.telemetry,
      restoreTransaction,
    );
    const massPropertyCommitSystem =
      this.#requireMassPropertyCommitSystem(context);
    if (massPropertyCommitSystem)
      reconstructMassPropertiesAfterCheckpointOwners(
        massPropertyCommitSystem,
        context,
      );
    this.multibodyRuntime.importState(state.physics);
    this.#requireBodyRegistryProjectionSystem().reconstructAfterPhysicsRestore(
      context,
    );
    this.flexibleLineRuntime?.importState(state.flexibleLines);
    importBodyRegistryCheckpointStateForRestore(
      context.bodyRegistry,
      state.bodyRegistry,
    );
    this.#structureSystem()?.importState(state.structure);
    this.#releaseCouplerSystem()?.importState(context, state.releaseCouplers);
    context.commandBus.importState(state.commandBus);
    this.inputCursor?.restore?.(state.inputCursor);
    this.sensorBank?.importState(state.sensors);
    this.controllerManager?.importState(state.controllers, { notify: false });
    this.terrainState?.importState?.(state.terrain);
    this.worldAdapter.importState(state.worldAdapter);
    this.#motorEnergySettlementSystem()?.importState(
      state.motorEnergySettlement,
    );
    reconstructOwnedMultibodyMotorEnergy(
      this.multibodyRuntime,
      state.motorEnergySettlement,
    );
    resynchronizeSimulationSessionAfterCheckpointRestore(
      this.session,
      restoreTransaction,
    );
  }

  #validateMutableState(context, state) {
    this.#requireBodyRegistryProjectionSystem();
    this.#validateAbsentMassOwnerPayloads(context, state);
    context.runGraph.validateState(state.runGraph);
    const flexibleLineRuntime = assertAbsentOwnerState(
      this.flexibleLineRuntime,
      state.flexibleLines,
      NO_FLEXIBLE_LINE_RUNTIME,
      "Flexible-line runtime",
    );
    flexibleLineRuntime?.validateState(state.flexibleLines);
    validateBodyRegistryCheckpointStateForRestore(
      context.bodyRegistry,
      state.bodyRegistry,
    );
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
    this.#validatePneumaticTireConsistency(state);
    const massPropertyCommitSystem =
        this.#requireMassPropertyCommitSystem(context),
      expectedMassPropertiesByPart = massPropertyCommitSystem
        ? planCheckpointMassProperties(context, {
            materialResources: state.materialResources,
            pneumatics: state.pneumatics,
            aerothermal: state.aerothermal,
          })
        : null;
    validateMultibodyStateForCheckpointRestore(
      this.multibodyRuntime,
      state.physics,
      expectedMassPropertiesByPart,
    );
    assertAbsentOwnerState(
      null,
      state.articulated,
      RETIRED_ARTICULATED_OWNER_TOMBSTONE,
      "Articulated runtime",
    );
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
    const telemetryBoundary = this.session.validateTelemetryState(
        state.telemetry,
      ),
      targetParts = new Map(
        state.runGraph.parts.map((record) => [
          stableStringify(record.id),
          record,
        ]),
      ),
      unknownPoweredPartIds = (telemetryBoundary.poweredPartIds || []).filter(
        (partId) => !targetParts.has(stableStringify(partId)),
      ),
      canonicalPoweredPartIds = telemetryBoundary.poweredPartIds
        ? [...telemetryBoundary.poweredPartIds].sort(compareCanonicalIds)
        : null;
    if (
      telemetryBoundary.tick !== state.session.clock.tick ||
      unknownPoweredPartIds.length > 0 ||
      stableStringify(telemetryBoundary.poweredPartIds) !==
        stableStringify(canonicalPoweredPartIds)
    )
      throw new DomainValidationError(
        "INVALID_CONTROLLER_POWER_DELAY_CHECKPOINT",
        "Controller power-delay state must identify canonical run-graph parts at the committed tick",
        {
          details: {
            boundaryTick: telemetryBoundary.tick,
            sessionTick: state.session.clock.tick,
            unknownPoweredPartIds,
            poweredPartIds: telemetryBoundary.poweredPartIds,
            canonicalPoweredPartIds,
          },
        },
      );
    validateCannonStateForCheckpointRestore(
      this.worldAdapter,
      state.worldAdapter,
      issueInertPlainData({
        externalBodyPlans: terrain
          ? [this.terrainState.checkpointExternalBodyPlan(state.terrain)]
          : [],
      }),
    );
    const motorEnergy = assertAbsentOwnerState(
      this.#bindMotorEnergyOwnerIdentities(),
      state.motorEnergySettlement,
      NO_MOTOR_ENERGY_RUNTIME,
      "Motor-energy settlement runtime",
    );
    motorEnergy?.validateState(state.motorEnergySettlement);
    validateAxialEffortEnergyOwnerConsistency(
      this.multibodyRuntime,
      state.physics,
      state.motorEnergySettlement,
    );
  }

  #validatePneumaticTireConsistency(state) {
    const chambers = new Map(
        Array.isArray(state.pneumatics?.chambers)
          ? state.pneumatics.chambers.map((record) => [
              record.partId,
              record.state,
            ])
          : [],
      ),
      physicsEntries = new Map(
        state.physics.entries.map((record) => [record.id, record]),
      );
    for (const liveEntry of this.multibodyRuntime.constraintEntries) {
      if (liveEntry.kind !== "rolling-contact-v1") continue;
      const tireState = physicsEntries.get(liveEntry.descriptor.id)?.tireState,
        chamber = chambers.get(liveEntry.descriptor.sourcePartId) ?? null,
        tireGas = tireState?.pneumaticGasState ?? null;
      if (stableStringify(tireGas) !== stableStringify(chamber))
        throw new DomainValidationError(
          "CHECKPOINT_PNEUMATIC_TIRE_AUTHORITY_MISMATCH",
          `Tire and pneumatic owners disagree for part ${String(liveEntry.descriptor.sourcePartId)}`,
        );
    }
  }

  #validateDeclarativeOwnerPayloads(payloads) {
    const input = payloads.get("input-command-bus"),
      compiled = payloads.get("compiled-topology"),
      solverContact = payloads.get("solver-contact"),
      tireCarcass = payloads.get("tire-carcass"),
      energy = payloads.get("energy-power-signal");
    if (!checkpointKeysMatch(input, ["commandBus", "inputCursor"]))
      throw new DomainValidationError(
        "INVALID_INPUT_COMMAND_CHECKPOINT",
        "Input-command checkpoint exceeds its mutable owner projection",
      );
    if (
      !checkpointKeysMatch(compiled, [
        "sourceRevision",
        "physicalSemanticsFingerprint",
        "bodyIds",
        "constraintIds",
        "contactRegionIds",
        "flexibleEntityIds",
        "flexibleEdgeIds",
        "transactionId",
      ]) ||
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
    if (
      !checkpointKeysMatch(solverContact, [
        "physicalSemanticsFingerprint",
        "statePolicy",
        "constraintIds",
        "collisionExclusionIds",
      ]) ||
      !checkpointKeysMatch(tireCarcass, ["owner", "contactIds"]) ||
      tireCarcass.owner !== "physics-world" ||
      !Array.isArray(tireCarcass.contactIds) ||
      new Set(tireCarcass.contactIds).size !== tireCarcass.contactIds.length
    )
      throw new DomainValidationError(
        "INVALID_SOLVER_CONTACT_CHECKPOINT",
        "Solver-contact and tire-carcass owners must be exact derived projections",
      );
    if (
      !checkpointKeysMatch(energy, [
        "version",
        "reconstruction",
        "graphRevision",
        "motorEnergySettlement",
      ]) ||
      energy.version !== 2 ||
      energy.reconstruction !==
        "resolve-from-run-graph-before-next-actuator-v1" ||
      !Number.isSafeInteger(energy.graphRevision) ||
      energy.graphRevision < 0
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
          pneumatics?.version !== 1 ||
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
            motorEnergy.lastSettledTick === committedTick)) &&
        Number.isFinite(expectedTime) &&
        session?.clock?.time === expectedTime &&
        session?.time === expectedTime &&
        physics?.world?.time === expectedTime;
    if (!coherent)
      throw new DomainValidationError(
        "CHECKPOINT_OWNER_TIME_MISMATCH",
        "Checkpoint owners do not describe one committed fixed-step boundary",
      );
  }

  /** @param {string | {runConfigurationFingerprint:string,blueprintFingerprint:string,compiledTopologyFingerprint:string}} identityInput */
  capture(identityInput) {
    const {
      runConfigurationFingerprint,
      blueprintFingerprint,
      compiledTopologyFingerprint,
    } = requireCheckpointIdentities(identityInput);
    const context = this.#requireCommittedSession();
    this.#requireMassPropertyCommitSystem(context);
    const exportedPhysics = exportValidatedMultibodyState(
        this.multibodyRuntime,
      ),
      physics = {
        ...exportedPhysics,
        worldAdapter: this.worldAdapter.exportState(),
      },
      physicalSemanticsFingerprint = compiledPhysicalSemanticsFingerprint(
        this.multibodyRuntime.compiled,
      ),
      runGraph = context.runGraph.exportState();
    requireRegistryPhysicsMassAgreement(context.bodyRegistry, physics);
    const payload = {
        session: this.session.exportState(),
        "input-command-bus": {
          commandBus: context.commandBus.exportState(),
          inputCursor: this.inputCursor?.capture?.() ?? null,
        },
        "run-graph": runGraph,
        "compiled-topology": {
          sourceRevision: this.multibodyRuntime.compiled.sourceRevision,
          physicalSemanticsFingerprint,
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
        "flexible-line-runtime":
          this.flexibleLineRuntime?.exportState() ?? NO_FLEXIBLE_LINE_RUNTIME,
        "solver-contact": {
          physicalSemanticsFingerprint,
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
        "body-registry": context.bodyRegistry.exportCheckpointState(),
        "structure-failure":
          this.#structureSystem()?.exportState() ?? NO_STRUCTURE_RUNTIME,
        "energy-power-signal": {
          version: 2,
          reconstruction: "resolve-from-run-graph-before-next-actuator-v1",
          graphRevision: runGraph.graphRevision,
          motorEnergySettlement:
            this.#bindMotorEnergyOwnerIdentities()?.exportState() ??
            NO_MOTOR_ENERGY_RUNTIME,
        },
        "release-couplers":
          this.#releaseCouplerSystem()?.exportState(context) ??
          NO_RELEASE_COUPLER_RUNTIME,
        "material-resources": this.#materialResourceExport(context),
        "pneumatic-gas":
          context.pneumaticNetwork?.exportState() ?? NO_PNEUMATIC_NETWORK,
        "thermal-ablation": this.aerothermalAblationOwner
          ? this.aerothermalAblationOwner.exportState()
          : NO_AEROTHERMAL_RUNTIME,
        "articulated-drive": RETIRED_ARTICULATED_OWNER_TOMBSTONE,
        sensors: this.sensorBank?.exportState() ?? NO_SENSOR_BANK,
        controllers:
          this.controllerManager?.exportState() ?? NO_CONTROLLER_RUNTIME,
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
    return decodeCheckpointOrThrow(stableStringify(checkpoint)).wire;
  }

  /**
   * @param {string | Record<string, any>} input
   * @param {string | {runConfigurationFingerprint:string,blueprintFingerprint:string,compiledTopologyFingerprint:string}} identityInput
   */
  restore(input, identityInput) {
    const boundaryContext = this.#requireCommittedSession(),
      checkpoint = decodeCheckpointOrThrow(input).wire,
      {
        runConfigurationFingerprint,
        blueprintFingerprint,
        compiledTopologyFingerprint,
      } = requireCheckpointIdentities(identityInput),
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
    const context = boundaryContext,
      payloads = ownerPayloads(checkpoint),
      compiled = payloads.get("compiled-topology"),
      currentPhysicalSemanticsFingerprint =
        compiledPhysicalSemanticsFingerprint(this.multibodyRuntime.compiled),
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
    this.#requireMassPropertyCommitSystem(context);
    if (
      payloads.get("energy-power-signal").graphRevision !==
      payloads.get("run-graph").graphRevision
    )
      throw new DomainValidationError(
        "CHECKPOINT_NETWORK_GRAPH_REVISION_MISMATCH",
        "Checkpoint network reconstruction revision does not match the run graph",
      );
    if (compiled.transactionId !== CANNON_SOLVER_TRANSACTION_ID)
      throw new DomainValidationError(
        "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
        "Checkpoint Cannon solver transaction identity changed",
      );
    if (
      compiled.sourceRevision !==
        this.multibodyRuntime.compiled.sourceRevision ||
      compiled.physicalSemanticsFingerprint !==
        currentPhysicalSemanticsFingerprint ||
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

    const physicsOwner = payloads.get("physics-world"),
      { worldAdapter: checkpointWorldAdapterProjection, ...physicsProjection } =
        physicsOwner,
      physics = issueInertPlainData(physicsProjection),
      checkpointWorldAdapter = issueInertPlainData(
        checkpointWorldAdapterProjection,
      ),
      solverContact = payloads.get("solver-contact"),
      tireCarcass = payloads.get("tire-carcass"),
      exactSortedCanonicalIds = (values) => {
        if (!Array.isArray(values)) return null;
        const identities = new Map();
        try {
          for (const value of values) {
            const identity = canonicalId(value);
            if (identities.has(identity)) return null;
            identities.set(identity, true);
          }
        } catch {
          return null;
        }
        return [...identities.keys()].sort(compareCanonicalIds);
      },
      exactSortedStringIds = (values) =>
        Array.isArray(values) &&
        values.every((value) => typeof value === "string") &&
        new Set(values).size === values.length
          ? [...values].sort()
          : null,
      solverConstraintIds = exactSortedStringIds(solverContact?.constraintIds),
      physicsConstraintIds = exactSortedStringIds(
        physics?.entries?.map((entry) => entry.id),
      ),
      solverExclusionIds = exactSortedStringIds(
        solverContact?.collisionExclusionIds,
      ),
      physicsExclusionIds = exactSortedStringIds(
        physics?.exclusionStates?.map((entry) => entry.id),
      ),
      tireContactIds = exactSortedStringIds(tireCarcass?.contactIds),
      physicsTireContactIds = exactSortedStringIds(
        physics?.entries
          ?.filter((entry) => entry.kind === "rolling-contact-v1")
          .map((entry) => entry.id),
      ),
      physicsBodyPartIds = exactSortedCanonicalIds(
        physics?.bodies?.map((body) => body.partId),
      ),
      liveBodyPartIds = exactSortedCanonicalIds([
        ...this.multibodyRuntime.bodyByPart.keys(),
      ]),
      compiledBodyPartIds = exactSortedCanonicalIds(
        this.multibodyRuntime.compiled.bodies.map((body) => body.partId),
      );
    if (
      physics?.compiledPhysicalSemanticsFingerprint !==
      currentPhysicalSemanticsFingerprint
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_PHYSICAL_SEMANTICS_MISMATCH",
        "Checkpoint physics state does not match the running compiled physical semantics",
      );
    if (
      !physicsBodyPartIds ||
      !liveBodyPartIds ||
      !compiledBodyPartIds ||
      stableStringify(physicsBodyPartIds) !==
        stableStringify(liveBodyPartIds) ||
      stableStringify(physicsBodyPartIds) !==
        stableStringify(compiledBodyPartIds)
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
        "Checkpoint physics body identities do not match compiled and live topology",
      );
    if (
      solverContact?.physicalSemanticsFingerprint !==
        currentPhysicalSemanticsFingerprint ||
      solverContact?.statePolicy !== physics?.solverStatePolicy ||
      !solverConstraintIds ||
      !physicsConstraintIds ||
      stableStringify(solverConstraintIds) !==
        stableStringify(physicsConstraintIds) ||
      !solverExclusionIds ||
      !physicsExclusionIds ||
      stableStringify(solverExclusionIds) !==
        stableStringify(physicsExclusionIds) ||
      !tireContactIds ||
      !physicsTireContactIds ||
      stableStringify(tireContactIds) !== stableStringify(physicsTireContactIds)
    )
      throw new DomainValidationError(
        "CHECKPOINT_SOLVER_CONTACT_IDENTITY_MISMATCH",
        "Checkpoint solver-contact identities do not match physics state",
      );

    const target = {
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
      worldAdapter: checkpointWorldAdapter,
      motorEnergySettlement: payloads.get("energy-power-signal")
        .motorEnergySettlement,
    };
    this.#validateOwnerTimeCoherence(checkpoint, payloads);
    this.#validateMutableState(context, target);
    const baseline = this.#captureMutableState(context),
      rollbackBoundary = this.session.captureCheckpointRollbackBoundary(),
      restoreTransaction = beginSimulationSessionCheckpointRestore(
        this.session,
      );
    try {
      this.#applyMutableState(context, target, restoreTransaction);
    } catch (restoreError) {
      try {
        this.#applyMutableState(context, baseline, restoreTransaction);
        rollbackSimulationSessionCheckpointRestore(
          this.session,
          rollbackBoundary,
          restoreTransaction,
        );
      } catch (rollbackError) {
        try {
          failSimulationSessionCheckpointRestore(
            this.session,
            restoreTransaction,
          );
        } catch (boundaryError) {
          throw new AggregateError(
            [restoreError, rollbackError, boundaryError],
            "Checkpoint restore failed, rollback failed, and the session boundary could not be closed",
            { cause: boundaryError },
          );
        }
        throw new AggregateError(
          [restoreError, rollbackError],
          "Checkpoint restore failed and rollback could not recover the running state",
          { cause: rollbackError },
        );
      }
      throw restoreError;
    }
    commitSimulationSessionCheckpointRestore(this.session, restoreTransaction);
    this.controllerManager?.publishState();
    return checkpoint;
  }
}
