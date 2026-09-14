import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/candidate-after.mjs', import.meta.url));
function run(args, env = {}) {
  const child = spawnSync(process.execPath, [fixture, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  const line = child.stdout.split('\n').find((l) => l.startsWith('TRANSPORT '));
  assert.ok(line, child.stdout + child.stderr);
  return { status: child.status, ...JSON.parse(line.slice(10)), stderr: child.stderr };
}
const receipt = (report, id) => report.verification.checks.find((r) => r.id === id);
const cleanup = (t, ...results) =>
  t.after(() => {
    for (const r of results) {
      if (r?.root) rmSync(r.root, { recursive: true, force: true });
      if (r?.report?.directory) rmSync(r.report.directory, { recursive: true, force: true });
    }
  });

test('a hand-supplied file list never reaches a candidate or a tier', (t) => {
  // Blocker from review: `verify:candidate -- local --changed-files README.md` used to narrow
  // a plain run to documentation scope and report plain passed. It is refused before capture.
  const plain = run(['first', 'new', '', 'x=pass', '--arg=--changed-files', '--arg=README.md']);
  cleanup(t, plain);
  assert.equal(plain.status, 1);
  assert.equal(plain.report.status, 'failed');
  assert.match(plain.report.error, /Usage/);
  assert.equal(plain.report.after, undefined);
  assert.equal(
    plain.calls.some((c) => c.kind === 'capture' || c.kind === 'process'),
    false,
    'nothing captured or ran',
  );
});

test('a diagnosed retry reuses the failed attempt on identical bytes, re-executes the failure and its controls, and never reports plain green', (t) => {
  const first = run(['first', 'new', '', 'x=fail']);
  cleanup(t, first);
  assert.equal(first.status, 1);
  assert.equal(first.report.status, 'failed');
  assert.equal(receipt(first.report, 'browser:x').ok, false);
  assert.equal(receipt(first.report, 'browser:y').ok, true);
  assert.equal(receipt(first.report, 'unit:test/a.test.mjs').ok, true);
  const parent = first.report.attemptReport;

  // A cause that names a passing leaf is refused before anything runs, and the report says so.
  const bad = run(['after', first.root, parent, 'x=pass', '--cause=browser:perf=not the failure']);
  assert.equal(bad.status, 1);
  assert.equal(bad.report.status, 'failed');
  assert.match(bad.report.error, /browser:x|browser:perf/);
  assert.equal(
    bad.calls.some((c) => c.kind === 'process'),
    false,
    'no process ran',
  );
  // The chain is on the report before capture, so even a refused retry names its parent.
  assert.deepEqual(bad.report.after.chain, [first.report.attempt]);

  // A parent report edited after the candidate wrote it is refused before anything is read
  // from it: the coverage and classification a retry trusts come only from attested reports.
  const forged = JSON.parse(readFileSync(parent, 'utf8'));
  forged.verification.checks.push({ id: 'browser:perf', configuration: {}, ok: true });
  // (written beside the candidate, not into the origin tree, so the source bytes stay equal)
  const forgedPath = join(first.report.directory, 'forged-report.json');
  writeFileSync(forgedPath, JSON.stringify(forged, null, 2));
  const tampered = run(['after', first.root, forgedPath, 'x=pass', '--cause=browser:x=late']);
  assert.equal(tampered.status, 1);
  assert.match(tampered.report.error, /attestation does not match/);
  assert.equal(
    tampered.calls.some((c) => c.kind === 'process'),
    false,
  );
  assert.equal(typeof first.report.attestation, 'string');

  // The retry must repeat the parent's scope as the commits its refs name now: another ref, or
  // the same ref after it moved, is refused before capture rather than silently re-pinned.
  for (const flags of [['base=HEAD~2'], ['moved=yes']]) {
    const scoped = run(['after', first.root, parent, 'x=pass', ...flags, '--cause=browser:x=late']);
    assert.equal(scoped.status, 1, flags.join());
    assert.match(scoped.report.error, /must repeat the parent attempt's --base/);
    assert.equal(
      scoped.calls.some((c) => c.kind === 'capture' || c.kind === 'process'),
      false,
      flags.join(),
    );
  }

  // Qualification never retries.
  const final = run([
    'after',
    first.root,
    parent,
    'x=pass',
    'tier=final',
    '--cause=browser:x=late',
  ]);
  assert.equal(final.status, 1);
  assert.match(final.report.error, /final/);

  // Same bytes: the passing unit and browser leaves are reused with their origin; the failure,
  // its control and every timing-sensitive or structural leaf execute; the status is distinct
  // from plain passed and the tier saw no file list at all.
  const retry = run([
    'after',
    first.root,
    parent,
    'x=pass',
    '--cause=browser:x=late pause landed after the load fell',
  ]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.report.status, 'passed after failure');
  assert.equal(retry.report.directory, first.report.directory, 'same candidate directory');
  assert.equal(retry.report.after.mode, 'same-bytes');
  assert.equal(retry.report.after.deltaSelection, undefined);
  assert.deepEqual(retry.report.after.sameBytes, {
    sameSource: true,
    sameDependencies: true,
    sameIdentity: true,
  });
  const origin = { attempt: first.report.attempt, report: first.report.attemptReport, depth: 1 };
  assert.deepEqual(receipt(retry.report, 'unit:test/a.test.mjs').origin, origin);
  assert.deepEqual(receipt(retry.report, 'browser:y').origin, origin);
  assert.deepEqual(retry.report.after.reused, [
    { id: 'browser:y', origin },
    { id: 'unit:test/a.test.mjs', origin },
  ]);
  const executed = retry.report.verification.executed;
  for (const id of [
    'browser:x',
    'unit:test/geometry.test.mjs',
    'browser:perf',
    'build:browser',
    'check:layers',
    'ci:budget',
  ])
    assert.ok(executed.includes(id), `${id} executed`);
  assert.equal(executed.includes('unit:test/a.test.mjs'), false);
  assert.equal(executed.includes('browser:y'), false);
  assert.deepEqual(retry.report.verification.retrySelection, {
    changedFiles: null,
    required: ['x'],
    covered: ['y'],
  });
  assert.equal(retry.report.verification.argv.includes('--changed-files'), false);
  assert.ok(retry.report.after.reexecuted.includes('browser:x'));
  assert.ok(retry.report.after.reexecuted.includes('unit:test/geometry.test.mjs'));
  assert.deepEqual(retry.report.after.required, ['browser:x', 'unit:test/geometry.test.mjs']);
  assert.ok(retry.report.after.controls.includes('unit:test/geometry.test.mjs'));
  assert.ok(retry.report.after.alwaysFresh.includes('build:browser'));
  assert.ok(retry.report.after.alwaysFresh.includes('check:layers'));
  assert.deepEqual(retry.report.after.notSelected, []);
  assert.equal(retry.report.after.causes['browser:x'], 'late pause landed after the load fell');
  assert.deepEqual(retry.report.after.chain, [first.report.attempt]);
  assert.equal(receipt(retry.report, 'ci:budget').ok, true, 'a non-process leaf still completes');

  // A retry whose child never observed the failed leaf executing cannot pass after failure.
  const omitted = run([
    'after',
    first.root,
    parent,
    'x=pass',
    'omit=browser:x',
    '--cause=browser:x=late pause',
  ]);
  assert.equal(omitted.status, 1);
  assert.equal(omitted.report.status, 'failed');
  assert.match(omitted.report.error, /browser:x/);
});

test('a source-only delta narrows through the ledger and records what it skipped; any identity or dependency change runs the fresh policy', (t) => {
  const first = run(['first', 'new', '', 'x=fail']);
  cleanup(t, first);
  assert.equal(first.report.status, 'failed');
  const parent = first.report.attemptReport;

  // Only source differs: fresh capture, no receipt loads, the byte delta reaches the tier's
  // selection through the ledger (never argv), the required failure re-executes, every check
  // the fresh policy selects and the parent never passed runs, and the one reusable browser
  // pass the delta does not reach is named as skipped, not evidence.
  const delta = run([
    'after',
    first.root,
    parent,
    'x=pass',
    'touch=src.mjs',
    '--cause=browser:x=late pause',
  ]);
  cleanup(t, delta);
  assert.equal(delta.status, 0, delta.stderr);
  assert.equal(delta.report.status, 'passed after failure');
  assert.equal(delta.report.after.mode, 'delta');
  assert.equal(delta.report.after.deltaSelection, 'source-only');
  assert.notEqual(delta.report.directory, first.report.directory);
  assert.deepEqual(delta.report.after.delta, ['src.mjs']);
  assert.deepEqual(delta.report.verification.retrySelection, {
    changedFiles: ['src.mjs'],
    required: ['x'],
    covered: ['y'],
  });
  assert.deepEqual(delta.report.verification.selection, {
    checks: ['x', 'perf'],
    skippedByDelta: ['y'],
  });
  assert.equal(delta.report.verification.argv.includes('--changed-files'), false);
  assert.equal(
    delta.report.verification.checks.some((r) => r.resumed),
    false,
  );
  assert.deepEqual(delta.report.after.reused, []);
  assert.deepEqual(delta.report.after.skippedByDelta, [
    { id: 'browser:y', parentAttempt: first.report.attempt },
  ]);
  assert.ok(delta.report.after.reexecuted.includes('browser:x'));
  assert.deepEqual(delta.report.after.covered, ['browser:y']);
  assert.deepEqual(delta.report.after.notSelected, []);
  // perf never ran in the parent (the suite aborted at x): no receipt covers it, so the fresh
  // policy's selection of it stands even though the delta does not reach it.
  assert.ok(delta.report.verification.executed.includes('browser:perf'), 'perf executed');
  assert.equal(delta.report.verification.executed.includes('browser:y'), false, 'y skipped');

  // Counterexample from review: the developer edits one file and also changes the relevant
  // environment (a runtime upgrade behaves the same). Every parent browser pass is stale, so
  // the tier runs its ordinary selection, nothing is skipped and nothing is reused.
  const fresh = run(
    ['after', first.root, parent, 'x=pass', 'touch=src.mjs', '--cause=browser:x=late pause'],
    { PLAYTEST_RETRY_PROBE: 'changed-environment' },
  );
  cleanup(t, fresh);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.report.status, 'passed');
  assert.equal(fresh.report.after.mode, 'delta');
  assert.equal(fresh.report.after.deltaSelection, 'fresh-policy');
  assert.equal(fresh.report.after.sameBytes.sameIdentity, false);
  assert.deepEqual(fresh.report.verification.retrySelection, {
    changedFiles: null,
    required: ['x'],
    covered: ['y'],
  });
  assert.deepEqual(fresh.report.after.skippedByDelta, []);
  assert.deepEqual(fresh.report.after.reused, []);
  for (const id of ['browser:y', 'browser:x', 'browser:perf'])
    assert.ok(fresh.report.verification.executed.includes(id), `${id} executed under fresh policy`);
});

test('a source-only delta after a parent with no browser coverage runs every check the fresh policy selects', (t) => {
  // Blocker from the third review: the parent failed in CI, its browser phase never ran, the
  // developer fixed the test only. Nothing is covered, so nothing may be skipped and the retry
  // must run the full fresh browser selection rather than the delta's empty scope.
  const first = run(['first', 'new', '', 'x=pass', 'unit=fail']);
  cleanup(t, first);
  assert.equal(first.status, 1);
  assert.equal(first.report.status, 'failed');
  assert.equal(receipt(first.report, 'unit:test/a.test.mjs').ok, false);
  assert.equal(receipt(first.report, 'ci:budget').ok, false);
  assert.equal(
    first.report.verification.checks.some((r) => r.id.startsWith('browser:')),
    false,
    'no browser receipt in the parent',
  );
  const retry = run([
    'after',
    first.root,
    first.report.attemptReport,
    'x=pass',
    'touch=src.mjs',
    '--cause=unit:test/a.test.mjs=the assertion was wrong',
    '--cause=ci:budget=aborted by the unit failure',
  ]);
  cleanup(t, retry);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.report.after.mode, 'delta');
  assert.equal(retry.report.after.deltaSelection, 'source-only');
  assert.deepEqual(retry.report.after.delta, ['src.mjs']);
  assert.deepEqual(retry.report.verification.retrySelection, {
    changedFiles: ['src.mjs'],
    required: [],
    covered: [],
  });
  assert.deepEqual(retry.report.verification.selection, {
    checks: ['y', 'x', 'perf'],
    skippedByDelta: [],
  });
  for (const id of ['browser:y', 'browser:x', 'browser:perf', 'unit:test/a.test.mjs', 'ci:budget'])
    assert.ok(retry.report.verification.executed.includes(id), `${id} executed`);
  assert.deepEqual(retry.report.after.skippedByDelta, []);
  assert.deepEqual(retry.report.after.covered, []);
  assert.deepEqual(retry.report.after.reused, []);
  assert.equal(retry.report.status, 'passed');
});

test('an attempt that failed around a green tier needs the candidate cause, and a retry that dies after capture keeps its chain', (t) => {
  // The tier passes, then the frozen clone drifts: a candidate-level failure with no failed leaf.
  const drifted = run(['first', 'new', '', 'x=pass', 'drift=yes']);
  cleanup(t, drifted);
  assert.equal(drifted.status, 1);
  assert.equal(drifted.report.status, 'failed');
  assert.match(drifted.report.error, /Candidate changed during verification/);
  assert.equal(drifted.report.verification.status, 'passed');
  const parent = drifted.report.attemptReport;

  // Cause-less retry refused: there is nothing diagnosed to retry on.
  const silent = run(['after', drifted.root, parent, 'x=pass']);
  assert.equal(silent.status, 1);
  assert.match(silent.report.error, /--cause candidate=/);
  assert.equal(
    silent.calls.some((c) => c.kind === 'process'),
    false,
  );

  // With the candidate cause the retry proceeds on the same bytes, reusing the green leaves.
  const retry = run([
    'after',
    drifted.root,
    parent,
    'x=pass',
    '--cause=candidate=a stray editor save into the clone',
  ]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.report.status, 'passed after failure');
  assert.deepEqual(retry.report.after.coverage.candidate, {
    aggregate: false,
    covers: [],
    candidateFailure: 'Candidate changed during verification',
  });
  assert.deepEqual(retry.report.after.chain, [drifted.report.attempt]);

  // A retry that itself dies after capture still carries the chain it extended, so a further
  // --after cannot restart the count.
  const dying = run([
    'after',
    drifted.root,
    parent,
    'x=pass',
    'drift=yes',
    '--cause=candidate=stray save',
  ]);
  assert.equal(dying.status, 1);
  assert.match(dying.report.error, /Candidate changed during verification/);
  assert.deepEqual(dying.report.after.chain, [drifted.report.attempt]);
  const third = run([
    'after',
    drifted.root,
    dying.report.attemptReport,
    'x=pass',
    '--cause=candidate=stray save, again',
  ]);
  assert.equal(third.status, 0, third.stderr);
  assert.deepEqual(third.report.after.chain, [drifted.report.attempt, dying.report.attempt]);
  // A plain resume of a retry report would drop the chain; it is refused in favour of --after.
  const resumed = run(['resume', drifted.root, dying.report.attemptReport]);
  assert.equal(resumed.status, 1);
  assert.match(resumed.report.error, /resume cannot continue a diagnosed retry/);
  assert.equal(
    resumed.calls.some((c) => c.kind === 'process' || c.kind === 'capture'),
    false,
  );
});
