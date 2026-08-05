/**
 * @typedef {object} ControllerRuntimeManagerOptions
 * @property {(controllerId: number|string, status: string, online: boolean) => void} [onStatus]
 * @property {(controllerId: number|string, commands: Map<string, number>) => void} [onCommands]
 * @property {(event: object) => void} [onTrace]
 */

const CONTROLLER_CHECKPOINT_FIELDS = Object.freeze([
  "controllerId",
  "bindingManifestIdentity",
  "programIdentity",
  "ready",
  "commands",
  "tick",
  "lastTick",
  "error",
  "engineState",
]);

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

export class ControllerRuntimeManager {
  /** @param {ControllerRuntimeManagerOptions} [options] */
  constructor({
    onStatus = () => {},
    onCommands = () => {},
    onTrace = () => {},
  } = {}) {
    this.onStatus = onStatus;
    this.onCommands = onCommands;
    this.onTrace = onTrace;
    this.runtimes = new Map();
  }

  attach(controllerId, preparedRuntime, label = "SCRIPT") {
    if (!preparedRuntime || typeof preparedRuntime.instantiate !== "function")
      throw new TypeError("controller runtime must provide instantiate()");
    this.dispose(controllerId);
    const engine = preparedRuntime.instantiate(),
      runtime = {
        controllerId,
        engine,
        label,
        language: preparedRuntime.language || null,
        policyVersion: preparedRuntime.policyVersion || null,
        bindingManifest: structuredClone(preparedRuntime.bindingManifest || []),
        bindingManifestIdentity:
          preparedRuntime.bindingManifestIdentity || null,
        programIdentity: preparedRuntime.programIdentity || null,
        ready: true,
        commands: new Map(),
        tick: 0,
        lastTick: null,
        status: `${label} ONLINE`,
        error: null,
      };
    this.runtimes.set(controllerId, runtime);
    this.onStatus(controllerId, runtime.status, true);
    return runtime;
  }

