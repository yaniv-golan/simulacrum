import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const run = (driver, variant) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['test/fixtures/cord-run.mjs', driver, ...(variant ? [variant] : [])],
      { encoding: 'utf8' },
    ),
  );
test('cord projections match separate processes and both production clocks', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) => run(driver));
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  assert.equal(new Set(runs[0].hashes).size > 1, true, 'the fixture must actually move');
  for (const r of runs) assert.deepEqual(r.hashes, runs[0].hashes);
});
test('the stiffest authored corner projects identically across processes and clocks', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) => run(driver, 'corner'));
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  assert.equal(new Set(runs[0].hashes).size > 1, true, 'the corner fixture must actually move');
  for (const r of runs) assert.deepEqual(r.hashes, runs[0].hashes);
  // A different plant must not hash the same; this is the wrong trace for a
  // fixture argument that is silently ignored.
  assert.notDeepEqual(runs[0].hashes, run('step').hashes);
});
