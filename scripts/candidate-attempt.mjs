import { writeFileSync, readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** A candidate has one attempt writer. An abandoned lock requires inspected recovery. */
export function acquireCandidateAttempt(directory) {
  const owner = Object.freeze({
    path: join(directory, 'active-attempt'),
    attempt: randomUUID(),
    pid: process.pid,
  });
  try {
    writeFileSync(owner.path, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw Error(
        `Candidate already has an attempt lock: ${owner.path}. Inspect its owner before recovery.`,
      );
    throw error;
  }
  return owner;
}

export function releaseCandidateAttempt(owner) {
  const stat = lstatSync(owner.path);
  if (!stat.isFile() || stat.size > 4096)
    throw Error('Invalid candidate attempt lock; refusing release');
  const current = JSON.parse(readFileSync(owner.path, 'utf8'));
  if (current.attempt !== owner.attempt || current.pid !== owner.pid)
    throw Error('Candidate attempt owner changed; refusing release');
  unlinkSync(owner.path);
}

/** Terminal failure is useful evidence; a previous or unfinished report is not this attempt. */
export function requireAttemptReport(report, attempt) {
  if (!attempt || report?.attempt !== attempt)
    throw Error('Verification report belongs to a different attempt');
  if (
    !['passed', 'failed'].includes(report.status) ||
    !Number.isFinite(report.elapsedMs) ||
    report.elapsedMs < 0 ||
    !Array.isArray(report.results) ||
    !Array.isArray(report.checks)
  )
    throw Error('Verification report is incomplete');
  const outcome = report.outcome;
  const expectedAutomation = report.status === 'passed' ? 'PASS' : 'FAIL';
  if (
    outcome?.automation?.status !== expectedAutomation ||
    !(report.status === 'passed' ? [0, 2] : [1]).includes(outcome?.exitCode) ||
    !['PASS', 'BLOCKED', 'NOT_EVALUATED'].includes(outcome?.qualification?.status) ||
    (report.status === 'failed' && outcome.qualification.status === 'PASS')
  )
    throw Error('Verification report has inconsistent outcome');
  return report;
}
