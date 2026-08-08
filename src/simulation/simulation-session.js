import {
  compareCanonicalIds,
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { createSimulationContext } from "./simulation-context.js";
import {
  createTelemetrySnapshot,
  publishTelemetrySnapshot,
  unsupportedRouteEvidenceDescriptor,
} from "./telemetry.js";
import { RouteEvidenceArchive } from "./route-evidence-archive.js";

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

const checkpointRollbackBoundaries = new WeakMap(),
  checkpointRestoreTransactions = new WeakMap(),
  checkpointRestorePorts = new WeakMap();

function checkpointRestorePort(session) {
  const port = checkpointRestorePorts.get(session);
  if (!port)
    throw new DomainValidationError(
      "INVALID_CHECKPOINT_RESTORE_SESSION",
      "Checkpoint restore requires a running package-owned simulation session",
    );
  return port;
}

export function beginSimulationSessionCheckpointRestore(session) {
  return checkpointRestorePort(session).begin();
}

export function importSimulationSessionStateForRestore(
  session,
  state,
  transaction,
) {
  checkpointRestorePort(session).importState(state, transaction);
}

export function importSimulationSessionTelemetryForRestore(
  session,
  state,
  transaction,
) {
  checkpointRestorePort(session).importTelemetry(state, transaction);
}

export function resynchronizeSimulationSessionAfterCheckpointRestore(
  session,
  transaction,
) {
  checkpointRestorePort(session).resynchronize(transaction);
}

export function rollbackSimulationSessionCheckpointRestore(
  session,
  boundary,
  transaction,
) {
  checkpointRestorePort(session).rollback(boundary, transaction);
}

export function commitSimulationSessionCheckpointRestore(session, transaction) {
  checkpointRestorePort(session).commit(transaction);
}

export function failSimulationSessionCheckpointRestore(session, transaction) {
  checkpointRestorePort(session).fail(transaction);
}

/**
 * @typedef {object} SimulationSystem
 * @property {string} phase
 * @property {(context: object) => void} [initialize]
 * @property {(context: object, fixedDt: number) => void} [step]
 * @property {(context: object) => void} [dispose]
 */

export const SIMULATION_PHASES = Object.freeze([
  "sensors",
  "controllers",
  "networks",
  "actuators",
  "environment",
  "integration",
  "structures",
  "thermal",
  "telemetry",
]);

export class SimulationSession {
  #initializedSystems = [];
  #routeEvidenceArchive = null;
  #restoredTelemetryBoundary = null;
  #stepBoundary = "stopped";

  constructor({ fixedDt = 1 / 120, maxSubsteps = 12, systems = [] } = {}) {
    if (!Number.isFinite(fixedDt) || fixedDt <= 0)
      throw new DomainValidationError(
        "INVALID_FIXED_TIMESTEP",
        "fixedDt must be a finite positive number",
      );
    if (!Number.isSafeInteger(maxSubsteps) || maxSubsteps <= 0)
      throw new DomainValidationError(
        "INVALID_MAX_SUBSTEPS",
        "maxSubsteps must be a positive safe integer",
      );
    if (!Array.isArray(systems))
      throw new DomainValidationError(
        "INVALID_SIMULATION_SYSTEMS",
        "systems must be an array",
      );
    const indexedSystems = systems.map((system, index) => {
      if (!system || typeof system !== "object")
        throw new DomainValidationError(
          "INVALID_SIMULATION_SYSTEM",
          `Simulation system ${index} must be an object`,
          { path: ["systems", index] },
        );
      const phaseIndex = SIMULATION_PHASES.indexOf(system.phase);
      if (phaseIndex < 0)
        throw new DomainValidationError(
          "UNKNOWN_SIMULATION_PHASE",
          `Unknown simulation phase ${String(system.phase)}`,
          { path: ["systems", index, "phase"] },
        );
      return { system, index, phaseIndex };
    });
    this.fixedDt = fixedDt;
    this.maxSubsteps = maxSubsteps;
    this.systems = indexedSystems
      .sort((a, b) => a.phaseIndex - b.phaseIndex || a.index - b.index)
      .map(({ system }) => system);
    this.context = null;
    this.accumulator = 0;
    this.time = 0;
    checkpointRestorePorts.set(
      this,
      Object.freeze({
        begin: () => this.#beginCheckpointRestore(),
        importState: (state, transaction) =>
          this.#importStateForCheckpointRestore(state, transaction),
        importTelemetry: (state, transaction) =>
          this.#importTelemetryForCheckpointRestore(state, transaction),
        resynchronize: (transaction) =>
          this.#resynchronizeForCheckpointRestore(transaction),
        rollback: (boundary, transaction) =>
          this.#rollbackCheckpointRestore(boundary, transaction),
        commit: (transaction) => this.#commitCheckpointRestore(transaction),
        fail: (transaction) => this.#failCheckpointRestore(transaction),
      }),
    );
  }

  start(snapshot, services = {}) {
    this.#requireLifecycleMutationBoundary("start");
    this.dispose();
    this.#stepBoundary = "initializing";
    this.#routeEvidenceArchive = new RouteEvidenceArchive();
    services.worldAdapter?.beginSession?.(this.fixedDt);
    this.context = createSimulationContext(snapshot, services, {
      fixedDt: this.fixedDt,
    });
    this.context.routeEvidenceArchive = this.#routeEvidenceArchive;
    this.accumulator = 0;
    this.time = 0;
    this.#initializedSystems = [];
    this.#restoredTelemetryBoundary = null;
    try {
      for (const system of this.systems) {
        // Include the current system in rollback because initialize may have
        // allocated resources before throwing.
        this.#initializedSystems.push(system);
        system.initialize?.(this.context);
      }
      this.context.telemetry = publishTelemetrySnapshot(this.context, {
        ...this.context.telemetry.systems,
        ...(this.context.initialSystemTelemetry || {}),
        routeEvidence: unsupportedRouteEvidenceDescriptor(),
      });
      delete this.context.initialSystemTelemetry;
      this.context.previousTelemetry = this.context.telemetry;
      this.#stepBoundary = "initialized";
    } catch (initializeError) {
      this.#stepBoundary = "failed";
      const context = this.context,
        cleanupErrors = this.#disposeSystems(context);
      this.#routeEvidenceArchive?.dispose();
      this.#routeEvidenceArchive = null;
      this.#clear();
      throw new AggregateError(
        [initializeError, ...cleanupErrors],
        `Simulation session initialization failed and was rolled back: ${String(initializeError)}`,
        { cause: initializeError },
      );
    }
    return this;
  }

  step(dt) {
    if (!this.context) return 0;
    if (
      this.#stepBoundary !== "initialized" &&
      this.#stepBoundary !== "committed"
    )
      throw new DomainValidationError(
        "SIMULATION_SESSION_NOT_COMMITTED",
        "Cannot advance a simulation session that is not at a committed boundary",
      );
    if (!Number.isFinite(dt))
      throw new DomainValidationError(
        "INVALID_STEP_DURATION",
        "Simulation step duration must be finite",
      );
    this.accumulator = Math.min(
      this.fixedDt * this.maxSubsteps,
      this.accumulator + Math.max(0, Math.min(0.25, dt)),
    );
    const substeps = Math.min(
      this.maxSubsteps,
      Math.max(0, Math.floor((this.accumulator + 1e-12) / this.fixedDt)),
    );
    if (substeps) this.#advanceFixedSteps(substeps, true);
    return substeps;
  }

  stepFixed(count = 1) {
    if (!this.context) return 0;
    if (!Number.isFinite(count))
      throw new DomainValidationError(
        "INVALID_STEP_COUNT",
        "Simulation fixed-step count must be finite",
      );
    const steps = Math.max(0, Math.floor(count));
    if (steps) this.#advanceFixedSteps(steps, false);
    return steps;
  }

  #advanceFixedSteps(steps, settleAccumulator) {
    if (
      this.#stepBoundary !== "initialized" &&
      this.#stepBoundary !== "committed"
    )
      throw new DomainValidationError(
        "SIMULATION_SESSION_NOT_COMMITTED",
        "Cannot advance a simulation session that is not at a committed boundary",
      );
    this.#stepBoundary = "stepping";
    try {
      for (let index = 0; index < steps; index++) {
        this.#completeFixedStep();
        if (settleAccumulator) {
          this.accumulator -= this.fixedDt;
          if (Math.abs(this.accumulator) <= 1e-12) this.accumulator = 0;
        }
      }
      this.#stepBoundary = "committed";
    } catch (error) {
      this.#stepBoundary = "failed";
      throw error;
    }
  }

  // Keep the hot system loop outside the boundary wrapper's try/catch. The
  // wrapper still owns failure state, while the physics body remains eligible
  // for ordinary engine optimization on every fixed tick.
  #completeFixedStep() {
    const completedTick = this.context.clock.tick + 1,
      completedTime = completedTick * this.fixedDt;
    this.context.previousTelemetry = this.context.telemetry;
    this.context.telemetry = {};
    this.context.time = completedTime;
    this.context.clock.tick = completedTick;
    this.context.clock.time = completedTime;
    this.context.bodyRegistry.beginTick(this.context.clock.tick);
    for (const system of this.systems)
      system.step?.(this.context, this.fixedDt);
    if (!Object.isFrozen(this.context.telemetry))
      this.context.telemetry = publishTelemetrySnapshot(
        this.context,
        this.context.telemetry,
      );
    this.time = completedTime;
  }

  /** @internal @returns {any} */
  requireCheckpointBoundary() {
    if (
      !this.context ||
      (this.#stepBoundary !== "initialized" &&
        this.#stepBoundary !== "committed")
    )
      throw new DomainValidationError(
        "CHECKPOINT_REQUIRES_COMMITTED_TICK",
        "Checkpoint operations require the initialized boundary or a fully completed fixed tick",
      );
    return this.context;
  }

  #beginCheckpointRestore() {
    const context = this.requireCheckpointBoundary(),
      transaction = Object.freeze({}),
      committedBoundary = this.#stepBoundary;
    checkpointRestoreTransactions.set(transaction, {
      session: this,
      context,
      committedBoundary,
    });
    this.#stepBoundary = "restoring";
    return transaction;
  }

  #requireCheckpointRestore(transaction) {
    const state =
      transaction && typeof transaction === "object"
        ? checkpointRestoreTransactions.get(transaction)
        : null;
    if (
      state?.session !== this ||
      state.context !== this.context ||
      this.#stepBoundary !== "restoring"
    )
      throw new DomainValidationError(
        "INVALID_CHECKPOINT_RESTORE_TRANSACTION",
        "Checkpoint mutation requires the active session-issued restore transaction",
      );
    return state;
  }

  #requireLifecycleMutationBoundary(operation) {
    if (
      this.#stepBoundary === "initializing" ||
      this.#stepBoundary === "stepping" ||
      this.#stepBoundary === "restoring" ||
      this.#stepBoundary === "disposing"
    )
      throw new DomainValidationError(
        "SIMULATION_SESSION_MUTATION_REENTRANT",
        `Cannot ${operation} while another session mutation is active`,
      );
  }

  telemetry() {
    return this.context?.telemetry || createTelemetrySnapshot();
  }

  routeEvidence(token, query, expectedIdentity) {
    if (this.#routeEvidenceArchive)
      return this.#routeEvidenceArchive.routeEvidence(
        token,
        query,
        expectedIdentity,
      );
    return deepFreeze({
      version: 1,
      medium: query?.kind?.startsWith?.("resource")
        ? "resource"
        : query?.kind || "power",
      identity: null,
      evidenceToken: null,
      status: "unsupported",
      source: query?.source || null,
      target: query?.target || null,
      resourceKey: query?.resourceKey || null,
      allocation: null,
      controllerPortSelection: null,
      hops: [],
      alternativeWitnessCount: 0,
      cycleConnectionIds: [],
      blockingConnectionIds: [],
      blockerEvidence: "unknown",
      totalHopCount: null,
      truncated: {
        hops: false,
        alternatives: false,
        cycles: false,
        blockers: false,
      },
    });
  }

  exportState() {
    this.requireCheckpointBoundary();
    return issueInertPlainData({
      version: 3,
      fixedDt: this.fixedDt,
      maxSubsteps: this.maxSubsteps,
      accumulator: this.accumulator,
      time: this.time,
      clock: this.context.clock,
    });
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_SESSION_CHECKPOINT_INPUT",
      message:
        "Simulation session checkpoint input must be serialized JSON or an exported immutable state",
      path: ["session"],
    });
    if (
      !this.context ||
      state?.version !== 3 ||
      !checkpointKeysMatch(state, [
        "version",
        "fixedDt",
        "maxSubsteps",
        "accumulator",
        "time",
        "clock",
      ])
    )
      throw new DomainValidationError(
        "INVALID_SESSION_CHECKPOINT",
        "Simulation session checkpoint is not valid for this session",
      );
    if (
      state.fixedDt !== this.fixedDt ||
      state.maxSubsteps !== this.maxSubsteps
    )
      throw new DomainValidationError(
        "SESSION_CHECKPOINT_IDENTITY_MISMATCH",
        "Simulation session timing identity changed",
      );
    if (
      !Number.isFinite(state.accumulator) ||
      state.accumulator < 0 ||
      state.accumulator >= this.fixedDt ||
      !checkpointKeysMatch(state.clock, ["tick", "time", "fixedDt"]) ||
      !Number.isSafeInteger(state.clock.tick) ||
      state.clock.tick < 0 ||
      state.clock.fixedDt !== this.fixedDt ||
      state.time !== state.clock.tick * this.fixedDt ||
      state.clock.time !== state.clock.tick * this.fixedDt
    )
      throw new DomainValidationError(
        "INVALID_SESSION_CHECKPOINT",
        "Simulation session checkpoint contains invalid state",
      );
    return {
      accumulator: state.accumulator,
      time: state.time,
      clock: structuredClone(state.clock),
    };
  }

  #applyImportedState(state) {
    const validated = this.validateState(state);
    this.accumulator = validated.accumulator;
    this.time = validated.time;
    this.context.time = validated.time;
    this.context.clock = validated.clock;
    this.context.sensors = new Map();
    this.context.commands = new Map();
    this.context.completedSensorSnapshot = Object.freeze({});
  }

  importState(state) {
    this.requireCheckpointBoundary();
    this.#applyImportedState(state);
  }

  #importStateForCheckpointRestore(state, transaction) {
    this.#requireCheckpointRestore(transaction);
    this.#applyImportedState(state);
  }

  exportTelemetryState() {
    this.requireCheckpointBoundary();
    const measuredPoweredPartIds =
      this.context.telemetry?.systems?.power?.poweredPartIds;
    return issueInertPlainData({
      version: 3,
      tick: this.context.clock.tick,
      reconstruction: "owners-plus-controller-power-delay-v1",
      poweredPartIds: Array.isArray(measuredPoweredPartIds)
        ? [...measuredPoweredPartIds].sort(compareCanonicalIds)
        : null,
    });
  }

  validateTelemetryState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_TELEMETRY_CHECKPOINT_INPUT",
      message:
        "Telemetry checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      !checkpointKeysMatch(state, [
        "version",
        "tick",
        "reconstruction",
        "poweredPartIds",
      ]) ||
      state.version !== 3 ||
      state.reconstruction !== "owners-plus-controller-power-delay-v1" ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 0 ||
      !(
        state.poweredPartIds === null ||
        (Array.isArray(state.poweredPartIds) &&
          state.poweredPartIds.every(
            (partId) =>
              (typeof partId === "string" && partId.length > 0) ||
              (typeof partId === "number" && Number.isSafeInteger(partId)),
          ) &&
          new Set(state.poweredPartIds.map(stableStringify)).size ===
            state.poweredPartIds.length)
      )
    )
      throw new DomainValidationError(
        "INVALID_TELEMETRY_CHECKPOINT",
        "Telemetry checkpoint must be the exact controller-delay projection",
      );
    return {
      tick: state.tick,
      poweredPartIds:
        state.poweredPartIds === null
          ? null
          : Object.freeze(structuredClone(state.poweredPartIds)),
    };
  }

  #applyImportedTelemetry(state) {
    this.#restoredTelemetryBoundary = this.validateTelemetryState(state);
  }

  importTelemetryState(state) {
    this.requireCheckpointBoundary();
    this.#applyImportedTelemetry(state);
  }

  #importTelemetryForCheckpointRestore(state, transaction) {
    this.#requireCheckpointRestore(transaction);
    this.#applyImportedTelemetry(state);
  }

  /** @internal Captures exact public read boundaries for same-call rollback only. */
  captureCheckpointRollbackBoundary() {
    this.requireCheckpointBoundary();
    const boundary = Object.freeze({});
    checkpointRollbackBoundaries.set(boundary, {
      session: this,
      context: this.context,
      telemetry: this.context.telemetry,
      previousTelemetry: this.context.previousTelemetry,
      restoredTelemetryBoundary: this.#restoredTelemetryBoundary,
    });
    return boundary;
  }

  #restoreCheckpointRollbackBoundary(boundary) {
    if (!boundary || typeof boundary !== "object")
      throw new DomainValidationError(
        "INVALID_CHECKPOINT_ROLLBACK_BOUNDARY",
        "Checkpoint rollback boundary was not issued by this running session",
      );
    const state = checkpointRollbackBoundaries.get(boundary);
    if (state?.session !== this || state.context !== this.context)
      throw new DomainValidationError(
        "INVALID_CHECKPOINT_ROLLBACK_BOUNDARY",
        "Checkpoint rollback boundary was not issued by this running session",
      );
    checkpointRollbackBoundaries.delete(boundary);
    this.context.telemetry = state.telemetry;
    this.context.previousTelemetry = state.previousTelemetry;
    this.#restoredTelemetryBoundary = state.restoredTelemetryBoundary;
  }

  /**
   * @internal Restores exact public read boundaries after authoritative owner rollback.
   * @param {object} boundary
   */
  restoreCheckpointRollbackBoundary(boundary) {
    this.requireCheckpointBoundary();
    this.#restoreCheckpointRollbackBoundary(boundary);
  }

  #rollbackCheckpointRestore(boundary, transaction) {
    const transactionState = this.#requireCheckpointRestore(transaction);
    this.#restoreCheckpointRollbackBoundary(boundary);
    checkpointRestoreTransactions.delete(transaction);
    this.#stepBoundary = transactionState.committedBoundary;
  }

  /** @internal Irreversible cache invalidation occurs only after every owner commits. */
  commitCheckpointRestore() {
    this.requireCheckpointBoundary();
    this.#routeEvidenceArchive?.invalidateForCheckpointImport();
  }

  #commitCheckpointRestore(transaction) {
    const transactionState = this.#requireCheckpointRestore(transaction);
    try {
      this.#routeEvidenceArchive?.invalidateForCheckpointImport();
      checkpointRestoreTransactions.delete(transaction);
      this.#stepBoundary = transactionState.committedBoundary;
    } catch (error) {
      checkpointRestoreTransactions.delete(transaction);
      this.#stepBoundary = "failed";
      throw error;
    }
  }

  #failCheckpointRestore(transaction) {
    this.#requireCheckpointRestore(transaction);
    checkpointRestoreTransactions.delete(transaction);
    this.#stepBoundary = "failed";
  }

  /** Rebuilds non-authoritative system caches after every complete restore. */
  #resynchronizeAfterCheckpointRestore() {
    // Discard the pre-restore future before any owner projects derived state.
    // Checkpoint telemetry carries only the narrow delayed-power boundary.
    this.context.telemetry = {};
    for (const system of this.#initializedSystems)
      system.afterCheckpointRestore?.(this.context);
    const context = this.context,
      captured = context.services.captureTelemetry?.(context),
      reconstructedSystems = captured?.systems || captured || context.telemetry,
      derivedPower = context.powerNetwork?.telemetry?.() || {},
      delayedPowerIds = this.#restoredTelemetryBoundary
        ? this.#restoredTelemetryBoundary.poweredPartIds
        : Array.isArray(derivedPower.poweredPartIds)
          ? derivedPower.poweredPartIds
          : null,
      restoredPower = { ...derivedPower },
      commandStates =
        context.commands instanceof Map ? [...context.commands.values()] : [],
      environmentBodies = context.services.environmentBodyRegistry?.snapshot?.({
        time: context.time,
        origin: context.services.environmentOrigin?.() || undefined,
      }),
      systems = {
        ...reconstructedSystems,
        sensors: context.completedSensorSnapshot || {},
        power: restoredPower,
        signals: context.signalNetwork?.telemetry?.() || {},
        commandReceivers: { states: commandStates },
        pneumatics: context.pneumaticNetwork?.telemetry?.() || null,
        environmentBodies: environmentBodies || null,
        routeEvidence: unsupportedRouteEvidenceDescriptor(),
      };
    if (delayedPowerIds === null) delete restoredPower.poweredPartIds;
    else restoredPower.poweredPartIds = [...delayedPowerIds];
    const rebuilt = publishTelemetrySnapshot(context, systems);
    context.telemetry = rebuilt;
    context.previousTelemetry = rebuilt;
    this.#restoredTelemetryBoundary = null;
  }

  /** Rebuilds non-authoritative system caches after every complete restore. */
  resynchronizeAfterCheckpointRestore() {
    this.requireCheckpointBoundary();
    this.#resynchronizeAfterCheckpointRestore();
  }

  #resynchronizeForCheckpointRestore(transaction) {
    this.#requireCheckpointRestore(transaction);
    this.#resynchronizeAfterCheckpointRestore();
  }

  dispose() {
    this.#requireLifecycleMutationBoundary("dispose");
    if (!this.context) {
      this.#clear();
      return;
    }
    this.#stepBoundary = "disposing";
    const context = this.context,
      errors = this.#disposeSystems(context);
    this.#routeEvidenceArchive?.dispose();
    this.#routeEvidenceArchive = null;
    this.#clear();
    if (errors.length)
      throw new AggregateError(
        errors,
        "One or more simulation systems failed during disposal",
      );
  }

  #disposeSystems(context) {
    const errors = [];
    for (const system of [...this.#initializedSystems].reverse())
      try {
        system.dispose?.(context);
      } catch (error) {
        errors.push(error);
      }
    return errors;
  }

  #clear() {
    this.context = null;
    this.accumulator = 0;
    this.time = 0;
    this.#initializedSystems = [];
    this.#restoredTelemetryBoundary = null;
    this.#stepBoundary = "stopped";
  }
}
