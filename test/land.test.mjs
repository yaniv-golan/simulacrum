import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { land, findLandingReports, parseLandArgs } from '../scripts/land.mjs';
import { attestReport } from '../scripts/candidate-after.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'land-repo-')),
    reports = mkdtempSync(join(tmpdir(), 'land-reports-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'one');
  git('add', 'a.txt');
  git('commit', '-qm', 'first');
  const main = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'candidate');
  writeFileSync(join(root, 'b.txt'), 'two');
  git('add', 'b.txt');
  git('commit', '-qm', 'candidate work');
  const tip = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  const index = execFileSync(
    'git',
    ['ls-tree', '-r', '--full-tree', '-z', '--format=%(objectmode) %(objectname) 0\t%(path)', tip],
    { cwd: root, encoding: 'utf8' },
  );
  const files = () => ({
    'a.txt': { sha256: sha256('one'), mode: 0o644 },
    'b.txt': { sha256: sha256('two'), mode: 0o644 },
  });
  let attempts = 0;
  // A report the way a candidate publishes it: in its own directory, attested by that
  // directory's resume key. `patch` overrides fields; `tamper` edits after attestation.
  const report = (patch = {}, { tamper = null, key = null } = {}) => {
    attempts++;
    const directory = join(reports, `simulacrum-candidate-${attempts}`),
      dir = join(directory, 'attempts', `attempt-${attempts}`),
      path = join(dir, 'report.json');
    mkdirSync(dir, { recursive: true });
    const secret = key ?? `key-${attempts}`;
    writeFileSync(join(directory, 'resume-key'), secret);
    const body = {
      status: 'passed',
      tier: 'merge',
      attempt: `attempt-${attempts}`,
      startedAt: `2026-09-15T${String(attempts).padStart(2, '0')}:00:00.000Z`,
      directory,
      attemptReport: path,
      candidate: { head: tip, index, files: files() },
      priority: { base: main, destination: main },
      destinationStillMatches: true,
      verification: {},
      ...patch,
    };
    body.attestation = attestReport(body, secret);
    Object.assign(body, tamper ?? {});
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  return { root, reports, git, main, tip, index, files, report };
}
const quiet = () => {};

test('land fast-forwards main only for a passing merge report of exactly this tip on this main', (t) => {
  const { root, reports, git, main, tip, report } = repo(t);
  report();
  const dry = land([tip, '--dry-run'], { cwd: root, roots: [reports], log: quiet });
  assert.equal(dry.landed, false);
  assert.equal(git('rev-parse', 'main'), main, 'dry run merges nothing');
  const result = land([tip], { cwd: root, roots: [reports], log: quiet });
  assert.equal(result.landed, true);
  assert.equal(result.from, main);
  assert.match(result.attestation, /^[a-f0-9]{64}$/);
  assert.equal(git('rev-parse', 'main'), tip);
  const again = land([tip], { cwd: root, roots: [reports], log: quiet });
  assert.equal(again.landed, false, 'a landed tip is reported, not re-merged');
});

test('land refuses every wrong trace a person used to check by hand', (t) => {
  const { root, reports, git, main, tip, index, files, report } = repo(t);
  const run = (args, roots = [reports]) => land(args, { cwd: root, roots, log: quiet });
  const attempt = (patch, pattern, options) => {
    const path = report(patch, options);
    assert.throws(() => run([tip, '--report', path]), pattern);
    assert.equal(git('rev-parse', 'main'), main, 'nothing landed');
    return path;
  };
  attempt({ status: 'failed' }, /not a passing attempt/);
  attempt({ tier: 'final' }, /cites merge evidence only/);
  attempt({ tier: 'local' }, /cites merge evidence only/);
  attempt({ verification: { hostProfile: 'github-ubuntu-2cpu' } }, /hosted-profile or measurement/);
  attempt({ verification: { measurement: true } }, /hosted-profile or measurement/);
  attempt({}, /attestation does not match/, { tamper: { priority: { destination: main } } });
  attempt({}, /attestation does not match/, { tamper: { attestation: 'a'.repeat(64) } });
  attempt({ candidate: { head: main, index, files: files() } }, /not this tip/);
  attempt({ priority: { destination: tip } }, /not the current main/);
  attempt({ priority: { base: tip } }, /not the current main/, {});
  attempt({ destinationStillMatches: false }, /already drifted/);
  const wrongIndex = `100644 ${'0'.repeat(40)} 0\tb.txt`;
  attempt({ candidate: { head: tip, index: wrongIndex, files: files() } }, /differs from the/);
  const extra = { ...files(), 'scratch.mjs': { sha256: sha256('x'), mode: 0o644 } };
  attempt({ candidate: { head: tip, index, files: extra } }, /untracked files/);
  const edited = { ...files(), 'a.txt': { sha256: sha256('edited'), mode: 0o644 } };
  attempt({ candidate: { head: tip, index, files: edited } }, /different bytes than the tip/);
  const gone = { ...files(), 'b.txt': { deleted: true } };
  attempt({ candidate: { head: tip, index, files: gone } }, /missing from the verified bytes/);
  const executable = { ...files(), 'b.txt': { sha256: sha256('two'), mode: 0o755 } };
  attempt({ candidate: { head: tip, index, files: executable } }, /different mode than the tip/);
  // A copy of a good report outside its candidate's attempts is not evidence.
  const good = report();
  const copy = join(reports, 'copied-report.json');
  writeFileSync(copy, readFileSync(good));
  assert.throws(() => run([tip, '--report', copy]), /outside its candidate's attempts/);
  const empty = mkdtempSync(join(tmpdir(), 'no-reports-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.throws(() => run([tip], [empty]), /no attempt report/);
  // Dirty tracked tree.
  writeFileSync(join(root, 'a.txt'), 'edited');
  assert.throws(() => run([tip]), /tracked files are modified/);
  git('checkout', '--', 'a.txt');
  // Not on main.
  git('checkout', '-q', '--detach', 'main');
  assert.throws(() => run([tip]), /not on main/);
  git('checkout', '-q', 'main');
  // Main moved on: the report's destination is stale and the merge is no fast-forward.
  writeFileSync(join(root, 'c.txt'), 'three');
  git('add', 'c.txt');
  git('commit', '-qm', 'main moved');
  const moved = git('rev-parse', 'main');
  assert.throws(() => run([tip]), /not the current main/);
  const stale = report({ priority: { destination: moved } });
  assert.throws(() => run([tip, '--report', stale]), /would not fast-forward/);
  assert.equal(git('rev-parse', 'main'), moved);
});

test('land takes routine merge evidence pinned to main and skips a newer report against another destination', (t) => {
  const { root, reports, git, main, tip, report } = repo(t);
  report({ priority: { base: main } });
  report({ priority: { base: main, destination: tip, destinationName: 'other-stack' } });
  const result = land([tip], { cwd: root, roots: [reports], log: quiet });
  assert.equal(result.landed, true);
  assert.equal(result.attempt, 'attempt-1', 'the older, landable report was chosen');
  assert.equal(git('rev-parse', 'main'), tip);
});

test('landing report lookup returns only passing reports for the tip, newest first', (t) => {
  const { reports, tip, main, index, files, report } = repo(t);
  report({ status: 'failed' });
  report({ candidate: { head: main, index, files: files() } });
  report({ startedAt: '2026-09-15T01:00:00.000Z' });
  const newest = report({ startedAt: '2026-09-15T09:00:00.000Z', status: 'passed after failure' });
  const found = findLandingReports(tip, { roots: [reports] });
  assert.deepEqual(
    found.map((f) => f.report.startedAt),
    ['2026-09-15T09:00:00.000Z', '2026-09-15T01:00:00.000Z'],
  );
  assert.equal(found[0].path, newest);
  assert.deepEqual(findLandingReports('0'.repeat(40), { roots: [reports] }), []);
  assert.deepEqual(parseLandArgs(['abc', '--report', 'r.json', '--dry-run']), {
    tip: 'abc',
    report: 'r.json',
    dryRun: true,
  });
  assert.throws(() => parseLandArgs([]), /land <tip>/);
  assert.throws(() => parseLandArgs(['a', 'b']), /land <tip>/);
});
