import { isOwnedImmutable } from "./owned-immutable-value.js";
import { finiteOr as finite } from "./finite-or.js";
import {
  enrichFailureDetachments,
  extractConnectionFailure,
  extractFlexibleLineFailure,
  extractThermalFailure,
  FailureEvent,
  observeConnectionFailure,
} from "./failure-event-extractors.js";

/**
 * Derives durable failure events from immutable telemetry and assembly state.
 * It observes the solver; it never mutates physics or dispatches on demos.
 */
export class FailureRecorder {
  #catalog;
  #events;
  #peaks;
  #seenFailures;
  #seenThermalParts;
  #seenFlexibleFailures;

  constructor({ catalog = {} } = {}) {
    this.#catalog = catalog;
    this.reset();
  }

  reset() {
    /** @type {FailureEvent[]} */
    this.#events = [];
    this.#seenFailures = new Set();
    this.#peaks = new Map();
    this.#seenThermalParts = new Set();
    this.#seenFlexibleFailures = new Set();
  }

  /** @returns {FailureEvent[]} */
  ingest(snapshot) {
    const createdIds = [];
    for (const connection of snapshot?.run?.connections || []) {
      const initialObservation = observeConnectionFailure(connection, 0);
      if (!initialObservation) continue;
      const observation = observeConnectionFailure(
        connection,
        this.#peaks.get(initialObservation.key) || 0,
      );
      this.#peaks.set(observation.key, observation.peak);
      if (!observation.failed || this.#seenFailures.has(observation.key))
        continue;
      this.#seenFailures.add(observation.key);
      const extracted = extractConnectionFailure({
        snapshot,
        connection,
        catalog: this.#catalog,
        observation,
        eventId: `failure-${this.#events.length + 1}`,
      });
      if (!extracted) continue;
      this.#events.push(extracted);
      createdIds.push(extracted.id);
    }

    this.#extractFlexible(snapshot, createdIds);

    this.#events = enrichFailureDetachments(this.#events, snapshot);
    if (!createdIds.length) this.#extractThermal(snapshot, createdIds);
    return createdIds.map((id) => {
      const event = this.#events.find((candidate) => candidate.id === id);
      if (!event) throw new Error(`missing recorded failure ${id}`);
      return new FailureEvent(event);
    });
  }

  #extractThermal(snapshot, createdIds) {
    const thermalPart = (snapshot?.systems?.aerothermal?.parts || []).find(
      (part) =>
        !this.#seenThermalParts.has(part.id) &&
        (part.thermal?.consumed ||
          (!part.thermal?.ablative && finite(part.thermal?.health, 1) <= 0)),
    );
    const extracted = extractThermalFailure({
      snapshot,
      thermalPart,
      catalog: this.#catalog,
      eventId: `failure-${this.#events.length + 1}`,
    });
    if (!extracted) return;
    this.#seenThermalParts.add(thermalPart.id);
    this.#events.push(extracted);
    createdIds.push(extracted.id);
  }

  #extractFlexible(snapshot, createdIds) {
    for (const topologyEvent of snapshot?.systems?.flexibleLines
      ?.topologyEvents || []) {
      if (this.#seenFlexibleFailures.has(topologyEvent.id)) continue;
      const extracted = extractFlexibleLineFailure({
        snapshot,
        topologyEvent,
        catalog: this.#catalog,
        eventId: `failure-${this.#events.length + 1}`,
      });
      if (!extracted) continue;
      this.#seenFlexibleFailures.add(topologyEvent.id);
      this.#events.push(extracted);
      createdIds.push(extracted.id);
    }
  }

  /** @returns {{status:string,eventCount:number,primary:FailureEvent|null,timeline:FailureEvent[]}} */
  report() {
    const primary = this.#events[0] || null;
    return Object.freeze({
      status: primary ? "failure" : "nominal",
      eventCount: this.#events.length,
      primary: primary ? new FailureEvent(primary) : null,
      timeline: Object.freeze(
        this.#events.map((event) => new FailureEvent(event)),
      ),
    });
  }
}

/** Bounded immutable telemetry recording used only for visual replay. */
export class ReplayBuffer {
  constructor({ seconds = 12, sampleHz = 30, postFailureSeconds = 4 } = {}) {
    this.seconds = seconds;
    this.sampleHz = sampleHz;
    this.postFailureSeconds = postFailureSeconds;
    this.maxFrames = Math.max(2, Math.ceil(seconds * sampleHz));
    this.reset();
  }

  reset() {
    this.frames = [];
    this.lastSampleTime = -Infinity;
    this.failureTime = null;
    this.frozen = false;
  }

  record(telemetry, { force = false } = {}) {
    const time = finite(telemetry?.time);
    if (
      this.frozen ||
      (!force && time - this.lastSampleTime < 1 / this.sampleHz - 1e-6)
    )
      return false;
    // Retain snapshots registered by their deep-immutability owner instead of
    // cloning the entire run/body/system graph at 30 Hz. Frozen-but-unowned and
    // mutable callers still receive the defensive fallback.
    this.frames.push({
      time,
      telemetry: isOwnedImmutable(telemetry)
        ? telemetry
        : structuredClone(telemetry),
    });
    while (this.frames.length > this.maxFrames) this.frames.shift();
    this.lastSampleTime = time;
    if (
      this.failureTime != null &&
      time + 1e-6 >= this.failureTime + this.postFailureSeconds
    )
      this.frozen = true;
    return true;
  }

  pinFailure(time) {
    if (this.failureTime == null) this.failureTime = finite(time);
  }

  frame(index) {
    const frame =
      this.frames[Math.max(0, Math.min(this.frames.length - 1, index))];
    return frame ? structuredClone(frame) : null;
  }

  snapshot() {
    return {
      frameCount: this.frames.length,
      durationS: this.frames.length
        ? this.frames.at(-1).time - this.frames[0].time
        : 0,
      startTimeS: this.frames[0]?.time || 0,
      endTimeS: this.frames.at(-1)?.time || 0,
      failureTimeS: this.failureTime,
      frozen: this.frozen,
    };
  }
}
