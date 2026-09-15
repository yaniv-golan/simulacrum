import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAttestation } from './candidate-after.mjs';

/**
 * Guarded landing: fast-forward `main` to a frozen tip only when a passing merge attempt
 * report for exactly that tip, attested by its own candidate key, names the current
 * `main` as the commit it integrated against and recorded exactly the tip's bytes.
 * Everything a landing message used to ask a person to confirm by hand is checked here.
 * Trust boundary: the report is admitted by the HMAC under its candidate directory's
 * 0600 resume key — the same same-UID class as receipts — never by its path alone.
 */
export const LANDABLE_STATUSES = Object.freeze([
  'passed',
  'passed after failure',
  'passed with reused receipts',
]);
export const LANDABLE_TIERS = Object.freeze(['merge']);
const usage = 'land <tip> [--report <attempt report.json>] [--dry-run]';

export function parseLandArgs(argv) {
  const options = { tip: null, report: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--report') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--') || options.report) throw Error(usage);
      options.report = argv[++i];
    } else if (arg.startsWith('--') || options.tip) throw Error(usage);
    else options.tip = arg;
  }
  if (!options.tip) throw Error(usage);
  return options;
}

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The tip's tree as `{ entry, mode, oid, path }` rows in the report's `candidate.index` shape. */
export function readTree(cwd, sha) {
  return execFileSync(
    'git',
    ['ls-tree', '-r', '--full-tree', '-z', '--format=%(objectmode) %(objectname) 0\t%(path)', sha],
    { cwd, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [mode, oid] = entry.split(' ');
      return { entry, mode, oid, path: entry.slice(entry.indexOf('\t') + 1) };
    });
}

/** sha256 of every blob, read in one cat-file batch. */
export function blobDigests(cwd, rows) {
  if (!rows.length) return new Map();
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: rows.map((row) => row.oid).join('\n') + '\n',
    maxBuffer: 1 << 30,
  });
  const digests = new Map();
  let offset = 0;
  for (const row of rows) {
    const end = out.indexOf(10, offset);
    const [oid, type, size] = out.subarray(offset, end).toString().split(' ');
    if (oid !== row.oid || type !== 'blob') throw Error(`cannot read blob ${row.oid} (${type})`);
    const start = end + 1,
      length = Number(size);
    digests.set(row.path, sha256(out.subarray(start, start + length)));
    offset = start + length + 1;
  }
  return digests;
}

/** Refuse anything but an attested passing merge attempt for exactly this tip and this main. */
export function assertLandable({
  tip,
  mainSha,
  report,
  reportPath,
  tree,
  digests,
  dirty,
  onMain,
  ancestor,
  readKey,
}) {
  const refuse = (why) => {
    throw Error(`refusing to land ${tip.slice(0, 7)}: ${why}`);
  };
  if (!onMain) refuse('the checkout is not on main');
  if (dirty.length) refuse(`tracked files are modified (${dirty.slice(0, 3).join(', ')})`);
  if (!report || typeof report !== 'object') refuse(`no attempt report (${reportPath ?? 'none'})`);
  if (!LANDABLE_STATUSES.includes(report.status))
    refuse(`report status is ${JSON.stringify(report.status)}, not a passing attempt`);
  if (!LANDABLE_TIERS.includes(report.tier))
    refuse(`report tier is ${JSON.stringify(report.tier)}; a landing cites merge evidence only`);
  if (report.verification?.hostProfile || report.verification?.measurement === true)
    refuse('a hosted-profile or measurement report is never landing evidence');
  if (typeof report.directory !== 'string' || typeof report.attemptReport !== 'string')
    refuse('the report does not name its candidate directory and attempt path');
  const attempts = resolve(report.directory, 'attempts') + sep;
  if (!reportPath || !resolve(reportPath).startsWith(attempts))
    refuse(`the report was read from outside its candidate's attempts (${reportPath})`);
  if (resolve(reportPath) !== resolve(report.attemptReport))
    refuse('the report path is not the attempt path it records');
  try {
    verifyAttestation(report, () => readKey(report.directory));
  } catch (error) {
    refuse(error.message);
  }
  if (report.candidate?.head !== tip)
    refuse(`the report verified ${String(report.candidate?.head).slice(0, 7)}, not this tip`);
  // A branch-pair merge names its destination; a routine `merge --base` pinned the commit
  // the delta was selected against, which for a fast-forward is the same evidence.
  const integrated = report.priority?.destination ?? report.priority?.base;
  if (integrated !== mainSha)
    refuse(
      `the report integrated against ${String(integrated).slice(0, 7)}, not the current main ${mainSha.slice(0, 7)}`,
    );
  if (report.destinationStillMatches === false)
    refuse('the report recorded its destination as already drifted');
  const recorded = new Set(
    String(report.candidate?.index ?? '')
      .split('\0')
      .filter(Boolean),
  );
  const actual = new Set(tree.map((row) => row.entry));
  const missing = [...recorded].filter((e) => !actual.has(e)),
    extra = [...actual].filter((e) => !recorded.has(e));
  if (missing.length || extra.length)
    refuse(
      `the tip's tree differs from the verified index (${missing.length} recorded entries absent, ${extra.length} unrecorded)`,
    );
  // The index says which blobs were staged; the verified bytes are the working tree's.
  const files = report.candidate?.files ?? {};
  const tracked = new Set(tree.map((row) => row.path));
  const untracked = Object.keys(files).filter((p) => !tracked.has(p));
  if (untracked.length)
    refuse(
      `the verified bytes included untracked files not in the tip (${untracked.slice(0, 3).join(', ')})`,
    );
  for (const row of tree) {
    const file = files[row.path];
    if (!file || file.deleted) refuse(`${row.path} was missing from the verified bytes`);
    if (!['100644', '100755'].includes(row.mode)) refuse(`${row.path} is not a regular file`);
    if (file.sha256 !== digests.get(row.path))
      refuse(`${row.path} was verified with different bytes than the tip carries`);
    if (Boolean(file.mode & 0o100) !== (row.mode === '100755'))
      refuse(`${row.path} was verified with a different mode than the tip carries`);
  }
  if (!ancestor) refuse('main is not an ancestor of the tip; the landing would not fast-forward');
}

