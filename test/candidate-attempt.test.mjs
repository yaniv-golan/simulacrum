import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  acquireCandidateAttempt,
  releaseCandidateAttempt,
  requireAttemptReport,
} from '../scripts/candidate-attempt.mjs';

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'candidate-attempt-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('candidate attempt excludes another process and requires its original owner to release', (t) => {
  const dir = directory(t),
    owner = acquireCandidateAttempt(dir);
  assert.equal(JSON.parse(readFileSync(owner.path)).pid, process.pid);
  const child = `import { acquireCandidateAttempt } from ${JSON.stringify(new URL('../scripts/candidate-attempt.mjs', import.meta.url).href)};
try { acquireCandidateAttempt(process.argv[1]); process.exitCode = 1; }
catch(error) { if(!error.message.includes('already has an attempt lock')) throw error; }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', child, dir]);
  assert.throws(
    () => releaseCandidateAttempt({ ...owner, attempt: 'wrong-owner' }),
    /owner changed/,
  );
  assert.throws(() => releaseCandidateAttempt({ ...owner, pid: process.pid + 1 }), /owner changed/);
  assert.equal(existsSync(owner.path), true);
  releaseCandidateAttempt(owner);
  assert.equal(existsSync(owner.path), false);
  const next = acquireCandidateAttempt(dir);
  assert.notEqual(next.attempt, owner.attempt);
  releaseCandidateAttempt(next);
});

test('candidate attempt never automatically recovers an abandoned or malformed lock', (t) => {
  const dir = directory(t),
    path = join(dir, 'active-attempt');
  for (const contents of [JSON.stringify({ pid: 2147483647, attempt: 'abandoned' }), '']) {
    writeFileSync(path, contents);
    assert.throws(() => acquireCandidateAttempt(dir), /already has an attempt lock/);
    assert.equal(readFileSync(path, 'utf8'), contents);
  }
});

const report = (status = 'passed') => ({
  attempt: 'current',
  status,
  elapsedMs: 12,
  results: [],
  checks: [],
  outcome: {
    automation: { status: status === 'passed' ? 'PASS' : 'FAIL' },
    qualification: { status: status === 'passed' ? 'NOT_EVALUATED' : 'BLOCKED' },
    exitCode: status === 'passed' ? 0 : 1,
  },
});

test('attempt reports accept current terminal outcomes and reject stale or incomplete reports', () => {
  for (const state of ['passed', 'failed']) {
    const current = report(state);
    assert.equal(requireAttemptReport(current, 'current'), current);
  }
  const pendingHuman = report();
  pendingHuman.outcome.exitCode = 2;
  pendingHuman.outcome.qualification.status = 'BLOCKED';
  assert.equal(requireAttemptReport(pendingHuman, 'current'), pendingHuman);
  assert.throws(() => requireAttemptReport(report(), 'different'), /different attempt/);
  assert.throws(
    () => requireAttemptReport({ ...report(), status: 'running' }, 'current'),
    /incomplete/,
  );
  const unfinished = report();
  delete unfinished.elapsedMs;
  assert.throws(() => requireAttemptReport(unfinished, 'current'), /incomplete/);
  const staleQualification = report('failed');
  staleQualification.outcome.qualification.status = 'PASS';
  assert.throws(() => requireAttemptReport(staleQualification, 'current'), /inconsistent/);
  const staleAutomation = report('failed');
  staleAutomation.outcome.automation.status = 'PASS';
  assert.throws(() => requireAttemptReport(staleAutomation, 'current'), /inconsistent/);
});
