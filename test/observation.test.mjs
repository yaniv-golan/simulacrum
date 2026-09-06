import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservationStore } from '../src/model/observation.mjs';
const frame = (tick, x = 0) => ({ tick, bodies: [{ position: { x, y: 0, z: 0 } }] });
test('observation has no mutable input or output aliases', () => {
  const initial = frame(0),
    store = createObservationStore(initial, { sessionId: 'a' });
  initial.bodies[0].position.x = 99;
  const observed = store.observe();
  assert.equal(observed.frames[0].bodies[0].position.x, 0);
  assert.throws(() => (observed.frames[0].bodies[0].position.x = 1), TypeError);
  assert.throws(() => observed.frames.push(frame(1)), TypeError);
  const next = frame(1, 2);
  store.publish(next);
  next.bodies[0].position.x = 3;
  assert.equal(store.observe().frames[0].bodies[0].position.x, 2);
});
test('paused edits advance revision and restore starts a new epoch', () => {
  const store = createObservationStore(frame(0), { sessionId: 'a' }),
    start = store.cursor();
  assert.deepEqual(start, { session: 'a', epoch: 0, revision: 0, tick: 0 });
  assert.deepEqual(store.observe('scene', 'full', start).frames, []);
  store.publish(frame(0, 1));
  assert.equal(store.cursor().revision, 1);
  assert.equal(store.observe('scene', 'full', start).frames[0].bodies[0].position.x, 1);
  store.publish(frame(1));
  const before = store.cursor();
  store.publish(frame(0), { restored: true });
  assert.deepEqual(store.cursor(), { session: 'a', epoch: 1, revision: 3, tick: 0 });
  assert.equal(store.observe('scene', 'full', before).reasonCode, 'RESYNC_REQUIRED');
});
test('deltas require exact known session epoch revision and tick and bounded window', () => {
  const store = createObservationStore(frame(0), { sessionId: 'a', maxDeltas: 2 });
  const zero = store.cursor();
  store.publish(frame(1));
  const one = store.cursor();
  store.publish(frame(2));
  assert.deepEqual(
    store.observe('scene', 'full', zero).frames.map((x) => x.tick),
    [1, 2],
  );
  store.publish(frame(3));
  for (const c of [
    zero,
    { ...one, session: 'b' },
    { ...one, revision: 9 },
    { ...one, tick: 9 },
    { tick: 1 },
    { ...one, revision: 1.1 },
    { ...one, extra: 1 },
  ]) {
    const response = store.observe('scene', 'full', c);
    assert.equal(response.ok, false);
    assert.equal(response.reasonCode, 'RESYNC_REQUIRED');
    assert.equal(response.frame.tick, 3);
  }
  assert.deepEqual(
    store.observe('scene', 'full', one).frames.map((x) => x.tick),
    [2, 3],
  );
});
test('scope and detail fail cleanly; summary reads the same snapshot', () => {
  const store = createObservationStore(frame(0), { sessionId: 'a' });
  assert.equal(store.observe('hidden').reasonCode, 'INVALID_SCOPE');
  assert.equal(store.observe('scene', 'secret').reasonCode, 'INVALID_DETAIL');
  assert.deepEqual(store.observe('scene', 'summary'), store.observe('scene', 'full'));
});
test('invalid publication is atomic and backwards ticks require restore', () => {
  const store = createObservationStore(frame(2), { sessionId: 'a' }),
    before = store.cursor();
  for (const bad of [
    frame(1),
    frame(NaN),
    { tick: 3, fn() {} },
    { tick: 3, date: new Date() },
    {
      tick: 3,
      get unsafe() {
        throw Error('getter executed');
      },
    },
  ])
    assert.throws(() => store.publish(bad));
  assert.deepEqual(store.cursor(), before);
  assert.throws(() => createObservationStore(frame(0), { sessionId: '', maxDeltas: 2 }));
  assert.throws(() => createObservationStore(frame(0), { sessionId: 'a', maxDeltas: 0 }));
});