/** Passing merge attempt reports for `tip` under the candidate roots, newest first. */
export function findLandingReports(tip, { roots = [tmpdir()] } = {}) {
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.startsWith('simulacrum-candidate-')) continue;
      const attempts = join(root, dir, 'attempts');
      let ids = [];
      try {
        ids = readdirSync(attempts);
      } catch {
        continue;
      }
      for (const attempt of ids) {
        const path = join(attempts, attempt, 'report.json');
        try {
          const report = JSON.parse(readFileSync(path, 'utf8'));
          if (report?.candidate?.head === tip && LANDABLE_STATUSES.includes(report.status))
            found.push({ path, report });
        } catch {
          // A missing or unreadable report is not evidence.
        }
      }
    }
  }
  return found.sort((a, b) => String(b.report.startedAt).localeCompare(String(a.report.startedAt)));
}

const defaultReadKey = (directory) => readFileSync(join(resolve(directory), 'resume-key'));

export function land(argv, { cwd = process.cwd(), roots, log = console.log, readKey } = {}) {
  const options = parseLandArgs(argv);
  const tip = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${options.tip}^{commit}`]);
  const mainSha = git(cwd, ['rev-parse', '--verify', 'refs/heads/main']);
  if (mainSha === tip) {
    log(JSON.stringify({ tip, landed: false, alreadyLanded: true }));
    return { tip, landed: false, alreadyLanded: true };
  }
  let onMain = false;
  try {
    onMain = git(cwd, ['symbolic-ref', '--quiet', 'HEAD']) === 'refs/heads/main';
  } catch {
    onMain = false;
  }
  const dirty = git(cwd, ['status', '--porcelain', '--untracked-files=no'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  let ancestor = true;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', mainSha, tip], { cwd, stdio: 'ignore' });
  } catch {
    ancestor = false;
  }
  const candidates = options.report
    ? [{ path: options.report, report: JSON.parse(readFileSync(options.report, 'utf8')) }]
    : findLandingReports(tip, { roots });
  const tree = readTree(cwd, tip),
    digests = blobDigests(cwd, tree);
  const shared = { tip, mainSha, tree, digests, dirty, onMain, ancestor };
  const key = readKey ?? defaultReadKey;
  // The newest report is not necessarily the landable one: the same tip may have been
  // verified against another destination later. Take the first that passes; if none does,
  // report the newest one's reason.
  let chosen = null,
    firstRefusal = null;
  for (const candidate of candidates.length ? candidates : [null]) {
    try {
      assertLandable({
        ...shared,
        report: candidate?.report ?? null,
        reportPath: candidate?.path ?? null,
        readKey: key,
      });
      chosen = candidate;
      break;
    } catch (error) {
      firstRefusal ??= error;
    }
  }
  if (!chosen) throw firstRefusal;
  const verdict = {
    tip,
    from: mainSha,
    attempt: chosen.report.attempt,
    tier: chosen.report.tier,
    status: chosen.report.status,
    attestation: chosen.report.attestation,
    report: chosen.path,
  };
  if (options.dryRun) {
    log(JSON.stringify({ ...verdict, landed: false, dryRun: true }));
    return { ...verdict, landed: false };
  }
  git(cwd, ['merge', '--ff-only', tip]);
  const after = git(cwd, ['rev-parse', '--verify', 'refs/heads/main']);
  if (after !== tip)
    throw Error(`main is ${after.slice(0, 7)} after the merge, not ${tip.slice(0, 7)}`);
  log(JSON.stringify({ ...verdict, landed: true, main: after }));
  return { ...verdict, landed: true, main: after };
}

const invoked = (() => {
  try {
    const script = realpathSync(fileURLToPath(import.meta.url));
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === script;
  } catch {
    return false;
  }
})();
if (invoked) {
  try {
    land(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
