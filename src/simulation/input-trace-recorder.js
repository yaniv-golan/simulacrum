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
      version: 1,
      sourceId: this.sourceId,
      nextSequence: this.nextSequence,
      records: structuredClone(this.records),
      previousValues: [...this.previousValues],
    };
  }

  restore(state) {
    if (
      state?.version !== 1 ||
      state.sourceId !== this.sourceId ||
      !Number.isSafeInteger(state.nextSequence) ||
      !Array.isArray(state.records) ||
      !Array.isArray(state.previousValues)
    )
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_CHECKPOINT",
        "Input trace checkpoint does not match the active recorder",
      );
    this.nextSequence = state.nextSequence;
    this.records = structuredClone(state.records);
    this.previousValues = new Map(structuredClone(state.previousValues));
  }
}
