import { assertRecordableObservation } from './recording-admission.mjs';
import { unpackCapturePacket } from './capture-packet.mjs';
/** Versioned, bounded observations. This codec never executes recorded commands or programs. */
export const captureStreamLimits = Object.freeze({
  bytes: 2 * 1024 * 1024,
  depth: 32,
  operations: 4096,
  batch: 128,
  events: 100000,
  expandedBytes: 256 * 1024 * 1024,
  wireBytes: 128 * 1024 * 1024,
  captureWireBytes: 112 * 1024 * 1024,
  encodedBytes: 384 * 1024 * 1024,
});
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) {
  throw new Error(`Invalid capture stream: ${message}`);
}
function validate(value, depth = 0, budget = { remaining: captureStreamLimits.bytes }) {
  if (depth > captureStreamLimits.depth) fail('depth limit');
  if (--budget.remaining < 0) fail('size limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('nonfinite number');
    return;
  }
  if (typeof value === 'string') {
    budget.remaining -= value.length;
    if (budget.remaining < 0) fail('size limit');
    return;
  }
  if (typeof value !== 'object') fail('non-JSON value');
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    fail('object prototype');
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) fail('unsafe key');
    budget.remaining -= key.length;
    validate(value[key], depth + 1, budget);
  }
}
function copy(value) {
  validate(value);
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > captureStreamLimits.bytes)
    fail('byte limit');
  return JSON.parse(serialized);
}
function envelope(event) {
  if (
    !object(event) ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 1 ||
    !Number.isFinite(event.timeMs) ||
    event.timeMs < 0 ||
    typeof event.kind !== 'string' ||
    !event.kind ||
    typeof event.id !== 'string' ||
    !event.id
  )
    fail('event envelope');
}
function difference(before, after, path, ops) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    const start = ops.length;
    for (let i = 0; i < after.length; i++) {
      difference(before[i], after[i], [...path, String(i)], ops);
      if (ops.length > captureStreamLimits.operations) return;
    }
    const replacement = { op: 'set', path, value: after };
    if (JSON.stringify(ops.slice(start)).length > JSON.stringify(replacement).length)
      ops.splice(start, ops.length - start, replacement);
    return;
  }
  if (!object(before) || !object(after)) {
    ops.push({ op: 'set', path, value: after });
    return;
  }
  for (const key of Object.keys(before))
    if (!own(after, key)) ops.push({ op: 'delete', path: [...path, key] });
  for (const key of Object.keys(after)) {
    if (!own(before, key)) ops.push({ op: 'set', path: [...path, key], value: after[key] });
    else difference(before[key], after[key], [...path, key], ops);
    if (ops.length > captureStreamLimits.operations) return;
  }
}
export function createCaptureEncoder() {
  let previous = null,
    lastKeyframe = -Infinity,
    lastKeyframeSeq = 0;
  return {
    encode(event, { keyframe = false } = {}) {
      assertRecordableObservation(event?.context?.observation);
      const snapshot = copy(event);
      envelope(snapshot);
      if (!own(snapshot, 'context') || own(snapshot, 'contextFrame')) fail('context required');
      const context = copy(snapshot.context);
      if (previous && (snapshot.seq !== previous.seq + 1 || snapshot.timeMs < previous.timeMs))
        fail('encoder order');
      const ops = [];
      const full =
        keyframe ||
        !previous ||
        snapshot.timeMs - lastKeyframe >= 5000 ||
        snapshot.seq - lastKeyframeSeq >= 256;
      if (!full) difference(previous.context, context, [], ops);
      const frame =
        full ||
        ops.length > captureStreamLimits.operations ||
        JSON.stringify(ops).length >= JSON.stringify(context).length
          ? { schema: 1, kind: 'keyframe', base: null, value: context }
          : { schema: 1, kind: 'delta', base: previous.seq, ops };
      delete snapshot.context;
      snapshot.contextFrame = frame;
      const result = copy(snapshot);
      if (frame.kind === 'keyframe') {
        lastKeyframe = event.timeMs;
        lastKeyframeSeq = event.seq;
      }
      previous = { seq: event.seq, timeMs: event.timeMs, context };
      return result;
    },
  };
}
function apply(context, ops) {
  if (!Array.isArray(ops) || ops.length > captureStreamLimits.operations) fail('operation limit');
  let result = copy(context);
  for (const operation of ops) {
    if (
      !object(operation) ||
      !['set', 'delete'].includes(operation.op) ||
      !Array.isArray(operation.path) ||
      operation.path.length > captureStreamLimits.depth ||
      operation.path.some((key) => typeof key !== 'string' || forbidden.has(key))
    )
      fail('operation');
    if (operation.op === 'set' && !own(operation, 'value')) fail('missing value');
    if (!operation.path.length) {
      if (operation.op !== 'set') fail('root delete');
      result = copy(operation.value);
      continue;
    }
    let target = result;
    for (const key of operation.path.slice(0, -1)) {
      if (
        (!object(target) && !Array.isArray(target)) ||
        !own(target, key) ||
        (Array.isArray(target) && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        fail('missing path');
      target = target[key];
    }
    const key = operation.path.at(-1);
    if (Array.isArray(target)) {
      if (operation.op !== 'set' || !/^(0|[1-9][0-9]*)$/.test(key) || !own(target, key))
        fail('array path');
    } else if (!object(target)) fail('non-object path');
    if (operation.op === 'delete') {
      if (!own(target, key)) fail('missing delete');
      delete target[key];
    } else target[key] = copy(operation.value);
  }
  return copy(result);
}
export function decodeCaptureEvents(input, { indexed = false } = {}) {
  const events = [],
    gaps = [];
  const flat = [],
    bases = [],
    packets = [];
  let cachedPacket = -1,
    cachedEvents;
  // One private reconstructed context bounds retained state while forward reads
  // avoid repeatedly replaying the same validated keyframe-to-event prefix.
  let seekIndex = -1,
    seekBase = -1,
    seekContext = null;
  function readEncoded(reference) {
    if (cachedPacket !== reference.packet) {
      const packet = unpackCapturePacket(packets[reference.packet]);
      cachedEvents = packet.kind === 'capture-batch' ? packet.data.events : [packet];
      cachedPacket = reference.packet;
    }
    return cachedEvents[reference.slot];
  }
  const result = (status, error) => ({
    events,
    gaps,
    status,
    ...(error ? { error } : {}),
    ...(indexed
      ? {
          readEvent(index) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= events.length) return null;
            if (!events[index].available) return { ...events[index], context: null };
            const base = bases[index];
            const resume = seekBase === base && seekIndex >= base && seekIndex <= index;
            let context = resume ? seekContext : null;
            for (let i = resume ? seekIndex + 1 : base; i <= index; i++) {
              const event = readEncoded(flat[i]);
              context =
                event.contextFrame?.kind === 'delta'
                  ? apply(context, event.contextFrame.ops)
                  : copy(event.contextFrame?.value ?? event.context ?? null);
            }
            seekIndex = index;
            seekBase = base;
            seekContext = context;
            // Callers own returned snapshots; they must never mutate the cursor.
            return { ...events[index], context: copy(context) };
          },
        }
      : {}),
  });
  try {
    if (!Array.isArray(input) || input.length > captureStreamLimits.events) fail('event count');
    let retainedBytes = 0,
      wireBytes = 0;
    const expandedLimit = indexed
      ? captureStreamLimits.encodedBytes
      : captureStreamLimits.expandedBytes;
    for (const raw of input) {
      const stored = copy(raw);
      wireBytes += new TextEncoder().encode(JSON.stringify(stored)).byteLength;
      if (wireBytes > captureStreamLimits.wireBytes) fail('wire session byte limit');
      const packet = copy(unpackCapturePacket(stored));
      const packetIndex = packets.length;
      packets.push(stored);
      retainedBytes += new TextEncoder().encode(JSON.stringify(packet)).byteLength;
      if (retainedBytes > expandedLimit) fail('session byte limit');
      if (packet.kind === 'capture-batch') {
        if (
          packet.data?.schema !== 1 ||
          !Array.isArray(packet.data.events) ||
          packet.data.events.length < 1 ||
          packet.data.events.length > captureStreamLimits.batch
        )
          fail('batch');
        for (const [slot, event] of packet.data.events.entries()) {
          if (event.kind === 'capture-batch') fail('nested batch');
          envelope(event);
          flat.push({ seq: event.seq, packet: packetIndex, slot });
        }
      } else {
        envelope(packet);
        flat.push({ seq: packet.seq, packet: packetIndex, slot: 0 });
      }
      if (flat.length > captureStreamLimits.events) fail('expanded event count');
    }
    flat.sort((a, b) => a.seq - b.seq);
    // A producer flushes consecutive events together. Arrival order may differ,
    // but crossing packet ranges would amplify decoding with the one-packet cache.
    const visitedPackets = new Set();
    let previousPacket = -1;
    for (const reference of flat) {
      if (reference.packet !== previousPacket) {
        if (visitedPackets.has(reference.packet)) fail('interleaved packets');
        visitedPackets.add(reference.packet);
        previousPacket = reference.packet;
      }
    }
    let previousSeq = 0,
      previousTime = 0,
      context = null,
      contextSeq = null,
      ended = false,
      independent = -1;
    for (const [index, reference] of flat.entries()) {
      const event = readEncoded(reference);
      if (event.seq <= previousSeq) fail('duplicate sequence');
      if (event.seq === 1 && event.kind !== 'session-start') fail('missing session start');
      if (event.seq !== 1 && event.kind === 'session-start') fail('repeated session start');
      if (event.timeMs < previousTime) fail('backwards time');
      if (ended) fail('event after end');
      if (event.seq !== previousSeq + 1)
        gaps.push({
          fromSeq: previousSeq + 1,
          toSeq: event.seq - 1,
          fromTimeMs: previousTime,
          toTimeMs: event.timeMs,
          reason: 'missing events',
        });
      if (own(event, 'contextFrame')) {
        if (own(event, 'context')) fail('ambiguous context');
        const frame = event.contextFrame;
        if (!object(frame) || frame.schema !== 1) fail('unknown context schema');
        if (frame.kind === 'keyframe') {
          if (frame.base !== null || !own(frame, 'value')) fail('keyframe');
          independent = index;
          context = copy(frame.value);
          contextSeq = event.seq;
        } else if (frame.kind === 'delta') {
          if (index - independent > 4096) fail('review seek chain limit');
          if (
            !Number.isSafeInteger(frame.base) ||
            frame.base !== event.seq - 1 ||
            !Array.isArray(frame.ops) ||
            frame.ops.length > captureStreamLimits.operations
          )
            fail('delta predecessor');
          // Validate operations even when their base was lost. Never mask corrupt data as a gap.
          for (const op of frame.ops) {
            if (
              !object(op) ||
              !['set', 'delete'].includes(op.op) ||
              !Array.isArray(op.path) ||
              op.path.length > captureStreamLimits.depth ||
              op.path.some((key) => typeof key !== 'string' || forbidden.has(key)) ||
              (op.op === 'set' && !own(op, 'value'))
            )
              fail('operation');
          }
          if (contextSeq !== frame.base) {
            gaps.push({
              fromSeq: event.seq,
              toSeq: event.seq,
              fromTimeMs: previousTime,
              toTimeMs: event.timeMs,
              reason: 'missing context predecessor',
            });
            context = null;
            contextSeq = null;
          } else {
            context = apply(context, frame.ops);
            contextSeq = event.seq;
          }
        } else fail('unknown frame kind');
      } else {
        if (!own(event, 'context')) fail('missing context');
        independent = index;
        context = copy(event.context);
        contextSeq = event.seq;
      }
      const decodedContext = contextSeq === event.seq ? context : null;
      bases.push(independent);
      if (!indexed)
        retainedBytes += new TextEncoder().encode(JSON.stringify(decodedContext)).byteLength;
      if (retainedBytes > expandedLimit) fail('expanded session byte limit');
      const decodedEvent = indexed
        ? { ...event, available: decodedContext !== null }
        : { ...event, context: copy(decodedContext) };
      if (indexed) delete decodedEvent.context;
      delete decodedEvent.contextFrame;
      events.push(decodedEvent);
      ended = event.kind === 'session-end';
      previousSeq = event.seq;
      previousTime = event.timeMs;
    }
    return result(gaps.length ? 'gaps' : ended ? 'complete' : 'unfinished');
  } catch (error) {
    return result('invalid', error.message);
  }
}
export function deriveCaptureTimeline(decoded) {
  return {
    status: decoded.status,
    ...(decoded.error ? { error: decoded.error } : {}),
    gaps: decoded.gaps,
    durationMs: decoded.events.at(-1)?.timeMs ?? 0,
    frames: decoded.events.map(({ seq, timeMs, kind, context, available }) => ({
      seq,
      timeMs,
      kind,
      available: typeof available === 'boolean' ? available : context !== null,
    })),
  };
}

/** Validate once, retaining encoded events and seeking from independent frames only. */
export function createCaptureReviewIndex(input) {
  return decodeCaptureEvents(input, { indexed: true });
}
