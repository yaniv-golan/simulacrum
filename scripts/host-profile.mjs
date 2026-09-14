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
  'waitScale',
  'liveSliceMs',
];
const CI_LIMIT_MS = 180000;
/** Check children learn the platform's patience as numbers, never the profile id. */
export const WAIT_SCALE_VARIABLE = 'SIMULACRUM_BROWSER_WAIT_SCALE';
export const LIVE_SLICE_VARIABLE = 'SIMULACRUM_BROWSER_LIVE_SLICE_MS';
/** The row's process budget, so no scaled wait can outlive the watchdog that would destroy the
 * failure artifacts the wait exists to produce. */
export const ROW_BUDGET_VARIABLE = 'SIMULACRUM_BROWSER_ROW_BUDGET_MS';
/** A scaled wait never takes more than this share of the row budget. */
export const ROW_BUDGET_SHARE = 0.6;
const LOCAL_LIVE_SLICE_MS = 2000;
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
    return {
      timeoutMs: check.hostedTimeoutMs,
      ...base,
      ...(profile.measurement ? { measurement: true } : {}),
    };
  if (profile.measurement && profile.browserTimeoutMs?.default) {
    const { cap, factor } = profile.browserTimeoutMs.default;
    return { timeoutMs: Math.min(cap, factor * check.timeoutMs), ...base, measurement: true };
  }
  throw Error(
    `no hostedTimeoutMs registered for ${check.id} under host profile ${profile.id}; register it from measurement runs`,
  );
}
/** Hosted runs have no tier context and therefore no quiet-host admission, so timing-sensitive
 * checks are not evaluated there whatever their tier, alongside the profile's excluded tiers. */
export function partitionHostedChecks(checks, profile) {
  if (!profile) return { run: checks, notEvaluated: [] };
  const excluded = new Set(profile.notEvaluated ?? []);
  const reason = (check) =>
    excluded.has(check.tier)
      ? `hosted profile ${profile.id}: ${check.tier} tier is not evaluated on this platform`
      : check.timingSensitive === true
        ? `hosted profile ${profile.id}: timing-sensitive check has no quiet-host admission on this platform`
        : null;
  return {
    run: checks.filter((check) => !reason(check)),
    notEvaluated: checks
      .filter((check) => reason(check))
      .map((check) => ({ id: check.id, status: 'NOT_EVALUATED', reason: reason(check) })),
  };
}
/** Measurement runs rotate the schedule so a job cut short still completes every check
 * across runs; seeded by the run number, never by history. */
/** The persisted run list: executed rows in schedule order, then the registered NOT_EVALUATED rows. */
export function finalSuiteRuns(checks, executedRows, notEvaluated) {
  return [...checks.flatMap((c) => executedRows.filter((r) => r.id === c.id)), ...notEvaluated];
}
/** Children under test never inherit the profile: it governs the harness, not the code under test. */
export function childEnvironment(env = process.env) {
  const {
    SIMULACRUM_HOST_PROFILE,
    [WAIT_SCALE_VARIABLE]: scale,
    [LIVE_SLICE_VARIABLE]: slice,
    [ROW_BUDGET_VARIABLE]: budget,
    ...rest
  } = env;
  void SIMULACRUM_HOST_PROFILE;
  void scale;
  void slice;
  void budget;
  return rest;
}
/** A browser check child under a profile gets the registered wait scale and live slice as
 * numbers; a local child gets neither, whatever the parent shell exported. */
export function checkWaitEnvironment(env, profile, { rowBudgetMs } = {}) {
  const rest = childEnvironment(env);
  if (!profile) return rest;
  return {
    ...rest,
    [WAIT_SCALE_VARIABLE]: String(profile.waitScale),
    [LIVE_SLICE_VARIABLE]: String(profile.liveSliceMs),
    ...(Number.isFinite(rowBudgetMs) ? { [ROW_BUDGET_VARIABLE]: String(rowBudgetMs) } : {}),
  };
}
/** `ms × scale`, clamped to the row budget's share when the suite passed one: a wait longer
 * than the watchdog would end as a bare kill with no evidence. Local (scale 1, no budget)
 * returns `ms` unchanged. */
