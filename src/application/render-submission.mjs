// Cursor-keyed CPU submission is distinct from historical two-RAF reflection.
// Neither endpoint measures GPU completion or physical display presentation.
export const RENDER_SUBMISSION_METRIC = 'cursor-keyed-render-submission-v1';
export const FIRST_TICK_METRIC = 'completed-first-tick-v1';
export const RENDER_SUBMISSION_TIMEOUT_MS = 5000;

/** Own pending reflection samples independently of whether RAF keeps firing. */
export function createRenderSubmissionTracker({
  readDraw,
  record,
  now = () => performance.now(),
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = RENDER_SUBMISSION_TIMEOUT_MS,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('Expected a positive submission timeout');
  const pending = new Set();
  let disposed = false;
  return Object.freeze({
    measure(sample, isCurrent) {
      let handle = null,
        timer = null,
        settled = false;
      const finish = (outcome, draw = null, cause) => {
        if (settled) return;
        settled = true;
        if (handle !== null) cancelFrame(handle);
        if (timer !== null) clearTimer(timer);
        pending.delete(cancel);
        record({
          ...sample,
          metric: RENDER_SUBMISSION_METRIC,
          outcome,
          ...(cause ? { cause } : {}),
          finishedAt: now(),
          completedAt: draw?.completedAt ?? null,
          reflectingCursor: draw?.cursor ?? null,
          durationMs:
            outcome === 'completed' && sample.timestampSource === 'input-event'
              ? draw.completedAt - sample.inputTime
              : null,
          superseded: outcome === 'superseded',
        });
      };
      const cancel = () => finish('cancelled', null, 'disposed');
      if (disposed) {
        cancel();
        return;
      }
      const poll = () => {
        handle = null;
        if (settled) return;
        try {
          const draw = readDraw();
          if (!draw || draw.completedAt < sample.acceptedAt) {
            handle = requestFrame(poll);
            return;
          }
          finish(isCurrent(draw.cursor) ? 'completed' : 'superseded', draw);
        } catch (error) {
          finish('failed', null, 'measurement-error');
          throw error;
        }
      };
      pending.add(cancel);
      timer = setTimer(() => finish('timeout'), timeoutMs);
      handle = requestFrame(poll);
    },
    dispose() {
      disposed = true;
      for (const cancel of [...pending]) cancel();
    },
  });
}
