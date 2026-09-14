import { normalizeSelectedFiles } from './test-selection.mjs';
import { assertNoHostProfile } from './host-profile.mjs';
import { cpus, loadavg } from 'node:os';
import { admitQuietHost, PRESSURE_POLICY } from './check-sequence.mjs';
import { samplePressure } from './host-pressure.mjs';

/** What a tier's browser selection will reach: `timing` when any selected row is a timing
 * budget, else `structural`. Taken from the resolved selection (a diagnosed retry's required
 * timing row counts), never from the raw delta. */
export function selectionReach(selection) {
  return selection?.checks?.some((check) => check.timingSensitive) ? 'timing' : 'structural';
}
export const REACHES = Object.freeze(['timing', 'structural']);
/** The structural gates run first, at t = 0, against 5 s deadlines; an updater or indexer that
 * fires at launch fails them before anything was measured. One short admission — the same
 * load/pressure rule as the timing phase, inside the window, immediately before the CI
 * phase — waits that out or refuses by name. A refusal is a failed attempt whose only row is
 * `launch-admission`, not evaluated: nothing ran, nothing is a defect. CPU pressure sees only
 * part of a disk-bound burst; that limit is recorded, not hidden.
 * The foreign-process bound is a timing-phase detector (one loud process moved a 2 ms p95);
 * the structural gates need CPU availability, which load1 and idle measure. So a tier whose
 * selection reaches no timing row is admitted on load1 and idle alone — a window server at
 * 55 % of one core does not starve a 5 s gate — while a tier that will measure launches under
 * the full policy, so no timing phase ever follows a lax launch. The reach and the bounds
 * applied are recorded on the row; the foreign rows seen stay in the pressure sample. */
export async function launchAdmission({
  reach,
  admit = admitQuietHost,
  host = { cores: cpus().length, load1: () => loadavg()[0], pressure: () => samplePressure() },
  waitMs = 60000,
  trendMs = 20000,
  policy = PRESSURE_POLICY,
} = {}) {
  if (!REACHES.includes(reach))
    throw Error(`launch admission needs the tier's reach (${REACHES.join('|')}), got ${reach}`);
  const applied = reach === 'timing' ? policy : { ...policy, foreignBound: Infinity };
  const record = {
    reach,
    mode: applied.mode,
    bounds: {
      idle: applied.idleBound,
      foreign: Number.isFinite(applied.foreignBound) ? applied.foreignBound : null,
    },
  };
  const admission = await admit({
    cores: host.cores,
    waitMs,
    trendMs,
    load1: host.load1,
    pressure: host.pressure ?? null,
    policy: applied,
  });
  return admission.admitted
    ? { ok: true, policy: record, admission }
    : { ok: false, notEvaluated: true, policy: record, reason: admission.reason, admission };
}
export const LAUNCH_ADMISSION_ID = 'launch-admission';
/** The selection phase runs after the launch admission; a selection whose reach differs from
 * the one the launch was admitted under is refused, so a lax launch never precedes a timing
 * phase. */
export function assertSelectionReach(selection, reach) {
  const actual = selectionReach(selection);
  if (actual !== reach)
    throw Error(
      `selection reach changed after launch admission: admitted as ${reach}, selection reaches ${actual}`,
    );
  return actual;
}
/** A failed prerequisite prevents expensive downstream work. Qualification uses a separate gate. */
export async function runVerificationPhases(
  phases,
  { now = () => performance.now(), onProgress = () => {} } = {},
) {
  const rows = [];
  for (const [id, execute] of phases) {
    const started = now();
    const row = { id, status: 'running', startedAt: new Date().toISOString() };
    rows.push(row);
    onProgress(rows);
    try {
      row.result = await execute();
      row.ok = row.result?.ok !== false;
    } catch (error) {
      row.ok = false;
      row.error = error.message;
      console.error(`${id}: ${error.stack}`);
    }
    row.status = row.ok ? 'passed' : 'failed';
    row.elapsedMs = now() - started;
    onProgress(rows);
    if (!row.ok) break;
  }
  return rows;
}
/** Leaves the host slept through, by receipt: named in the tier's summary so a sleep never reads
 * as a set of timeouts. */
export function sleptSummary(checks = []) {
  // Leaf receipts only: the unit aggregate carries the same fields for the whole batch.
  const slept = checks.filter(
    (row) => row.notEvaluated === true && row.hostSleptMs > 0 && !Array.isArray(row.unexecuted),
  );
  const unexecuted = checks.reduce(
    (n, row) => n + (row.failureKind === 'host-slept' ? (row.unexecuted?.length ?? 0) : 0),
    0,
  );
  if (!slept.length) return '';
  return ` host slept: ${slept.length} leaves not evaluated${unexecuted ? `, ${unexecuted} not executed after the sleep` : ''}.`;
}
export function localOutcome(results, checks) {
  const complete = ['ci', 'browser'].every((id) => results.some((r) => r.id === id && r.ok));
  const ok = complete && checks.every((r) => r.ok);
  return {
    automation: { status: ok ? 'PASS' : 'FAIL' },
    humanAcceptance: { status: 'NOT_EVALUATED' },
    qualification: { status: 'NOT_EVALUATED' },
    exitCode: ok ? 0 : 1,
  };
}

/** Executed gate counterexamples for local/qualification separation and prerequisite ordering. */
export async function checkVerificationTiers() {
  const accepted = [
    { id: 'ci', ok: true },
    { id: 'browser', ok: true },
  ];
  if (
    localOutcome(accepted, []).exitCode !== 0 ||
    localOutcome(accepted, []).qualification.status !== 'NOT_EVALUATED'
  )
    throw Error('local success confused with qualification');
  if (
    localOutcome(accepted, [{ ok: false }]).exitCode !== 1 ||
    localOutcome(accepted.slice(0, 1), []).exitCode !== 1
  )
    throw Error('incomplete local work accepted');
  let ran = false;
  await runVerificationPhases([
    ['ci', async () => ({ ok: false })],
    [
      'browser',
      async () => {
        ran = true;
      },
    ],
  ]);
  if (ran) throw Error('failed prerequisites did not stop browser execution');
  return { ok: true };
}

/** Priority is scheduling metadata, never a verification selector. */
export function parseCompletionArgs(tier, args) {
  assertNoHostProfile();
  const result = {
    base: 'HEAD',
    priorityFiles: [],
    priorityProvenance: 'explicit integration paths',
  };
  const usage = () =>
    Error(
      'Usage: local [--base <commit>] | merge --base <commit> [--incoming <commit> --destination <commit>] | final; all support --priority-files <paths...>',
    );
  if (!['local', 'merge', 'final'].includes(tier)) throw usage();
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw usage();
    seen.add(arg);
    if (
      arg === '--base' &&
      ['local', 'merge'].includes(tier) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      result.base = args[++i];
    else if (
      ['--incoming', '--destination'].includes(arg) &&
      tier === 'merge' &&
      args[i + 1] &&
      !args[i + 1].startsWith('-')
    )
      result[arg.slice(2)] = args[++i];
    else if (arg === '--priority-files') {
      while (args[i + 1] && !args[i + 1].startsWith('-')) result.priorityFiles.push(args[++i]);
      if (!result.priorityFiles.length) throw usage();
    } else throw usage();
  }
  if (
    tier === 'merge' &&
    (!seen.has('--base') || Boolean(result.incoming) !== Boolean(result.destination))
  )
    throw usage();
  result.priorityFiles = [...new Set(normalizeSelectedFiles(result.priorityFiles))];
  return result;
}
