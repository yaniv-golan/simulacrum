/**
 * @typedef {object} ControllerRuntimeManagerOptions
 * @property {(controllerId: number|string, status: string, online: boolean) => void} [onStatus]
 * @property {(controllerId: number|string, commands: Map<string, number>) => void} [onCommands]
 * @property {(event: object) => void} [onTrace]
 */

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
    runtime.engine.dispose?.();
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
        label: runtime.label,
        language: runtime.language,
        policyVersion: runtime.policyVersion,
        bindingManifest: structuredClone(runtime.bindingManifest),
        bindingManifestIdentity: runtime.bindingManifestIdentity,
        ready: runtime.ready,
        commands: [...runtime.commands].sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        ),
        tick: runtime.tick,
        lastTick: structuredClone(runtime.lastTick),
        status: runtime.status,
        error: runtime.error,
        engineState: runtime.engine.exportState(),
      }));
  }

  importState(state) {
    if (!Array.isArray(state) || state.length !== this.runtimes.size)
      throw new Error("controller checkpoint does not match attached programs");
    const byId = new Map(state.map((record) => [record.controllerId, record]));
    for (const runtime of this.runtimes.values()) {
      const record = byId.get(runtime.controllerId);
      if (
        !record ||
        record.language !== runtime.language ||
        record.policyVersion !== runtime.policyVersion ||
        record.bindingManifestIdentity !== runtime.bindingManifestIdentity
      )
        throw new Error("controller checkpoint identity mismatch");
      runtime.engine.importState(record.engineState);
      runtime.ready = Boolean(record.ready);
      runtime.commands = new Map(record.commands);
      runtime.tick = record.tick;
      runtime.lastTick = structuredClone(record.lastTick);
      runtime.status = record.status;
      runtime.error = record.error;
      this.onCommands(runtime.controllerId, new Map(runtime.commands));
      this.onStatus(runtime.controllerId, runtime.status, runtime.ready);
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
