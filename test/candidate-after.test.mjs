import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAfterArgs,
  classifyParentLeaves,
  validateCauses,
  reexecutionSet,
  afterMode,
  deltaSelection,
  afterSummary,
  validateAfterReport,
  CHAIN_DEPTH_LIMIT,
  CANDIDATE_CAUSE,
  reusableLeaf,
  requiredReexecution,
  withRequiredChecks,
  resolveRetrySelection,
  attestReport,
  verifyAttestation,
  reusableAcrossCandidates,
  reuseSet,
  reuseSummary,
  validateReuseReport,
  REUSE_TIERS,
} from '../scripts/candidate-after.mjs';
import { readFileSync } from 'node:fs';

const manifest = {
  browserChecks: [
    { id: 'ball', script: 'scripts/ball.mjs', tier: 'browser' },
    { id: 'spring-perf', script: 'scripts/spring.mjs', tier: 'performance', timingSensitive: true },
    { id: 'audio', script: 'scripts/audio.mjs', tier: 'browser', timingSensitive: true },
    { id: 'mirror', script: 'scripts/mirror.mjs', tier: 'browser' },
    { id: 'smoke', script: 'scripts/smoke.mjs', tier: 'browser', mergeSmoke: true },
    { id: 'hosted', script: 'scripts/hosted.mjs', tier: 'browser', environment: 'self' },
    { id: 'probe', script: 'scripts/probe.mjs', tier: 'browser', environment: 'probe' },
  ],
  checks: [{ id: 'layers' }, { id: 'invariant-controls' }],
  invariants: [
    {
      id: 'geometry',
      checks: ['ball'],
      controls: {
        positive: [{ path: 'test/geometry.test.mjs' }],
        negative: [{ path: 'test/geometry-wrong.test.mjs' }],
      },
    },
    {
      id: 'mirror-truth',
      checks: ['mirror', 'layers'],
      controls: { positive: [{ path: 'test/mirror.test.mjs' }], negative: [] },
    },
  ],
};
const receipt = (id, ok, extra = {}) => ({ id, configuration: { id }, ok, ...extra });
function parent(overrides = {}) {
  return {
    status: 'failed',
    attempt: '11111111-1111-4111-8111-111111111111',
    attemptReport: '/tmp/parent/attempts/1/report.json',
    directory: '/tmp/parent',
    candidate: { files: { 'a.mjs': { sha256: 'a' } } },
    installedDependencies: 'deps',
    verification: {
      status: 'failed',
      runtime: 'v24.18.0',
      platform: 'darwin',
      arch: 'arm64',
      environmentDigest: 'relevant',
      results: [
        { id: 'ci', status: 'passed' },
        { id: 'selection', status: 'passed' },
        { id: 'browser', status: 'failed' },
      ],
      checks: [
        receipt('check:layers', true),
        receipt('unit:test/geometry.test.mjs', true),
        receipt('unit:test/mirror.test.mjs', true),
        receipt('unit:test/other.test.mjs', true),
        receipt('build:browser', true),
        receipt('browser:ball', false, { error: 'assertion' }),
        receipt('browser:spring-perf', true),
        receipt('browser:audio', true),
        receipt('browser:mirror', true),
        receipt('browser:smoke', true),
      ],
    },
    ...overrides,
  };
}

test('after arguments are separated from tier arguments and refused alongside resume', () => {
  const parsed = parseAfterArgs([
    'merge',
    '--base',
    'abc',
    '--after',
    'report.json',
    '--cause',
    'browser:ball=late pause landed after the load fell',
    '--cause',
    'ci=unit timeouts under host contention',
  ]);
  assert.deepEqual(parsed.rest, ['merge', '--base', 'abc']);
  assert.equal(parsed.after, 'report.json');
  assert.deepEqual(
    [...parsed.causes],
    [
      ['browser:ball', 'late pause landed after the load fell'],
      ['ci', 'unit timeouts under host contention'],
    ],
  );
  assert.equal(parseAfterArgs(['local']).after, null);
  assert.throws(() => parseAfterArgs(['resume', 'r.json', '--after', 'x']), /resume/);
  assert.throws(() => parseAfterArgs(['local', '--after']), /--after/);
  assert.throws(() => parseAfterArgs(['local', '--after', 'x', '--cause', 'noequals']), /cause/);
  assert.throws(() => parseAfterArgs(['local', '--after', 'x', '--cause', 'ci=']), /cause/);
  assert.throws(() => parseAfterArgs(['local', '--cause', 'ci=text']), /--after/);
  // Qualification evidence is always a fresh full run.
  assert.throws(() => parseAfterArgs(['final', '--after', 'x', '--cause', 'ci=text']), /final/);
  assert.doesNotThrow(() => parseAfterArgs(['final']));
});

