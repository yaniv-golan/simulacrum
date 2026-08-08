import { decodeInputTraceOrThrow } from "../model/mechanism-artifacts.js";
import {
  compareCompiledIds,
  DomainValidationError,
  identityToken,
} from "../model/primitives.js";

function key(targetId, channelId) {
  return JSON.stringify([
    identityToken(targetId, { typedStrings: true }),
    channelId,
  ]);
}

/** Supplies only recorded external candidates at fixed input boundaries. */
export class InputTracePlayer {
  constructor(trace, { targetIds = [] } = {}) {
    this.trace = decodeInputTraceOrThrow(trace).wire;
    this.targetByWireId = new Map(
      targetIds.map((value) => [
        identityToken(value, { typedStrings: true }),
        value,
      ]),
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
          compareCompiledIds(left.targetId, right.targetId) ||
          left.channelId.localeCompare(right.channelId, "en"),
      )
      .map((input) => ({
        targetId:
          this.targetByWireId.get(
            identityToken(input.targetId, { typedStrings: true }),
          ) ?? input.targetId,
        channel: input.channelId,
        sourceId: input.sourceId,
        value: input.value,
        active: input.value !== 0,
        replayable: input.sourceId === this.trace.sourceId,
      }));
    return { remote, scripts: [] };
  }
}
