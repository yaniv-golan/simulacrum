import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewVideo, seekVideo } from '../src/presentation/capture-review-model.mjs';

const media = [
  { kind: 'screen', clip: 'a', file: 'screen-a.webm' },
  { kind: 'screen', clip: 'b', file: 'screen-b.webm' },
];
const segment = (clip, startTimeMs, endTimeMs, durationMs) => ({
  kind: 'screen-segment',
  data: { clip, startTimeMs, endTimeMs, durationMs },
});
test('segmented video maps each clip time and leaves suppressed intervals unavailable', () => {
  const video = reviewVideo([segment('a', 0, 1000, 950), segment('b', 3000, 4000, 980)], media);
  assert.deepEqual(seekVideo(video, 500), { file: 'screen-a.webm', timeSeconds: 0.475 });
  assert.equal(seekVideo(video, 2000), null);
  assert.deepEqual(seekVideo(video, 3500), { file: 'screen-b.webm', timeSeconds: 0.49 });
  assert.equal(seekVideo(video, 4000), null);
});
test('missing, overlapping, incomplete, and unsafe segments never fall back to legacy seeking', () => {
  for (const events of [
    [{ kind: 'screen-segment-start', data: { clip: 'a', startTimeMs: 0 } }],
    [segment('a', 0, 1000, 1000), segment('b', 500, 2000, 1500)],
    [segment('absent', 0, 1000, 1000)],
    [segment('a', 0, 1000, Infinity)],
  ])
    assert.equal(seekVideo(reviewVideo(events, media), 700), null);
  assert.equal(
    seekVideo(reviewVideo([segment('a', 0, 1000, 1000)], [{ ...media[0], gaps: true }]), 500),
    null,
  );
});
test('one legacy screen preserves its historical direct-time mapping', () => {
  assert.deepEqual(seekVideo(reviewVideo([], [media[0]]), 2500), {
    file: 'screen-a.webm',
    timeSeconds: 2.5,
  });
  assert.equal(seekVideo(reviewVideo([], media), 2500), null);
});
test('unknown duration leaves only its segment unavailable', () => {
  const video = reviewVideo([segment('a', 0, 1000, null), segment('b', 3000, 4000, 1000)], media);
  assert.equal(seekVideo(video, 500), null);
  assert.deepEqual(seekVideo(video, 3500), { file: 'screen-b.webm', timeSeconds: 0.5 });
});