test('parent leaves classify into passing, failed, unexecuted and aborted aggregates', () => {
  const p = parent();
  p.verification.checks.push(
    receipt('ci:budget', false, { unexecuted: ['test/late.test.mjs', 'test/later.test.mjs'] }),
  );
  p.verification.results[0].status = 'failed';
  const c = classifyParentLeaves(p);
  assert.deepEqual(c.failed, ['browser:ball', 'ci:budget']);
  assert.deepEqual(c.unexecuted, ['unit:test/late.test.mjs', 'unit:test/later.test.mjs']);
  assert.deepEqual(c.abortedAggregates, ['browser', 'ci']);
  assert.deepEqual(
    c.passing.map((r) => r.id),
    [
      'check:layers',
      'unit:test/geometry.test.mjs',
      'unit:test/mirror.test.mjs',
      'unit:test/other.test.mjs',
      'build:browser',
      'browser:spring-perf',
      'browser:audio',
      'browser:mirror',
      'browser:smoke',
    ],
  );
  assert.equal(c.candidateFailure, null);
  assert.throws(() => classifyParentLeaves({ ...p, status: 'passed' }), /failed/);
  // Only a failed parent is retried; a chained passed-after-failure report has nothing to retry.
  assert.throws(() => classifyParentLeaves({ ...p, status: 'passed after failure' }), /failed/);
  // A parent that died before its tier completed carries no receipts to retry from.
  assert.throws(() => classifyParentLeaves({ ...p, verification: undefined }), /fresh candidate/);
  // A candidate-level failure around the tier is classified as its own cause target.
  assert.equal(
    classifyParentLeaves({ ...p, error: 'Candidate changed during verification' }).candidateFailure,
    'Candidate changed during verification',
  );
});

test('every failed or unexecuted leaf needs its own cause; an aborted aggregate covers absent leaves', () => {
  const p = parent();
  p.verification.checks.push(receipt('ci:budget', false, { unexecuted: ['test/late.test.mjs'] }));
  const c = classifyParentLeaves(p);
  assert.throws(() => validateCauses(c, new Map([['browser:ball', 'x']])), /ci:budget/);
  // A cause on the aggregate that listed the unexecuted files covers them and names them.
  assert.deepEqual(
    validateCauses(
      c,
      new Map([
        ['browser:ball', 'x'],
        ['ci:budget', 'y'],
      ]),
    )['ci:budget'],
    { aggregate: true, covers: ['unit:test/late.test.mjs'] },
  );
  assert.throws(
    () =>
      validateCauses(
        c,
        new Map([
          ['browser:ball', 'x'],
          ['ci:budget', 'y'],
          ['unit:test/late.test.mjs', 'z'],
          ['browser:mirror', 'passed leaf'],
        ]),
      ),
    /browser:mirror/,
  );
  const coverage = validateCauses(
    c,
    new Map([
      ['browser:ball', 'late pause'],
      ['ci:budget', 'budget expired under load'],
      ['unit:test/late.test.mjs', 'never admitted'],
      ['browser', 'suite aborted after ball'],
    ]),
  );
  assert.deepEqual(coverage.browser, { aggregate: true, covers: [] });
  assert.deepEqual(coverage['browser:ball'], { aggregate: false, covers: ['browser:ball'] });
  // A parent that failed around the tier with every leaf green needs the candidate cause, and
  // a cause-less retry of such a parent is refused rather than admitted with nothing to say.
  const drifted = parent({ error: 'Candidate changed during verification' });
  drifted.verification.status = 'passed';
  drifted.verification.results[2].status = 'passed';
  drifted.verification.checks.find((x) => x.id === 'browser:ball').ok = true;
  const dc = classifyParentLeaves(drifted);
  assert.throws(() => validateCauses(dc, new Map()), /--cause candidate=/);
  assert.deepEqual(validateCauses(dc, new Map([[CANDIDATE_CAUSE, 'a stray editor save']])), {
    candidate: {
      aggregate: false,
      covers: [],
      candidateFailure: 'Candidate changed during verification',
    },
  });
  // The candidate cause is refused when the parent reported no candidate failure, and a parent
  // with nothing failed at all is not a retry target.
  assert.throws(
    () =>
      validateCauses(
        c,
        new Map([
          ['browser:ball', 'x'],
          [CANDIDATE_CAUSE, 'y'],
        ]),
      ),
    /candidate failure/,
  );
  const green = parent();
  green.verification.checks.find((x) => x.id === 'browser:ball').ok = true;
  assert.throws(() => validateCauses(classifyParentLeaves(green), new Map()), /nothing to retry/);
  // Both kinds of failure in one parent need both kinds of cause.
  const both = parent({ error: 'Installed dependencies changed during verification' });
  assert.throws(
    () => validateCauses(classifyParentLeaves(both), new Map([['browser:ball', 'x']])),
    /--cause candidate=/,
  );
  // Chain depth is refused before anything runs.
  const deep = parent({ after: { chain: Array(CHAIN_DEPTH_LIMIT).fill(parent().attempt) } });
  assert.throws(() => classifyParentLeaves(deep), /chain/);
});

