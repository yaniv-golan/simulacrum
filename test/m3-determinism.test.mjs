import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePoweredRuns, runPoweredProcesses } from '../scripts/verify-m3.mjs';
test('powered trace comparator rejects deliberate altered hash', () => {
  const expected = {
    hashes: [
      { tick: 1, hash: 'a' },
      { tick: 2, hash: 'b' },
    ],
  };
  assert.doesNotThrow(() => comparePoweredRuns(expected, structuredClone(expected)));
  assert.throws(
    () =>
      comparePoweredRuns(expected, {
        hashes: [
          { tick: 1, hash: 'a' },
          { tick: 2, hash: 'wrong' },
        ],
      }),
    /divergence at tick 2/,
  );
  assert.throws(() => comparePoweredRuns(expected, { hashes: [{ tick: 1, hash: 'a' }] }), /length/);
});
test('ordinary powered assembly matches all 120 ticks across four fresh processes and both clocks', async () => {
  const runs = await runPoweredProcesses();
  assert.equal(runs.length, 4);
  assert.equal(new Set(runs.map((run) => run.pid)).size, 4);
  for (const run of runs) {
    assert.equal(run.hashes.length, 120);
    assert.ok(run.observed.maxRotorSpeed > 0);
    assert.ok(run.observed.energyUsedJ > 0);
    assert.ok(run.observed.maxTorque > 0);
  }
});
