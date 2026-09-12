import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function configuredCache(value) {
  const env = { ...process.env };
  delete env.SIMULACRUM_VITE_CACHE_DIR;
  if (value !== undefined) env.SIMULACRUM_VITE_CACHE_DIR = value;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import config from './vite.config.mjs'; console.log(JSON.stringify(config.cacheDir ?? null))"], { env, encoding: 'utf8' }));
}
test('candidate Vite cache redirects only when explicitly configured', () => {
  assert.equal(configuredCache(undefined), null);
  assert.equal(configuredCache('/tmp/candidate-artifacts/vite-cache'), '/tmp/candidate-artifacts/vite-cache');
});