test('reexecution covers non-pass leaves, their registered controls and every always-fresh class', () => {
  const p = parent();
  const c = classifyParentLeaves(p);
  const r = reexecutionSet({ classification: c, manifest });
  // the failed browser check, its invariant's controls, and the structural/always-fresh classes
  for (const id of [
    'browser:ball',
    'unit:test/geometry.test.mjs',
    'unit:test/geometry-wrong.test.mjs',
    'browser:spring-perf',
    'browser:audio',
    'check:layers',
    'build:browser',
  ])
    assert.ok(r.has(id), id);
  assert.equal(r.has('browser:mirror'), false);
  assert.equal(r.has('unit:test/mirror.test.mjs'), false);
  assert.equal(r.has('unit:test/other.test.mjs'), false);
  // a failed unit control re-executes the checks of the invariants it controls
  const q = parent();
  q.verification.checks.find((x) => x.id === 'unit:test/mirror.test.mjs').ok = false;
  q.verification.checks.find((x) => x.id === 'browser:ball').ok = true;
  const r2 = reexecutionSet({ classification: classifyParentLeaves(q), manifest });
  assert.ok(r2.has('browser:mirror'));
  assert.ok(r2.has('check:layers'));
  assert.equal(r2.has('browser:ball'), false);
  // A failed structural check pulls the controls of the invariants it guards.
  const q2 = parent();
  q2.verification.checks.find((x) => x.id === 'check:layers').ok = false;
  q2.verification.checks.find((x) => x.id === 'browser:ball').ok = true;
  assert.ok(
    reexecutionSet({ classification: classifyParentLeaves(q2), manifest }).has(
      'unit:test/mirror.test.mjs',
    ),
  );
  assert.equal(reusableLeaf('browser:ball', manifest), true);
  assert.equal(reusableLeaf('browser:audio', manifest), false);
  // Registered merge smoke re-executes on every retry, same bytes or not.
  assert.equal(reusableLeaf('browser:smoke', manifest), false);
  assert.ok(r.has('browser:smoke'));
  assert.equal(reusableLeaf('unit:test/x.test.mjs', manifest), true);
  assert.equal(reusableLeaf('check:layers', manifest), false);
  assert.equal(reusableLeaf('ci:budget', manifest), false);
  // The required set is the observed part: non-pass leaves and invariant-derived leaves, never
  // the always-fresh classes that merely lack a receipt.
  const required = requiredReexecution({ classification: c, manifest });
  assert.deepEqual([...required].sort(), [
    'browser:ball',
    'unit:test/geometry-wrong.test.mjs',
    'unit:test/geometry.test.mjs',
  ]);
  assert.ok(
    requiredReexecution({ classification: classifyParentLeaves(q), manifest }).has(
      'browser:mirror',
    ),
  );
});

test('required browser checks widen a selection from the registry and never narrow it', () => {
  const checks = manifest.browserChecks;
  const selection = { scope: 'documentation', checks: [checks[0]], reasons: [{ id: 'ball' }] };
  assert.equal(withRequiredChecks(selection, [], checks), selection);
  assert.equal(withRequiredChecks(selection, ['ball'], checks), selection);
  const widened = withRequiredChecks(selection, ['mirror', 'ball'], checks);
  assert.deepEqual(
    widened.checks.map((c) => c.id),
    ['ball', 'mirror'],
  );
  assert.deepEqual(widened.required, ['mirror']);
  assert.equal(widened.scope, 'documentation');
  assert.ok(widened.reasons.some((r) => r.id === 'mirror' && /required/.test(r.reason)));
  assert.throws(() => withRequiredChecks(selection, ['ghost'], checks), /unregistered/);
});

