import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionRecorder, INTERACTION_STORAGE_KEY } from '../src/application/interaction-recorder.mjs';

function fixture(options = {}) {
  const entries = new Map();
  let time = 100;
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const config = { build: { id: 'test-build' }, storage, now: () => time, wallNow: () => '2026-09-05T12:00:00.000Z', idFactory: () => 'session-1', ...options };
  return { recorder: createInteractionRecorder(config), entries, storage, config, time: value => { time = value; } };
}

test('capture is explicitly started and stopped; elapsed clock never moves backwards', () => {
  const f = fixture(); const r = f.recorder;
  assert.equal(r.record('key', {}), false); assert.equal(r.snapshot(), null);
  assert.equal(r.start({ mode: 'build' }), true);
  f.time(120); assert.equal(r.record('key', { key: 'w' }, { tick: 1 }), true);
  f.time(110); assert.equal(r.record('command', { command: 'run' }), true);
  assert.deepEqual(r.snapshot().events.map(e => [e.seq, e.timeMs]), [[1, 20], [2, 20]]);
  assert.equal(r.stop({ tick: 2 }), true);
  assert.equal(r.record('key', {}), false);
  assert.equal(r.snapshot().terminationReason, 'user-stop');
  assert.deepEqual(r.snapshot().finalContext, { tick: 2 });
  assert.equal(r.snapshot().startedAt, '2026-09-05T12:00:00.000Z');
});

test('event limit closes at exact boundary without silently dropping accepted events', () => {
  const { recorder: r } = fixture({ maxEvents: 2 }); r.start();
  assert.equal(r.record('one', {}), true); assert.equal(r.state().recording, true);
  assert.equal(r.record('two', {}), true); assert.equal(r.state().recording, false);
  assert.equal(r.record('three', {}), false);
  assert.equal(r.snapshot().events.length, 2); assert.equal(r.state().reason, 'event-limit');
});

test('byte limit preserves complete prefix and bounds UTF-8 persisted and exported payload', () => {
  const f = fixture({ maxBytes: 700 }); const r = f.recorder; r.start();
  assert.equal(r.record('small', { text: 'שלום' }), true);
  assert.equal(r.record('large', { text: '🧰'.repeat(500) }), false);
  assert.equal(r.state().reason, 'byte-limit'); assert.equal(r.snapshot().events.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(r.snapshot())) <= 700);
  assert.ok(Buffer.byteLength(f.entries.get(INTERACTION_STORAGE_KEY)) <= 700);
});

test('storage errors stop capture and leave all accepted events available in memory', () => {
  const f = fixture(); const r = f.recorder; r.start();
  f.storage.setItem = () => { throw new Error('quota'); };
  assert.equal(r.record('key', { key: 'w' }), false);
  assert.equal(r.state().reason, 'storage-failure'); assert.equal(r.state().persisted, false);
  assert.equal(r.snapshot().events.length, 1); assert.match(r.state().error, /quota/);
  assert.equal(r.record('key', {}), false);
});

test('stored capture survives reload and all inputs and outputs are isolated copies', () => {
  const f = fixture(); const context = { nested: { x: 1 } }; const data = { list: [1] };
  f.recorder.start(context); f.recorder.record('pointer', data, context); f.recorder.stop(context);
  context.nested.x = 9; data.list.push(2);
  const snapshot = f.recorder.snapshot(); snapshot.events[0].data.list.push(3);
  const reloaded = createInteractionRecorder(f.config); const previous = reloaded.readLast();
  assert.deepEqual(previous.events[0].data, { list: [1] });
  previous.initialContext.nested.x = 99;
  assert.equal(reloaded.readLast().initialContext.nested.x, 1);
  assert.equal(f.recorder.snapshot().initialContext.nested.x, 1);
  assert.equal(reloaded.state().recording, false);
});

test('malformed and foreign stored documents are refused', () => {
  const f = fixture();
  for (const bad of ['{', '{}', 'null', JSON.stringify({ version: 1, events: [] })]) {
    f.entries.set(INTERACTION_STORAGE_KEY, bad); assert.equal(f.recorder.readLast(), null);
  }
  f.storage.getItem = () => { throw new Error('denied'); };
  assert.equal(f.recorder.readLast(), null);
});

test('invalid JSON values stop recording without corrupting the complete prefix', () => {
  for (const data of [{ n: NaN }, { f() {} }, { a: undefined }, { n: Infinity }, { n: 1n }]) {
    const { recorder: r } = fixture(); r.start(); r.record('good', {});
    assert.equal(r.record('bad', data), false); assert.equal(r.state().reason, 'invalid-data');
    assert.equal(r.snapshot().events.length, 1);
  }
});

test('oversized initial and final contexts cannot evade the byte bound', () => {
  const { recorder: r } = fixture({ maxBytes: 700 });
  assert.equal(r.start({ huge: 'x'.repeat(2000) }), false); assert.equal(r.snapshot(), null);
  assert.equal(r.start(), true); assert.equal(r.stop({ huge: 'x'.repeat(2000) }), false);
  assert.equal(r.state().reason, 'byte-limit'); assert.ok(Buffer.byteLength(JSON.stringify(r.snapshot())) <= 700);
});

test('byte budget accepts an event exactly at the reserved terminal boundary', () => {
  const sample = fixture(); sample.recorder.start(); sample.recorder.record('key', { key: 'w' });
  const expected = { ...sample.recorder.snapshot(), endedAt: '2026-09-05T12:00:00.000Z', status: 'stopped', terminationReason: 'storage-failure' };
  const boundary = Buffer.byteLength(JSON.stringify(expected));
  const exact = fixture({ maxBytes: boundary }); exact.recorder.start();
  assert.equal(exact.recorder.record('key', { key: 'w' }), true);
  const under = fixture({ maxBytes: boundary - 1 }); under.recorder.start();
  assert.equal(under.recorder.record('key', { key: 'w' }), false);
  assert.equal(under.recorder.state().reason, 'byte-limit');
});

test('hidden non-JSON properties are not silently omitted', () => {
  const { recorder: r } = fixture(); r.start();
  const input = Object.defineProperty({}, 'hidden', { value: () => 1 });
  assert.equal(r.record('bad', input), false);
  assert.equal(r.state().reason, 'invalid-data');
});

test('stop failure retains final context in the downloadable capture', () => {
  const f = fixture(); f.recorder.start();
  f.storage.setItem = () => { throw new Error('quota'); };
  assert.equal(f.recorder.stop({ tick: 10 }), false);
  assert.deepEqual(f.recorder.snapshot().finalContext, { tick: 10 });
});
