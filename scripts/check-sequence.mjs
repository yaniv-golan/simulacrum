/** Work-conserving workers; exclusive checks are barriers. Fatal integrity errors drain started work. */
export async function runCheckSequence(
  checks,
  execute,
  afterEach = () => {},
  { workers = 1, failFast = false } = {},
) {
  if (![1, 2, 3, 4].includes(workers)) throw Error('browser workers must be 1 to 4');
  const results = new Array(checks.length);
  let next = 0,
    fatal,
    stopped = false;
  async function run(index) {
    const check = checks[index];
    try {
      results[index] = { id: check.id, ok: true, value: await execute(check) };
    } catch (error) {
      results[index] = { id: check.id, ok: false, error };
      if (failFast) stopped = true;
    }
    try {
      await afterEach(check);
    } catch (error) {
      fatal ??= error;
    }
  }
  while (next < checks.length && !fatal && !stopped) {
    if (checks[next].execution !== 'parallel') await run(next++);
    else {
      let end = next;
      while (checks[end]?.execution === 'parallel') end++;
      await Promise.all(
        Array.from({ length: Math.min(workers, end - next) }, async () => {
          while (next < end && !fatal && !stopped) await run(next++);
        }),
      );
    }
  }
  if (fatal) throw fatal;
  for (let index = next; index < checks.length; index++)
    results[index] = { id: checks[index].id, status: 'not evaluated', reason: 'probe fail-fast' };
  return results;
}

/** Pack only undersized admitted parallel runs. Existing runs are never split;
 * runs of four or more remain in place. New combined groups contain at most four
 * checks. The priority prefix and relative exclusive order are unchanged.
 */
export function packParallelChecks(checks, { workers = 1, priorityCount = 0 } = {}) {
  if (![1, 2, 3, 4].includes(workers)) throw Error('browser workers must be 1 to 4');
  if (!Number.isInteger(priorityCount) || priorityCount < 0 || priorityCount > checks.length)
    throw Error('invalid priority prefix');
  if (workers === 1) return [...checks];
  const ordered = checks.slice(0, priorityCount);
  let smallRuns = [],
    exclusive = [];
  function flush() {
    let next = 0;
    for (const check of exclusive) {
      let size = 0;
      while (next < smallRuns.length && size + smallRuns[next].length <= 4) {
        const run = smallRuns[next++];
        ordered.push(...run);
        size += run.length;
      }
      ordered.push(check);
    }
    ordered.push(...smallRuns.slice(next).flat());
    smallRuns = [];
    exclusive = [];
  }
  for (let i = priorityCount; i < checks.length; ) {
    if (checks[i].execution !== 'parallel') {
      exclusive.push(checks[i++]);
      continue;
    }
    const start = i;
    while (checks[i]?.execution === 'parallel') i++;
    const run = checks.slice(start, i);
    if (run.length >= 4) {
      flush();
      ordered.push(...run);
    } else smallRuns.push(run);
  }
  flush();
  return ordered;
}

/** Longest known work first inside each admitted run; never move a priority or exclusive check. */
export function balanceParallelChecks(checks, durations = {}, priorityCount = 0) {
  const ordered = checks.slice(0, priorityCount);
  for (let i = priorityCount; i < checks.length; ) {
    if (checks[i].execution !== 'parallel') {
      ordered.push(checks[i++]);
      continue;
    }
    const start = i;
    while (checks[i]?.execution === 'parallel') i++;
    const duration = (c) =>
      Number.isFinite(durations[c.id]) && durations[c.id] > 0 ? durations[c.id] : 0;
    ordered.push(...checks.slice(start, i).sort((a, b) => duration(b) - duration(a)));
  }
  return ordered;
}

/** Three phases with one registered fact deciding membership: the headless pool
 * (`execution: 'parallel'`, packed longest historical duration first; the priority prefix
 * is queue order, never a packing barrier), the policy-serialized lane (exclusive for
 * focus/recording/self-hosting reasons), then timing-sensitive checks, which need a quiet
 * host and run last. The order is deterministic in its inputs; the seed only breaks ties
 * among checks without a recorded duration so a nightly run can rotate them. */