test('a source-only delta selects the fresh policy minus covered checks the delta does not reach, plus required', () => {
  const checks = manifest.browserChecks;
  const row = (id) => checks.find((c) => c.id === id);
  const fresh = {
    scope: 'local-contract',
    checks: [row('ball'), row('mirror'), row('audio')],
    reasons: [{ id: 'ball' }, { id: 'mirror' }, { id: 'audio' }],
  };
  const narrow = { scope: 'documentation', checks: [], reasons: [] };
  // Counterexample from review: a parent with no browser coverage covers nothing, so the
  // delta's empty scope never narrows the fresh policy.
  const uncovered = resolveRetrySelection({ fresh, narrow, required: [], covered: [], checks });
  assert.deepEqual(
    uncovered.checks.map((c) => c.id),
    ['ball', 'mirror', 'audio'],
  );
  assert.deepEqual(uncovered.skippedByDelta, []);
  assert.deepEqual(uncovered.fresh, {
    scope: 'local-contract',
    fallback: null,
    checks: ['ball', 'mirror', 'audio'],
  });
  // A covered check the delta does not reach is skipped and named; a covered check the delta
  // reaches, or that is required, runs.
  const covered = resolveRetrySelection({
    fresh,
    narrow: { ...narrow, checks: [row('audio')], reasons: [{ id: 'audio' }] },
    required: ['mirror'],
    covered: ['mirror', 'audio', 'ball'],
    checks,
  });
  assert.deepEqual(
    covered.checks.map((c) => c.id),
    ['mirror', 'audio'],
  );
  assert.deepEqual(covered.skippedByDelta, ['ball']);
  assert.deepEqual(covered.covered, ['audio', 'ball', 'mirror']);
  // A check the delta reaches but the fresh policy did not select still runs (the union never
  // narrows), and required checks outside both are added from the registry.
  const widened = resolveRetrySelection({
    fresh: { ...fresh, checks: [row('ball')], reasons: [{ id: 'ball' }] },
    narrow: { ...narrow, checks: [row('mirror')], reasons: [{ id: 'mirror' }] },
    required: ['smoke'],
    covered: ['ball'],
    checks,
  });
  assert.deepEqual(
    widened.checks.map((c) => c.id),
    ['mirror', 'smoke'],
  );
  assert.deepEqual(widened.skippedByDelta, ['ball']);
  assert.deepEqual(widened.required, ['smoke']);
  assert.ok(widened.reasons.some((r) => r.id === 'smoke' && /required/.test(r.reason)));
  // No covered set and no required set: exactly the fresh policy.
  const plain = resolveRetrySelection({ fresh, narrow, checks });
  assert.deepEqual(
    plain.checks.map((c) => c.id),
    ['ball', 'mirror', 'audio'],
  );
});

test('mode is same-bytes only when source, installed dependencies and relevant identity all match', () => {
  assert.equal(
    afterMode({ sameSource: true, sameDependencies: true, sameIdentity: true }),
    'same-bytes',
  );
  for (const flip of ['sameSource', 'sameDependencies', 'sameIdentity'])
    assert.equal(
      afterMode({ sameSource: true, sameDependencies: true, sameIdentity: true, [flip]: false }),
      'delta',
    );
  // The byte delta narrows selection only when nothing but source changed; a new runtime,
  // environment or dependency set makes every parent browser pass stale.
  assert.equal(deltaSelection({ sameDependencies: true, sameIdentity: true }), 'source-only');
  assert.equal(deltaSelection({ sameDependencies: false, sameIdentity: true }), 'fresh-policy');
  assert.equal(deltaSelection({ sameDependencies: true, sameIdentity: false }), 'fresh-policy');
});

