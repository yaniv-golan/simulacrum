import { deepFreeze } from "../model/primitives.js";

export class CommandBus {
  constructor() {
    this.remote = new Map();
    this.script = new Map();
    this.conflicts = new Set();
    this.rejections = [];
  }

  static key(targetId, channel) {
    return `${targetId}:${channel}`;
  }

  clearTick() {
    this.remote.clear();
    this.script.clear();
    this.conflicts.clear();
    this.rejections = [];
  }

  writeRemote(targetId, channel, value) {
    const number = Number(value);
    if (targetId == null || !channel || !Number.isFinite(number)) return false;
    this.remote.set(CommandBus.key(targetId, channel), {
      targetId,
      channel,
      value: number,
    });
    return true;
  }

  writeScript(controllerId, bindingId, targetId, channel, value) {
    const number = Number(value);
    if (
      controllerId == null ||
      !bindingId ||
      targetId == null ||
      !channel ||
      !Number.isFinite(number)
    )
      return false;
    const key = CommandBus.key(targetId, channel),
      existing = this.script.get(key);
    if (existing && existing.controllerId !== controllerId) {
      this.conflicts.add(key);
      return false;
    }
    this.script.set(key, {
      controllerId,
      bindingId,
      targetId,
      channel,
      value: number,
    });
    return true;
  }

  reject(candidate, reason) {
    this.rejections.push({ ...structuredClone(candidate), reason });
  }

  read(targetId, channel, fallback = 0) {
    const key = CommandBus.key(targetId, channel);
    if (this.conflicts.has(key))
      return { value: fallback, conflict: true, source: "none" };
    const scripted = this.script.get(key);
    if (scripted)
      return { value: scripted.value, conflict: false, source: "script" };
    const remote = this.remote.get(key);
    if (remote)
      return { value: remote.value, conflict: false, source: "remote" };
    return { value: fallback, conflict: false, source: "default" };
  }

  entries() {
    return Object.freeze({
      remote: Object.freeze(
        [...this.remote.values()].map((entry) => Object.freeze({ ...entry })),
      ),
      script: Object.freeze(
        [...this.script.values()].map((entry) => Object.freeze({ ...entry })),
      ),
      conflicts: Object.freeze([...this.conflicts]),
      rejections: Object.freeze(
        this.rejections.map((entry) => deepFreeze({ ...entry })),
      ),
    });
  }

  exportState() {
    const state = this.entries();
    return structuredClone(state);
  }

  importState(state) {
    if (!state || typeof state !== "object")
      throw new TypeError("command bus checkpoint must be an object");
    this.clearTick();
    for (const entry of state.remote || [])
      if (!this.writeRemote(entry.targetId, entry.channel, entry.value))
        throw new TypeError(
          "command bus checkpoint contains invalid remote data",
        );
    for (const entry of state.script || [])
      if (
        !this.writeScript(
          entry.controllerId,
          entry.bindingId,
          entry.targetId,
          entry.channel,
          entry.value,
        )
      )
        throw new TypeError(
          "command bus checkpoint contains invalid script data",
        );
    this.conflicts = new Set(state.conflicts || []);
    this.rejections = structuredClone(state.rejections || []);
  }
}
