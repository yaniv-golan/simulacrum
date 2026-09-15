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
export function assertPackageVerification(manifest) {
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
}
