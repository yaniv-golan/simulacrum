import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './fixtures/assessment-fixture.mjs';

check('designated player may repeat F1 after F4 and prior F1 exposure', (f) => {
  f.record('F4', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'exposure');
  f.record('F1', 'designated-player', 'fail', '2026-09-05T02:00:00.000Z', 'prior-f1');
  const result = f.run(
    'scripts/assess.mjs',
    'F1',
    'pass',
    'designated-player',
    f.fingerprint(),
    'Observed',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
});
check('writer rejects another participant even without prior exposure', (f) => {
  const result = f.run(
    'scripts/assess.mjs',
    'F1',
    'pass',
    'another-player',
    f.fingerprint(),
    'Observed',
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /designated participant/);
});
check('reader rejects externally supplied F1 from another participant', (f) => {
  f.record('F1', 'another-player', 'pass', '2026-09-05T01:00:00.000Z');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /designated participant/);
});
check('designated player repeated pass becomes red when latest session fails', (f) => {
  f.record('F1', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F1', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'repeat');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
  f.record('F1', 'designated-player', 'fail', '2026-09-05T03:00:00.000Z', 'latest');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /assessed FAIL/);
});
check('returning designated player evidence must use current protocol', (f) => {
  f.record('F4', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'exposure');
  f.record('F1', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'f1');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
  writeFileSync(join(f.dir, 'assessments/protocol/F1.md'), 'Revised target player protocol');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contract changed/);
});
check('later valid exposure preserves designated player evidence', (f) => {
  f.record('F1', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F4', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'later');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
});
