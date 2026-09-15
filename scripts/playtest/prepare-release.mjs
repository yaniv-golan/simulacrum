import { sourceIdentity } from '../source-identity.mjs';
import { assertPackageVerification, verificationHash } from './package-verification.mjs';
import {
  classifyParentLeaves,
  reuseSet,
  reuseSummary,
  validateReuseReport,
  verifyAttestation,
} from '../candidate-after.mjs';
import { readLeafRow } from '../verification-resume.mjs';
import { dependencyDigest, readResumeDescriptor } from '../candidate-resume.mjs';
import { candidateMatchesOrigin, identityFiles } from '../candidate.mjs';
import { requireAttemptReport } from '../candidate-attempt.mjs';
import { processIdentity } from '../verification-environment.mjs';
import {
  FINAL_PHASES,
  LAUNCH_ADMISSION_ID,
  LAUNCH_WAIT_VARIABLE,
  describeLaunchRefusal,
} from '../verification-tiers.mjs';
import { verificationOutcome } from '../verification-outcome.mjs';
import { assertRuntime } from '../runtime-preflight.mjs';
import { hostReadiness } from '../verify-host.mjs';
export const RELEASE_LAUNCH_WAIT_MS = 300000;
// One frozen verification and package path shared by local and CI releases.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative, basename, dirname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd, env = process.env) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env });
const text = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
async function inventory(root) {
  const result = {};
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('Release symlinks forbidden');
      if (entry.isDirectory()) await visit(path);
      else result[relative(root, path).replaceAll('\\', '/')] = sha(await readFile(path));
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
// The tier's environment never inherits a resume ledger by accident: a plain release strips the
// two variables, a citing release sets its own.
function tierEnvironment(ledger, out) {
  const env = {
    ...process.env,
    // The tier's caches live under the release so the recorded dependency digest survives it.
    SIMULACRUM_VITE_CACHE_DIR: join(out, 'cache', 'vite'),
    MINIFLARE_CACHE_DIR: join(out, 'cache', 'miniflare'),
    // A release final waits longer for a quiet host than a routine tier: a refused attempt plus
    // a manual relaunch costs a fresh snapshot and install. Only the wait lengthens.
    [LAUNCH_WAIT_VARIABLE]: String(RELEASE_LAUNCH_WAIT_MS),
  };
  delete env.SIMULACRUM_LEAF_LEDGER;
  delete env.SIMULACRUM_VERIFICATION_ATTEMPT;
  if (ledger)
    Object.assign(env, {
      SIMULACRUM_LEAF_LEDGER: ledger.path,
      SIMULACRUM_VERIFICATION_ATTEMPT: ledger.attempt,
    });
  return env;
}
/** An experimental release may cite a passed merge candidate's workshop receipts. The parent is
 * admitted through its own attestation and signed descriptor, never the editable report: same
 * tree, same installed dependencies, same relevant environment, a merge tier, no hosted or
 * measurement report, and its own origin still matching at its end. Every refusal names the
 * field; nothing falls back to a plain run. */
export async function admitReleaseParent(after, root) {
  if (process.env.SIMULACRUM_HOST_PROFILE)
    throw Error('Release reuse is refused under a host profile; unset SIMULACRUM_HOST_PROFILE');
  const path = resolve(after);
  const parent = JSON.parse(await readFile(path, 'utf8'));
  verifyAttestation(parent, () => readFileSync(join(resolve(parent.directory), 'resume-key')));
  const parentDirectory = resolve(parent.directory);
  const parentKey = readFileSync(join(parentDirectory, 'resume-key'));
  const descriptor = readResumeDescriptor(parentDirectory, parentKey);
  if (!['passed', 'passed with reused receipts'].includes(parent.status))
    throw Error(
      `Release reuse needs a passed merge parent attempt; parent status is ${parent.status}`,
    );
  if (descriptor.tier !== 'merge' || parent.tier !== 'merge')
    throw Error(
      'Release reuse cites a merge parent attempt only; a local candidate is not release evidence',
    );
  if (!parent.verification || typeof parent.verification !== 'object')
    throw Error('Parent attempt report has no tier receipts');
  requireAttemptReport(parent.verification, parent.attempt);
  if (existsSync(join(parentDirectory, 'active-attempt')))
    throw Error('Parent candidate still has an active attempt');
  if (parent.destinationStillMatches === false)
    throw Error('Parent attempt destination moved before it finished');
  if (parent.originStillMatches !== true)
    throw Error('Parent attempt origin did not still match at its end');
  for (const row of parent.verification.results ?? [])
    if (row?.result?.hostProfile || row?.result?.measurement === true)
      throw Error(
        `Release reuse never cites a hosted-profile or measurement report (${row.id}: ${row.result.hostProfile ?? 'measurement'})`,
      );
  const classification = classifyParentLeaves(parent);
  if (classification.kind !== 'reuse') throw Error('Release reuse needs a passed parent attempt');
  const head = text('git', ['rev-parse', 'HEAD'], root);
  if (descriptor.candidate?.head !== head)
    throw Error(
      `Parent attempt candidate head ${descriptor.candidate?.head} differs from the release HEAD ${head}; cite the merge attempt of this exact commit`,
    );
  const identity = processIdentity(),
    parentIdentity = descriptor.identity ?? {};
  for (const key of ['runtime', 'platform', 'arch', 'environmentDigest'])
    if (identity[key] !== parentIdentity[key])
      throw Error(
        `Release environment identity differs from the parent attempt (${key}); prepare from the candidate's environment`,
      );
  if (!(await candidateMatchesOrigin(root, descriptor.candidate)))
    throw Error('Release source bytes differ from the parent attempt candidate');
  const manifest = JSON.parse(await readFile(join(root, 'scripts/manifest.json'), 'utf8'));
  const { offered } = reuseSet({ classification, manifest });
  if (!offered.length)
    throw Error('Parent attempt offers no reusable workshop receipt; prepare without --after');
  return { parent, parentDirectory, parentKey, descriptor, classification, offered };
}
// Cited evidence is copied into the frozen tree so the package outlives the candidate's temp dir.
async function copyCitedEvidence(admitted, reused, snapshot) {
  const leaves = join(admitted.parentDirectory, 'attempts', admitted.parent.attempt, 'leaves');
  const reusedRoot = join(
    snapshot,
    'artifacts',
    'browser-suite',
    'reused',
    admitted.parent.attempt,
  );
  for (const entry of reused) {
    // The leaf is read with the ledger's own rules and trusted only under the parent's key and
    // only for this receipt.
    let row;
    try {
      row = readLeafRow(join(leaves, sha(entry.id) + '.json'), admitted.parentKey);
    } catch {
      throw Error(`Cited leaf for ${entry.id} is not signed by the parent candidate`);
    }
    if (!row) throw Error(`Cited evidence unavailable for ${entry.id}`);
    if (row.payload?.id !== entry.id)
      throw Error(`Cited leaf for ${entry.id} is not signed by the parent candidate`);
    const checksums = row.payload.value?.evidenceChecksums;
    if (!Array.isArray(checksums) || !checksums.length)
      throw Error(`Cited receipt ${entry.id} carries no retained evidence`);
    const directories = checksums.filter((c) => c?.directory === true);
    if (directories.length !== 1 || typeof directories[0].path !== 'string')
      throw Error(`Cited receipt ${entry.id} has no single evidence directory`);
    const base = resolve(directories[0].path),
      run = dirname(base),
      target = join(reusedRoot, basename(base));
    const copied = [];
    for (const item of checksums) {
      if (item.directory === true) continue;
      const source = resolve(String(item.path));
      // Retained evidence lives in the evidence directory or beside it (the run log); nothing
      // outside the parent's run directory is ever read, and nothing lands outside the copy.
      if (!source.startsWith(run + sep))
        throw Error(`Cited evidence path outside the parent run for ${entry.id}: ${item.path}`);
      const bytes = await readFile(source).catch(() => null);
      if (!bytes || bytes.length !== item.bytes || sha(bytes) !== item.sha256)
        throw Error(`Cited evidence altered or missing for ${entry.id}: ${item.path}`);
      const destination = resolve(target, relative(base, source));
      if (!destination.startsWith(reusedRoot + sep))
        throw Error(`Cited evidence copy escapes the release for ${entry.id}`);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
      copied.push({
        path: relative(snapshot, destination),
        sha256: item.sha256,
        bytes: item.bytes,
      });
    }
    entry.evidenceChecksums = checksums;
    entry.copiedTo = relative(snapshot, target);
    entry.copiedChecksums = copied;
  }
}
/** The package envelope, one pure function for the real prepare and the dry check's rehearsal,
 * so the shape the tier emits and the shape the consumer accepts meet in one place. */
export function releaseEnvelope({
  verification,
  artifact,
  files,
  head,
  source,
  installed,
  timings,
  status,
  reuse = null,
  origin,
  appBuild,
  created,
}) {
  const manifest = {
    verification: {
      artifact,
      sourceHash: sha(JSON.stringify(source)),
      build: verification.build,
      results: verification.results.map(({ id, ok, result }) => ({
        id,
        ok,
        ...(id === 'gate'
          ? {
              result: {
                failed: result.failed,
                unmet: result.unmet,
                dueBarCount: result.dueBarCount,
                bars: result.bars,
              },
            }
          : {}),
      })),
      automation: verification.outcome.automation,
      humanAcceptance: verification.outcome.humanAcceptance,
      source: verification.source,
      runtime: verification.runtime,
      installed,
      checks: verification.checks,
      timings,
      status,
      ...(reuse ? { reuse } : {}),
      bundleCoverage:
        'Backend source is checked by the full suite; Wrangler bundles that same frozen source after verification. Hosted smoke checks the deployed bundle. Local bundle execution is not claimed.',
    },
    schema: 1,
    protocolVersion: 2,
    createOnlyPayloads: true,
    artifact,
    files,
    head,
    sourceHash: sha(JSON.stringify(source)),
    origin,
    appBuild,
    created,
    expires: created + 14 * 86400000,
  };
  manifest.verificationHash = verificationHash(manifest.verification);
  return manifest;
}
const refusedLaunch = (report) => {
  const first = report?.results?.[0];
  return first?.id === LAUNCH_ADMISSION_ID && first.ok === false && first.result ? first : null;
};
/** A report in the shape the current final emits, with nothing real in it: every phase from the
 * shared list, the gate pending its human bar exactly as an experimental release sees it, one
 * receipt per phase. It is built for one consumer check and never written or printed. */
function rehearsalReport(phases, identity) {
  const bar = { id: 'F1', human: true, state: 'RED', assessment: 'pending' };
  const results = phases.map((id) =>
    id === 'gate'
      ? { id, ok: false, result: { failed: 0, unmet: 0, dueBarCount: 1, bars: [bar] } }
      : { id, ok: true },
  );
  const checks = phases
    .filter((id) => id !== LAUNCH_ADMISSION_ID)
    .map((id) => ({ id: `${id}:dry-check`, ok: true, configuration: {}, elapsedMs: 0 }));
  return {
    source: identity,
    build: 'dry-check',
    runtime: process.version,
    results,
    checks,
    outcome: verificationOutcome(results, checks),
  };
}
/** The cheap prerequisites of a release prepare and a rehearsal of its packaging path against
 * the tier's own phase list, in seconds: a development probe that creates nothing under
 * `.release-private/`, writes nothing under `artifacts/` and never enters the verification
 * window. It makes no completion claim and nothing in it is citable. */
export async function dryCheckRelease(
  destination,
  {
    root = process.cwd(),
    phases = FINAL_PHASES,
    requireClean = false,
    run: execute = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }),
    readiness = () => hostReadiness({ reach: 'timing' }),
    runtime = () => assertRuntime(),
  } = {},
) {
  const rows = [];
  const row = async (id, evaluate) => {
    try {
      const detail = await evaluate();
      rows.push({ id, ok: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      rows.push({ id, ok: false, error: error.message });
    }
  };
  const out = resolve(root, destination);
  await row('destination', () => {
    if (!relative(root, out).startsWith('.release-private/'))
      throw Error('Prepare destination must be a new .release-private/<release> directory');
    if (existsSync(out)) throw Error(`Prepare destination exists: ${destination}`);
    return 'new directory under .release-private/ (not created)';
  });
  await row('runtime', () => {
    runtime();
    return process.version;
  });
  let source = null;
  await row('tree', () => {
    let treeFiles;
    try {
      treeFiles = identityFiles(root);
    } catch (error) {
      if (/Secret-like/.test(error.message))
        throw Error('Review secret-like source paths before packaging');
      throw error;
    }
    source = {};
    for (const path of Object.keys(treeFiles).sort())
      if (!treeFiles[path].deleted) source[path] = treeFiles[path].sha256;
    const dirty = execute('git', ['status', '--porcelain', '--untracked-files=all'])
      .split('\n')
      .filter(Boolean);
    if (dirty.length && requireClean)
      throw Error(`Working tree is not clean; these would be packaged: ${dirty.join(', ')}`);
    return dirty.length
      ? `${Object.keys(source).length} inputs; modified or untracked, would be packaged: ${dirty.join(', ')}`
      : `${Object.keys(source).length} inputs; clean`;
  });
  await row('format', () => {
    execute('npm', ['run', 'format:check']);
    return 'format:check passed';
  });
  await row('phases', () => {
    const consumer = 'ci,browser,gate';
    const head = '0'.repeat(40),
      inputs = source ?? {};
    const report = rehearsalReport(phases, {
      head,
      workingTreeDigest: sha(JSON.stringify(inputs)),
    });
    const envelope = releaseEnvelope({
      verification: report,
      artifact: 'dry-check',
      files: {},
      head,
      source: inputs,
      installed: 'dry-check',
      timings: {},
      status: 'passed',
      origin: 'dry-check',
      appBuild: report.build,
      created: 0,
    });
    // The rehearsal envelope is integrity-bound like a real one but carries fake identity; it is
    // checked here and discarded, never written or printed.
    try {
      assertPackageVerification(envelope);
    } catch (error) {
      throw Error(
        `tier phases ${phases.join(',')} disagree with the package consumer (${consumer}): ${error.message}`,
      );
    }
    return `tier phases ${phases.join(',')} accepted by the package consumer (${consumer})`;
  });
  await row('host', async () => {
    const host = await readiness();
    const summary = host.rows.map((r) => `${r.id}: ${r.detail ?? r.error}`).join('; ');
    if (!host.admitted) throw Error(`not admitted now (advisory): ${summary}`);
    return `admitted now (advisory; the tier's own launch admission decides): ${summary}`;
  });
  return { rows, ok: rows.every((r) => r.ok) };
}
export async function prepareRelease(destination, { after = null } = {}) {
  const root = process.cwd(),
    out = resolve(destination);
  if (!relative(root, out).startsWith('.release-private/'))
    throw Error('Prepare destination must be a new .release-private/<release> directory');
  const admitted = after ? await admitReleaseParent(after, root) : null;
  const head = text('git', ['rev-parse', 'HEAD']);
  // One read of the tree: the candidate's per-path record (shas, modes, deletions; never the
  // index) is the identity a later merge citation compares, and the packaged `source` map is
  // derived from it so the two records cannot disagree. Secret-like and symlinked inputs are
  // refused by the same rules a candidate applies.
  let treeFiles;
  try {
    treeFiles = identityFiles(root);
  } catch (error) {
    if (/Secret-like/.test(error.message))
      throw Error('Review secret-like source paths before packaging');
    throw error;
  }
  const paths = Object.keys(treeFiles).sort();
  const source = {};
  for (const path of paths) if (!treeFiles[path].deleted) source[path] = treeFiles[path].sha256;
  await mkdir(resolve(out, '..'), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  // Keep Spotlight off the frozen snapshot: the marker sits at the release root, outside the
  // `source` map and the snapshot's identity.
  await writeFile(join(out, '.metadata_never_index'), '', { mode: 0o600, flag: 'wx' });
  const snapshot = join(out, 'source');
  run('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, snapshot]);
  for (const path of Object.keys(source)) {
    const target = join(snapshot, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(root, path), target);
  }
  const record = { head, source, files: treeFiles };
  await writeFile(join(out, 'source.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  const timings = {};
  const timed = (id, command, args, env) => {
    const start = performance.now();
    try {
      return run(command, args, snapshot, env);
    } finally {
      timings[id] = performance.now() - start;
    }
  };
  timed('install', 'npm', ['ci']);
  // Installed dependencies are digested exactly as a candidate digests them: the scratch
  // directories the tier creates exist first, and the tier's caches are redirected so the
  // digest recorded here is the one the final ran on.
  for (const path of ['.vite-temp', '.cache/prettier'])
    mkdirSync(join(snapshot, 'node_modules', path), { recursive: true });
  const installed = dependencyDigest(snapshot),
    installedAt = new Date().toISOString();
  // Runtime identity of the prepare process; the narrowed environment digest joins it when the
  // declared-environment identity lands (until then the final report's own digest is whole-env).
  Object.assign(record, {
    installed,
    installedAt,
    identity: { runtime: process.version, platform: process.platform, arch: process.arch },
  });
  await writeFile(join(out, 'source.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  let ledger = null,
    offered = [];
  if (admitted) {
    if (installed !== admitted.descriptor.installed)
      throw Error('Release installed dependencies differ from the parent attempt');
    const manifest = JSON.parse(await readFile(join(snapshot, 'scripts/manifest.json'), 'utf8'));
    offered = reuseSet({ classification: admitted.classification, manifest }).offered;
    if (JSON.stringify(offered) !== JSON.stringify(admitted.offered))
      throw Error('Frozen manifest offers a different reuse set than the release root');
    ledger = { path: join(out, 'ledger.json'), attempt: randomUUID() };
    await writeFile(
      ledger.path,
      JSON.stringify({
        key: randomBytes(32).toString('hex'),
        output: join(out, 'leaves'),
        previous: join(admitted.parentDirectory, 'attempts', admitted.parent.attempt, 'leaves'),
        previousKey: admitted.parentKey.toString('hex'),
        reuse: offered,
        origin: {
          attempt: ledger.attempt,
          report: join(snapshot, 'artifacts', 'verification-final.json'),
        },
      }),
      { mode: 0o600, flag: 'wx' },
    );
  }
  const environment = tierEnvironment(ledger, out);
  timed('format', 'npm', ['run', 'format:check'], environment);
  // Qualification exit 2 is acceptable for release automation only when its report
  // confirms automation passed; human acceptance is never invented by deployment.
  try {
    timed('verification', 'npm', ['run', 'verify:final'], environment);
  } catch (error) {
    const report = JSON.parse(
      await readFile(join(snapshot, 'artifacts', 'verification-final.json'), 'utf8'),
    );
    if (error.status === 2 && report.outcome?.automation?.status === 'PASS') {
      // Qualification exit 2 with passing automation: humans pending, never invented here.
    } else if (refusedLaunch(report)) {
      // The one failure the operator relaunches rather than diagnoses: name it and the
      // offenders here, so the frozen snapshot's report need not be opened.
      throw Error(`Release ${describeLaunchRefusal(report.results[0].result)}`);
    } else throw error;
  }
  const verification = JSON.parse(
    await readFile(join(snapshot, 'artifacts/verification-final.json'), 'utf8'),
  );
  if (verification.outcome?.automation?.status !== 'PASS')
    throw Error('Complete release automation must pass');
  if (JSON.stringify(verification.source) !== JSON.stringify(sourceIdentity()))
    throw Error('Verification source does not match frozen candidate');
  if (dependencyDigest(snapshot) !== installed)
    throw Error('Release installed dependencies changed during release verification');
  let reuse = null,
    status = 'passed';
  if (admitted) {
    const summary = reuseSummary({
      parent: admitted.parent,
      mode: 'same-bytes',
      sameBytes: { sameSource: true, sameDependencies: true, sameIdentity: true },
      offered,
      child: { status: 'passed', checks: verification.checks },
    });
    reuse = summary.after;
    status = summary.status;
    // The shared validator owns the block's internal consistency; the envelope check below
    // only binds it to the receipts and to the experimental consumer.
    validateReuseReport(
      { status, tier: 'final', after: reuse, verification: { checks: verification.checks } },
      { childTiers: ['final'] },
    );
    await copyCitedEvidence(admitted, reuse.reused, snapshot);
  } else if (verification.checks.some((c) => c.resumed))
    throw Error('Plain release verification resumed a receipt');
  const verifiedAssets = await inventory(join(snapshot, 'dist'));
  const payload = join(out, 'payload');
  await mkdir(payload);
  await mkdir(join(payload, 'assets'));
  const assets = await inventory(join(snapshot, 'dist'));
  for (const path of Object.keys(assets)) {
    if (path.startsWith('.') || path.endsWith('.map')) continue;
    const target = join(payload, 'assets', path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(snapshot, 'dist', path), target);
  }
  timed('bundle', 'npx', [
    '--no-install',
    'wrangler',
    'deploy',
    '--dry-run',
    '--outdir',
    join(payload, 'backend'),
  ]);
  if (JSON.stringify(await inventory(join(snapshot, 'dist'))) !== JSON.stringify(verifiedAssets))
    throw Error('Verified assets changed while packaging backend');
  for (const [path, hash] of Object.entries(source))
    if (sha(await readFile(join(snapshot, path))) !== hash)
      throw Error('Frozen source changed during release preparation');
  // Source drift outside the frozen copy is also a rejection, never a silent selection.
  for (const [path, hash] of Object.entries(source))
    if (sha(await readFile(join(root, path))) !== hash)
      throw Error('Source changed during release preparation');
  const current = text('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(paths) !== JSON.stringify(current))
    throw Error('Source input list changed during preparation');
  const files = await inventory(payload),
    artifact = sha(JSON.stringify(files));
  const manifest = releaseEnvelope({
    verification,
    artifact,
    files,
    head,
    source,
    installed,
    timings,
    status,
    reuse,
    origin: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local',
    appBuild: /<meta[^>]+name="build-id"[^>]+content="([^"]+)"/.exec(
      await readFile(join(payload, 'assets/index.html'), 'utf8'),
    )?.[1],
    created: Date.now(),
  });
  assertPackageVerification(manifest, { allowReusedEvidence: Boolean(admitted) });
  await writeFile(join(out, 'release.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      directory: out,
      artifact,
      status,
      ...(reuse ? { reuse: reuse.counts, parentAttempt: reuse.parentAttempt } : {}),
    }),
  );
  return manifest;
}
