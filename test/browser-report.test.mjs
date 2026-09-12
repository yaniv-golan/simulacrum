import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withBrowserReport } from '../scripts/verify-browser-suite.mjs';
test('every attempt replaces old green reports, including build and server failures', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'suite-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const phase of ['build', 'server']) {
    writeFileSync(join(dir, 'all.json'), JSON.stringify({ ok: true, runs: [{ id: 'stale' }] }));
    await assert.rejects(
      withBrowserReport(
        'all',
        {},
        async (report) => {
          assert.equal(JSON.parse(readFileSync(join(dir, 'all.json'))).status, 'running');
          report.phase = phase;
          throw Error(`${phase} refused`);
        },
        dir,
      ),
      /refused/,
    );
    const report = JSON.parse(readFileSync(join(dir, 'all.json')));
    assert.equal(report.ok, false);
    assert.equal(report.phase, phase);
    assert.deepEqual(report.runs, []);
    assert.match(report.failure, /refused/);
  }
  await withBrowserReport(
    'all',
    {},
    async (report) => {
      report.runs.push({ id: 'good', ok: true });
    },
    dir,
  );
  assert.equal(JSON.parse(readFileSync(join(dir, 'last-run.json'))).ok, true);
});

import { symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
test('actual CLI admission failures replace previous success; summary discovery leaves it alone', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cli-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['src', 'test', 'scripts'])
    symlinkSync(join(repo, path), join(root, path), 'dir');
  await withBrowserReport('all', {}, async () => {}, join(root, 'artifacts/browser-suite'));
  const path = join(root, 'artifacts/browser-suite/last-run.json');
  const run = (script, args) =>
    spawnSync(process.execPath, [join(repo, 'scripts', script), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_DIR: join(repo, '.git') },
    });
  const before = readFileSync(path, 'utf8');
  assert.equal(run('verify-browser-suite.mjs', ['all', '--summary']).status, 0);
  assert.equal(readFileSync(path, 'utf8'), before);
  for (const args of [
    ['all', '--workers', '3'],
    ['all', '--unknown-option'],
  ]) {
    assert.equal(run('verify-browser-suite.mjs', args).status, 1);
    const report = JSON.parse(readFileSync(path));
    assert.equal(report.ok, false);
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.runs, []);
  }
  const local = join(root, 'artifacts/verification-local.json');
  writeFileSync(local, JSON.stringify({ outcome: { automation: { status: 'PASS' } } }));
  assert.equal(run('verify-local.mjs', ['--base', 'missing-review-ref-xyz']).status, 1);
  const report = JSON.parse(readFileSync(local));
  assert.equal(report.outcome.automation.status, 'FAIL');
  assert.equal(report.outcome.qualification.status, 'NOT_EVALUATED');
  const final = join(root, 'artifacts/verification-final.json');
  writeFileSync(final, JSON.stringify({ outcome: { automation: { status: 'PASS' } } }));
  assert.equal(run('verify-final.mjs', ['--unknown-option']).status, 1);
  const finalReport = JSON.parse(readFileSync(final));
  assert.equal(finalReport.outcome.automation.status, 'FAIL');
  assert.equal(finalReport.outcome.qualification.status, 'BLOCKED');
});

