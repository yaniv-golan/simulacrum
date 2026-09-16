/** A release's `final` run on byte-identical code is that commit's merge evidence — recorded as a
 * citation, never as a skipped tier. Pure decisions over two records: the merge candidate's own
 * capture (head, files, installed dependency digest) and the release directory's `source.json`
 * (the same fields, written by `release:prepare` after `npm ci` and before `verify:final`),
 * plus the release's `verification-final.json` once the final has ended and its `release.json`
 * once packaged. The candidate command wires them; `readRelease` is the only reader.
 * Compared: head, every tracked and non-ignored path's sha256 and mode, the installed digest.
 * Never compared: the git index (a `git add` is not a byte change) and the process identity
 * (informational until the narrowed environment digest lands with the candidate). Deleted
 * entries are normalised away: a release is only ever prepared from a tree without deleted
 * tracked files, so the case exists on the candidate side alone. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPackageVerification } from './playtest/package-verification.mjs';

export const CITATION_BASIS = 'identical tree and dependencies';
export const PENDING_EXIT_CODE = 3;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const liveFiles = (files = {}) =>
  Object.fromEntries(Object.entries(files).filter(([, row]) => row && row.deleted !== true));

/** Differences between a candidate capture and a cited record, by name. */
export function compareIdentity(candidate, cited) {
  const differing = { head: false, files: [], installed: false };
  if (!candidate?.head || !cited?.head || candidate.head !== cited.head) differing.head = true;
  const a = liveFiles(candidate?.files),
    b = liveFiles(cited?.files);
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)]).values())
    if (a[path]?.sha256 !== b[path]?.sha256 || a[path]?.mode !== b[path]?.mode)
      differing.files.push(path);
  differing.files.sort();
  if (
    typeof candidate?.installed !== 'string' ||
    typeof cited?.installed !== 'string' ||
    candidate.installed !== cited.installed
  )
    differing.installed = true;
  return {
    same: !differing.head && !differing.files.length && !differing.installed,
    differing,
  };
}
export function describeDifference({ differing }) {
  const parts = [];
  if (differing.head) parts.push('head');
  if (differing.files.length)
    parts.push(
      `${differing.files.length} path(s): ${differing.files.slice(0, 8).join(', ')}${differing.files.length > 8 ? ', …' : ''}`,
    );
  if (differing.installed) parts.push('installed dependency digest');
  return parts.join('; ');
}

/** The release directory as a record: `source.json` is required; the final report and the
 * package are present only once each has ended. Bytes are pinned by sha256 so a later
 * `cite-final` resolves against the same release, not a re-prepared one. */
export function readRelease(directory, { read = readFileSync, exists = existsSync } = {}) {
  const sourcePath = join(directory, 'source.json');
  if (!exists(sourcePath)) throw Error(`release ${directory} has no source.json`);
  const sourceBytes = read(sourcePath);
  const source = JSON.parse(sourceBytes);
  const finalPath = join(directory, 'source', 'artifacts', 'verification-final.json');
  const finalBytes = exists(finalPath) ? read(finalPath) : null;
  const packagePath = join(directory, 'release.json');
  const packageBytes = exists(packagePath) ? read(packagePath) : null;
  return {
    directory,
    source,
    sourceSha256: sha(sourceBytes),
    final: finalBytes ? JSON.parse(finalBytes) : null,
    finalSha256: finalBytes ? sha(finalBytes) : null,
    package: packageBytes ? JSON.parse(packageBytes) : null,
    packageSha256: packageBytes ? sha(packageBytes) : null,
  };
}

/** The final's report exists from its first phase (`status: 'running'`, rewritten as phases
 * end); only a terminal status is a result. A green final is then packaged; until
 * `release.json` exists the release's own post-tier checks (dependency drift, source drift)
 * have not passed, so the citation stays pending on the package. */
export const finalEnded = (final) => ['passed', 'failed'].includes(final?.status);
const finalPassed = (final) =>
  final?.status === 'passed' && final?.outcome?.automation?.status === 'PASS';
