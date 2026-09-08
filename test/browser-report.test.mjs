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