test('real suite owns cleanup inside failed receipts and preserves simultaneous causes', () => {
  const child = spawnSync(
    process.execPath,
    [join(repo, 'test/fixtures/browser-suite-cleanup.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout
    .split('\n')
    .filter((s) => s.startsWith('RESULT '))
    .map((s) => JSON.parse(s.slice(7)));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].report.ok, true);
  for (const row of rows.slice(1)) {
    assert.equal(row.report.ok, false);
    assert.equal(row.report.runs[0].ok, false);
    assert.equal(row.receipts.find((r) => r.id === 'browser:verify-browser').ok, false);
    assert.match(JSON.stringify(row.report), /injected probe cleanup failure/);
    if (row.childFail) assert.match(JSON.stringify(row.report), /injected child failure/);
  }
});

test('progress is visible before completion and later attempts preserve earlier evidence', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'suite-progress-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let first;
  await assert.rejects(
    withBrowserReport(
      'all',
      {},
      async (report, publish) => {
        first = report;
        writeFileSync(join(report.directory, 'failure.log'), 'original failure');
        report.runs.push({
          id: 'fast',
          status: 'failed',
          ok: false,
          log: join(report.directory, 'failure.log'),
        });
        publish();
        const live = JSON.parse(readFileSync(report.reportPath));
        assert.equal(live.status, 'running');
        assert.equal(live.ok, false);
        assert.equal(live.runs[0].id, 'fast');
        throw Error('deliberate failure');
      },
      dir,
    ),
    /deliberate failure/,
  );
  await withBrowserReport(
    'all',
    {},
    async (report) => {
      assert.notEqual(report.runId, first.runId);
      assert.deepEqual(report.previousFailures, ['fast']);
      writeFileSync(join(report.directory, 'failure.log'), 'later success');
    },
    dir,
  );
  const retained = JSON.parse(readFileSync(first.reportPath));
  assert.equal(retained.status, 'failed');
  assert.equal(readFileSync(retained.runs[0].log, 'utf8'), 'original failure');
  assert.notEqual(JSON.parse(readFileSync(join(dir, 'last-run.json'))).runId, first.runId);
});

