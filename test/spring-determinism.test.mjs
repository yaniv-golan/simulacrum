import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('spring drop and stop projections match four processes and both production clocks', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) =>
    JSON.parse(
      execFileSync(process.execPath, ['test/fixtures/spring-run.mjs', driver], {
        encoding: 'utf8',
      }),
    ),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const run of runs) assert.deepEqual(run.hashes, runs[0].hashes);
  const wrong = structuredClone(runs[0]);
  wrong.hashes[12] = 'wrong';
  assert.notDeepEqual(wrong.hashes, runs[0].hashes);
});