export function planBrowserPhases(
  checks,
  { durations = {}, priorityIds = [], seed = 'tier' } = {},
) {
  // The default seed keeps the longest-first balance; any other seed orders the pool by the
  // seed alone (durations never tie), which is what makes a rotated nightly order a control.
  const balanced = seed === 'tier';
  for (const check of checks)
    if (check.timingSensitive === true && check.execution === 'parallel')
      throw Error(`timing-sensitive checks run exclusively: ${check.id}`);
  const tie = (id) => {
    let hash = 2166136261;
    for (const char of `${seed}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  const priority = new Set(priorityIds);
  const pool = checks
    .filter((c) => c.execution === 'parallel' && c.timingSensitive !== true)
    .map((c) => ({ ...c, phase: 'pool' }))
    .sort(
      (a, b) =>
        Number(priority.has(b.id)) - Number(priority.has(a.id)) ||
        (balanced ? (durations[b.id] ?? 0) - (durations[a.id] ?? 0) : 0) ||
        tie(a.id) - tie(b.id),
    );
  const lane = checks
    .filter((c) => c.execution !== 'parallel' && c.timingSensitive !== true)
    .map((c) => ({ ...c, phase: 'lane' }));
  const timing = checks
    .filter((c) => c.timingSensitive === true)
    .map((c) => ({ ...c, phase: 'timing' }));
  return { pool, lane, timing, order: [...pool, ...lane, ...timing], seed, balanced };
}

/** Timing-sensitive checks start only on a quiet host. Above the bound the caller waits once,
 * for at most `waitMs`, then reports refusal; a refusal is never retried and never becomes a
 * pass — it is a skipped gate, recorded as such. */
/** Pressure policy: the foreign-process share is the detector (a call, the window server, an
 * indexer at 40 %+ of a core is what moved a 2 ms p95 on this host); idle is a coarse backstop
 * (a two-core desktop burst is still 86 % idle on fourteen cores). `mode` 'enforce' refuses,
 * naming the process; the bounds come from a local tier's own records on a resting desktop
 * (idle 86.5–88 %, busiest foreign process 16 %, 2026-09-14). 'observe' records and never
 * refuses on pressure — the opt-out for a host whose resting record has not been read. */
export const PRESSURE_POLICY = Object.freeze({
  mode: process.env.SIMULACRUM_TIMING_PRESSURE === 'observe' ? 'observe' : 'enforce',
  idleBound: Number(process.env.SIMULACRUM_TIMING_IDLE_BOUND) || 80,
  foreignBound: Number(process.env.SIMULACRUM_TIMING_FOREIGN_BOUND) || 40,
});
export function pressureHolds(sample, policy = PRESSURE_POLICY) {
  if (!sample || sample.method === 'unavailable' || policy.mode !== 'enforce') return null;
  const busy = (sample.foreign ?? []).filter((row) => row.pcpu >= policy.foreignBound);
  const reasons = [];
  if (busy.length)
    reasons.push(
      `${busy.map((row) => `${row.comm} ${row.pcpu} %`).join(', ')} (foreign ≥ ${policy.foreignBound} %)`,
    );
  if (Number.isFinite(sample.idlePercent) && sample.idlePercent < policy.idleBound)
    reasons.push(`idle ${sample.idlePercent} % (< ${policy.idleBound} %)`);
  return reasons.length ? `host pressure: ${reasons.join('; ')}` : null;
}
export async function admitQuietHost({
  cores,
  bound = Math.max(1, Math.floor(cores / 2)),
  waitMs = 180000,
  pollMs = 5000,
  trendMs = 30000,
  load1,
  pressure = null,
  policy = PRESSURE_POLICY,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => performance.now(),
}) {
  // load1 is a one-minute average: right after a pool it decays for a minute or more, so the
  // wait tracks the decay instead of expiring at a fixed 60 s. Once a trend window is in hand,
  // a flat or rising load is refused early — there is nothing to wait for — while a falling one
  // is waited out up to waitMs, the projected crossing recorded with the samples. Host pressure
  // (idle %, foreign process shares) is sampled beside it; when enforced it holds the wait too,
  // but never triggers the flat-trend early refusal, which is about load1 alone.
  const samples = [];
  const started = now();
  let lastPressure = null;
  const sample = async () => {
    const value = load1();
    lastPressure = pressure ? await pressure() : null;
    samples.push({
      atMs: Math.round(now() - started),
      load1: value,
      ...(lastPressure
        ? { idlePercent: lastPressure.idlePercent, foreign: lastPressure.foreign }
        : {}),
    });
    return value;
  };
  const trend = () => {
    const at = now() - started,
      window = samples.filter((s) => s.atMs >= at - trendMs);
    if (window.length < 3 || at < trendMs) return null;
    const n = window.length,
      meanT = window.reduce((s, p) => s + p.atMs, 0) / n,
      meanL = window.reduce((s, p) => s + p.load1, 0) / n,
      slope =
        window.reduce((s, p) => s + (p.atMs - meanT) * (p.load1 - meanL), 0) /
        Math.max(
          1e-9,
          window.reduce((s, p) => s + (p.atMs - meanT) ** 2, 0),
        );
    const current = samples.at(-1).load1;
    return {
      windowMs: trendMs,
      slopePerS: Number((slope * 1000).toFixed(4)),
      projectedMs: slope < 0 ? Math.round((current - bound) / -slope) : null,
    };
  };
  let current = await sample(),
    seen = null,
    held = pressureHolds(lastPressure, policy);
  while ((current > bound || held) && now() - started < waitMs) {
    seen = current > bound ? trend() : seen;
    if (current > bound && !held && seen && seen.projectedMs === null) break;
    await sleep(Math.min(pollMs, waitMs - (now() - started)));
    current = await sample();
    held = pressureHolds(lastPressure, policy);
  }
  const waitedMs = Math.round(now() - started),
    loads = samples.map((s) => s.load1),
    result = {
      load1: current,
      waitedMs,
      samples: loads,
      trend: seen ?? trend(),
      pressure: lastPressure
        ? {
            ...lastPressure,
            mode: policy.mode,
            bounds: { idle: policy.idleBound, foreign: policy.foreignBound },
            samples: samples.map((s) => ({
              atMs: s.atMs,
              idlePercent: s.idlePercent,
              foreign: s.foreign,
            })),
          }
        : null,
    };
  if (current > bound)
    return {
      admitted: false,
      ...result,
      reason:
        seen?.projectedMs === null && !held
          ? `host load ${current} above bound ${bound} after ${waitedMs} ms and not falling (${seen.slopePerS}/s over the last ${trendMs} ms)`
          : `host load ${current} above bound ${bound} after ${waitedMs} ms${held ? `; ${held}` : ''}`,
    };
  if (held) return { admitted: false, ...result, reason: `${held} after ${waitedMs} ms` };
  return { admitted: true, ...result };
}

/** Workers for a tier follow the host. On the first phased run (14 cores) four concurrent
 * headless checks held load1 near 15 — about three runnable threads each — but that pool
 * rendered WebGL in software: the headless shell ran SwiftShader, so the GPU process rasterised
 * on CPU threads. With the ui profile on Metal (mirror probe: headless+metal 0.96× headed wall,
 * SwiftShader 4.19×) the raster threads are gone and a pooled check is its renderer main thread
 * plus the node driver — about two runnable threads, taken as two per worker until the tier's
 * per-row load recalibrates it. Cap four; quiet-host admission and the renderer liveness
 * windows remain the tripwires. */
export const LOAD_PER_WORKER = 2;
export const MAX_TIER_WORKERS = 4;
export function tierWorkers({ cores, load1, perWorker = LOAD_PER_WORKER }) {
  return Math.max(1, Math.min(MAX_TIER_WORKERS, Math.floor((cores - load1) / perWorker)));
}