test('actual suite separates canonical selection from priority execution', () => {
  const child = spawnSync(
    process.execPath,
    [join(repo, 'test/fixtures/browser-suite-cleanup.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout
    .split('\n')
    .filter((s) => s.startsWith('PRIORITY '))
    .map((s) => JSON.parse(s.slice(9)));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2].order, [...rows[2].selected].reverse());
  assert.equal(rows[2].report.priority.provenance, 'captured changed files');
  assert.deepEqual(rows[0].order, rows[0].selected);
  assert.deepEqual(rows[1].order, [...rows[1].selected].reverse());
  assert.deepEqual(
    rows[0].report.runs.map((r) => r.id),
    rows[1].report.runs.map((r) => r.id),
  );
  assert.equal(rows[1].report.status, 'failed');
  assert.equal(
    rows[1].liveRuns[1].find((r) => r.id === rows[1].report.runs[1].id).status,
    'failed',
  );
  assert.equal(
    rows[0].liveRuns[1].find((r) => r.id === rows[0].report.runs[0].id).status,
    'passed',
  );
  assert.equal(rows[0].report.runs.filter((r) => r.ok === false).length, 1);
  assert.equal(rows[1].report.runs.filter((r) => r.ok === false).length, 1);
});

test('final alias publication failure cannot leave authoritative success', async (t) => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const dir = mkdtempSync(join(tmpdir(), 'suite-publication-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rename = fs.renameSync;
  let reportPath,
    injected = false;
  fs.renameSync = (from, to) => {
    if (
      !injected &&
      to.endsWith('last-run.json') &&
      JSON.parse(readFileSync(from)).status === 'passed'
    ) {
      injected = true;
      throw Error('injected publication failure');
    }
    return rename(from, to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      withBrowserReport(
        'all',
        {},
        async (report) => {
          reportPath = report.reportPath;
        },
        dir,
      ),
      /publication failure/,
    );
    assert.equal(JSON.parse(readFileSync(reportPath)).ok, false);
    assert.equal(JSON.parse(readFileSync(reportPath)).status, 'failed');
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
});

test('same-context suite reuse references retained original evidence for success and failures', () => {
  const child = spawnSync(
    process.execPath,
    [join(repo, 'test/fixtures/browser-suite-cleanup.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout
    .split('\n')
    .filter((line) => line.startsWith('REUSE_EVIDENCE '))
    .map((line) => JSON.parse(line.slice(15)));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.executions, 1);
    const [original, reused] = row.reports;
    assert.notEqual(original.runId, reused.runId);
    assert.equal(original.runs[0].reused, false);
    assert.equal(reused.runs[0].reused, true);
    assert.deepEqual(original.runs[0].evidenceOrigin, reused.runs[0].evidenceOrigin);
    assert.equal(reused.runs[0].evidenceOrigin.runId, original.runId);
    assert.equal(reused.runs[0].evidenceOrigin.reportPath, original.reportPath);
    assert.equal(reused.runs[0].evidenceDirectory, original.runs[0].evidenceDirectory);
    assert.equal(reused.runs[0].log, original.runs[0].log);
    assert.equal(original.runs[0].ok, !(row.childFailed || row.cleanupFailed));
    assert.equal(reused.runs[0].ok, original.runs[0].ok);
    assert.equal(row.retainedBytes, row.originalBytes);
    assert.ok(row.originalBytes.length);
    assert.ok(row.originalLog.length);
    if (row.cleanupFailed) assert.match(row.originalLog, /child passed.*witness.json/);
    assert.equal(row.retainedLog, row.originalLog);
    assert.deepEqual(row.retainedReport, original);
  }
});

test('server cleanup survives timing publication failure and retains both causes', () => {
  const child = spawnSync(
    process.execPath,
    [join(repo, 'test/fixtures/browser-suite-cleanup.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout
    .split('\n')
    .filter((s) => s.startsWith('TIMING_CLEANUP '))
    .map((s) => JSON.parse(s.slice(15)));
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.closes, 1);
  assert.equal(rows[0].report.ok, true);
  assert.equal(rows[1].report.ok, false);
  assert.match(JSON.stringify(rows[1].report), /injected timing publication failure/);
  assert.match(JSON.stringify(rows[1].report), /injected server cleanup failure/);
});

test('scheduling history survives fresh report directories without reusing results', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'suite-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const historyPath = join(root, 'history.json');
  await withBrowserReport(
    'all',
    { historyPath },
    async (report) => {
      report.runs.push(
        { id: 'bad', ok: false, elapsedMs: 20 },
        { id: 'good', ok: true, elapsedMs: 10 },
      );
    },
    join(root, 'first'),
  );
  await withBrowserReport(
    'all',
    { historyPath },
    async (report) => {
      assert.deepEqual(report.previousFailures, ['bad']);
      assert.equal(report.durations.good, 10);
      assert.deepEqual(report.runs, []);
      report.runs.push({ id: 'bad', ok: true, elapsedMs: 15 });
    },
    join(root, 'fresh-candidate'),
  );
  await withBrowserReport(
    'all',
    { historyPath },
    async (report) => {
      assert.deepEqual(report.previousFailures, []);
      assert.equal(report.durations.good, 10);
    },
    join(root, 'third'),
  );
});

test('actual suite allows four-worker probes and rejects completion-context overrides', () => {
  const child = spawnSync(
    process.execPath,
    [join(repo, 'test/fixtures/browser-suite-cleanup.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const rows = child.stdout
    .split('\n')
    .filter((s) => s.startsWith('WORKERS '))
    .map((s) => JSON.parse(s.slice(8)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, true, JSON.stringify(rows[0]));
  assert.equal(rows[1].ok, false);
  assert.match(rows[1].failure, /explicit development probes/);
  assert.deepEqual(rows[1].runs, []);
});

test('cleanup attempts every resource despite phase publication and close failures', async () => {
  const { withCleanup } = await import('../scripts/verification-cleanup.mjs');
  const calls = [];
  const primary = Error('execution failed');
  const reporting = Error('phase publication failed');
  const closing = Error('browser close failed');
  await assert.rejects(
    withCleanup(
      async () => {
        throw primary;
      },
      () => {
        calls.push('phase');
        throw reporting;
      },
      () => {
        calls.push('browser');
        throw closing;
      },
      () => {
        calls.push('server');
      },
      () => {
        calls.push('cloud');
      },
    ),
    (error) => {
      assert.deepEqual(calls, ['phase', 'browser', 'server', 'cloud']);
      assert.deepEqual(error.errors, [primary, reporting, closing]);
      return true;
    },
  );
  assert.equal(
    await withCleanup(
      () => 42,
      () => calls.push('success'),
    ),
    42,
  );
});

test('history rejects late stale outcomes and preserves newer observations', async (t) => {
  const { readBrowserHistory, writeBrowserHistory } = await import(
    '../scripts/browser-history.mjs'
  );
  const root = mkdtempSync(join(tmpdir(), 'late-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'history.json');
  writeBrowserHistory(path, [{ id: 'check', ok: false, observedAt: 200, observationId: 'new' }]);
  writeBrowserHistory(path, [{ id: 'check', ok: true, observedAt: 100, observationId: 'old' }]);
  assert.equal(readBrowserHistory(path).get('check').ok, false);
  writeBrowserHistory(path, [
    { id: 'check', ok: true, elapsedMs: 3, observedAt: 300, observationId: 'latest' },
  ]);
  assert.equal(readBrowserHistory(path).get('check').elapsedMs, 3);
  // A competing snapshot publisher read before the newer failure completed.
  writeBrowserHistory(path, [{ id: 'check', ok: false, observedAt: 400 }]);
  writeFileSync(path, JSON.stringify({ runs: [{ id: 'check', ok: true, observedAt: 300 }] }));
  assert.equal(readBrowserHistory(path).get('check').ok, false);
  for (let observedAt = 500; observedAt < 510; observedAt++)
    writeBrowserHistory(path, [{ id: 'check', ok: true, observedAt }]);
  const { readdirSync } = await import('node:fs');
  assert.equal(readdirSync(`${path}.observations`).length, 2);
});

test('history publication cannot be permanently blocked by an interrupted writer', async (t) => {
  const { readBrowserHistory, writeBrowserHistory } = await import(
    '../scripts/browser-history.mjs'
  );
  const root = mkdtempSync(join(tmpdir(), 'interrupted-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'history.json');
  writeFileSync(`${path}.lock`, '');
  writeBrowserHistory(path, [{ id: 'check', ok: false }]);
  assert.equal(readBrowserHistory(path).get('check').ok, false);
});

test('legacy candidate returns only newly executed report outcomes', async (t) => {
  const { readBrowserHistory, writeBrowserHistory, returnBrowserHistory } = await import(
    '../scripts/browser-history.mjs'
  );
  const root = mkdtempSync(join(tmpdir(), 'legacy-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.json'),
    report = join(root, 'last-run.json');
  writeBrowserHistory(origin, [{ id: 'check', ok: true, observedAt: 1 }]);
  writeFileSync(
    report,
    JSON.stringify({
      runId: 'new',
      startedAt: new Date(100).toISOString(),
      runs: [
        { id: 'check', ok: false },
        { id: 'unstarted', status: 'queued' },
        { id: 'reused', ok: true, reused: true },
      ],
    }),
  );
  returnBrowserHistory(origin, report, 'old');
  assert.equal(readBrowserHistory(origin).get('check').ok, false);
  assert.equal(readBrowserHistory(origin).has('unstarted'), false);
  assert.equal(readBrowserHistory(origin).has('reused'), false);
  writeBrowserHistory(origin, [{ id: 'check', ok: true, observedAt: 200 }]);
  returnBrowserHistory(origin, report, 'new');
  assert.equal(readBrowserHistory(origin).get('check').ok, true);
});

test('history removes abandoned temporary files while preserving live writers', async (t) => {
  const { writeBrowserHistory } = await import('../scripts/browser-history.mjs');
  const { existsSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'orphan-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {
    encoding: 'utf8',
  });
  assert.equal(child.status, 0);
  const dead = join(root, `.browser-history-${child.stdout.trim()}-abc.tmp`);
  const live = join(root, `.browser-history-${process.pid}-abc.tmp`);
  writeFileSync(dead, 'partial');
  writeFileSync(live, 'partial');
  writeBrowserHistory(join(root, 'history.json'), [{ id: 'check', ok: true }]);
  assert.equal(existsSync(dead), false);
  assert.equal(existsSync(live), true);
});
