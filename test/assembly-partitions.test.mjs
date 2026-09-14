import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemblyPartition } from '../scripts/assembly-scenarios.mjs';
test('assembly partitions cover each retained scenario exactly once', () => {
  const script = readFileSync(new URL('../scripts/assembly-ux-cases.mjs', import.meta.url), 'utf8');
  const names = [...script.matchAll(/await attempt\('([^']+)'/g)].map((x) => x[1]);
  assert.equal(names.length, 15);
  assert.equal(new Set(names).size, 15);
  const groups = [0, 1].map((p) => names.filter((_, i) => assemblyPartition(i) === p));
  assert.equal(groups[0].length, 8);
  assert.equal(groups[1].length, 7);
  assert.deepEqual(new Set(groups.flat()), new Set(names));
  assert.throws(() => assemblyPartition(-1));
  // Partitions stay bounded: the UX partition measured 71–89 s across retained runs and was
  // killed in teardown at 90 s, so it carries 120 s; the library partition keeps 90 s.
  const m = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
  for (const [id, timeoutMs] of [
    ['verify-assembly-ux-browser', 120000],
    ['verify-assembly-library-browser', 90000],
  ])
    assert.ok(m.browserChecks.some((c) => c.id === id && c.timeoutMs === timeoutMs));
});