test('the summary names reused origins, re-executed leaves and maps a passing tier to passed after failure', () => {
  const p = parent();
  const classification = classifyParentLeaves(p);
  const reexecute = reexecutionSet({ classification, manifest });
  const required = requiredReexecution({ classification, manifest });
  const causes = new Map([
    ['browser:ball', 'late pause'],
    ['browser', 'suite aborted'],
  ]);
  const coverage = validateCauses(classification, causes);
  const child = {
    status: 'passed',
    checks: [
      receipt('check:layers', true),
      receipt('unit:test/geometry.test.mjs', true),
      receipt('unit:test/geometry-wrong.test.mjs', true),
      receipt('unit:test/mirror.test.mjs', true, {
        resumed: true,
        origin: { attempt: p.attempt, report: p.attemptReport, depth: 1 },
      }),
      receipt('unit:test/other.test.mjs', true),
      receipt('build:browser', true),
      receipt('browser:ball', true),
      receipt('browser:spring-perf', true),
      receipt('browser:audio', true),
      receipt('browser:mirror', true, {
        resumed: true,
        origin: { attempt: p.attempt, report: p.attemptReport, depth: 1 },
      }),
      receipt('browser:smoke', true),
    ],
  };
  const summary = afterSummary({
    parent: p,
    mode: 'same-bytes',
    causes,
    coverage,
    reexecute,
    required,
    child,
  });
  assert.equal(summary.status, 'passed after failure');
  assert.deepEqual(summary.after.reused, [
    {
      id: 'browser:mirror',
      origin: { attempt: p.attempt, report: p.attemptReport, depth: 1 },
    },
    {
      id: 'unit:test/mirror.test.mjs',
      origin: { attempt: p.attempt, report: p.attemptReport, depth: 1 },
    },
  ]);
  assert.deepEqual(summary.after.noReceipt, ['unit:test/other.test.mjs']);
  assert.ok(summary.after.reexecuted.includes('browser:ball'));
  assert.deepEqual(summary.after.alwaysFresh, [
    'browser:audio',
    'browser:smoke',
    'browser:spring-perf',
    'build:browser',
    'check:layers',
  ]);
  assert.deepEqual(summary.after.required, [
    'browser:ball',
    'unit:test/geometry-wrong.test.mjs',
    'unit:test/geometry.test.mjs',
  ]);
  assert.equal(summary.after.deltaSelection, undefined);
  assert.deepEqual(summary.after.controls, [
    'unit:test/geometry-wrong.test.mjs',
    'unit:test/geometry.test.mjs',
  ]);
  assert.equal(summary.after.parentAttempt, p.attempt);
  assert.equal(summary.after.mode, 'same-bytes');
  assert.deepEqual(summary.after.chain, [p.attempt]);
  assert.equal(summary.after.causes['browser:ball'], 'late pause');
  // A failing child stays failed; a passing child without any reuse or delta skip is plain passed.
  assert.equal(
    afterSummary({
      parent: p,
      mode: 'same-bytes',
      causes,
      coverage,
      reexecute,
      required,
      child: { ...child, status: 'failed' },
    }).status,
    'failed',
  );
  const fresh = {
    ...child,
    checks: child.checks.map((r) => ({ ...r, resumed: undefined, origin: undefined })),
  };
  assert.equal(
    afterSummary({
      parent: p,
      mode: 'same-bytes',
      causes,
      coverage,
      reexecute,
      required,
      child: fresh,
    }).status,
    'passed',
  );
  // A resumed receipt counts as reuse even when it cannot name its origin; the report then
  // fails validation instead of passing plainly.
  const orphan = {
    ...child,
    checks: child.checks.map((r) => (r.resumed ? { ...r, origin: undefined } : r)),
  };
  const orphanSummary = afterSummary({
    parent: p,
    mode: 'same-bytes',
    causes,
    coverage,
    reexecute,
    required,
    child: orphan,
  });
  assert.equal(orphanSummary.status, 'passed after failure');
  assert.deepEqual(
    orphanSummary.after.reused.map((r) => r.origin),
    [null, null],
  );
  assert.throws(
    () =>
      validateAfterReport({
        status: orphanSummary.status,
        after: orphanSummary.after,
        verification: orphan,
      }),
    /origin attempt/,
  );
  // Delta mode records which selection the tier applied.
  const deltaSummary = afterSummary({
    parent: p,
    mode: 'delta',
    deltaSelection: 'fresh-policy',
    causes,
    coverage,
    reexecute,
    required,
    child: fresh,
  });
  assert.equal(deltaSummary.after.deltaSelection, 'fresh-policy');
  assert.deepEqual(deltaSummary.after.noReceipt, []);
  // Chains accumulate and are bounded.
  const grand = { ...p, after: { chain: ['00000000-0000-4000-8000-000000000000'] } };
  assert.deepEqual(
    afterSummary({
      parent: grand,
      mode: 'same-bytes',
      causes,
      coverage,
      reexecute,
      required,
      child,
    }).after.chain,
    ['00000000-0000-4000-8000-000000000000', p.attempt],
  );
});

