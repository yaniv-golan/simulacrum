import { createHash } from 'node:crypto';
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
/** Environment that changes what a check does or selects. Terminal, cwd and private variables
 * must not change identity, or no two invocations ever share a receipt. */
export const RELEVANT_ENVIRONMENT = Object.freeze({
  names: Object.freeze(['NODE_ENV', 'NODE_OPTIONS', 'FEEDBACK_SOURCE']),
  prefixes: Object.freeze(['PLAYWRIGHT_', 'PLAYTEST_', 'SIMULACRUM_BROWSER_']),
});
const attemptScopedKeys = [
  'SIMULACRUM_VERIFICATION_WINDOW',
  'SIMULACRUM_LEAF_LEDGER',
  'SIMULACRUM_VERIFICATION_ATTEMPT',
];
const digestEnvironment = (entries) =>
  createHash('sha256')
    .update(stable(Object.fromEntries(entries)))
    .digest('hex');
export function relevantEnvironmentDigest(env = process.env) {
  // The verification runtime defaults NODE_ENV to production before any check runs; digest the
  // same default so the candidate command and the tier agree on identity.
  const entries = Object.entries({ ...env, NODE_ENV: env.NODE_ENV ?? 'production' });
  return digestEnvironment(
    entries.filter(
      ([k]) =>
        RELEVANT_ENVIRONMENT.names.includes(k) ||
        RELEVANT_ENVIRONMENT.prefixes.some((prefix) => k.startsWith(prefix)),
    ),
  );
}
/** Forensic record of the whole environment; never part of receipt identity. */
export function environmentForensics(env = process.env) {
  return {
    environmentDigest: digestEnvironment(
      Object.entries(env).filter(([k]) => !attemptScopedKeys.includes(k)),
    ),
    relevant: RELEVANT_ENVIRONMENT,
  };
}
/** The process-level part of verification identity, computable without the verification runtime. */
export function processIdentity(env = process.env) {
  return {
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    environmentDigest: relevantEnvironmentDigest(env),
  };
}
