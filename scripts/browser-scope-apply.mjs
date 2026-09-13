import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  existsSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureCandidate, candidateIdentity } from './candidate.mjs';
import { runProcess } from './run-check.mjs';
import { withVerificationWindow } from './verification-window.mjs';
import {
  scopeWitnessRequest,
  validateScopeWitnessResult,
} from './browser-scope-witness-contract.mjs';
import { assertRuntime, assertLocalServerAccess } from './runtime-preflight.mjs';
import { validateScopeRows } from './validate-manifest.mjs';
import {
  prepareScopeProposal,
  inspectScopeInputs,
  resolveScopeReview,
  same,
  digest,
} from './browser-scope-proposal.mjs';

export function scopeArtifact(root, path) {
  const absolute = resolve(root, path),
    local = relative(resolve(root), absolute);
  if (!local.startsWith('artifacts/') || local.split('/').some((s) => ['.', '..', ''].includes(s)))
    throw Error('Scope output must be a file under artifacts/');
  for (let p = absolute; p !== resolve(root); p = dirname(p))
    if (lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())
      throw Error('Symlink scope output refused');
  return absolute;
}
export function assertScopeEnvironment(env = process.env) {
  if (
    Object.keys(env).some(
      (k) =>
        env[k] &&
        (k === 'FEEDBACK_SOURCE' ||
          k.startsWith('PLAYTEST_') ||
          k.startsWith('SIMULACRUM_BROWSER_')),
    )
  )
    throw Error(
      'Scope witnesses require a clean local environment; remove FEEDBACK_SOURCE, PLAYTEST_* and SIMULACRUM_BROWSER_* overrides',
    );
}
async function executeWitnesses(candidate, proposal, reportDirectory) {
  if (proposal.changes.some((c) => c.kind === 'local')) await assertLocalServerAccess();
  try {
    const install = await runProcess('npm', ['ci', '--prefer-offline'], {
      cwd: candidate,
      timeoutMs: 120000,
    });
    writeFileSync(join(reportDirectory, 'install.log'), install.output);
  } catch (error) {
    writeFileSync(join(reportDirectory, 'install.log'), error.output ?? error.message);
    throw error;
  }
  const before = candidateIdentity(candidate);
  const spec = scopeWitnessRequest(proposal);
  const request = JSON.stringify(spec);
  try {
    const result = await runProcess(
      process.execPath,
      ['scripts/browser-scope-witnesses.mjs', request],
      {
        cwd: candidate,
        timeoutMs:
          180000 +
          JSON.parse(proposal.proposedManifest).browserChecks.reduce((n, c) => n + c.timeoutMs, 0),
      },
    );
    writeFileSync(join(reportDirectory, 'witnesses.log'), result.output);
  } catch (error) {
    writeFileSync(join(reportDirectory, 'witnesses.log'), error.output ?? error.message);
    throw error;
  }
  if (!same(before, candidateIdentity(candidate)))
    throw Error('Candidate changed during scope witnesses');
  const result = JSON.parse(
    readFileSync(join(candidate, 'artifacts/scope-witness-result.json'), 'utf8'),
  );
  validateScopeWitnessResult(proposal, result);
  return { ...result, candidateIdentity: before };
}
/** Single-writer operation. Observed drift rejects; this is not a filesystem CAS. */
export async function applyScopeProposal(
  root,
  proposal,
  review,
  { runWitnesses = executeWitnesses, withWindow = withVerificationWindow } = {},
) {
  assertRuntime();
  assertScopeEnvironment();
  // Declared reaching checks join their rows before the witness request is derived, so a
  // declaration is always executed before it is trusted. `proposal` stays the reviewed identity.
  const resolved = resolveScopeReview(proposal, review, inspectScopeInputs(root));
  const current = candidateIdentity(root);
  const skipped = resolved.affectedNotWitnessed ?? { basis: null, checks: null };
  const skippedLine = `Affected but not witnessed (NOT_EXECUTED; enumeration only): ${
    skipped.checks
      ? skipped.checks.join(', ') || 'none'
      : `not computed${skipped.error ? ` (${skipped.error})` : ''}`
  }`;
  if (same(current, resolved.expected)) {
    console.log(skippedLine);
    return {
      status: 'already-current',
      witnesses: 'NOT_EVALUATED',
      changed: false,
      affectedNotWitnessed: skipped,
    };
  }
  const rebuilt = prepareScopeProposal(root, proposal.declarations, {
    base: proposal.affectedNotWitnessed?.basis?.base ?? null,
  });
  if (!same(rebuilt, proposal))
    throw Error(
      'Stale proposal: source, graph, declarations or manifest changed; prepare and review again',
    );
  const required = scopeWitnessRequest(resolved).scopes.length > 0;
  const directory = scopeArtifact(root, `artifacts/browser-scopes/apply-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const reportPath = join(directory, 'report.json');
  const report = {
    status: 'running',
    ok: false,
    proposalDigest: proposal.digest,
    review,
    declared: Object.fromEntries(
      resolved.changes.filter((c) => c.declared).map((c) => [c.key, c.declared]),
    ),
    source: proposal.source,
    // Enumeration only: what the candidate delta selects that this application does not run.
    affectedNotWitnessed: skipped,
    proposedManifestSha256: digest(resolved.proposedManifest),
    reportPath,
  };
  const publish = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  publish();
  console.log(skippedLine);
  try {
    await withWindow(async () => {
      const destination = join(mkdtempSync(join(tmpdir(), 'simulacrum-scope-')), 'source');
      report.candidate = destination;
      const captured = await captureCandidate(root, destination);
      if (
        !same(
          { head: captured.head, index: captured.index, files: captured.files },
          proposal.source,
        )
      )
        throw Error('Origin changed before scope capture');
      writeFileSync(join(destination, 'scripts/manifest.json'), resolved.proposedManifest);
      if (!same(candidateIdentity(destination), resolved.expected))
        throw Error('Proposed candidate identity mismatch');
      publish();
      if (required) {
        report.installed = 'npm ci';
        report.witnesses = await runWitnesses(destination, resolved, directory);
        if (!report.witnesses?.ok) throw Error('Scope witnesses did not pass');
      } else {
        // Added reaching checks and membership format changes were reviewed explicitly; no
        // source byte changed, so no witness executes and no dependency install occurs.
        validateScopeRows(JSON.parse(resolved.proposedManifest));
        report.witnesses = {
          status: 'NOT_REQUIRED',
          ok: true,
          reason: 'only added reaching checks or membership format changed',
        };
        report.installed = 'skipped';
      }
      if (!same(candidateIdentity(destination), resolved.expected))
        throw Error('Candidate changed during scope witnesses');
      if (!same(candidateIdentity(root), proposal.source))
        throw Error('Origin changed during scope witnesses; manifest not applied');
      const target = resolve(root, 'scripts/manifest.json');
      const temporary = `${target}.${randomUUID()}.tmp`;
      report.beforeManifest = readFileSync(target, 'utf8');
      publish();
      try {
        writeFileSync(temporary, resolved.proposedManifest, { flag: 'wx' });
        chmodSync(temporary, proposal.source.files['scripts/manifest.json'].mode);
        renameSync(temporary, target);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      if (!same(candidateIdentity(root), resolved.expected))
        throw Error(
          'Post-application source mismatch; preserve changes and inspect retained report; no automatic rollback',
        );
      report.after = candidateIdentity(root);
    });
    report.ok = true;
    report.status = 'applied';
  } catch (error) {
    report.failure = error.message;
    report.status = 'failed';
    throw Object.assign(error, { reportPath });
  } finally {
    publish();
  }
  return report;
}
