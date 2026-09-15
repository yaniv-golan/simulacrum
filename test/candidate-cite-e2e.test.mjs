import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/candidate-cite.mjs', import.meta.url));
const run = (scenario) => {
  const child = spawnSync(process.execPath, [fixture, scenario], { encoding: 'utf8' });
  const line = child.stdout.split('\n').find((x) => x.startsWith('CITE '));
  assert.ok(line, child.stdout + child.stderr);
  return { status: child.status, ...JSON.parse(line.slice(5)) };
};
const processesOf = (calls) => calls.filter((c) => c.kind === 'process');

test('a release final on identical bytes is recorded as the merge candidate evidence: captured and installed like a merge candidate, nothing run', () => {
  const { first, calls, installed, attemptExists } = run('identical');
  assert.equal(first.code, 0);
  assert.equal(first.report.status, 'passed');
  // Exactly one process — npm ci — and no tier; the candidate was captured and digested.
  assert.deepEqual(
    processesOf(calls).map((c) => c.args),
    [['ci', '--prefer-offline']],
  );
  assert.equal(first.report.installedDependencies, installed);
  assert.equal(first.report.tier, 'merge');
  assert.equal(first.report.priority.destinationName, 'target');
  assert.equal(first.report.priority.destination, 'resolved-target');
  assert.deepEqual(first.report.mergeReadiness, {
    basis: 'identical tree and dependencies',
    pending: false,
    satisfiedBy: {
      ...first.report.mergeReadiness.satisfiedBy,
      kind: 'release-final',
      head: 'c'.repeat(40),
      installed,
    },
  });
  assert.match(first.report.mergeReadiness.satisfiedBy.release, /\.release-private\/main-r9$/);
  assert.match(first.report.mergeReadiness.satisfiedBy.sourceJsonSha256, /^[a-f0-9]{64}$/);
  assert.match(first.report.mergeReadiness.satisfiedBy.verificationFinalSha256, /^[a-f0-9]{64}$/);
  // The tier record is a citation: no receipts, not reusable, the citation row alone.
  assert.equal(first.report.verification.citation, true);
  assert.equal(first.report.verification.reusable, false);
  assert.deepEqual(first.report.verification.checks, []);
  assert.deepEqual(
    first.report.verification.results.map((r) => [r.id, r.status]),
    [['citation', 'passed']],
  );
  assert.equal(first.report.verification.outcome.automation.status, 'PASS');
  assert.equal(first.report.qualification, 'NOT_EVALUATED');
  // Identity still checked both sides; destination drift still routed; attested.
  assert.deepEqual(calls.filter((c) => c.kind === 'identity').length, 2);
  assert.equal(
    calls.some((c) => c.kind === 'drift'),
    true,
  );
  assert.equal(first.report.destinationStillMatches, true);
  assert.match(first.report.attestation, /^[a-f0-9]{64}$/);
  assert.match(first.report.attemptReport, /attempts\/[\da-f-]{36}\/report\.json$/);
  assert.equal(attemptExists, true);
  assert.match(first.report.mergeReadiness.satisfiedBy.packageSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.report.citedBeside, undefined, 'a complete release records no window owner');
});

test('a citation is refused, with no merge readiness recorded, when a path, the dependency digest or the record itself differs, or the final was red', () => {
  const differing = run('differing');
  assert.equal(differing.first.code, 1);
  assert.equal(differing.first.report.status, 'failed');
  assert.match(
    differing.first.report.error,
    /prepared from different bytes: 1 path\(s\): src\/a\.mjs$/,
  );
  assert.equal(differing.first.report.mergeReadiness, undefined);
  assert.equal(differing.first.report.verification.results[0].status, 'failed');
  assert.deepEqual(
    processesOf(differing.calls).map((c) => c.args),
    [['ci', '--prefer-offline']],
  );
  const deps = run('deps');
  assert.equal(deps.first.code, 1);
  assert.match(deps.first.report.error, /different bytes: installed dependency digest$/);
  assert.equal(deps.first.report.mergeReadiness, undefined);
  const legacy = run('legacy');
  assert.equal(legacy.first.code, 1);
  // A release without the record is refused before any capture.
  assert.deepEqual(processesOf(legacy.calls), []);
  assert.match(
    legacy.first.report.error,
    /records no dependency digest or file inventory; nothing to compare/,
  );
  const red = run('red');
  assert.equal(red.first.code, 1);
  assert.equal(red.first.report.status, 'failed');
  assert.equal(red.first.report.error, 'release final did not pass: bar B7 unmet');
  assert.equal(red.first.report.mergeReadiness.failed, true);
  assert.equal(red.first.report.mergeReadiness.pending, false);
});

