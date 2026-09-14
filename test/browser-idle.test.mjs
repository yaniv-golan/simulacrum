import test from 'node:test';
import assert from 'node:assert/strict';
import { settledWindow, SEGMENTS } from '../scripts/browser-idle.mjs';

// Four reads per window: before, after each third.
const fakePage = (ticksPerRead) => {
  let reads = 0;
  const waits = [];
  return {
    evaluate: async () => ticksPerRead[Math.min(reads++, ticksPerRead.length - 1)],
    waitForTimeout: async (t) => void waits.push(t),
    waits,
  };
};

test('a settled window proves liveness when the loop ran in every third of it', async () => {
  const page = fakePage([100, 101, 102, 103]);
  const result = await settledWindow(page, 700);
  assert.deepEqual(result, { ms: 700, before: 100, after: 103, observed: 3, segments: [1, 1, 1] });
  assert.equal(SEGMENTS, 3);
  assert.deepEqual(page.waits, [233, 233, 234], 'thirds cover the whole window');
  // 13 frames in 700 ms is what the first four-worker pool run produced for exploded: a slow
  // loop, not a stalled one, so the state-settled assertions after it were proven.
  await settledWindow(fakePage([100, 104, 109, 113]), 700);
});

test('a window with a stalled third is refused rather than proving nothing changed', async () => {
  // Frames ran early, none after the two-thirds mark: a late change would not have been drawn.
  await assert.rejects(settledWindow(fakePage([100, 110, 121, 121]), 700), (error) => {
    assert.match(
      error.message,
      /renderer starved: no animation frame in third 3 of a 700 ms window \(10\/11\/0 frames\)/,
    );
    assert.equal(error.failureKind, 'renderer-starved');
    return true;
  });
  // A stall in the middle is refused too; and a wholly stalled loop.
  await assert.rejects(settledWindow(fakePage([100, 105, 105, 110]), 700), /third 2 of a 700 ms/);
  await assert.rejects(settledWindow(fakePage([7, 7, 7, 7]), 350), /third 1 of a 350 ms/);
  // A counter that went backwards (a reload) is not liveness either.
  await assert.rejects(settledWindow(fakePage([100, 101, 0, 1]), 350), /third 2/);
});
