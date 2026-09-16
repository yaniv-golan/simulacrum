import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './fixtures/assessment-fixture.mjs';

check('writer records an incomplete session with its notes', (f) => {
  const result = f.run(
    'scripts/assess.mjs',
    'F1',
    'incomplete',
    'designated-player',
    f.fingerprint(),
    'left at 6 min before building; no criterion reached',
  );
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(join(f.dir, 'assessments/sessions'));
  assert.equal(files.length, 1);
  const written = JSON.parse(readFileSync(join(f.dir, 'assessments/sessions', files[0])));
  assert.equal(written.verdict, 'incomplete');
  assert.match(written.notes, /no criterion reached/);
});
check('only incomplete sessions leave the bar pending, not failed', (f) => {
  f.record('F3', 'a', 'incomplete', '2026-09-05T01:00:00.000Z');
  const result = f.run('scripts/bars.mjs', 'F3');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /incomplete/);
  assert.doesNotMatch(result.stderr, /assessed FAIL|bad verdict/);
});
check('a newer incomplete session does not demote a pass and is named beside it', (f) => {
  f.record('F3', 'a', 'pass', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F3', 'a', 'incomplete', '2026-09-05T02:00:00.000Z', 'later');
  const result = f.run('scripts/bars.mjs', 'F3');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /later session .* incomplete/);
});
check('a newer incomplete session does not clear a fail', (f) => {
  f.record('F3', 'a', 'fail', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F3', 'a', 'incomplete', '2026-09-05T02:00:00.000Z', 'later');
  const result = f.run('scripts/bars.mjs', 'F3');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /assessed FAIL/);
  assert.match(result.stderr, /later session .* incomplete/);
});
check('a later incomplete session on the current build is named beside a stale pass', (f) => {
  f.record('F3', 'a', 'pass', '2026-09-05T01:00:00.000Z', 'stale');
  const stale = join(f.dir, 'assessments/sessions/stale.json');
  const previous = JSON.parse(readFileSync(stale));
  writeFileSync(stale, JSON.stringify({ ...previous, app: 'app-0', servedBuild: 'app-0' }));
  f.record('F3', 'a', 'incomplete', '2026-09-05T02:00:00.000Z', 'later');
  const result = f.run('scripts/bars.mjs', 'F3');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence is for app-0/);
  assert.match(result.stderr, /later session .* \(app app-[0-9a-f]+\) was incomplete/);
});
check('an F1 session from another participant is rejected even when it does not govern', (f) => {
  f.record('F1', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'ok');
  f.record('F1', 'another-player', 'incomplete', '2026-09-05T02:00:00.000Z', 'foreign');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /designated participant/);
});
