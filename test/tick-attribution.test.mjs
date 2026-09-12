import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTickAttribution } from '../scripts/tick-attribution.mjs';

test('attribution shows frame and publication cost without treating variability as a pass', () => {
  const summary = summarizeTickAttribution({
    totalMs: [10, 20],
    phaseMs: [2, 2],
    checkpointMs: [0, 0],
    frameMs: [1, 1],
    publicationMs: [6, 16],
    overheadMs: [1, 1],
  });
  assert.equal(summary.meanTotalMs, 15);
  assert.equal(summary.meanMs.publicationMs, 11);
  assert.equal(summary.largestMeasuredComponent, 'publicationMs');
  assert.equal(summary.causalStatus, 'UNRESOLVED');
  assert.equal('passed' in summary, false);
});

test('attribution rejects missing costs and double counting', () => {
  assert.throws(() => summarizeTickAttribution({ totalMs: [1] }), /Incomplete/);
  assert.throws(
    () =>
      summarizeTickAttribution({
        totalMs: [1],
        phaseMs: [1],
        checkpointMs: [0],
        frameMs: [1],
        publicationMs: [0],
        overheadMs: [0],
      }),
    /reconcile/,
  );
});