test('a running final is pending only when the slot owner says so; cite-final resolves it against the same release', () => {
  // Without --pending the citation refuses: no capture runs beside a final.
  const refused = run('pending');
  assert.equal(refused.first.code, 1);
  assert.match(
    refused.first.report.error,
    /release final .*main-r9 has not ended; cite after it ends, or pass --pending/,
  );
  // Refused before any capture: no process ran, no candidate directory was made.
  assert.deepEqual(processesOf(refused.calls), []);
  assert.equal(
    refused.calls.some((c) => c.kind === 'capture'),
    false,
  );
  assert.equal(refused.first.report.directory, undefined);
  assert.equal(refused.first.report.mergeReadiness, undefined);
  // With --pending: exit 3, merge readiness pending, the citation row pending.
  const pending = run('pending-allowed');
  assert.equal(pending.first.code, 3);
  assert.equal(pending.first.report.status, 'pending final');
  assert.equal(pending.first.report.mergeReadiness.pending, true);
  assert.equal(pending.first.report.mergeReadiness.pendingOn, 'final');
  assert.match(
    pending.first.report.mergeReadiness.satisfiedBy.verificationFinalSha256,
    /^[a-f0-9]{64}$/,
  );
  // The running final's own first report is what was read — pending, never a failure.
  assert.equal(pending.first.report.error, undefined);
  assert.ok(
    'citedBeside' in pending.first.report,
    'a pending citation records the window owner it was captured beside',
  );
  assert.deepEqual(
    pending.first.report.verification.results.map((r) => [r.id, r.status]),
    [['citation', 'pending']],
  );
  assert.equal(pending.first.report.verification.outcome.automation.status, 'PENDING');
  // The final ended green: cite-final rewrites the attempt report as passed, attested, with
  // the final's bytes pinned and `landed` recorded (null outside a repository).
  const done = run('cite-final');
  assert.equal(done.second.code, 0, done.second.stderr);
  assert.match(
    done.second.stdout,
    /merge readiness of ccccccc satisfied by release final .*main-r9, identical tree$/,
  );
  assert.equal(done.second.attempt.status, 'passed');
  assert.equal(done.second.attempt.mergeReadiness.pending, false);
  assert.match(
    done.second.attempt.mergeReadiness.satisfiedBy.verificationFinalSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(done.second.attempt.mergeReadiness.landed, null);
  assert.match(done.second.attempt.citationResolvedAt, /^\d{4}-/);
  assert.match(done.second.attempt.attestation, /^[a-f0-9]{64}$/);
  assert.equal(done.second.attempt.verification.results[0].status, 'passed');
  // The latest pointer is not the record: cite-final refuses it and the attempt stays pending.
  const pointer = run('cite-final-pointer');
  assert.equal(pointer.second.code, 1);
  assert.match(pointer.second.attempt.status, /pending final/);
  assert.equal(pointer.second.latest.status, 'failed');
  assert.match(pointer.second.latest.error, /cite-final needs the attempt report itself/);
  // The final ended red: the merge report becomes failed, carrying the failure.
  const redFinal = run('cite-final-red');
  assert.equal(redFinal.second.code, 1);
  assert.equal(redFinal.second.attempt.status, 'failed');
  assert.equal(redFinal.second.attempt.error, 'release final did not pass: bar B7 unmet');
  assert.equal(redFinal.second.attempt.verification.outcome.automation.status, 'FAIL');
});

test('citation reports are not attempts: neither resumed nor retried', () => {
  const resumed = run('resume-citation');
  assert.equal(resumed.second.code, 1);
  assert.equal(resumed.second.report.error, 'citation reports are not attempts; nothing to resume');
  const after = run('after-citation');
  assert.equal(after.second.code, 1);
  assert.equal(
    after.second.report.error,
    'citation reports are not attempts; nothing to retry or reuse',
  );
});
