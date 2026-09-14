import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAfterArgs,
  classifyParentLeaves,
  validateCauses,
  reexecutionSet,
  afterMode,
  afterSummary,
  validateAfterReport,
  CHAIN_DEPTH_LIMIT,
  reusableLeaf,
} from '../scripts/candidate-after.mjs';

const manifest = {
  browserChecks: [
    { id: 'ball', script: 'scripts/ball.mjs', tier: 'browser' },
    { id: 'spring-perf', script: 'scripts/spring.mjs', tier: 'performance', timingSensitive: true },
    { id: 'audio', script: 'scripts/audio.mjs', tier: 'browser', timingSensitive: true },
    { id: 'mirror', script: 'scripts/mirror.mjs', tier: 'browser' },
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
        receipt('gate:layers', true),
        receipt('unit:test/geometry.test.mjs', true),
        receipt('unit:test/mirror.test.mjs', true),
        receipt('unit:test/other.test.mjs', true),
        receipt('build:browser', true),
        receipt('browser:ball', false, { error: 'assertion' }),
        receipt('browser:spring-perf', true),
        receipt('browser:audio', true),
        receipt('browser:mirror', true),
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
      'gate:layers',
      'unit:test/geometry.test.mjs',
      'unit:test/mirror.test.mjs',
      'unit:test/other.test.mjs',
      'build:browser',
      'browser:spring-perf',
      'browser:audio',
      'browser:mirror',
    ],
  );
  assert.throws(() => classifyParentLeaves({ ...p, status: 'passed' }), /failed/);
  assert.throws(() => classifyParentLeaves({ ...p, verification: undefined }), /incomplete/);
});

test('every failed or unexecuted leaf needs its own cause; an aborted aggregate covers absent leaves', () => {
  const p = parent();
  p.verification.checks.push(receipt('ci:budget', false, { unexecuted: ['test/late.test.mjs'] }));
  const c = classifyParentLeaves(p);
  assert.throws(() => validateCauses(c, new Map([['browser:ball', 'x']])), /ci:budget/);
  assert.throws(
    () =>
      validateCauses(
        c,
        new Map([
          ['browser:ball', 'x'],
          ['ci:budget', 'y'],
        ]),
      ),
    /unit:test\/late.test.mjs/,
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
  assert.deepEqual(coverage.browser, { aggregate: true, covers: 'leaves that did not run' });
  assert.deepEqual(coverage['browser:ball'], { aggregate: false, covers: ['browser:ball'] });
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
    'gate:layers',
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
  assert.ok(r2.has('gate:layers'));
  assert.equal(r2.has('browser:ball'), false);
  assert.equal(reusableLeaf('browser:ball', manifest), true);
  assert.equal(reusableLeaf('browser:audio', manifest), false);
  assert.equal(reusableLeaf('unit:test/x.test.mjs', manifest), true);
  assert.equal(reusableLeaf('gate:layers', manifest), false);
  assert.equal(reusableLeaf('ci:budget', manifest), false);
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
});

test('the summary names reused origins, re-executed leaves and maps a passing tier to passed after failure', () => {
  const p = parent();
  const classification = classifyParentLeaves(p);
  const reexecute = reexecutionSet({ classification, manifest });
  const causes = new Map([
    ['browser:ball', 'late pause'],
    ['browser', 'suite aborted'],
  ]);
  const coverage = validateCauses(classification, causes);
  const child = {
    status: 'passed',
    checks: [
      receipt('gate:layers', true),
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
    ],
  };
  const summary = afterSummary({
    parent: p,
    mode: 'same-bytes',
    causes,
    coverage,
    reexecute,
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
  assert.ok(summary.after.alwaysFresh.includes('browser:audio'));
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
      child: { ...child, status: 'failed' },
    }).status,
    'failed',
  );
  const fresh = {
    ...child,
    checks: child.checks.map((r) => ({ ...r, resumed: undefined, origin: undefined })),
  };
  assert.equal(
    afterSummary({ parent: p, mode: 'same-bytes', causes, coverage, reexecute, child: fresh })
      .status,
    'passed',
  );
  // Chains accumulate and are bounded.
  const grand = { ...p, after: { chain: ['00000000-0000-4000-8000-000000000000'] } };
  assert.deepEqual(
    afterSummary({ parent: grand, mode: 'same-bytes', causes, coverage, reexecute, child }).after
      .chain,
    ['00000000-0000-4000-8000-000000000000', p.attempt],
  );
  const deep = { ...p, after: { chain: Array(CHAIN_DEPTH_LIMIT).fill(p.attempt) } };
  assert.throws(
    () => afterSummary({ parent: deep, mode: 'same-bytes', causes, coverage, reexecute, child }),
    /chain/,
  );
});

test('an after report is admitted only when its block is consistent with the child receipts', () => {
  const p = parent();
  const classification = classifyParentLeaves(p);
  const reexecute = reexecutionSet({ classification, manifest });
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
    ],
  };
  const summary = afterSummary({
    parent: p,
    mode: 'same-bytes',
    causes,
    coverage,
    reexecute,
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
});
