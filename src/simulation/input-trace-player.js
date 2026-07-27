import { decodeInputTraceOrThrow } from "../model/mechanism-artifacts.js";
import { DomainValidationError } from "../model/primitives.js";

function key(targetId, channelId) {
  return `${targetId}\0${channelId}`;
}

/** Supplies only recorded external candidates at fixed input boundaries. */
export class InputTracePlayer {
  constructor(trace, { targetIds = [] } = {}) {
    this.trace = decodeInputTraceOrThrow(trace).wire;
    this.targetByWireId = new Map(
      targetIds.map((value) => [String(value), value]),
    );
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.lastTick = 0;
    this.values = new Map();
  }

  readCommandCandidates(tick) {
    if (!Number.isSafeInteger(tick) || tick < this.lastTick)
      throw new DomainValidationError(
        "INVALID_INPUT_TRACE_PLAYBACK_TICK",
        "Input-trace playback ticks must be non-negative and monotonic",
        { path: ["tick"] },
      );
    while (
      this.cursor < this.trace.inputs.length &&
      this.trace.inputs[this.cursor].tick <= tick
    ) {
      const input = this.trace.inputs[this.cursor++];
      this.values.set(key(input.targetId, input.channelId), input);
    }
    this.lastTick = tick;
    const remote = [...this.values.values()]
      .sort(
        (left, right) =>
          left.targetId.localeCompare(right.targetId, "en") ||
          left.channelId.localeCompare(right.channelId, "en"),
      )
      .map((input) => ({
        targetId: this.targetByWireId.get(input.targetId) ?? input.targetId,
        channel: input.channelId,
        value: input.value,
        active: input.value !== 0,
      }));
    return { remote, scripts: [] };
  }
}