  #fail(runtime, error) {
    runtime.ready = false;
    runtime.commands = new Map();
    runtime.error = error instanceof Error ? error.message : String(error);
    runtime.status = `TRAP: ${runtime.error}`;
    this.onCommands(runtime.controllerId, runtime.commands);
    this.onStatus(runtime.controllerId, runtime.status, false);
  }

  tick(controllerId, dt, sensors) {
    const runtime = this.runtimes.get(controllerId);
    if (!runtime?.ready) return false;
    runtime.tick++;
    runtime.lastTick = {
      dt: Number(dt),
      sensors: structuredClone(sensors || {}),
    };
    try {
      const commands = runtime.engine.tick(dt, sensors),
        normalized =
          commands instanceof Map ? new Map(commands) : new Map(commands || []);
      runtime.commands = normalized;
      this.onCommands(runtime.controllerId, normalized);
      this.onTrace({
        controllerId: runtime.controllerId,
        tick: runtime.tick,
        dt: runtime.lastTick.dt,
        sensors: structuredClone(runtime.lastTick.sensors),
        commands: Object.fromEntries(normalized),
        bindingManifestIdentity: runtime.bindingManifestIdentity,
      });
      return true;
    } catch (error) {
      this.#fail(runtime, error);
      return false;
    }
  }

  commands(controllerId) {
    return new Map(this.runtimes.get(controllerId)?.commands || []);
  }

  ready(controllerId) {
    return Boolean(this.runtimes.get(controllerId)?.ready);
  }

  status(controllerId) {
    const runtime = this.runtimes.get(controllerId);
    return runtime
      ? {
          ready: runtime.ready,
          status: runtime.status,
          error: runtime.error,
          language: runtime.language,
          policyVersion: runtime.policyVersion,
          bindingManifestIdentity: runtime.bindingManifestIdentity,
          tick: runtime.tick,
        }
      : null;
  }

  ids() {
    return [...this.runtimes.keys()];
  }

  exportState() {
    return [...this.runtimes.values()]
      .sort((left, right) =>
        String(left.controllerId).localeCompare(
          String(right.controllerId),
          "en",
        ),
      )
      .map((runtime) => ({
        controllerId: runtime.controllerId,
        bindingManifestIdentity: runtime.bindingManifestIdentity,
        programIdentity: runtime.programIdentity,
        ready: runtime.ready,
        commands: [...runtime.commands].sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        ),
        tick: runtime.tick,
        lastTick: structuredClone(runtime.lastTick),
        error: runtime.error,
        engineState: runtime.engine.exportState(),
      }));
  }

  validateState(state) {
    if (!Array.isArray(state) || state.length !== this.runtimes.size)
      throw new Error("controller checkpoint does not match attached programs");
    const byId = new Map();
    for (const record of state) {
      const commands = new Map();
      if (
        !checkpointKeysMatch(record, CONTROLLER_CHECKPOINT_FIELDS) ||
        byId.has(record.controllerId) ||
        typeof record.bindingManifestIdentity !== "string" ||
        !record.bindingManifestIdentity ||
        typeof record.programIdentity !== "string" ||
        !record.programIdentity ||
        typeof record.ready !== "boolean" ||
        !Array.isArray(record.commands) ||
        !Number.isSafeInteger(record.tick) ||
        record.tick < 0 ||
        !(
          record.lastTick === null ||
          (checkpointKeysMatch(record.lastTick, ["dt", "sensors"]) &&
            typeof record.lastTick.dt === "number" &&
            Number.isFinite(record.lastTick.dt) &&
            record.lastTick.dt > 0 &&
            checkpointTreeIsFinite(record.lastTick.sensors))
        ) ||
        !(
          record.error === null ||
          (typeof record.error === "string" && record.error.length > 0)
        ) ||
        (record.ready ? record.error !== null : record.error === null)
      )
        throw new Error("controller checkpoint contains invalid runtime state");
      for (const command of record.commands) {
        if (
          !Array.isArray(command) ||
          command.length !== 2 ||
          typeof command[0] !== "string" ||
          !command[0] ||
          typeof command[1] !== "number" ||
          !Number.isFinite(command[1]) ||
          commands.has(command[0])
        )
          throw new Error("controller checkpoint contains invalid commands");
        commands.set(command[0], command[1]);
      }
      byId.set(record.controllerId, {
        ...structuredClone(record),
        commands,
      });
    }
    for (const runtime of this.runtimes.values()) {
      const record = byId.get(runtime.controllerId);
      if (
        !record ||
        record.bindingManifestIdentity !== runtime.bindingManifestIdentity ||
        record.programIdentity !== runtime.programIdentity
      )
        throw new Error("controller checkpoint identity mismatch");
      runtime.engine.validateState(record.engineState);
    }
    return byId;
  }

  importState(state, { notify = true } = {}) {
    const byId = this.validateState(state);
    for (const runtime of this.runtimes.values()) {
      const record = byId.get(runtime.controllerId);
      runtime.engine.importState(record.engineState);
      runtime.ready = record.ready;
      runtime.commands = record.commands;
      runtime.tick = record.tick;
      runtime.lastTick = structuredClone(record.lastTick);
      runtime.error = record.error;
      runtime.status = runtime.ready
        ? `${runtime.label} ONLINE`
        : `TRAP: ${runtime.error}`;
    }
    if (notify) this.publishState();
  }

  /**
   * Publishes restored state only after every checkpoint owner commits.
   * Observers are not checkpoint authorities: their failures are contained so
   * a committed restore cannot be reported as a failed transaction.
   */
  publishState() {
    for (const runtime of this.runtimes.values()) {
      try {
        this.onCommands(runtime.controllerId, new Map(runtime.commands));
      } catch {
        // Post-commit observers are not checkpoint authorities.
      }
      try {
        this.onStatus(runtime.controllerId, runtime.status, runtime.ready);
      } catch {
        // Continue publishing independent observers after one rejects.
      }
    }
  }

  dispose(controllerId) {
    const runtime = this.runtimes.get(controllerId);
    if (!runtime) return;
    runtime.engine.dispose?.();
    this.runtimes.delete(controllerId);
  }

  disposeAll() {
    for (const id of [...this.runtimes.keys()]) this.dispose(id);
  }
}
