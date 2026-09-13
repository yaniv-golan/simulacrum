import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenderSubmissionTracker,
  RENDER_SUBMISSION_METRIC,
} from '../src/application/render-submission.mjs';
const cursor = { session: 's', epoch: 0, revision: 2, tick: 0 };
function setup() {
  let at = 10,
    draw = null,
    id = 0;
  const frames = new Map(),
    timers = new Map(),
    records = [];
  const tracker = createRenderSubmissionTracker({
    readDraw: () => draw,
    now: () => at,
    requestFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    setTimer: (fn, delay) => {
      timers.set(++id, { fn, due: at + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    record: (row) => records.push(row),
    timeoutMs: 50,
  });
  return {
    tracker,
    records,
    frames,
    timers,
    setDraw: (value) => {
      draw = value;
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const fn of callbacks) fn();
    },
    time(value) {
      at = value;
      for (const [key, timer] of [...timers])
        if (timer.due <= at) {
          timers.delete(key);
          timer.fn();
        }
    },
    sample: {
      kind: 'place',
      inputTime: 5,
      acceptedAt: 10,
      timestampSource: 'input-event',
      targetCursor: cursor,
    },
    matches: (c) =>
      c.session === cursor.session && c.epoch === cursor.epoch && c.revision === cursor.revision,
  };
}
test('submission metrics identify their endpoint and ignore an older completed draw', () => {
  const h = setup();
  h.tracker.measure(h.sample, h.matches);
  h.setDraw({ cursor, completedAt: 9 });
  h.frame();
  assert.equal(h.records.length, 0);
  h.setDraw({ cursor, completedAt: 20 });
  h.time(20);
  h.frame();
  assert.equal(h.records[0].metric, RENDER_SUBMISSION_METRIC);
  assert.equal(h.records[0].outcome, 'completed');
  assert.equal(h.records[0].durationMs, 15);
  assert.equal(h.records[0].completedAt, 20);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});
test('a never-drawing or hidden window records one bounded incomplete sample and cancels its RAF', () => {
  const h = setup();
  h.tracker.measure(h.sample, h.matches);
  h.time(60);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].outcome, 'timeout');
  assert.equal(h.records[0].durationMs, null);
  assert.equal(h.records[0].completedAt, null);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  h.setDraw({ cursor, completedAt: 70 });
  h.time(70);
  h.frame();
  assert.equal(h.records.length, 1);
});
test('dispose records cancellation of every pending measurement and clears timers and frames', () => {
  const h = setup();
  h.tracker.measure(h.sample, h.matches);
  h.tracker.measure({ ...h.sample, kind: 'connect' }, h.matches);
  h.tracker.dispose();
  h.tracker.dispose();
  assert.equal(h.records.length, 2);
  assert.ok(
    h.records.every(
      (r) => r.outcome === 'cancelled' && r.cause === 'disposed' && r.durationMs === null,
    ),
  );
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  h.time(100);
  h.frame();
  assert.equal(h.records.length, 2);
});
test('a wrong cursor remains an explicit superseded sample, never successful latency', () => {
  const h = setup();
  h.tracker.measure(h.sample, h.matches);
  h.setDraw({ cursor: { ...cursor, epoch: 1 }, completedAt: 20 });
  h.frame();
  assert.equal(h.records[0].outcome, 'superseded');
  assert.equal(h.records[0].superseded, true);
  assert.equal(h.records[0].durationMs, null);
  assert.equal(h.timers.size, 0);
});
test('a callback-triggered draw is recorded but cannot manufacture input latency', () => {
  const h = setup();
  h.tracker.measure({ ...h.sample, timestampSource: 'callback' }, h.matches);
  h.setDraw({ cursor, completedAt: 20 });
  h.frame();
  assert.equal(h.records[0].durationMs, null);
});