test('an after report is admitted only when its block is consistent with the child receipts', () => {
  const p = parent();
  const classification = classifyParentLeaves(p);
  const reexecute = reexecutionSet({ classification, manifest });
  const required = requiredReexecution({ classification, manifest });
  const causes = new Map([
    ['browser:ball', 'late pause'],
    ['browser', 'suite aborted'],
  ]);
  const coverage = validateCauses(classification, causes);
  const child = {
    status: 'passed',
    checks: [
      receipt('browser:ball', true),
      receipt('browser:mirror', true, {
        resumed: true,
        origin: { attempt: p.attempt, report: 'r', depth: 1 },
      }),
      receipt('unit:test/geometry.test.mjs', true),
      receipt('unit:test/geometry-wrong.test.mjs', true),
    ],
  };
  const summary = afterSummary({
    parent: p,
    mode: 'same-bytes',
    causes,
    coverage,
    reexecute,
    required,
    child,
  });
  const report = { status: summary.status, after: summary.after, verification: child };
  validateAfterReport(report);
  assert.throws(() => validateAfterReport({ ...report, after: undefined }), /after/);
  const resumedFailure = structuredClone(report);
  resumedFailure.verification.checks[0].resumed = true;
  assert.throws(() => validateAfterReport(resumedFailure), /executed/);
  const missing = structuredClone(report);
  missing.after.reexecuted = missing.after.reexecuted.filter((id) => id !== 'browser:ball');
  assert.throws(() => validateAfterReport(missing), /browser:ball/);
  assert.throws(() => validateAfterReport({ ...report, status: 'passed' }), /status/);
  assert.doesNotThrow(() => validateAfterReport({ status: 'passed', verification: child }));
  // A plain passed report may carry an after block when nothing was reused or skipped.
  const nothingReused = structuredClone(report);
  nothingReused.status = 'passed';
  nothingReused.after.reused = [];
  nothingReused.after.skippedByDelta = [];
  nothingReused.verification.checks[1].resumed = false;
  assert.doesNotThrow(() => validateAfterReport(nothingReused));
  // ...but never while any child receipt is resumed, with or without an origin.
  const hiddenReuse = structuredClone(nothingReused);
  hiddenReuse.verification.checks[1].resumed = true;
  hiddenReuse.verification.checks[1].origin = undefined;
  assert.throws(() => validateAfterReport(hiddenReuse), /resumed receipt: browser:mirror/);
  // A failed leaf that never appears as an executed child receipt cannot pass after failure.
  const unobserved = structuredClone(report);
  unobserved.verification.checks = unobserved.verification.checks.filter(
    (r) => r.id !== 'browser:ball',
  );
  assert.throws(() => validateAfterReport(unobserved), /browser:ball/);
  // An invariant-derived leaf is observed like a non-pass leaf: a delta retry whose narrowed
  // selection never ran the control cannot pass after failure on the strength of the plan.
  const unobservedControl = structuredClone(report);
  unobservedControl.verification.checks = unobservedControl.verification.checks.filter(
    (r) => r.id !== 'unit:test/geometry-wrong.test.mjs',
  );
  assert.throws(() => validateAfterReport(unobservedControl), /geometry-wrong/);
  // Nothing re-executed may also be skipped by delta.
  const overlap = structuredClone(report);
  overlap.after.skippedByDelta = [{ id: 'browser:ball', parentAttempt: p.attempt }];
  assert.throws(() => validateAfterReport(overlap), /both re-executed and skipped/);
  // A skipped leaf must be one the parent covered, and must not have run in the child.
  const uncovered = structuredClone(report);
  uncovered.after.skippedByDelta = [{ id: 'browser:audio', parentAttempt: p.attempt }];
  uncovered.after.covered = ['browser:mirror'];
  assert.throws(() => validateAfterReport(uncovered), /without parent coverage/);
  const ran = structuredClone(report);
  ran.after.skippedByDelta = [{ id: 'browser:mirror', parentAttempt: p.attempt }];
  ran.after.covered = ['browser:mirror'];
  assert.throws(() => validateAfterReport(ran), /has a child receipt/);
  const coveredSkip = structuredClone(report);
  coveredSkip.after.skippedByDelta = [{ id: 'browser:audio', parentAttempt: p.attempt }];
  coveredSkip.after.covered = ['browser:audio', 'browser:mirror'];
  assert.doesNotThrow(() => validateAfterReport(coveredSkip));
});

