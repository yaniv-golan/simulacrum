import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObservationStore,
  immutableCopy,
  immutableBodySample,
} from '../src/model/observation.mjs';
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

test('immutable copies preserve data keys and reject non-data descriptors', () => {
  const input = JSON.parse('{"__proto__":{"tag":"data"},"constructor":[3,{"x":4}],"0":"zero"}');
  const result = immutableCopy(input);
  assert.deepEqual(result, input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.ok(Object.hasOwn(result, '__proto__'));
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__'), {
    value: result.__proto__,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  input.__proto__.tag = 'changed';
  input.constructor[1].x = 99;
  assert.equal(result.__proto__.tag, 'data');
  assert.equal(result.constructor[1].x, 4);
  assert.ok(Object.isFrozen(result.constructor));
  assert.ok(Object.isFrozen(result.constructor[1]));
  let getterCalls = 0;
  const getter = {
    get x() {
      getterCalls++;
      return 1;
    },
  };
  for (const bad of [
    getter,
    { [Symbol('hidden')]: 1 },
    [, ,],
    Object.assign([], { extra: 1 }),
    Object.defineProperty({}, 'hidden', { value: 1 }),
  ])
    assert.throws(() => immutableCopy(bad), TypeError);
  assert.equal(getterCalls, 0);
});

test('tick attribution separates frame construction from immutable publication without double counting', () => {
  const times = [18, 23];
  const store = createObservationStore(frame(0), {
    sessionId: 'timing',
    clock: () => times.shift(),
  });
  store.publish(frame(1), { timing: { startedAt: 0, phaseMs: 10, checkpointMs: 2, frameMs: 4 } });
  assert.deepEqual(store.observe().frames[0].tickTiming, {
    totalMs: 23,
    phaseMs: 10,
    checkpointMs: 2,
    frameMs: 4,
    publicationMs: 5,
    overheadMs: 2,
  });
});

test('publication reuses admitted body trees and keeps retained observations immutable', () => {
  const bodies = immutableCopy([{ position: [1, 2, 3] }]);
  const store = createObservationStore({ tick: 0, physics: bodies }, { sessionId: 'reuse' });
  const retained = store.observe().frames[0];
  store.publish({ tick: 1, physics: bodies });
  assert.equal(store.observe().frames[0].physics, bodies);
  assert.equal(retained.physics, bodies);
  assert.throws(() => {
    retained.physics[0].position[0] = 99;
  }, TypeError);
  assert.deepEqual(retained.physics[0].position, [1, 2, 3]);
});

test('numeric body admission owns its arrays and rejects every non-finite or nonnumeric field', () => {
  const numbers = [1, 2, 3, 0, 0, 0, 1, 4, 5, 6, 7, 8, 9, 10];
  const body = immutableBodySample(...numbers);
  assert.deepEqual(body, {
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    velocity: [4, 5, 6],
    angularVelocity: [7, 8, 9],
    mass: 10,
  });
  assert.equal(immutableCopy(body), body);
  numbers[0] = 999;
  assert.equal(body.position[0], 1);
  for (const vector of [body.position, body.rotation, body.velocity, body.angularVelocity]) {
    assert.ok(Object.isFrozen(vector));
    assert.throws(() => {
      vector[0] = 999;
    }, TypeError);
  }
  assert.throws(() => {
    body.mass = 999;
  }, TypeError);
  for (let index = 0; index < 14; index++) {
    for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined, {}, []]) {
      const bad = [...numbers];
      bad[index] = invalid;
      assert.throws(() => immutableBodySample(...bad), TypeError);
    }
  }
  assert.throws(() => immutableBodySample(), TypeError);
});
