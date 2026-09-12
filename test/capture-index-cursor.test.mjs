import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCaptureEncoder,
  createCaptureReviewIndex,
  decodeCaptureEvents,
} from '../src/application/capture-stream.mjs';
const makeFrames = (count, keyframeAt) => {
  const encoder = createCaptureEncoder();
  return Array.from({ length: count }, (_, i) =>
    encoder.encode(
      {
        id: `event-${i + 1}`,
        seq: i + 1,
        timeMs: i * 10,
        kind: i === 0 ? 'session-start' : i === count - 1 ? 'session-end' : 'sample',
        data: {},
        context: { observation: { tick: i, stable: 's'.repeat(500) }, camera: [i, 2] },
      },
      { keyframe: i === keyframeAt },
    ),
  );
};
function readWork(count) {
  const review = createCaptureReviewIndex(makeFrames(count));
  assert.equal(review.status, 'complete');
  const original = TextEncoder.prototype.encode;
  let copies = 0;
  try {
    TextEncoder.prototype.encode = function (...args) {
      copies++;
      return original.apply(this, args);
    };
    for (let i = 0; i < count; i++) assert.equal(review.readEvent(i).context.observation.tick, i);
  } finally {
    TextEncoder.prototype.encode = original;
  }
  return copies;
}
test('indexed cursor preserves seek/gap/isolation semantics with linear sequential reconstruction', (t) => {
  const frames = makeFrames(24, 16);
  // A legacy independent context also starts a new seek chain.
  frames[20] = {
    ...frames[20],
    context: { observation: { tick: 20, stable: 's'.repeat(500) }, camera: [20, 2] },
  };
  delete frames[20].contextFrame;
  for (const wire of [frames, frames.filter((event) => event.seq !== 7)]) {
    const eager = decodeCaptureEvents(wire),
      review = createCaptureReviewIndex(wire);
    assert.equal(review.status, eager.status);
    assert.deepEqual(review.gaps, eager.gaps);
    const indexes = [...wire.keys(), 0, 1, 10, 5, 6, 15, 16, 17, 4, 4, 20, 21, 2];
    for (const i of indexes) {
      const observed = review.readEvent(i);
      assert.deepEqual(observed.context, eager.events[i].context);
      if (observed.context) {
        observed.context.observation.tick = -999;
        observed.context.camera.push('poison');
      }
      assert.deepEqual(review.readEvent(i).context, eager.events[i].context);
    }
    for (const invalid of [-1, wire.length, 1.5, NaN])
      assert.equal(review.readEvent(invalid), null);
    assert.deepEqual(review.readEvent(0).context, eager.events[0].context);
  }
  const small = readWork(16),
    large = readWork(32);
  t.diagnostic(`sequential context serialization work: 16=${small}, 32=${large}`);
  assert.ok(large <= small * 2.2, `doubling events repeated prefixes: ${small} -> ${large}`);
});
