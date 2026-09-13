import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('dynamic load-cell force and supply loss restore exactly across four processes and both production clocks', () => {
  const run = (driver, mutation) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          new URL('./fixtures/load-cell-run.mjs', import.meta.url).pathname,
          driver,
          ...(mutation ? [mutation] : []),
        ],
        { encoding: 'utf8', timeout: 20000 },
      ),
    );
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) => run(driver));
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  const compare = (actual) => assert.deepEqual(actual.hashes, runs[0].hashes);
  runs.forEach(compare);
  for (const result of runs) {
    assert.deepEqual(result.checkpointTicks, [0, 12, 35, 80]);
    assert.equal(result.depletedAt, runs[0].depletedAt);
  }
  // A real missing external impulse changes physical history. The same complete
  // projection comparison must reject it, rather than merely comparing metadata.
  const omitted = run('elapsed', 'omit-impulse');
  assert.deepEqual(omitted.hashes.slice(0, 20), runs[0].hashes.slice(0, 20));
  assert.throws(() => compare(omitted), assert.AssertionError);
});
