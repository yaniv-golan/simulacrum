/** Closed observation errors. All views use the same completed read model. */
export const OBSERVATION_REASON_CODES = Object.freeze([
  'RESYNC_REQUIRED',
  'INVALID_SCOPE',
  'INVALID_DETAIL',
]);

// Only nodes recursively admitted and frozen by this module may bypass copying.
// Object.isFrozen on caller data alone does not establish nested immutability.
const admittedNodes = new WeakSet();

export function immutableCopy(value) {
  const result = copyData(value, new Set());
  if (result !== null && typeof result === 'object') admittedNodes.add(result);
  return result;
}

function copyData(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new TypeError('Expected acyclic finite JSON data');
  if (admittedNodes.has(value)) return value;
  const array = Array.isArray(value);
  if (
    !array &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new TypeError('Expected plain data');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string'))
    throw new TypeError('Symbol fields are not data');
  if (array && keys.length !== value.length + 1) throw new TypeError('Expected dense array');
  const entries = [];
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!('value' in descriptor) || !descriptor.enumerable)
      throw new TypeError('Expected enumerable data fields');
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
      throw new TypeError('Unexpected array field');
    entries.push([key, copyData(descriptor.value, ancestors)]);
  }
  ancestors.delete(value);
  // Construct all data properties together, then freeze them. fromEntries also
  // preserves an own __proto__ key without invoking the prototype setter.
  return Object.freeze(array ? entries.map(([, child]) => child) : Object.fromEntries(entries));
}

/** Owns revision history, including edits that leave simulation tick unchanged. */
export function createObservationStore(initial, { sessionId, maxDeltas = 600, clock } = {}) {
  if (typeof sessionId !== 'string' || sessionId.length === 0)
    throw new TypeError('sessionId is required');
  if (!Number.isSafeInteger(maxDeltas) || maxDeltas < 1)
    throw new TypeError('maxDeltas must be positive');
  if (clock !== undefined && typeof clock !== 'function')
    throw new TypeError('clock must be a function');
  function admit(frame) {
    const copy = immutableCopy(frame);
    if (!copy || Array.isArray(copy) || !Number.isSafeInteger(copy.tick) || copy.tick < 0)
      throw new TypeError('frame.tick must be a nonnegative safe integer');
    return copy;
  }
  let current = admit(initial);
  let epoch = 0;
  let revision = 0;
  const makeCursor = () =>
    Object.freeze({ session: sessionId, epoch, revision, tick: current.tick });
  let currentCursor = makeCursor();
  let history = [{ frame: current, cursor: currentCursor }];

  return Object.freeze({
    publish(frame, { restored = false, timing } = {}) {
      if (typeof restored !== 'boolean') throw new TypeError('restored must be boolean');
      let publicationStart;
      if (timing !== undefined) {
        if (
          !clock ||
          !timing ||
          Object.keys(timing).sort().join(',') !== 'checkpointMs,phaseMs,startedAt' ||
          !Object.values(timing).every((value) => Number.isFinite(value) && value >= 0)
        )
          throw new TypeError('invalid tick timing');
        publicationStart = clock();
      }
      let next = admit(frame);
      if (!restored && next.tick < current.tick)
        throw new RangeError('Backwards tick requires restore');
      if (revision === Number.MAX_SAFE_INTEGER || (restored && epoch === Number.MAX_SAFE_INTEGER))
        throw new RangeError('Observation sequence exhausted');
      if (timing !== undefined) {
        // End after expensive frame admission; the final timing envelope and
        // cursor/history assignments below are deliberately outside this sample.
        const finishedAt = clock(),
          publicationMs = finishedAt - publicationStart;
        const totalMs = finishedAt - timing.startedAt;
        const overheadMs = totalMs - timing.phaseMs - timing.checkpointMs - publicationMs;
        if (
          ![publicationMs, totalMs, overheadMs].every(
            (value) => Number.isFinite(value) && value >= 0,
          )
        )
          throw new TypeError('invalid tick timing clock');
        // All children of next were already admitted; append only this trusted
        // diagnostic record rather than cloning the dynamic physics tree twice.
        next = Object.freeze({
          ...next,
          tickTiming: immutableCopy({
            totalMs,
            publicationMs,
            checkpointMs: timing.checkpointMs,
            phaseMs: timing.phaseMs,
            overheadMs,
          }),
        });
        admittedNodes.add(next);
      }
      current = next;
      revision += 1;
      if (restored) {
        epoch += 1;
        history = [];
      }
      currentCursor = makeCursor();
      history.push({ frame: current, cursor: currentCursor });
      if (history.length > maxDeltas + 1) history.shift();
      return currentCursor;
    },
    cursor() {
      return currentCursor;
    },
    observe(scope = 'scene', detail = 'full', cursor) {
      if (scope !== 'scene')
        return Object.freeze({ ok: false, reasonCode: 'INVALID_SCOPE', cursor: currentCursor });
      if (detail !== 'full' && detail !== 'summary')
        return Object.freeze({ ok: false, reasonCode: 'INVALID_DETAIL', cursor: currentCursor });
      if (cursor === undefined)
        return Object.freeze({ ok: true, frames: Object.freeze([current]), cursor: currentCursor });
      const exactShape =
        cursor &&
        typeof cursor === 'object' &&
        !Array.isArray(cursor) &&
        Reflect.ownKeys(cursor).length === 4 &&
        ['session', 'epoch', 'revision', 'tick'].every((key) => Object.hasOwn(cursor, key));
      const index = exactShape
        ? history.findIndex((entry) => {
            const known = entry.cursor;
            return (
              known.session === cursor.session &&
              known.epoch === cursor.epoch &&
              known.revision === cursor.revision &&
              known.tick === cursor.tick
            );
          })
        : -1;
      if (index < 0)
        return Object.freeze({
          ok: false,
          reasonCode: 'RESYNC_REQUIRED',
          frame: current,
          cursor: currentCursor,
        });
      return Object.freeze({
        ok: true,
        frames: Object.freeze(history.slice(index + 1).map((entry) => entry.frame)),
        cursor: currentCursor,
      });
    },
  });
}
