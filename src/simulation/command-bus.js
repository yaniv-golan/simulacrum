import { deepFreeze, identityToken } from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";

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

export class CommandBus {
  constructor() {
    this.remote = new Map();
    this.script = new Map();
    this.conflicts = new Set();
    this.rejections = [];
  }

  static key(targetId, channel) {
    return JSON.stringify([
      identityToken(targetId, { typedStrings: true }),
      channel,
    ]);
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
    let key;
    try {
      key = CommandBus.key(targetId, channel);
    } catch {
      return false;
    }
    this.remote.set(key, {
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
    let key;
    try {
      key = CommandBus.key(targetId, channel);
    } catch {
      return false;
    }
    const existing = this.script.get(key);
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
    return issueInertPlainData(state);
  }

  validateState(state) {
    const detachedState = requireInertPlainData(state, {
      code: "INVALID_COMMAND_BUS_CHECKPOINT_PLAIN_DATA",
      message:
        "Command bus checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      !checkpointKeysMatch(detachedState, [
        "remote",
        "script",
        "conflicts",
        "rejections",
      ])
    )
      throw new TypeError("command bus checkpoint must be an object");
    if (
      !Array.isArray(detachedState.remote || []) ||
      !Array.isArray(detachedState.script || []) ||
      !Array.isArray(detachedState.conflicts || []) ||
      !Array.isArray(detachedState.rejections || []) ||
      new Set(detachedState.conflicts).size !==
        detachedState.conflicts.length ||
      detachedState.conflicts.some((key) => typeof key !== "string") ||
      !checkpointTreeIsFinite(detachedState.rejections)
    )
      throw new TypeError("command bus checkpoint contains invalid arrays");
    const remote = new Map(),
      script = new Map(),
      conflicts = new Set(detachedState.conflicts || []);
    for (const entry of detachedState.remote || []) {
      if (
        !checkpointKeysMatch(entry, ["targetId", "channel", "value"]) ||
        entry.targetId == null ||
        typeof entry.channel !== "string" ||
        !entry.channel ||
        typeof entry.value !== "number" ||
        !Number.isFinite(entry.value)
      )
        throw new TypeError(
          "command bus checkpoint contains invalid remote data",
        );
      let key;
      try {
        key = CommandBus.key(entry.targetId, entry.channel);
      } catch {
        throw new TypeError(
          "command bus checkpoint contains invalid remote data",
        );
      }
      if (remote.has(key))
        throw new TypeError(
          "command bus checkpoint contains invalid remote data",
        );
      remote.set(key, {
        targetId: entry.targetId,
        channel: entry.channel,
        value: entry.value,
      });
    }
    for (const entry of detachedState.script || []) {
      if (
        !checkpointKeysMatch(entry, [
          "controllerId",
          "bindingId",
          "targetId",
          "channel",
          "value",
        ]) ||
        entry?.controllerId == null ||
        typeof entry.bindingId !== "string" ||
        !entry.bindingId ||
        entry.targetId == null ||
        typeof entry.channel !== "string" ||
        !entry.channel ||
        typeof entry.value !== "number" ||
        !Number.isFinite(entry.value)
      )
        throw new TypeError(
          "command bus checkpoint contains invalid script data",
        );
      let key;
      try {
        key = CommandBus.key(entry.targetId, entry.channel);
      } catch {
        throw new TypeError(
          "command bus checkpoint contains invalid script data",
        );
      }
      if (script.has(key))
        throw new TypeError(
          "command bus checkpoint contains invalid script data",
        );
      script.set(key, {
        controllerId: entry.controllerId,
        bindingId: entry.bindingId,
        targetId: entry.targetId,
        channel: entry.channel,
        value: entry.value,
      });
    }
    if ([...conflicts].some((key) => !script.has(key)))
      throw new TypeError("command bus checkpoint contains unknown conflicts");
    return {
      remote,
      script,
      conflicts,
      rejections: structuredClone(detachedState.rejections || []),
    };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.remote = validated.remote;
    this.script = validated.script;
    this.conflicts = validated.conflicts;
    this.rejections = validated.rejections;
  }
}