export function scaledWait(ms, env = process.env) {
  const scaled = ms * waitScaleFromEnvironment(env);
  const raw = env[ROW_BUDGET_VARIABLE];
  if (raw === undefined) return scaled;
  const budget = Number(raw);
  if (!Number.isFinite(budget) || budget <= 0) throw Error(`invalid ${ROW_BUDGET_VARIABLE}: ${raw}`);
  return Math.min(scaled, Math.floor(budget * ROW_BUDGET_SHARE));
}
/** The scale a check process runs under: 1 unless the suite passed a registered one. */
export function waitScaleFromEnvironment(env = process.env) {
  const raw = env[WAIT_SCALE_VARIABLE];
  if (raw === undefined) return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale < 1) throw Error(`invalid ${WAIT_SCALE_VARIABLE}: ${raw}`);
  return scale;
}
export function liveSliceFromEnvironment(env = process.env) {
  const raw = env[LIVE_SLICE_VARIABLE];
  if (raw === undefined) return LOCAL_LIVE_SLICE_MS;
  const slice = Number(raw);
  if (!Number.isFinite(slice) || slice < LOCAL_LIVE_SLICE_MS)
    throw Error(`invalid ${LIVE_SLICE_VARIABLE}: ${raw}`);
  return slice;
}
/** Rotation is schedule metadata: it never enters the priority reasons that size the prefix. */
export function measurementRotation(checks, profile, env = process.env) {
  if (!profile?.measurement) return { checks, note: null };
  const seed = Number.parseInt(env.GITHUB_RUN_NUMBER ?? '0', 10) || 0;
  return { checks: rotateSchedule(checks, seed), note: `measurement rotation seed ${seed}` };
}
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
  for (const key of [WAIT_SCALE_VARIABLE, LIVE_SLICE_VARIABLE, ROW_BUDGET_VARIABLE])
    if (env[key] !== undefined)
      throw Error(
        `completion tiers never run under a hosted wait scale (${key}=${env[key]}); unset it`,
      );
}
export function ciBudget(profile) {
  if (!profile?.ciBudgetMs) return { limitMs: CI_LIMIT_MS, deadlineMs: CI_LIMIT_MS };
  return {
    limitMs: CI_LIMIT_MS,
    hostedLimitMs: profile.ciBudgetMs,
    deadlineMs: profile.ciBudgetMs,
  };
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
    if (!profile || typeof profile !== 'object' || Array.isArray(profile))
      fail('must be an object');
    for (const key of Object.keys(profile))
      if (!PROFILE_KEYS.includes(key)) fail(`unknown field ${key}`);
    if (typeof profile.measurement !== 'boolean') fail('measurement must be a boolean');
    if (
      !Array.isArray(profile.measurementRuns ?? []) ||
      (profile.measurementRuns ?? []).some((id) => typeof id !== 'string' || !id.trim())
    )
      fail('measurementRuns entries must be run identifiers (workflow run id strings)');
    if (profile.measurement && (profile.measurementRuns ?? []).length > 3)
      fail('at most three measurement runs before per-check budgets are registered');
    for (const site of DEADLINE_SITES) {
      if (!Number.isFinite(profile[site])) fail(`${site} must be a finite number`);
      if (profile[site] < LOCAL_DEADLINES[site])
        fail(`${site} is shorter than the local deadline ${LOCAL_DEADLINES[site]}`);
    }
    if (!Number.isFinite(profile.ciBudgetMs) || profile.ciBudgetMs < CI_LIMIT_MS)
      fail(`ciBudgetMs must be a finite number no shorter than ${CI_LIMIT_MS}`);
    if (![1, 2, 3, 4].includes(profile.unitWorkers)) fail('unitWorkers must be 1 to 4');
    // More than two browser workers is reserved for explicit development probes.
    if (![1, 2].includes(profile.browserWorkers)) fail('browserWorkers must be 1 or 2');
    // Patience is a measured host fact: how much slower the runner's page is than the developer
    // host (startup, interaction) and how long a live renderer can go without a frame.
    if (!Number.isFinite(profile.waitScale) || profile.waitScale < 1)
      fail('waitScale must be a finite number >= 1 (measured page slowdown vs the local host)');
    if (!Number.isFinite(profile.liveSliceMs) || profile.liveSliceMs < LOCAL_LIVE_SLICE_MS)
      fail(`liveSliceMs must be a finite number >= ${LOCAL_LIVE_SLICE_MS}`);
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
        .filter(
          (check) =>
            !excluded.has(check.tier) &&
            check.timingSensitive !== true &&
            !Number.isFinite(check.hostedTimeoutMs),
        )
        .map((check) => check.id);
      if (missing.length)
        fail(
          `registered profiles need hostedTimeoutMs on every evaluated browser check; missing: ${missing.join(', ')}`,
        );
    }
  }
  for (const check of manifest.browserChecks ?? [])
    if (
      check.hostedTimeoutMs !== undefined &&
      (!Number.isFinite(check.hostedTimeoutMs) || check.hostedTimeoutMs < check.timeoutMs)
    )
      throw Error(`${check.id}: hostedTimeoutMs must be a finite number no shorter than timeoutMs`);
  return manifest;
}
