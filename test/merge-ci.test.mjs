import test from 'node:test';
import assert from 'node:assert/strict';
import { ciBrowserScope } from '../scripts/verify-ci-browser.mjs';
import { compareMergeCoverage } from '../scripts/merge-comparison.mjs';
const sha = (x) => x.repeat(40);
const git = (args) =>
  args[0] === 'merge-base' ? sha('c') : args.at(-1) === 'HEAD~1^{commit}' ? sha('b') : sha('a');
test('PR uses event incoming and destination common ancestor, never destination tip as base', () => {
  const r = ciBrowserScope(
    'pull_request',
    { pull_request: { head: { sha: sha('d') }, base: { sha: sha('b') } } },
    git,
  );
  assert.equal(r.mode, 'merge');
  assert.deepEqual(r.changes, { base: sha('c'), incoming: sha('d'), destination: sha('b') });
  assert.throws(() => ciBrowserScope('pull_request', {}, git), /PR/);
});
test('push invalid ancestry or unavailable before falls back full; schedules keep full', () => {
  assert.equal(ciBrowserScope('push', { before: sha('0') }, git).mode, 'all');
  assert.equal(
    ciBrowserScope('push', { before: sha('b') }, () => {
      throw Error('bad ref');
    }).mode,
    'all',
  );
  assert.deepEqual(ciBrowserScope('push', { before: sha('b') }, git).changes, { base: sha('b') });
  for (const event of ['schedule', 'workflow_dispatch']) {
    const r = ciBrowserScope(event, {}, git);
    assert.equal(r.mode, 'all');
    assert.equal(r.comparison.base, sha('b'));
  }
});
const source = { head: 'h', workingTreeDigest: 'digest' };
const scope = { base: 'b', head: 'h' };
const selection = ['smoke'];
const checks = [{ id: 'smoke' }, { id: 'other' }];
const full = {
  status: 'failed',
  mode: 'all',
  source,
  selection: { mergeComparison: { scope, selection } },
  runs: [
    { id: 'smoke', status: 'passed' },
    { id: 'other', status: 'failed' },
  ],
};
const compare = (report = full, extra = {}) =>
  compareMergeCoverage({ full: report, source, scope, selection, checks, ...extra });
test('matching completed full comparison exposes omitted failure', () => {
  assert.equal(compare().status, 'COVERAGE_GAP');
  assert.deepEqual(compare().omittedFailures, ['other']);
});
test('mismatched, incomplete, duplicate or unknown evidence never supplies agreement', () => {
  for (const report of [
    { ...full, status: 'running' },
    { ...full, mode: ['smoke', 'other'] },
    { ...full, source: { ...source, head: 'wrong' } },
    { ...full, selection: null },
    { ...full, selection: { mergeComparison: { scope: { base: 'wrong' }, selection } } },
    { ...full, selection: { mergeComparison: { scope, selection: ['other'] } } },
    { ...full, runs: full.runs.slice(0, 1) },
    { ...full, runs: [...full.runs, full.runs[0]] },
    { ...full, runs: [...full.runs, { id: 'unknown', status: 'passed' }] },
    {
      ...full,
      runs: [
        { id: 'smoke', status: 'passed' },
        { id: 'other', status: 'not evaluated' },
      ],
    },
  ])
    assert.equal(compare(report).status, 'NOT_EVALUATED');
});

test('CI runner retires stale success before admission and rejects source or scope drift', async () => {
  const { runCIBrowser } = await import('../scripts/verify-ci-browser.mjs');
  const snapshots = [];
  const writeReport = (report) => snapshots.push(structuredClone(report));
  await assert.rejects(
    runCIBrowser({
      writeReport,
      loadServices: async () => {
        throw Error('admission');
      },
    }),
    /admission/,
  );
  assert.equal(snapshots[0].status, 'running');
  assert.equal(snapshots.at(-1).status, 'failed');
  for (const [kind, threshold] of [
    ['source', 1],
    ['scope', 1],
    ['source', 2],
    ['scope', 2],
  ]) {
    let executions = 0,
      sourceReads = 0,
      scopeReads = 0;
    const services = {
      sourceIdentity: () => ({
        head: 'h',
        workingTreeDigest: kind === 'source' && ++sourceReads > threshold ? 'changed' : 'digest',
      }),
      browserChecks: () => checks,
      affectedBrowserChecks: () => ({ checks }),
      mergeSelection: () => ({ checks }),
      mergeChanges: () => ({
        refs: { base: 'b' },
        files: kind === 'scope' && ++scopeReads > threshold ? ['changed'] : ['a'],
        scopeKind: 'base',
      }),
      verifyBrowserSuite: async () => {
        executions++;
      },
    };
    await assert.rejects(
      runCIBrowser({
        writeReport,
        loadServices: async () => services,
        eventName: 'push',
        event: { before: sha('b') },
        git,
      }),
      /changed/,
    );
    assert.equal(executions, threshold - 1);
    assert.equal(snapshots.at(-1).status, 'failed');
  }
});
