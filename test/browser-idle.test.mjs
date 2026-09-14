import test from 'node:test';
import assert from 'node:assert/strict';
import { settledWindow, liveWait, SEGMENTS } from '../scripts/browser-idle.mjs';

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

// A page whose predicate becomes true after `trueAfter` slices; loopTicks advance per read
// unless the renderer is declared stalled.
const waitingPage = ({ trueAfter, stalledFrom = Infinity, giveUpAfter = 40 }) => {
  let reads = 0,
    slices = 0;
  const timeout = Object.assign(Error('Timeout 2000ms exceeded'), { name: 'TimeoutError' });
  return {
    evaluate: async () => (reads++ < stalledFrom ? reads : stalledFrom),
    // The real slice must be forwarded (a wait without it would fall back to the page's private
    // default — the old behaviour) along with the predicate's argument; a fake that is asked
    // more than `giveUpAfter` times fails closed instead of hanging the test.
    waitForFunction: async (predicate, argument, options) => {
      assert.equal(typeof predicate, 'function');
      assert.equal(argument, 'sentinel');
      assert.deepEqual(options, { timeout: 2000 });
      if (++slices > giveUpAfter) throw Error('fake page asked too often');
      if (slices >= trueAfter) return { slices };
      throw timeout;
    },
    slices: () => slices,
  };
};

test('a live wait outlasts a private deadline while the loop ticks, and refuses a stalled one', async () => {
  // Slow but alive: true on the fourth slice (8 s at 2 s slices — beyond the old 8 s deadline).
  const slow = waitingPage({ trueAfter: 4 });
  assert.deepEqual(await liveWait(slow, () => true, 'sentinel'), { slices: 4 });
  // Stalled: no tick across a slice → renderer-starved, not a timeout.
  await assert.rejects(
    liveWait(waitingPage({ trueAfter: 99, stalledFrom: 2 }), () => true, 'sentinel'),
    (error) => {
      assert.match(error.message, /renderer starved: no animation frame in a 2000 ms wait slice/);
      assert.equal(error.failureKind, 'renderer-starved');
      return true;
    },
  );
  // Alive but the predicate never becomes true: bounded by maxMs, failing inside the check with
  // its evidence rather than by the row watchdog (which would lose the failure artifacts).
  await assert.rejects(
    liveWait(waitingPage({ trueAfter: 99 }), () => true, 'sentinel', {
      maxMs: 6000,
      label: 'duty 1',
    }),
    /duty 1 stayed false for 6000 ms \(3 slices\) while the presentation loop ticked 3 times/,
  );
  // Any other driver error passes through unchanged.
  const broken = {
    evaluate: async () => 1,
    waitForFunction: async () => {
      throw Error('Target closed');
    },
  };
  await assert.rejects(
    liveWait(broken, () => true, 'sentinel'),
    /Target closed/,
  );
});
