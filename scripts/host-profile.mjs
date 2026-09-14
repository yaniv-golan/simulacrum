// Hosted runners are slower than the developer host. Their deadlines are registered
// facts in the manifest (`hostProfiles`), selected only by SIMULACRUM_HOST_PROFILE from
// the workflow, never by an environment number. A profile in measurement mode uses
// bounded provisional browser budgets and labels every report `measurement`; once
// per-check budgets are registered the provisional rule disappears and a row without
// a registered budget refuses.
const DEADLINE_SITES = ['moduleTimeoutMs', 'unitTimeoutMs'];
const LOCAL_DEADLINES = { moduleTimeoutMs: 5000, unitTimeoutMs: 30000 };
const PROFILE_KEYS = [
  'measurement',
  'measurementRuns',
  'moduleTimeoutMs',
  'unitTimeoutMs',
  'unitWorkers',
  'ciBudgetMs',
  'browserWorkers',
  'browserTimeoutMs',
  'notEvaluated',
];
const CI_LIMIT_MS = 180000;
export function readHostProfile(manifest, env = process.env) {
  const id = env.SIMULACRUM_HOST_PROFILE;
  if (!id) return null;
  const profile = manifest.hostProfiles?.[id];
  if (!profile) throw Error(`unknown host profile ${id}; register it in scripts/manifest.json`);
  return { id, ...profile };
}
/** A profile can lengthen a deadline, never shorten what the caller registered. */
export function profileDeadline(profile, site, callerMs) {
  if (!DEADLINE_SITES.includes(site)) throw Error(`unknown deadline site ${site}`);
  if (!profile) return callerMs;
  return Math.max(callerMs, profile[site] ?? callerMs);
}
export function browserBudget(profile, check) {
  if (!profile) return { timeoutMs: check.timeoutMs };
  const base = { registeredTimeoutMs: check.timeoutMs, hostProfile: profile.id };
  if (Number.isFinite(check.hostedTimeoutMs))
    return { timeoutMs: check.hostedTimeoutMs, ...base, ...(profile.measurement ? { measurement: true } : {}) };
  if (profile.measurement && profile.browserTimeoutMs?.default) {
    const { cap, factor } = profile.browserTimeoutMs.default;
    return { timeoutMs: Math.min(cap, factor * check.timeoutMs), ...base, measurement: true };
  }
  throw Error(
    `no hostedTimeoutMs registered for ${check.id} under host profile ${profile.id}; register it from measurement runs`,
  );
}
export function partitionHostedChecks(checks, profile) {
  if (!profile) return { run: checks, notEvaluated: [] };
  const excluded = new Set(profile.notEvaluated ?? []);
  return {
    run: checks.filter((check) => !excluded.has(check.tier)),
    notEvaluated: checks
      .filter((check) => excluded.has(check.tier))
      .map((check) => ({
        id: check.id,
        status: 'NOT_EVALUATED',
        reason: `hosted profile ${profile.id}: ${check.tier} tier is not evaluated on this platform`,
      })),
  };
}
/** Measurement runs rotate the schedule so a job cut short still completes every check
 * across runs; seeded by the run number, never by history. */
export function rotateSchedule(items, seed) {
  if (!items.length) return [];
  const offset = ((seed % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
export function assertNoHostProfile(env = process.env) {
  if (env.SIMULACRUM_HOST_PROFILE)
    throw Error(
      `completion tiers never run under a hosted profile (SIMULACRUM_HOST_PROFILE=${env.SIMULACRUM_HOST_PROFILE}); unset it`,
    );
}
export function ciBudget(profile) {
  if (!profile?.ciBudgetMs) return { limitMs: CI_LIMIT_MS, deadlineMs: CI_LIMIT_MS };
  return { limitMs: CI_LIMIT_MS, hostedLimitMs: profile.ciBudgetMs, deadlineMs: profile.ciBudgetMs };
}
export function hostedReportFields(profile) {
  return profile ? { hostProfile: profile.id, measurement: profile.measurement === true } : {};
}
export function hostProfileStateLine(manifest) {
  return Object.entries(manifest.hostProfiles ?? {})
    .map(([id, profile]) =>
      profile.measurement
        ? `hosted profile ${id}: measurement mode (${(profile.measurementRuns ?? []).length}/3 runs recorded)`
        : `hosted profile ${id}: registered per-check budgets`,
    )
    .join('\n');
}
export function validateHostProfiles(manifest) {
  const tiers = new Set((manifest.browserChecks ?? []).map((check) => check.tier));
  for (const [id, profile] of Object.entries(manifest.hostProfiles ?? {})) {
    const fail = (message) => {
      throw Error(`host profile ${id}: ${message}`);
    };
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('must be an object');
    for (const key of Object.keys(profile))
      if (!PROFILE_KEYS.includes(key)) fail(`unknown field ${key}`);
    if (typeof profile.measurement !== 'boolean') fail('measurement must be a boolean');
    if (!Array.isArray(profile.measurementRuns ?? []))
      fail('measurementRuns must list run identifiers');
    if (profile.measurement && (profile.measurementRuns ?? []).length > 3)
      fail('at most three measurement runs before per-check budgets are registered');
    for (const site of DEADLINE_SITES) {
      if (!Number.isFinite(profile[site])) fail(`${site} must be a finite number`);
      if (profile[site] < LOCAL_DEADLINES[site])
        fail(`${site} is shorter than the local deadline ${LOCAL_DEADLINES[site]}`);
    }
    if (!Number.isFinite(profile.ciBudgetMs) || profile.ciBudgetMs < CI_LIMIT_MS)
      fail(`ciBudgetMs must be a finite number no shorter than ${CI_LIMIT_MS}`);
    for (const workers of ['unitWorkers', 'browserWorkers'])
      if (![1, 2, 3, 4].includes(profile[workers])) fail(`${workers} must be 1 to 4`);
    for (const tier of profile.notEvaluated ?? [])
      if (!tiers.has(tier)) fail(`unknown tier ${tier} in notEvaluated`);
    if (profile.measurement) {
      const rule = profile.browserTimeoutMs?.default;
      if (!rule || !Number.isFinite(rule.cap) || !Number.isFinite(rule.factor) || rule.factor < 1)
        fail('measurement mode needs browserTimeoutMs.default with a finite cap and factor >= 1');
    } else {
      if (profile.browserTimeoutMs) fail('registered profiles carry no provisional browser rule');
      const excluded = new Set(profile.notEvaluated ?? []);
      const missing = (manifest.browserChecks ?? [])
        .filter((check) => !excluded.has(check.tier) && !Number.isFinite(check.hostedTimeoutMs))
        .map((check) => check.id);
      if (missing.length)
        fail(`registered profiles need hostedTimeoutMs on every evaluated browser check; missing: ${missing.join(', ')}`);
    }
  }
  for (const check of manifest.browserChecks ?? [])
    if (check.hostedTimeoutMs !== undefined && (!Number.isFinite(check.hostedTimeoutMs) || check.hostedTimeoutMs < check.timeoutMs))
      throw Error(`${check.id}: hostedTimeoutMs must be a finite number no shorter than timeoutMs`);
  return manifest;
}
