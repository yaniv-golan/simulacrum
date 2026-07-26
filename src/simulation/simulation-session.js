import { deepFreeze, DomainValidationError } from "../model/primitives.js";
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

function restoreCheckpointValue(record) {
  if (record?.kind === "map-v1")
    return new Map(structuredClone(record.entries));
  if (record?.kind === "value-v1") return structuredClone(record.value);
  throw new DomainValidationError(
    "INVALID_SESSION_CHECKPOINT_VALUE",
    "Session checkpoint contains an unknown value representation",
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
        "Simulation session initialization failed and was rolled back",
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
      version: 1,
      fixedDt: this.fixedDt,
      maxSubsteps: this.maxSubsteps,
      accumulator: this.accumulator,
      time: this.time,
      clock: this.context.clock,
      environment: this.context.environment,
      sensors: checkpointValue(this.context.sensors),
      commandValues: checkpointValue(this.context.commands),
      completedSensorSnapshot: this.context.completedSensorSnapshot ?? null,
      telemetry: stripRouteEvidenceCapabilities(this.context.telemetry),
      previousTelemetry: stripRouteEvidenceCapabilities(
        this.context.previousTelemetry,
      ),
    });
  }

  importState(state) {
    if (!this.context || state?.version !== 1)
      throw new DomainValidationError(
        "INVALID_SESSION_CHECKPOINT",
        "Simulation session checkpoint is not valid for this session",
      );
    this.#routeEvidenceArchive?.invalidateForCheckpointImport();
    if (
      state.fixedDt !== this.fixedDt ||
      state.maxSubsteps !== this.maxSubsteps
    )
      throw new DomainValidationError(
        "SESSION_CHECKPOINT_IDENTITY_MISMATCH",
        "Simulation session timing identity changed",
      );
    this.accumulator = state.accumulator;
    this.time = state.time;
    this.context.time = state.time;
    this.context.clock = structuredClone(state.clock);
    this.context.environment = deepFreeze(structuredClone(state.environment));
    this.context.sensors = restoreCheckpointValue(state.sensors);
    this.context.commands = restoreCheckpointValue(state.commandValues);
    if (state.completedSensorSnapshot !== null)
      this.context.completedSensorSnapshot = Object.freeze(
        structuredClone(state.completedSensorSnapshot),
      );
    this.context.telemetry = stripRouteEvidenceCapabilities(state.telemetry);
    this.context.previousTelemetry = stripRouteEvidenceCapabilities(
      state.previousTelemetry,
    );
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
