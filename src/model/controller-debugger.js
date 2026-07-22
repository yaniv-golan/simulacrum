const OPERATORS = Object.freeze({
  gt: (value, target) => value > target,
  gte: (value, target) => value >= target,
  lt: (value, target) => value < target,
  lte: (value, target) => value <= target,
  eq: (value, target) => Math.abs(value - target) < 1e-6,
});

export class ControllerTraceBuffer {
  constructor({ capacity = 360 } = {}) {
    this.capacity = Math.max(30, Math.floor(capacity));
    this.samples = new Map();
    this.watches = new Map();
    this.breakpoints = new Map();
    this.triggered = new Map();
  }

  setWatches(controllerId, names = []) {
    this.watches.set(controllerId, [...new Set(names)].slice(0, 8));
  }

  setBreakpoint(controllerId, breakpoint = null) {
    if (!breakpoint?.name) this.breakpoints.delete(controllerId);
    else
      this.breakpoints.set(controllerId, {
        name: String(breakpoint.name),
        op: OPERATORS[breakpoint.op] ? breakpoint.op : "gt",
        value: Number(breakpoint.value) || 0,
        armed: breakpoint.armed !== false,
      });
    this.triggered.delete(controllerId);
  }

  ingest({
    controllerId,
    tick = 0,
    time = 0,
    sensors = {},
    commands = {},
    provenance = [],
  }) {
    const values = {
        ...Object.fromEntries(
          Object.entries(sensors || {}).map(([key, value]) => [
            `sensor.${key}`,
            Number(value) || 0,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(commands || {}).map(([key, value]) => [
            `command.${key}`,
            Number(value) || 0,
          ]),
        ),
      },
      sample = { tick, time, values, provenance: structuredClone(provenance) };
    const samples = this.samples.get(controllerId) || [];
    samples.push(sample);
    if (samples.length > this.capacity)
      samples.splice(0, samples.length - this.capacity);
    this.samples.set(controllerId, samples);
    const breakpoint = this.breakpoints.get(controllerId),
      current = values[breakpoint?.name];
    if (
      breakpoint?.armed &&
      Number.isFinite(current) &&
      OPERATORS[breakpoint.op](current, breakpoint.value)
    ) {
      const event = { ...breakpoint, tick, time, current };
      this.triggered.set(controllerId, event);
      breakpoint.armed = false;
      return event;
    }
    return null;
  }

  clear(controllerId) {
    this.samples.delete(controllerId);
    this.triggered.delete(controllerId);
  }

  /**
   * @returns {{
   *   sampleCount:any, tick:any, time:any, latest:any,
   *   latestProvenance:any, watches:any, traces:any,
   *   breakpoint:any, triggered:any,
   * }}
   */
  snapshot(controllerId, { includeTraces = true } = {}) {
    const samples = this.samples.get(controllerId) || [],
      latest = samples.at(-1) || { tick: 0, time: 0, values: {} },
      watches = this.watches.get(controllerId) || [],
      names = watches.length ? watches : Object.keys(latest.values).slice(0, 4);
    return structuredClone({
      sampleCount: samples.length,
      tick: latest.tick,
      time: latest.time,
      latest: latest.values,
      latestProvenance: latest.provenance || [],
      watches: names,
      traces: includeTraces
        ? names.map((name) => ({
            name,
            values: samples.map((sample) => ({
              time: sample.time,
              value: sample.values[name] ?? 0,
            })),
          }))
        : [],
      breakpoint: this.breakpoints.get(controllerId) || null,
      triggered: this.triggered.get(controllerId) || null,
    });
  }
}
