import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('rope projections match separate processes and both production clocks', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) =>
    JSON.parse(
      execFileSync(process.execPath, ['test/fixtures/rope-run.mjs', driver], { encoding: 'utf8' }),
    ),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const r of runs) assert.deepEqual(r.hashes, runs[0].hashes);
});
