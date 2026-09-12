import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../scripts/run-check.mjs';
test('learned policies match four fresh processes, both clocks and renamed authored identities', async () => {
  const runs = [];
  for (const [driver, rename] of [
    ['step', ''],
    ['elapsed', ''],
    ['step', 'rename'],
    ['elapsed', 'rename'],
  ]) {
    const result = await runProcess(
      process.execPath,
      ['test/fixtures/learning-run.mjs', driver, rename],
      { timeoutMs: 20000 },
    );
    assert.equal(result.code, 0, result.stderr);
    runs.push(JSON.parse(result.stdout));
  }
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  assert.ok(runs[0].duties.some((v) => Math.abs(v) > 0.1));
  assert.notEqual(runs[0].duties[0], runs[0].duties.at(-1));
  for (const r of runs) assert.deepEqual(r.hashes, runs[0].hashes);
  const wrong = structuredClone(runs[0]);
  wrong.hashes[10] = 'wrong';
  assert.notDeepEqual(wrong.hashes, runs[0].hashes);
});
