import { DomainValidationError } from "../model/primitives.js";

function keyFor(targetId, channel) {
  return `${String(targetId)}\u0000${channel}`;
}

function candidateFromKey(key) {
  const separator = key.indexOf("\u0000");
  return {
    targetId: key.slice(0, separator),
    channelId: key.slice(separator + 1),
    value: 0,
  };
}

function candidateOrder(left, right) {
  return (
    left.targetId.localeCompare(right.targetId) ||
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
    const targetId = String(candidate.targetId),
      channelId = candidate.channel;
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
          ([key, previousValue]) =>
            !currentKeys.has(key) && !Object.is(previousValue, 0),
        )
        .map(([key]) => candidateFromKey(key));
    for (const candidate of [...current, ...released].sort(candidateOrder)) {
      const key = keyFor(candidate.targetId, candidate.channelId);
      if (Object.is(this.previousValues.get(key), candidate.value)) continue;
      this.previousValues.set(key, candidate.value);
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
    return {
      version: 2,
      records: this.records.map(
        ({ sourceId: _sourceId, channelId, ...record }) => ({
          ...structuredClone(record),
          channel: channelId,
        }),
      ),
    };
  }

  validateState(state) {
    if (
      state?.version !== 2 ||
      !checkpointKeysMatch(state, ["version", "records"]) ||
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
        typeof record.targetId !== "string" ||
        !record.targetId ||
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
      this.previousValues.set(
        keyFor(record.targetId, record.channelId),
        record.value,
      );
  }
}
