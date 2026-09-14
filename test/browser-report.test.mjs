import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withBrowserReport,
  browserReceiptConfiguration,
} from '../scripts/verify-browser-suite.mjs';
import { createLeafLedger } from '../scripts/verification-resume.mjs';
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
    if (row.childFail) {
      assert.match(JSON.stringify(row.report), /injected child failure/);
      // The runner's snapshot survives the cleanup AggregateError wrapper onto the row.
      assert.equal(row.report.runs[0].processSnapshot?.at, 'watchdog');
      assert.equal(row.report.runs[0].failureKind, 'watchdog', 'kind recovered through wrappers');
      assert.deepEqual(row.report.runs[0].appStatus, ['Not placed · fixture']);
      // H1 signal: the failed row carries the age of the candidate's installed binaries.
      assert.ok(row.report.runs[0].msSinceInstall >= 60000, 'install age from the pinned time');
    } else {
      assert.equal(row.report.runs[0].processSnapshot, null);
      assert.deepEqual(row.report.runs[0].appStatus, []);
    }
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
  // Execution follows the recorded phased schedule: the pool first (priority as queue order
  // inside it), the serialized lane, then timing-sensitive checks last. The fixture's pair is
  // one pool check and one timing-sensitive check, so the priority check leads every run and
  // the timing-sensitive check closes it; the priority run is distinguished by its provenance.
  const scriptOf = (row, id) => row.selectedById[id];
  for (const row of rows) {
    assert.deepEqual(
      row.order,
      row.report.schedule.checks.map((id) => row.selectedById[id]),
      'execution order is the recorded phased schedule',
    );
    assert.deepEqual(row.report.schedule.phases.timing, ['qualify-workshop']);
    assert.equal(row.order.at(-1), scriptOf(row, 'qualify-workshop'));
  }
  assert.equal(rows[2].report.priority.provenance, 'captured changed files');
  assert.equal(rows[0].report.priority.reasons.length, 0, 'no priority without changed files');
  assert.ok(rows[1].report.priority.reasons.some((r) => r.id === 'verify-attachment-status'));
  assert.deepEqual(
    rows[0].report.runs.map((r) => r.id),
    rows[1].report.runs.map((r) => r.id),
  );
  assert.equal(rows[1].report.status, 'failed');
  for (const run of rows[1].report.runs) {
    const conditions = run.measurementConditions;
    assert.equal(conditions.scheduleIndex, rows[1].report.schedule.checks.indexOf(run.id));
    assert.ok(Number.isFinite(Date.parse(conditions.startedAt)));
    assert.equal(conditions.hostLoadAverage.length, 3);
    assert.ok(Array.isArray(conditions.activeBrowserChecks));
  }

  // Live snapshots are taken at each execution; index them by the phased schedule, not by
  // the canonical run order the report keeps.
  // The deliberately failing check is the pool check, so it executes first in every row: at
  // the second snapshot it has failed while the timing-sensitive check is running, and the
  // final report still records the timing-sensitive check as passed.
  const executed = (row, i) => row.report.schedule.checks[i];
  for (const row of [rows[0], rows[1]]) {
    assert.equal(row.liveRuns[1].find((r) => r.id === executed(row, 0)).status, 'failed');
    assert.equal(row.liveRuns[1].find((r) => r.id === executed(row, 1)).status, 'running');
    assert.equal(row.report.runs.find((r) => r.id === executed(row, 1)).status, 'passed');
  }
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
    // A passing receipt's value names the evidence a later candidate must find intact.
    const saved = row.savedValues.filter((s) => s.id === 'browser:verify-browser');
    if (!row.childFailed && !row.cleanupFailed) {
      assert.equal(saved.length, 1, 'saved once, reused once');
      const checksums = saved[0].value.evidenceChecksums;
      assert.deepEqual(checksums[0], { path: original.runs[0].evidenceDirectory, directory: true });
      const witness = checksums.find((c) => c.path.endsWith('/witness.json'));
      assert.equal(witness.bytes, Buffer.byteLength(row.originalBytes));
      assert.equal(witness.sha256, createHash('sha256').update(row.originalBytes).digest('hex'));
      const log = checksums.find((c) => c.path === original.runs[0].log);
      assert.equal(log.sha256, createHash('sha256').update(row.originalLog).digest('hex'));
    } else assert.equal(saved.length, 0, 'a failed or unretained leaf is never saved');
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
  assert.equal(rows.length, 3);
  assert.equal(rows[0].ok, true, JSON.stringify(rows[0]));
  assert.equal(rows[1].ok, false);
  assert.match(rows[1].failure, /explicit development probes/);
  assert.deepEqual(rows[1].runs, []);
  // Without a tier context nothing is derived from the host: two workers, and the timing
  // phase is not gated on a quiet host (hosted CI runners are never quiet).
  assert.equal(rows[2].ok, true, JSON.stringify(rows[2]));
  assert.equal(rows[2].workers, 2);
  assert.deepEqual(
    { ...rows[2].workersBasis, load1: undefined },
    { explicit: 2, derived: false, load1: undefined },
  );
  assert.equal(rows[2].timingAdmission.skipped, 'no tier context');
  assert.equal(rows[2].timingAdmission.admitted, true);
  assert.deepEqual(rows[2].schedule.phases.timing, ['qualify-workshop']);
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