const finalFailure = (final) =>
  final?.failure ??
  final?.results?.find((row) => row.ok === false)?.error ??
  'release final automation did not pass';
/** What a citation waits on, or null when the release is complete. */
export function pendingOn(release) {
  if (!finalEnded(release.final)) return 'final';
  if (finalPassed(release.final) && !release.package) return 'package';
  return null;
}

/** Why a packaged release cannot be cited, or null: the package's own integrity envelope
 * first, then its binding to the cited source (head, source hash, installed digest). */
export function packageRefusal(release) {
  if (!release.package) return null;
  try {
    assertPackageVerification(release.package);
  } catch (error) {
    return `release package refused: ${error.message}`;
  }
  const envelope = release.package.verification;
  const sourceHash = sha(JSON.stringify(release.source.source));
  if (
    release.package.head !== release.source.head ||
    envelope?.sourceHash !== sourceHash ||
    (typeof envelope?.installed === 'string' && envelope.installed !== release.source.installed)
  )
    return 'release package does not match the cited source (head, source hash or installed digest)';
  return null;
}
/** The merge candidate's status from a release record. `passed` when the release's final has
 * passed on identical bytes; `pending final` when the release records the bytes but its final
 * has not ended; refused otherwise. A refusal names what differs. */
/** Why a release record cannot be compared at all, or null: a release prepared before the
 * record existed has nothing to cite. */
export function recordRefusal(release) {
  const { source } = release;
  return typeof source?.installed !== 'string' || !source?.files
    ? `release ${release.directory} records no dependency digest or file inventory; nothing to compare`
    : null;
}
export function citeRelease({ candidate, installed, release }) {
  const { source } = release;
  const unrecorded = recordRefusal(release);
  if (unrecorded) return { status: 'refused', reason: unrecorded };
  const comparison = compareIdentity(
    { head: candidate.head, files: candidate.files, installed },
    { head: source.head, files: source.files, installed: source.installed },
  );
  if (!comparison.same)
    return {
      status: 'refused',
      reason: `release ${release.directory} was prepared from different bytes: ${describeDifference(comparison)}`,
      differing: comparison.differing,
    };
  const satisfiedBy = {
    kind: 'release-final',
    release: release.directory,
    sourceJsonSha256: release.sourceSha256,
    verificationFinalSha256: release.finalSha256,
    head: source.head,
    installed: source.installed,
    environment: finalEnded(release.final)
      ? {
          runtime: release.final.runtime ?? null,
          platform: release.final.platform ?? null,
          arch: release.final.arch ?? null,
          environmentDigest: release.final.environmentDigest ?? null,
        }
      : (source.identity ?? null),
  };
  const waiting = pendingOn(release);
  if (waiting)
    return {
      status: 'pending final',
      mergeReadiness: { satisfiedBy, basis: CITATION_BASIS, pending: true, pendingOn: waiting },
      summary: `merge readiness of ${source.head.slice(0, 7)} pending release ${waiting} ${release.directory}`,
    };
  if (JSON.stringify(release.final.source?.head) !== JSON.stringify(source.head))
    return {
      status: 'refused',
      reason: `release final reports head ${release.final.source?.head} for a release prepared from ${source.head}`,
    };
  if (!finalPassed(release.final))
    return {
      status: 'refused',
      reason: `release final did not pass: ${finalFailure(release.final)}`,
      mergeReadiness: { satisfiedBy, basis: CITATION_BASIS, pending: false, failed: true },
    };
  const refused = packageRefusal(release);
  if (refused) return { status: 'refused', reason: refused };
  return {
    status: 'passed',
    mergeReadiness: {
      satisfiedBy: { ...satisfiedBy, packageSha256: release.packageSha256 },
      basis: CITATION_BASIS,
      pending: false,
    },
    summary: `merge readiness of ${source.head.slice(0, 7)} satisfied by release final ${release.directory}, identical tree`,
  };
}

/** Resolve a pending citation once the release's final has ended: the same release (source.json
 * bytes pinned), the same tree and dependencies, and — when packaged — a package whose
 * verification envelope carries the same source hash. */
