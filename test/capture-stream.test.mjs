import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCaptureEncoder,
  createCaptureReviewIndex,
  decodeCaptureEvents,
  deriveCaptureTimeline,
} from '../src/application/capture-stream.mjs';
const event = (
  seq,
  context = { observation: { x: seq, stable: 's'.repeat(200) }, camera: [1, 2] },
  kind = seq === 1 ? 'session-start' : 'sample',
  timeMs = seq * 100,
) => ({ id: `event-${seq}`, seq, timeMs, at: '2026-09-09T00:00:00.000Z', kind, data: {}, context });
test('capture stream round trips immutable contexts, deletes, arrays and periodic keyframes', () => {
  const encoder = createCaptureEncoder();
  const first = event(1, { a: 1, remove: true, list: [1, 2], stable: 's'.repeat(200) });
  const frames = [
    encoder.encode(first),
    encoder.encode(event(2, { a: 2, list: [3], stable: 's'.repeat(200) })),
    encoder.encode(event(3, { a: 3 }, 'session-end', 5200)),
  ];
  first.context.a = 999;
  assert.equal(frames[0].contextFrame.value.a, 1);
  assert.equal(frames[1].contextFrame.kind, 'delta');
  assert.equal(frames[2].contextFrame.kind, 'keyframe');
  const result = decodeCaptureEvents([frames[2], frames[0], frames[1]]);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.events[1].context, { a: 2, list: [3], stable: 's'.repeat(200) });
  assert.equal(deriveCaptureTimeline(result).frames.length, 3);
});
test('capture stream exposes missing predecessors, recovers at keyframe and never erases gaps', () => {
  const encoder = createCaptureEncoder();
  const frames = [1, 2, 3, 4, 5].map((seq) =>
    encoder.encode(
      event(
        seq,
        { x: seq, stable: 's'.repeat(200) },
        seq === 5 ? 'session-end' : seq === 1 ? 'session-start' : 'sample',
      ),
      { keyframe: seq === 4 },
    ),
  );
  const result = decodeCaptureEvents(frames.filter((e) => e.seq !== 2));
  assert.equal(result.status, 'gaps');
  assert.equal(result.events.find((e) => e.seq === 3).context, null);
  assert.deepEqual(result.events.find((e) => e.seq === 4).context, {
    x: 4,
    stable: 's'.repeat(200),
  });
  assert.ok(result.gaps.length);
  assert.equal(decodeCaptureEvents(frames.slice(0, 3)).status, 'unfinished');
});
test('capture stream rejects duplicate, unknown, corrupt and dangerous contexts', () => {
  const f = createCaptureEncoder().encode(event(1));
  assert.equal(decodeCaptureEvents([f, f]).status, 'invalid');
  assert.equal(
    decodeCaptureEvents([{ ...f, contextFrame: { ...f.contextFrame, schema: 99 } }]).status,
    'invalid',
  );
  assert.throws(() =>
    createCaptureEncoder().encode(event(1, JSON.parse('{"__proto__":{"polluted":true}}'))),
  );
  let deep = {};
  for (let i = 0; i < 34; i++) deep = { deep };
  assert.throws(() => createCaptureEncoder().encode(event(1, deep)));
  assert.throws(() => createCaptureEncoder().encode(event(1, { x: 'a'.repeat(2 * 1024 * 1024) })));
  const bad = {
    ...event(2),
    contextFrame: {
      schema: 1,
      kind: 'delta',
      base: 1,
      ops: [{ op: 'set', path: ['missing', 'x'], value: 1 }],
    },
  };
  delete bad.context;
  assert.equal(decodeCaptureEvents([f, bad]).status, 'invalid');
  bad.contextFrame.ops[0].path = ['__proto__', 'polluted'];
  assert.equal(decodeCaptureEvents([f, bad]).status, 'invalid');
  assert.equal({}.polluted, undefined);
});
test('capture stream supports bounded batches and legacy, rejects terminal holes and backwards time', () => {
  const encoder = createCaptureEncoder();
  const frames = [encoder.encode(event(1)), encoder.encode(event(2, {}, 'session-end'))];
  const batch = { kind: 'capture-batch', data: { schema: 1, events: frames } };
  assert.equal(decodeCaptureEvents([batch]).status, 'complete');
  assert.equal(
    decodeCaptureEvents([{ ...batch, data: { schema: 1, events: Array(129).fill(frames[0]) } }])
      .status,
    'invalid',
  );
  assert.equal(decodeCaptureEvents([event(1), event(2, {}, 'session-end')]).status, 'complete');
  assert.equal(decodeCaptureEvents([event(1), event(3, {}, 'session-end')]).status, 'gaps');
  assert.equal(decodeCaptureEvents([event(1), event(2, {}, 'session-end', 0)]).status, 'invalid');
});

test('indexed review supports 30 minutes at 10Hz without retaining expanded per-event state', () => {
  const context = { observation: { payload: 'x'.repeat(19000), tick: 0 } };
  const events = Array.from({ length: 18000 }, (_, i) => ({
    id: `e-${i + 1}`,
    seq: i + 1,
    timeMs: i * 100,
    kind: i === 0 ? 'session-start' : i === 17999 ? 'session-end' : 'state-sample',
    data: {},
    contextFrame:
      i % 50 === 0
        ? {
            schema: 1,
            kind: 'keyframe',
            base: null,
            value: { observation: { ...context.observation, tick: i } },
          }
        : {
            schema: 1,
            kind: 'delta',
            base: i,
            ops: [{ op: 'set', path: ['observation', 'tick'], value: i }],
          },
  }));
  const review = createCaptureReviewIndex(events);
  assert.equal(review.status, 'complete');
  assert.equal(review.events.length, 18000);
  assert.equal(review.readEvent(17999).context.observation.tick, 17999);
  assert.equal(review.readEvent(12001).context.observation.tick, 12001);
  assert.ok(!Object.hasOwn(review.events[12001], 'context'));
  assert.ok(JSON.stringify(review.events).length < 12 * 1024 * 1024);
});

test('indexed review preserves lost predecessors, independent recovery and corruption', () => {
  const encoder = createCaptureEncoder();
  const wire = [
    encoder.encode(event(1)),
    encoder.encode(event(2)),
    encoder.encode(event(3)),
    encoder.encode(event(4), { keyframe: true }),
  ];
  const review = createCaptureReviewIndex([wire[0], wire[2], wire[3]]);
  assert.equal(review.status, 'gaps');
  assert.equal(review.readEvent(1).context, null);
  assert.equal(review.readEvent(2).context.observation.x, 4);
  assert.equal(deriveCaptureTimeline(review).frames[1].available, false);
  assert.equal(review.readEvent(-1), null);
  assert.equal(review.readEvent(3), null);
  const corrupt = structuredClone(wire);
  corrupt[1].contextFrame = {
    schema: 1,
    kind: 'delta',
    base: 1,
    ops: [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
  };
  assert.equal(createCaptureReviewIndex(corrupt).status, 'invalid');
  assert.equal({}.polluted, undefined);
});
test('encoder bounds keyframe distance during same-time event bursts', () => {
  const encoder = createCaptureEncoder();
  let last = 0;
  for (let seq = 1; seq <= 1024; seq++) {
    const encoded = encoder.encode(
      event(seq, { stable: 'x'.repeat(1000), seq }, seq === 1 ? 'session-start' : 'sample', 0),
    );
    if (encoded.contextFrame.kind === 'keyframe') last = seq;
    assert.ok(seq - last < 256);
  }
});
