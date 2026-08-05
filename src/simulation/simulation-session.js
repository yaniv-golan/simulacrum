import {
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "../model/primitives.js";
import { createSimulationContext } from "./simulation-context.js";
import {
  createTelemetrySnapshot,
  publishTelemetrySnapshot,
  stripRouteEvidenceCapabilities,
  unsupportedRouteEvidenceDescriptor,
} from "./telemetry.js";
import { RouteEvidenceArchive } from "./route-evidence-archive.js";

function checkpointValue(value) {
  return value instanceof Map
    ? { kind: "map-v1", entries: [...value] }
    : { kind: "value-v1", value };
}

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function checkpointTreeIsFinite(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(checkpointTreeIsFinite);
  if (typeof value !== "object") return false;
  return Object.values(value).every(checkpointTreeIsFinite);
}

function validateCheckpointValue(record) {
  if (
    record?.kind === "map-v1" &&
    checkpointKeysMatch(record, ["kind", "entries"]) &&
    Array.isArray(record.entries) &&
    record.entries.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        checkpointTreeIsFinite(entry[0]) &&
        checkpointTreeIsFinite(entry[1]),
    ) &&
    new Set(record.entries.map(([key]) => stableStringify(key))).size ===
      record.entries.length
  )
    return new Map(structuredClone(record.entries));
  if (
    record?.kind === "value-v1" &&
    checkpointKeysMatch(record, ["kind", "value"]) &&
    checkpointTreeIsFinite(record.value)
  )
    return structuredClone(record.value);
  throw new DomainValidationError(
    "INVALID_SESSION_CHECKPOINT_VALUE",
    "Session checkpoint contains an invalid value representation",
  );
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
  }

  start(snapshot, services = {}) {
    this.dispose();
    this.#routeEvidenceArchive = new RouteEvidenceArchive();
    services.worldAdapter?.beginSession?.();
    this.context = createSimulationContext(snapshot, services, {
      fixedDt: this.fixedDt,
    });
    this.context.routeEvidenceArchive = this.#routeEvidenceArchive;
    this.accumulator = 0;
    this.time = 0;
    this.#initializedSystems = [];
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
    } catch (initializeError) {
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
    if (!Number.isFinite(dt))
      throw new DomainValidationError(
        "INVALID_STEP_DURATION",
        "Simulation step duration must be finite",
      );
    this.accumulator += Math.max(0, Math.min(0.25, dt));
    let substeps = 0;
    while (
      this.accumulator + 1e-12 >= this.fixedDt &&
      substeps < this.maxSubsteps
    ) {
      this.stepFixed();
      this.accumulator -= this.fixedDt;
      substeps++;
    }
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
    for (let index = 0; index < steps; index++) {
      const completedTime = this.time + this.fixedDt;
      this.context.previousTelemetry = this.context.telemetry;
      this.context.telemetry = {};
      this.context.time = completedTime;
      this.context.clock.tick++;
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
    return steps;
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
    if (!this.context)
      throw new DomainValidationError(
        "SESSION_CHECKPOINT_NOT_RUNNING",
        "Cannot checkpoint a simulation session before it starts",
      );
    return structuredClone({
      version: 2,
      fixedDt: this.fixedDt,
      maxSubsteps: this.maxSubsteps,
      accumulator: this.accumulator,
      time: this.time,
      clock: this.context.clock,
      sensors: checkpointValue(this.context.sensors),
      commandValues: checkpointValue(this.context.commands),
      completedSensorSnapshot: this.context.completedSensorSnapshot ?? null,
    });
  }

  validateState(state) {
    if (
      !this.context ||
      state?.version !== 2 ||
      !checkpointKeysMatch(state, [
        "version",
        "fixedDt",
        "maxSubsteps",
        "accumulator",
        "time",
        "clock",
        "sensors",
        "commandValues",
        "completedSensorSnapshot",
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
      !Number.isFinite(state.time) ||
      !checkpointKeysMatch(state.clock, ["tick", "time", "fixedDt"]) ||
      !Number.isSafeInteger(state.clock.tick) ||
      state.clock.tick < 0 ||
      !Number.isFinite(state.clock.time) ||
      state.clock.fixedDt !== this.fixedDt ||
      Math.abs(state.clock.time - state.time) > 1e-12 ||
      (state.completedSensorSnapshot !== null &&
        !checkpointTreeIsFinite(state.completedSensorSnapshot))
    )
      throw new DomainValidationError(
        "INVALID_SESSION_CHECKPOINT",
        "Simulation session checkpoint contains invalid state",
      );
    return {
      accumulator: state.accumulator,
      time: state.time,
      clock: structuredClone(state.clock),
      sensors: validateCheckpointValue(state.sensors),
      commands: validateCheckpointValue(state.commandValues),
      completedSensorSnapshot:
        state.completedSensorSnapshot === null
          ? null
          : Object.freeze(structuredClone(state.completedSensorSnapshot)),
    };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.accumulator = validated.accumulator;
    this.time = validated.time;
    this.context.time = validated.time;
    this.context.clock = validated.clock;
    this.context.sensors = validated.sensors;
    this.context.commands = validated.commands;
    if (validated.completedSensorSnapshot === null)
      delete this.context.completedSensorSnapshot;
    else
      this.context.completedSensorSnapshot = validated.completedSensorSnapshot;
  }

  exportTelemetryState() {
    if (!this.context)
      throw new DomainValidationError(
        "SESSION_CHECKPOINT_NOT_RUNNING",
        "Cannot checkpoint telemetry before the session starts",
      );
    return structuredClone({
      version: 2,
      tick: this.context.clock.tick,
      telemetry: stripRouteEvidenceCapabilities(this.context.telemetry),
      previousTelemetry: stripRouteEvidenceCapabilities(
        this.context.previousTelemetry,
      ),
    });
  }

  validateTelemetryState(state) {
    if (
      !checkpointKeysMatch(state, [
        "version",
        "tick",
        "telemetry",
        "previousTelemetry",
      ]) ||
      state.version !== 2 ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 0 ||
      !checkpointTreeIsFinite(state.telemetry) ||
      !checkpointTreeIsFinite(state.previousTelemetry)
    )
      throw new DomainValidationError(
        "INVALID_TELEMETRY_CHECKPOINT",
        "Telemetry checkpoint must be an exact finite version 2 projection",
      );
    return {
      tick: state.tick,
      telemetry: stripRouteEvidenceCapabilities(state.telemetry),
      previousTelemetry: stripRouteEvidenceCapabilities(
        state.previousTelemetry,
      ),
    };
  }

  importTelemetryState(state) {
    const validated = this.validateTelemetryState(state);
    this.context.telemetry = validated.telemetry;
    this.context.previousTelemetry = validated.previousTelemetry;
  }

  /** Irreversible cache invalidation occurs only after every owner commits. */
  commitCheckpointRestore() {
    this.#routeEvidenceArchive?.invalidateForCheckpointImport();
  }

  /** Rebuilds non-authoritative system caches after every complete restore. */
  resynchronizeAfterCheckpointRestore() {
    if (!this.context)
      throw new DomainValidationError(
        "SESSION_CHECKPOINT_NOT_RUNNING",
        "Cannot resynchronize checkpoint state before the session starts",
      );
    for (const system of this.#initializedSystems)
      system.afterCheckpointRestore?.(this.context);
  }

  dispose() {
    if (!this.context) {
      this.#clear();
      return;
    }
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
  }
}
