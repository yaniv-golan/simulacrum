import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './fixtures/assessment-fixture.mjs';
import { validateManifest } from '../scripts/validate-manifest.mjs';
const root = process.cwd();

check('valid assessment passes; newer failure supersedes it', (f) => {
  f.record('F3', 'one', 'pass', '2026-09-05T01:00:00.000Z');
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 0);
  f.record('F3', 'two', 'fail', '2026-09-05T02:00:00.000Z');
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
});
for (const timestamp of [
  'invalid',
  '2026-02-30T01:00:00.000Z',
  '2026-09-05',
  '2026-09-05T01:00:00.000Z',
])
  check('ambiguous or invalid timestamp fails closed: ' + timestamp, (f) => {
    f.record('F3', 'a', 'fail', '2026-09-05T01:00:00.000Z');
    f.record('F3', 'z', 'pass', timestamp);
    const result = f.run('scripts/bars.mjs', 'F3');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recordedAt|ambiguous/);
  });
check('missing or unreadable protocol rejects assessment reader and writer', (f) => {
  f.record('F3', 'a', 'pass', '2026-09-05T01:00:00.000Z');
  const path = join(f.dir, 'assessments/protocol/F3.md');
  rmSync(path);
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
  assert.notEqual(
    f.run('scripts/assess.mjs', 'F3', 'pass', 'b', f.fingerprint(), 'Observed').status,
    0,
  );
  mkdirSync(path);
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
});
test('manifest requires a nonempty designated F1 participant only', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json')));
  for (const participant of [undefined, '', '   ', 17]) {
    const bad = structuredClone(manifest);
    bad.bars.F1.participant = participant;
    assert.throws(() => validateManifest(bad), /F1.*participant/);
  }
  manifest.bars.F1.participant = 'designated-player';
  for (const [id, bar] of Object.entries(manifest.bars)) if (id !== 'F1') delete bar.participant;
  assert.doesNotThrow(() => validateManifest(manifest));
});
