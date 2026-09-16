// The package carries one integrity-bound verification envelope, not a second check inventory.
import { createHash } from 'node:crypto';
import { verificationOutcome } from '../verification-outcome.mjs';
export const verificationHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** The tier's phases: `ci,browser,gate`, optionally preceded by the launch admission every tier
 * runs first (a passed row only — a refused launch is a failed attempt, never a package). */
export function tierPhases(results) {
  const ids = results.map((r) => r.id);
  if (ids[0] !== 'launch-admission') return ids;
  if (results[0].ok !== true) throw Error('Package verification launch admission did not pass');
  return ids.slice(1);
}
const attemptId = (v) => /^[\da-f-]{36}$/.test(v ?? '');
/** A package may cite another candidate's receipts only when the envelope names each one and
 * the consumer is an explicitly authorized experimental release; a plain package carries neither
 * a reuse block nor a resumed receipt. */
function assertReusedEvidence(v, allowReusedEvidence) {
  const resumed = v.checks.filter((c) => c.resumed === true);
  const reuse = v.reuse;
  if (!reuse && !resumed.length) {
    if (v.status !== undefined && v.status !== 'passed')
      throw Error('Package verification status disagrees with its receipts');
    return;
  }
  // A block that cites nothing (every offered receipt executed here) is a plain pass for every
  // consumer; a cited receipt is admissible only to an experimental exception.
  if (!allowReusedEvidence && (resumed.length || reuse?.reused?.length))
    throw Error(
      'Package cites reused receipts; only an explicitly authorized experimental release may consume it',
    );
  if (!reuse || reuse.kind !== 'reuse' || !attemptId(reuse.parentAttempt))
    throw Error('Package carries a resumed receipt without a reuse block');
  if (reuse.parentTier !== 'merge') throw Error('Package reuse needs a merge parent attempt');
  if (
    !Array.isArray(reuse.reused) ||
    !Array.isArray(reuse.offered) ||
    !Array.isArray(reuse.executed)
  )
    throw Error('Package reuse block is malformed');
  // A citing release that ended up executing everything (purged or refused parent evidence) is
  // a plain pass that still names what it offered; a reused receipt requires the marked status.
  const expected = reuse.reused.length ? 'passed with reused receipts' : 'passed';
  if (v.status !== expected)
    throw Error(`Package verification status must be ${expected} for its reuse block`);
  const executedIds = v.checks
    .filter((c) => !c.resumed)
    .map((c) => c.id)
    .sort();
  if (JSON.stringify([...reuse.executed].sort()) !== JSON.stringify(executedIds))
    throw Error('Package reuse block executed list disagrees with its receipts');
  const counts = reuse.counts ?? {};
  if (
    counts.offered !== reuse.offered.length ||
    counts.reused !== reuse.reused.length ||
    counts.executed !== reuse.executed.length
  )
    throw Error('Package reuse block counts disagree with its lists');
  const byId = new Map(v.checks.map((c) => [c.id, c]));
  const offered = new Set(reuse.offered);
  for (const entry of reuse.reused) {
    const receipt = byId.get(entry?.id);
    if (!receipt?.resumed) throw Error(`Reused receipt ${entry?.id} is not a resumed receipt`);
    if (!offered.has(entry.id)) throw Error(`Reused receipt ${entry.id} was not offered`);
    const origin = receipt.origin;
    if (origin?.attempt !== reuse.parentAttempt || entry.origin?.attempt !== reuse.parentAttempt)
      throw Error(`Reused receipt ${entry.id} origin attempt disagrees with the parent`);
    if (origin.depth !== 1 || entry.origin.depth !== 1)
      throw Error(`Reused receipt ${entry.id} origin depth must be 1`);
    const checksums = entry.evidenceChecksums;
    if (
      !Array.isArray(checksums) ||
      !checksums.length ||
      checksums.filter((c) => c?.directory === true).length !== 1 ||
      typeof entry.copiedTo !== 'string' ||
      !Array.isArray(entry.copiedChecksums)
    )
      throw Error(`Reused receipt ${entry.id} carries no retained evidence record`);
  }
  for (const receipt of resumed)
    if (!reuse.reused.some((entry) => entry.id === receipt.id))
      throw Error(`Resumed receipt ${receipt.id} is missing from the reuse block`);
}
export function assertPackageVerification(manifest, { allowReusedEvidence = false } = {}) {
  const v = manifest.verification;
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!v || !hash(manifest.verificationHash) || verificationHash(v) !== manifest.verificationHash)
    throw Error('Package verification integrity missing or invalid');
  if (
    v.artifact !== manifest.artifact ||
    v.sourceHash !== manifest.sourceHash ||
    !hash(v.sourceHash) ||
    v.build !== manifest.appBuild ||
    typeof v.build !== 'string' ||
    !v.build ||
    v.source?.head !== manifest.head ||
    !/^[a-f0-9]{40}$/.test(manifest.head ?? '') ||
    !hash(v.source?.workingTreeDigest) ||
    !/^v\d+\.\d+\.\d+$/.test(v.runtime ?? '')
  )
    throw Error('Package verification source, build or runtime mismatch');
  if (
    !Array.isArray(v.checks) ||
    !v.checks.length ||
    new Set(v.checks.map((c) => c.id)).size !== v.checks.length ||
    v.checks.some(
      (c) =>
        typeof c.id !== 'string' ||
        !c.id ||
        c.ok !== true ||
        !c.configuration ||
        typeof c.configuration !== 'object' ||
        !Number.isFinite(c.elapsedMs) ||
        c.elapsedMs < 0,
    ) ||
    !Array.isArray(v.results) ||
    tierPhases(v.results).join(',') !== 'ci,browser,gate'
  )
    throw Error('Incomplete package verification checks or phases');
  const outcome = verificationOutcome(v.results, v.checks);
  if (
    outcome.automation.status !== 'PASS' ||
    JSON.stringify(outcome.automation) !== JSON.stringify(v.automation) ||
    JSON.stringify(outcome.humanAcceptance) !== JSON.stringify(v.humanAcceptance)
  )
    throw Error('Package verification automation failed or outcome disagrees');
  assertReusedEvidence(v, allowReusedEvidence);
}
