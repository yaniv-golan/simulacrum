/** Local, explicitly started usability capture. No input listeners or browser ownership. */
export const INTERACTION_STORAGE_KEY = 'simulacrum.interaction-recording.v1';
const reasons = new Set(['user-stop', 'event-limit', 'byte-limit', 'storage-failure', 'invalid-data', 'clock-failure']);
const encoder = new TextEncoder();

function jsonCopy(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Expected finite, acyclic JSON data');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Expected plain JSON objects');
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('JSON cannot contain symbol keys');
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) throw new Error('Expected dense JSON array');
  if (Object.getOwnPropertyNames(value).some(key => !(Array.isArray(value) && key === 'length') && !Object.getOwnPropertyDescriptor(value, key).enumerable)) throw new Error('JSON cannot contain hidden properties');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!('value' in descriptor)) throw new Error('JSON cannot contain accessors');
    Object.defineProperty(result, key, { value: jsonCopy(descriptor.value, ancestors), enumerable: true, configurable: true, writable: true });
  }
  ancestors.delete(value);
  return result;
}
const size = value => encoder.encode(JSON.stringify(value)).byteLength;
const utc = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid wall clock');
  const result = date.toISOString();
  if (result.length !== 24) throw new Error('Wall clock outside supported UTC range');
  return result;
};

export function createInteractionRecorder({ build, storage, now = () => Date.now(), wallNow = () => Date.now(), idFactory = () => `interaction-${Date.now()}`, maxEvents = 10000, maxBytes = 2000000 }) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Capture limits must be positive integers');
  let capture = null;
  let origin = 0;
  let reason = null;
  let error = null;
  let persisted = false;
  const recording = () => capture?.status === 'recording';
  // Reserve the longest termination reason and fixed UTC timestamp before admitting
  // events, so even the final complete prefix fits the configured byte budget.
  const fits = value => size({ ...value, endedAt: value.endedAt ?? value.startedAt, status: 'stopped', terminationReason: 'storage-failure' }) <= maxBytes;
  const close = (why, finalContext = capture?.finalContext ?? null) => {
    reason = why;
    if (!capture) return;
    let endedAt = capture.startedAt;
    try { endedAt = utc(wallNow()); } catch { /* The start anchor remains available. */ }
    capture = { ...capture, status: 'stopped', terminationReason: why, endedAt, finalContext };
  };
  const persist = () => {
    try {
      storage.setItem(INTERACTION_STORAGE_KEY, JSON.stringify(capture));
      persisted = true;
      return true;
    } catch (cause) {
      error = String(cause?.message ?? cause);
      persisted = false;
      close('storage-failure');
      return false;
    }
  };
  const fail = (why, cause) => {
    if (cause) error = String(cause?.message ?? cause);
    close(why);
    if (capture) persist();
    return false;
  };
  return {
    start(initialContext = null) {
      if (recording()) return false;
      error = null; reason = null; persisted = false;
      let candidate;
      try {
        const id = idFactory();
        if (typeof id !== 'string' || !id) throw new Error('Session id must be a nonempty string');
        candidate = { version: 1, id, build: jsonCopy(build), startedAt: utc(wallNow()), endedAt: null, status: 'recording', terminationReason: null, initialContext: jsonCopy(initialContext), finalContext: null, events: [] };
      } catch (cause) { reason = 'invalid-data'; error = String(cause.message); return false; }
      try { origin = now(); if (!Number.isFinite(origin)) throw new Error('Invalid monotonic clock'); }
      catch (cause) { reason = 'clock-failure'; error = String(cause.message); return false; }
      if (!fits(candidate)) { reason = 'byte-limit'; return false; }
      capture = candidate;
      return persist();
    },
    record(kind, data = null, context = null) {
      if (!recording()) return false;
      let event;
      try {
        if (typeof kind !== 'string' || !kind) throw new Error('Event kind must be a nonempty string');
        event = { seq: capture.events.length + 1, timeMs: 0, kind, data: jsonCopy(data), context: jsonCopy(context) };
      } catch (cause) { return fail('invalid-data', cause); }
      try {
        const current = now();
        if (!Number.isFinite(current) || !Number.isFinite(current - origin)) throw new Error('Invalid monotonic clock');
        event.timeMs = Math.max(0, capture.events.at(-1)?.timeMs ?? 0, current - origin);
      } catch (cause) { return fail('clock-failure', cause); }
      const candidate = { ...capture, events: [...capture.events, event] };
      if (!fits(candidate)) return fail('byte-limit');
      capture = candidate;
      if (capture.events.length === maxEvents) close('event-limit');
      return persist();
    },
    stop(finalContext = null) {
      if (!recording()) return false;
      let copied;
      try { copied = jsonCopy(finalContext); } catch (cause) { return fail('invalid-data', cause); }
      if (!fits({ ...capture, finalContext: copied })) return fail('byte-limit');
      close('user-stop', copied);
      return persist();
    },
    snapshot: () => capture === null ? null : jsonCopy(capture),
    readLast() {
      try {
        const raw = storage.getItem(INTERACTION_STORAGE_KEY);
        if (typeof raw !== 'string' || encoder.encode(raw).byteLength > maxBytes) return null;
        const value = JSON.parse(raw);
        if (value?.version !== 1 || typeof value.id !== 'string' || !value.id || !Object.hasOwn(value, 'build') || !Object.hasOwn(value, 'initialContext') || !Object.hasOwn(value, 'finalContext') || !Array.isArray(value.events) || value.events.length > maxEvents || utc(value.startedAt) !== value.startedAt) return null;
        if (value.status === 'recording') { if (value.terminationReason !== null || value.endedAt !== null) return null; }
        else if (value.status !== 'stopped' || !reasons.has(value.terminationReason) || utc(value.endedAt) !== value.endedAt) return null;
        let previous = 0;
        for (const [index, event] of value.events.entries()) {
          if (event?.seq !== index + 1 || !Number.isFinite(event.timeMs) || event.timeMs < previous || typeof event.kind !== 'string' || !event.kind || !Object.hasOwn(event, 'data') || !Object.hasOwn(event, 'context')) return null;
          previous = event.timeMs;
        }
        return jsonCopy(value);
      } catch { return null; }
    },
    state: () => ({ recording: recording(), reason, eventCount: capture?.events.length ?? 0, persisted, error }),
  };
}
