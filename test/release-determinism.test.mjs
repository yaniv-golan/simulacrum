import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('release projection matches in independent processes, both clocks and renamed authored identities', () => {
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./contracts/release-process.mjs', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 10000 },
    ).trim();
  const expected = run('ticks');
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(run('ticks'), expected);
  assert.equal(run('elapsed'), expected);
  assert.equal(run('elapsed', 'rename'), expected);
});
