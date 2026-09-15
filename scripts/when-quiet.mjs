import { setTimeout as delay } from 'node:timers/promises';
import { launchAdmission } from './verification-tiers.mjs';
import { windowState as readWindowState } from './verification-window.mjs';
import { SLEEP_GAP_MS } from './run-check.mjs';

const usage = 'Usage: verify:candidate -- <tier> [tier options] --when-quiet <maxWaitMs>';
/** Strip `--when-quiet <ms>` from the candidate arguments. Scheduling only: it never reaches the
 * tier, the descriptor or the report's priority. Syntax only: verify-candidate refuses the flag
 * beside a citation (`cite-final`, `--satisfied-by`) in its own argument order, after the
 * citation arguments are stripped, so that refusal is never dead code here. */
export function parseWhenQuietArgs(argv) {
  const rest = [];
  let whenQuiet = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--when-quiet') {
      rest.push(argv[i]);
      continue;
    }
    const value = Number(argv[i + 1]);
    if (whenQuiet !== null || !argv[i + 1] || !Number.isFinite(value) || value <= 0)
      throw Error(`${usage}\n--when-quiet needs one positive number of milliseconds`);
    whenQuiet = Math.floor(value);
    i++;
  }
  return { rest, whenQuiet };
}
export const CITATION_REFUSAL =
  '--when-quiet cannot accompany --satisfied-by: a citation runs nothing on the host';

const POLL_INTERVAL_MS = 5000;
/** The record keeps a transition per change of sample CLASS, never per change of live numbers:
 * an admission reason embeds the load and pressure it measured, so keyed on text an 8 h wait
 * would record every refused sample. */
export const MAX_TRANSITIONS = 64;
export function sampleKind(sample) {
  if (sample.admitted) return 'admitted';
  if (sample.hostSlept) return 'host-slept';
  if (sample.windowOwner !== null && sample.windowOwner !== undefined) return 'window-owned';
  return `refused: ${String(sample.reason ?? '').replace(/\d+(?:\.\d+)?/g, '#')}`;
}
/** Poll OUTSIDE the window until one sample would pass the launch admission for `reach` while no
 * window owner is live, or until maxWaitMs of counted waiting elapsed. No lease, no capture, no
 * candidate directory is touched. A wall-clock jump beyond sleepGapMs is a `host-slept` sample,
 * named and not counted toward the wait. An abandoned (dead-pid) owner fails the poll at once:
 * the tier would refuse it after capture anyway, and recovery is a human decision. */
export async function pollUntilQuiet({
  maxWaitMs,
  reach,
  admit = (options) => launchAdmission(options),
  windowState = () => readWindowState(),
  now = () => Date.now(),
  intervalMs = POLL_INTERVAL_MS,
  sleep = () => delay(intervalMs),
  sleepGapMs = SLEEP_GAP_MS,
  onSample = () => {},
} = {}) {
  if (!Number.isFinite(maxWaitMs) || maxWaitMs <= 0) throw Error('maxWaitMs must be positive');
  const startedAt = now();
  let waitedMs = 0,
    hostSleptMs = 0,
    count = 0,
    last = null,
    first = null,
    lastTick = startedAt,
    transitionsDropped = 0;
  const transitions = [],
    windowOwners = [];
  const record = (sample) => {
    count++;
    first ??= sample;
    const previous = last;
    last = sample;
    const kind = sampleKind(sample);
    if (!previous || sampleKind(previous) !== kind) {
      if (transitions.length < MAX_TRANSITIONS) transitions.push({ ...sample, kind });
      else transitionsDropped++;
    }
    onSample(sample);
  };
  for (;;) {
    const state = windowState();
    if (state?.state === 'abandoned')
      throw Error(
        `abandoned verification window needs explicit recovery (owner pid ${state.owner?.pid} is gone); --when-quiet will not wait it out`,
      );
    const owner = state?.state === 'owned' ? state.owner : null;
    if (owner && !windowOwners.some((o) => o.pid === owner.pid))
      windowOwners.push({ atMs: waitedMs, pid: owner.pid, cwd: owner.cwd, intent: owner.intent });
    const decision = owner ? null : await admit({ reach, waitMs: 0 });
    const sample = {
      atMs: waitedMs,
      admitted: !!decision?.ok,
      reason: owner ? `verification window owned by pid ${owner.pid}` : (decision?.reason ?? null),
      load1: decision?.admission?.load1 ?? null,
      windowOwner: owner?.pid ?? null,
      hostSlept: false,
    };
    record(sample);
    if (sample.admitted)
      return {
        admitted: true,
        waitedMs,
        hostSleptMs,
        admittedAt: new Date(now()).toISOString(),
        reach,
        windowOwner: null,
        windowOwners,
        samples: { count, first, last, transitions, transitionsDropped },
      };
    if (waitedMs >= maxWaitMs)
      return {
        admitted: false,
        waitedMs,
        hostSleptMs,
        reason: sample.reason,
        reach,
        windowOwners,
        samples: { count, first, last, transitions, transitionsDropped },
      };
    await sleep();
    const tick = now(),
      elapsed = tick - lastTick;
    lastTick = tick;
    if (elapsed > sleepGapMs) {
      // The host was asleep (or suspended): name it, do not count it as waiting.
      hostSleptMs += elapsed - intervalMs;
      record({
        atMs: waitedMs,
        admitted: false,
        reason: 'host slept',
        hostSlept: true,
        windowOwner: null,
        load1: null,
      });
      waitedMs += intervalMs;
    } else waitedMs += elapsed;
  }
}