test('a parent report is trusted only under the attestation of its own candidate key', () => {
  const key = Buffer.alloc(32, 5),
    other = Buffer.alloc(32, 6);
  const report = { status: 'failed', directory: '/tmp/c', verification: { checks: [] } };
  const attested = { ...report, attestation: attestReport(report, key) };
  assert.equal(
    verifyAttestation(attested, () => key),
    true,
  );
  // Re-attesting an attested report ignores the previous attestation field.
  assert.equal(attestReport(attested, key), attested.attestation);
  assert.throws(() => verifyAttestation(report, () => key), /not attested/);
  assert.throws(() => verifyAttestation(attested, () => other), /does not match/);
  assert.throws(
    () => verifyAttestation({ ...attested, status: 'passed' }, () => key),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyAttestation(
        {
          ...attested,
          verification: { checks: [{ id: 'browser:x', ok: true }] },
        },
        () => key,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyAttestation(attested, () => {
        throw Error('ENOENT');
      }),
    /unavailable/,
  );
});

const passedParent = (overrides = {}) =>
  parent({
    status: 'passed',
    tier: 'local',
    verification: {
      ...parent().verification,
      status: 'passed',
      results: parent().verification.results.map((r) => ({ ...r, status: 'passed' })),
      checks: [
        ...parent().verification.checks.filter((r) => r.id !== 'browser:ball'),
        receipt('browser:ball', true),
        receipt('browser:smoke', true),
        receipt('browser:hosted', true),
        receipt('browser:probe', true),
      ],
    },
    ...overrides,
  });

test('across candidates only workshop browser journeys carry a receipt; smoke, timing, hosted, probe and unit leaves never do', () => {
  assert.equal(reusableAcrossCandidates('browser:ball', manifest), true);
  assert.equal(reusableAcrossCandidates('browser:mirror', manifest), true);
  assert.equal(reusableAcrossCandidates('browser:smoke', manifest), false, 'merge smoke');
  assert.equal(reusableAcrossCandidates('browser:hosted', manifest), false, 'hosted');
  assert.equal(reusableAcrossCandidates('browser:probe', manifest), false, 'probe');
  assert.equal(reusableAcrossCandidates('browser:audio', manifest), false, 'timing-sensitive');
  assert.equal(reusableAcrossCandidates('browser:spring-perf', manifest), false, 'performance');
  assert.equal(reusableAcrossCandidates('unit:test/geometry.test.mjs', manifest), false, 'unit');
  assert.equal(reusableAcrossCandidates('browser:missing', manifest), false);
  assert.equal(reusableAcrossCandidates('build:browser', manifest), false);
  // The registered manifest decides: a workshop journey with local storage is reusable, the
  // camera journey is timing-sensitive, every hosted recording check is self, smoke is smoke.
  const real = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
  const rows = Object.fromEntries(real.browserChecks.map((c) => [c.id, c]));
  assert.equal(reusableAcrossCandidates('browser:verify-recording-browser', real), true);
  assert.equal(rows['verify-camera-browser'].timingSensitive, true);
  assert.equal(reusableAcrossCandidates('browser:verify-camera-browser', real), false);
  for (const c of real.browserChecks) {
    const reusable = reusableAcrossCandidates(`browser:${c.id}`, real);
    if (
      c.mergeSmoke ||
      c.timingSensitive ||
      c.tier !== 'browser' ||
      (c.environment ?? 'workshop') !== 'workshop'
    )
      assert.equal(reusable, false, c.id);
    else assert.equal(reusable, true, c.id);
  }
  assert.ok(
    real.browserChecks.filter((c) => reusableAcrossCandidates(`browser:${c.id}`, real)).length >=
      30,
  );
  assert.deepEqual([...REUSE_TIERS], ['local', 'merge']);
});

test('a passed parent classifies for reuse; a passed report carrying a failed leaf is refused', () => {
  const c = classifyParentLeaves(passedParent());
  assert.equal(c.kind, 'reuse');
  assert.deepEqual(c.failed, []);
  assert.equal(classifyParentLeaves(parent()).kind, 'retry');
  assert.equal(
    classifyParentLeaves(passedParent({ status: 'passed with reused receipts' })).kind,
    'reuse',
  );
  assert.throws(
    () => classifyParentLeaves(passedParent({ status: 'passed after failure' })),
    /--after needs|failed/,
  );
  const inconsistent = passedParent();
  inconsistent.verification.checks.find((r) => r.id === 'browser:mirror').ok = false;
  assert.throws(() => classifyParentLeaves(inconsistent), /failed.*browser:mirror/);
  // A passed parent takes no cause.
  assert.throws(() => validateCauses(c, new Map([['browser:ball', 'x']])), /nothing failed/);
  assert.deepEqual(validateCauses(c, new Map()), {});
});

test("the offered set is the parent's own depth-0 workshop journeys; resumed or chained receipts are always fresh", () => {
  const p = passedParent();
  p.verification.checks.find((r) => r.id === 'browser:mirror').resumed = true;
  p.verification.checks.find((r) => r.id === 'browser:mirror').origin = {
    attempt: p.attempt,
    report: 'r',
    depth: 1,
  };
  const set = reuseSet({ classification: classifyParentLeaves(p), manifest });
  assert.deepEqual(set.offered, ['browser:ball']);
  assert.ok(set.alwaysFresh.includes('browser:mirror'), 'resumed in the parent');
  assert.ok(set.alwaysFresh.includes('browser:smoke'));
  assert.ok(set.alwaysFresh.includes('browser:hosted'));
  assert.ok(set.alwaysFresh.includes('browser:audio'));
  assert.ok(set.alwaysFresh.includes('unit:test/geometry.test.mjs'));
  assert.throws(
    () => reuseSet({ classification: classifyParentLeaves(parent()), manifest }),
    /passed/,
  );
});

test('a reuse child is passed with reused receipts exactly when it resumed a receipt the parent offered and executed', () => {
  const p = passedParent();
  const origin = { attempt: p.attempt, report: p.attemptReport, depth: 1 };
  const child = (checks, status = 'passed') => ({ status, checks });
  const summary = reuseSummary({
    parent: p,
    mode: 'same-bytes',
    sameBytes: { sameSource: true, sameDependencies: true, sameIdentity: true },
    offered: ['browser:ball', 'browser:mirror'],
    child: child([
      receipt('check:layers', true),
      receipt('browser:ball', true, { resumed: true, origin }),
      receipt('browser:smoke', true),
    ]),
  });
  assert.equal(summary.status, 'passed with reused receipts');
  assert.equal(summary.after.kind, 'reuse');
  assert.deepEqual(summary.after.reused, [{ id: 'browser:ball', origin }]);
  assert.deepEqual(summary.after.notSelected, ['browser:mirror']);
  assert.deepEqual(summary.after.executed, ['browser:smoke', 'check:layers']);
  assert.deepEqual(summary.after.counts, { offered: 2, reused: 1, executed: 2 });
  assert.deepEqual(summary.after.chain, []);
  assert.equal(summary.after.parentTier, 'local');
  // Nothing reused is plain passed; a failed child is failed.
  assert.equal(
    reuseSummary({
      parent: p,
      mode: 'delta',
      sameBytes: {},
      offered: [],
      child: child([receipt('browser:ball', true)]),
    }).status,
    'passed',
  );
  assert.equal(
    reuseSummary({
      parent: p,
      mode: 'same-bytes',
      sameBytes: {},
      offered: ['browser:ball'],
      child: child([], 'failed'),
    }).status,
    'failed',
  );
  // The report validator refuses every inconsistent shape.
  const report = (overrides = {}) => ({
    status: 'passed with reused receipts',
    tier: 'merge',
    after: { ...summary.after },
    verification: { checks: [receipt('browser:ball', true, { resumed: true, origin })] },
    ...overrides,
  });
  const consistent = report();
  assert.equal(validateReuseReport(consistent), consistent);
  assert.throws(
    () => validateReuseReport(report({ status: 'passed' })),
    /must be passed with reused receipts/,
  );
  assert.throws(
    () => validateReuseReport(report({ after: { ...summary.after, reused: [] } })),
    /at least one/,
  );
  assert.throws(() => validateReuseReport(report({ tier: 'final' })), /final/);
  // A caller may admit other child tiers (release operations); the parent is never final.
  const intoFinal = report({ tier: 'final' });
  assert.equal(validateReuseReport(intoFinal, { childTiers: ['final'] }), intoFinal);
  assert.throws(
    () => validateReuseReport(report({ after: { ...summary.after, parentTier: 'final' } })),
    /local or merge parent/,
  );
  assert.throws(
    () =>
      validateReuseReport(report({ after: { ...summary.after, parentTier: 'final' } }), {
        childTiers: ['final'],
      }),
    /local or merge parent/,
  );
  assert.throws(
    () =>
      validateReuseReport(
        report({
          verification: {
            checks: [
              receipt('browser:ball', true, { resumed: true, origin: { ...origin, depth: 2 } }),
            ],
          },
        }),
      ),
    /depth-0/,
  );
  assert.throws(
    () => validateReuseReport(report({ after: { ...summary.after, offered: ['browser:mirror'] } })),
    /not offered/,
  );
  assert.throws(
    () =>
      validateReuseReport(
        report({
          verification: {
            checks: [
              receipt('browser:ball', true, { resumed: true, origin }),
              receipt('browser:mirror', true, { resumed: true, origin }),
            ],
          },
        }),
      ),
    /missing from the after block/,
  );
  assert.throws(
    () => validateReuseReport(report({ after: { ...summary.after, kind: 'retry' } })),
    /consistent/,
  );
  // validateAfterReport dispatches on the block kind.
  assert.equal(validateAfterReport(consistent), consistent);
});