export function resolveCitation({ citation, candidate, installed, release, landed = null }) {
  const pinned = citation.mergeReadiness?.satisfiedBy;
  if (!pinned || pinned.kind !== 'release-final' || citation.status !== 'pending final')
    throw Error('cite-final needs a merge report whose merge readiness is pending a release final');
  if (pinned.sourceJsonSha256 !== release.sourceSha256)
    return {
      status: 'refused',
      reason: `release ${release.directory} was re-prepared since the citation (source.json changed)`,
    };
  const again = citeRelease({ candidate, installed, release });
  if (again.status === 'pending final') return again;
  if (again.status === 'refused' && !again.mergeReadiness) return again;
  const readiness = {
    ...again.mergeReadiness,
    satisfiedBy: {
      ...again.mergeReadiness.satisfiedBy,
      verificationFinalSha256: release.finalSha256,
    },
    resolvedAt: new Date().toISOString(),
    // Whether main was the cited head where cite-final ran; null outside a repository.
    landed,
  };
  return again.status === 'passed'
    ? { status: 'passed', mergeReadiness: readiness, summary: again.summary }
    : {
        status: 'failed',
        reason: again.reason,
        mergeReadiness: readiness,
        summary: `merge readiness of ${release.source.head.slice(0, 7)} failed: ${again.reason}`,
      };
}
export const exitCodeFor = (status) =>
  status === 'passed' ? 0 : status === 'pending final' ? PENDING_EXIT_CODE : 1;

const citeUsage =
  'Usage: verify:candidate -- merge (--base <commit> --incoming <commit> --destination <ref> | --stack <ref>) --satisfied-by <release directory> [--pending]';
/** Strip --satisfied-by/--pending from the tier arguments before the tier parses them. A
 * citation is a merge tier only, never a retry, resume or final; a pending citation (the
 * release's final still running) must be asked for by the slot owner. */
export function parseCiteArgs(argv) {
  const rest = [];
  let satisfiedBy = null,
    pending = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--satisfied-by') {
      if (satisfiedBy !== null || !argv[i + 1] || argv[i + 1].startsWith('-'))
        throw Error(`${citeUsage}\n--satisfied-by needs one release directory`);
      satisfiedBy = argv[++i];
    } else if (arg === '--pending') pending = true;
    else rest.push(arg);
  }
  if (satisfiedBy === null) {
    if (pending) throw Error(`${citeUsage}\n--pending needs --satisfied-by`);
    return { rest, satisfiedBy: null, pending: false };
  }
  if (rest[0] !== 'merge')
    throw Error(`${citeUsage}\n--satisfied-by cites a release final as merge evidence only`);
  if (rest.includes('--after') || rest.includes('--cause'))
    throw Error(
      `${citeUsage}\n--satisfied-by cannot be combined with --after; a citation runs nothing to retry`,
    );
  return { rest, satisfiedBy, pending };
}
/** The tier record a citation publishes in place of a run: no phases executed, no receipts,
 * nothing reusable; the citation row carries the decision. */
export function citationVerification({ tier, citation, options, source }) {
  return {
    tier,
    citation: true,
    reusable: false,
    scope: 'MERGE_ONLY',
    priority: options,
    source,
    status:
      citation.status === 'passed'
        ? 'passed'
        : citation.status === 'pending final'
          ? 'pending final'
          : 'failed',
    results: [
      {
        id: 'citation',
        status:
          citation.status === 'passed'
            ? 'passed'
            : citation.status === 'pending final'
              ? 'pending'
              : 'failed',
        ok: citation.status === 'passed',
        result: citation,
      },
    ],
    checks: [],
    outcome: {
      automation: {
        status:
          citation.status === 'passed'
            ? 'PASS'
            : citation.status === 'pending final'
              ? 'PENDING'
              : 'FAIL',
        detail: citation.summary ?? citation.reason,
      },
      qualification: { status: 'NOT_EVALUATED' },
      humanAcceptance: { status: 'NOT_EVALUATED' },
    },
  };
}
