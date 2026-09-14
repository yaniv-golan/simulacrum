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
export async function admitQuietHost({
  cores,
  bound = Math.max(1, Math.floor(cores / 2)),
  waitMs = 60000,
  pollMs = 5000,
  load1,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => performance.now(),
}) {
  const samples = [];
  const started = now();
  let current = load1();
  samples.push(current);
  while (current > bound && now() - started < waitMs) {
    await sleep(Math.min(pollMs, waitMs - (now() - started)));
    current = load1();
    samples.push(current);
  }
  const waitedMs = Math.round(now() - started);
  if (current > bound)
    return {
      admitted: false,
      load1: current,
      waitedMs,
      samples,
      reason: `host load ${current} above bound ${bound} after ${waitedMs} ms`,
    };
  return { admitted: true, load1: current, waitedMs, samples };
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