test('history uses one snapshot and accepts last-writer-wins hint loss', async (t) => {
  const { writeBrowserHistory, readBrowserHistory } = await import(
    '../scripts/browser-history.mjs'
  );
  const { readdirSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'simple-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'history.json');
  for (let observedAt = 1; observedAt <= 10; observedAt++)
    writeBrowserHistory(path, [{ id: 'check', ok: false, observedAt }]);
  assert.deepEqual(readdirSync(root), ['history.json']);
  // A competing writer can lose a hint; hints cannot admit or skip a check.
  writeFileSync(path, JSON.stringify({ runs: [{ id: 'check', ok: true, observedAt: 5 }] }));
  assert.equal(readBrowserHistory(path).get('check').ok, true);
});

test('a browser receipt is bound to its registered row, not the worker count of the run that took it', (t) => {
  // The scheduler derives workers per run; a receipt taken under a three-worker pool must be
  // offered to a two-worker run, so the worker count is a measurement condition on the row and
  // never part of receipt identity. The channel version is part of it for system browsers only.
  const check = {
    id: 'ball',
    script: 'scripts/verify-ball-browser.mjs',
    timeoutMs: 90000,
    environment: 'workshop',
    execution: 'parallel',
  };
  const configuration = browserReceiptConfiguration(check);
  assert.deepEqual(configuration, {
    script: check.script,
    timeoutMs: 90000,
    environment: 'workshop',
    execution: 'parallel',
  });
  assert.equal('workers' in configuration, false);
  const chrome = browserReceiptConfiguration({ ...check, browserChannel: 'chrome' });
  assert.equal(chrome.browserChannel, 'chrome');
  assert.equal(typeof chrome.browserVersion, 'string');
  // Round trip through the signed ledger: saved by an attempt at workers 3, loaded at workers 2.
  const dir = mkdtempSync(join(tmpdir(), 'receipt-workers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identity = { source: 'fixed', environmentDigest: 'same' };
  const ledger = (workers) =>
    createLeafLedger({
      directory: dir,
      key: Buffer.alloc(32, 4),
      identity,
      eligible: ['browser:ball'],
      saveEligible: null,
      origin: { attempt: `attempt-at-${workers}`, report: '/r' },
    });
  ledger(3).save('browser:ball', browserReceiptConfiguration(check), { code: 0 }, 10);
  const offered = ledger(2).load('browser:ball', browserReceiptConfiguration(check));
  assert.ok(offered, 'receipt offered across worker counts');
  assert.equal(offered.origin.attempt, 'attempt-at-3');
  assert.equal(
    ledger(2).load('browser:ball', {
      ...browserReceiptConfiguration(check),
      execution: 'exclusive',
    }),
    null,
    'a changed execution class still refuses reuse',
  );
});
