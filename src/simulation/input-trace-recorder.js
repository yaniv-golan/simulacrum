import {
  compareCompiledIds,
  compiledId,
  DomainValidationError,
  identityToken,
} from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";

function keyFor(targetId, channel) {
  return JSON.stringify([
    identityToken(targetId, { typedStrings: true }),
    channel,
  ]);
}

function candidateOrder(left, right) {
  return (
    compareCompiledIds(left.targetId, right.targetId) ||
    left.channelId.localeCompare(right.channelId)
  );
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

function normalizedCandidates(candidates) {
  const byTargetChannel = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const value = Number(candidate?.value);
    if (
      candidate?.targetId == null ||
      typeof candidate.channel !== "string" ||
      !candidate.channel ||
      !Number.isFinite(value)
    )
      continue;
    let targetId;
    try {
      targetId = compiledId(candidate.targetId, { path: ["targetId"] });
    } catch {
      continue;
    }
    const channelId = candidate.channel;
    byTargetChannel.set(keyFor(targetId, channelId), {
      targetId,
      channelId,
      value,
    });
  }
  return [...byTargetChannel.values()].sort(candidateOrder);
}

/** Records external command values at fixed-tick input boundaries. */
export class InputTraceRecorder {
  constructor({ sourceId = "operator" } = {}) {
    if (typeof sourceId !== "string" || !sourceId)
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_SOURCE",
        "Input trace sourceId must be a non-empty string",
      );
    this.sourceId = sourceId;
    this.nextSequence = 0;
    this.records = [];
    this.previousValues = new Map();
  }

  recordTick(tick, candidates) {
    if (!Number.isSafeInteger(tick) || tick < 0)
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_TICK",
        "Input trace tick must be a non-negative safe integer",
      );
    const current = normalizedCandidates(candidates),
      currentKeys = new Set(
        current.map((candidate) =>
          keyFor(candidate.targetId, candidate.channelId),
        ),
      ),
      released = [...this.previousValues]
        .filter(
          ([key, previous]) =>
            !currentKeys.has(key) && !Object.is(previous.value, 0),
        )
        .map(([, previous]) => ({ ...previous, value: 0 }));
    for (const candidate of [...current, ...released].sort(candidateOrder)) {
      const key = keyFor(candidate.targetId, candidate.channelId);
      if (Object.is(this.previousValues.get(key)?.value, candidate.value))
        continue;
      this.previousValues.set(key, { ...candidate });
      this.records.push({
        tick,
        sequence: this.nextSequence++,
        sourceId: this.sourceId,
        ...candidate,
      });
    }
  }

  inputsThrough(endTick) {
    if (!Number.isSafeInteger(endTick) || endTick < 0)
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_END_TICK",
        "Input trace endTick must be a non-negative safe integer",
      );
    return structuredClone(
      this.records.filter((record) => record.tick <= endTick),
    );
  }

  capture() {
    return issueInertPlainData({
      version: 2,
      sourceId: this.sourceId,
      records: this.records.map(
        ({ sourceId: _sourceId, channelId, ...record }) => ({
          ...structuredClone(record),
          channel: channelId,
        }),
      ),
    });
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_INPUT_TRACE_CHECKPOINT",
      message:
        "Input trace checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      state?.version !== 2 ||
      !checkpointKeysMatch(state, ["version", "sourceId", "records"]) ||
      state.sourceId !== this.sourceId ||
      !Array.isArray(state.records)
    )
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_CHECKPOINT",
        "Input trace checkpoint does not match the active recorder",
      );
    let previousTick = -1;
    const records = state.records.map((record, index) => {
      if (
        !checkpointKeysMatch(record, [
          "tick",
          "sequence",
          "targetId",
          "channel",
          "value",
        ]) ||
        !Number.isSafeInteger(record.tick) ||
        record.tick < previousTick ||
        record.sequence !== index ||
        !(
          (typeof record.targetId === "number" &&
            Number.isSafeInteger(record.targetId)) ||
          (typeof record.targetId === "string" && record.targetId.length > 0)
        ) ||
        typeof record.channel !== "string" ||
        !record.channel ||
        typeof record.value !== "number" ||
        !Number.isFinite(record.value)
      )
        throw new DomainValidationError(
          "INVALID_INPUT_TRACE_CHECKPOINT",
          "Input trace checkpoint contains invalid ordered records",
        );
      previousTick = record.tick;
      return {
        tick: record.tick,
        sequence: record.sequence,
        sourceId: this.sourceId,
        targetId: record.targetId,
        channelId: record.channel,
        value: record.value,
      };
    });
    return records;
  }

  restore(state) {
    const records = this.validateState(state);
    this.nextSequence = records.length;
    this.records = structuredClone(records);
    this.previousValues = new Map();
    for (const record of records)
      this.previousValues.set(keyFor(record.targetId, record.channelId), {
        targetId: record.targetId,
        channelId: record.channelId,
        value: record.value,
      });
  }
}
