import { spawn, execFileSync } from 'node:child_process';
import {
  listProcesses,
  descendantsOf,
  selectSampleTargets,
  sampleProcess,
  readMemoryCounters,
  waitChannelOf,
} from './process-inventory.mjs';
import { pathToFileURL } from 'node:url';
import { loadavg } from 'node:os';
import { basename } from 'node:path';

const activeChildren = new Set();
const TERMINATION_GRACE_MS = 250;
const SNAPSHOT_ROWS = 8;
// Host daemons whose activity is worth seeing at a stall regardless of ranking
// (Gatekeeper/XProtect assessment of freshly installed binaries, Spotlight indexing).
const WATCHED_DAEMONS = /^(?:syspolicyd|xprotect\w*|mds|mds_stores|mdworker\w*|trustd)$/i;
const SNAPSHOT_LIST_ROWS = 32;
// A beat every second; a gap of more than a minute between beats is a host sleep, never a
// busy scheduler (timer lateness on a loaded host is measured in seconds).
const HEARTBEAT_MS = 1000;
const SLEEP_GAP_MS = 60_000;
/** H1 signal (unverified hypothesis): a freshly installed binary still carrying
 * quarantine/provenance attributes is a candidate for a first-exec assessment stall.
 * macOS only; bounded; never throws. */
function firstExecHint(executable) {
  if (process.platform !== 'darwin' || !executable || !executable.startsWith('/'))
    return { unsupported: process.platform !== 'darwin' ? process.platform : 'relative' };
  try {
    const attributes = execFileSync('xattr', ['-l', executable], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
    return {
      path: executable,
      quarantined: /^com\.apple\.quarantine:/m.test(attributes),
      provenance: /^com\.apple\.provenance:/m.test(attributes),
    };
  } catch (error) {
    return { path: executable, error: error.code ?? error.message };
  }
}
function timedHint(executable) {
  const started = performance.now();
  const firstExec = firstExecHint(executable);
  return { firstExecHint: firstExec, hintMs: performance.now() - started };
}
function processSnapshot(rows, rootPid, at) {
  const brief = ({ pid, ppid, stat, pcpu, rssKb, time, etime, comm }) => ({
    pid,
    ppid,
    stat,
    pcpu,
    rssKb,
    time,
    etime,
    wchan: waitChannelOf(pid),
    comm,
  });
  const tree = descendantsOf(rows, rootPid);
  const root = tree[0]?.pid === rootPid ? tree[0] : null;
  const top = (key) =>
    [...rows]
      .sort((a, b) => b[key] - a[key])
      .slice(0, SNAPSHOT_ROWS)
      .map(brief);
  return {
    at,
    loadAverage: loadavg(),
    topCpu: top('pcpu'),
    topRss: top('rssKb'),
    watch: rows
      .filter((row) => WATCHED_DAEMONS.test(row.comm))
      .slice(0, SNAPSHOT_LIST_ROWS)
      .map(brief),
    tree: tree.slice(0, SNAPSHOT_LIST_ROWS).map(brief),
    ...timedMemory(),
    ...(root && at === 'watchdog' ? timedHint(root.executable) : {}),
    ...(at === 'watchdog' ? timedSamples(rows, rootPid) : { samples: [], sampleMs: 0 }),
  };
}
function timedMemory() {
  const started = performance.now();
  const memory = readMemoryCounters();
  return { memory, memoryMs: performance.now() - started };
}
/** A stall's evidence: the syscall each blocked owned descendant sleeps in. Bounded to a
 * few processes and a second each; only paid at a watchdog. */
function timedSamples(rows, rootPid) {
  const started = performance.now();
  const samples = selectSampleTargets(rows, rootPid).map((row) => ({
    comm: row.comm,
    stat: row.stat,
    wchan: waitChannelOf(row.pid),
    ...sampleProcess(row.pid),
  }));
  return { samples, sampleMs: performance.now() - started };
}
function signalGroup(child, signal, observe = () => {}) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
    observe('signal', {
      target: process.platform === 'win32' ? child.pid : -child.pid,
      signal,
      outcome: 'sent',
    });
  } catch (error) {
    observe('signal', {
      target: process.platform === 'win32' ? child.pid : -child.pid,
      signal,
      outcome: 'error',
      errno: error.code,
    });
    if (error.code !== 'ESRCH') throw error;
  }
}
function propagateTermination() {
  // Shared runners cooperate before their owner escalates to SIGKILL. A blocked
  // event loop cannot run this handler; the outer process inventory remains the
  // backstop for that case and for third-party programs that detach themselves.
  for (const child of activeChildren)
    try {
      signalGroup(child, 'SIGTERM');
    } catch {}
}
function retainChild(child) {
  activeChildren.add(child);
}
function releaseChild(child) {
  activeChildren.delete(child);
  if (activeChildren.size === 0 && process.platform !== 'win32')
    process.off('SIGTERM', propagateTermination);
}

/** One bounded process-tree owner for checks, including their browser children. */
export function runProcess(
  command,
  args = [],
  {
    timeoutMs = 60_000,
    cwd = process.cwd(),
    env = process.env,
    maxOutputBytes = 4 * 1024 * 1024,
    inheritOutput = false,
    heartbeatMs = HEARTBEAT_MS,
    sleepGapMs = SLEEP_GAP_MS,
    wallClock = Date.now,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('deadline must be positive');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0)
    throw new Error('output limit must be positive');
  return new Promise((resolve, reject) => {
    const started = performance.now(),
      firstChild = activeChildren.size === 0 && process.platform !== 'win32';
    const processDiagnostics = {
      startedAt: new Date().toISOString(),
      // Paging counters at start, for rows long enough to stall (a unit file is not);
      // the watchdog snapshot reads them again so a stall's page-in is a measured delta.
      memoryAtStart: timeoutMs >= 10_000 ? readMemoryCounters() : { unsupported: 'short row' },
      events: [],
      droppedEvents: 0,
    };
    // A wall-clock heartbeat sees a host sleep on every platform: a gap between beats far
    // longer than the beat is time the host was not running, not time the check spent.
    // (libuv's continuous clock happens to count sleep on darwin, Linux's monotonic one does
    // not; Date.now() does everywhere.) Accumulated, and named at settlement.
    let lastBeat = wallClock(),
      hostSleptMs = 0;
    const heartbeat = setInterval(() => {
      const beat = wallClock(),
        gap = beat - lastBeat;
      lastBeat = beat;
      if (gap > sleepGapMs) {
        hostSleptMs += gap;
        observe('host-slept', { gapMs: gap, hostSleptMs });
      }
    }, heartbeatMs);
    heartbeat.unref?.();
    const observe = (type, details = {}) => {
      if (processDiagnostics.events.length < 256)
        processDiagnostics.events.push({
          type,
          elapsedMs: performance.now() - started,
          ...details,
        });
      else processDiagnostics.droppedEvents++;
    };
    // enumerationMs is the ps call (only paid here when the watchdog did not already
    // enumerate); snapshotMs is the in-memory ranking and tree walk.
    const takeSnapshot = (at, rootPid, rows = null, enumerationMs = null) => {
      if (process.platform === 'win32') {
        processDiagnostics.snapshot = { at, unsupported: 'win32' };
        observe('snapshot', { at, error: null });
        return;
      }
      let listStarted = performance.now();
      try {
        if (!rows) {
          rows = listProcesses();
          enumerationMs = performance.now() - listStarted;
        }
        const snapshotStarted = performance.now();
        const snapshot = processSnapshot(rows, rootPid, at);
        processDiagnostics.snapshot = {
          ...snapshot,
          enumerationMs,
          snapshotMs:
            performance.now() -
            snapshotStarted -
            (snapshot.hintMs ?? 0) -
            snapshot.sampleMs -
            snapshot.memoryMs,
        };
      } catch (error) {
        processDiagnostics.snapshot = {
          at,
          snapshotError: error.code ?? error.message,
          enumerationMs: enumerationMs ?? performance.now() - listStarted,
          snapshotMs: 0,
        };
      }
      observe('snapshot', { at, error: processDiagnostics.snapshot.snapshotError ?? null });
    };
    // Install before native spawn: termination can arrive after the OS child
    // exists but before spawn returns. Signal callbacks run after this stack,
    // by which time the returned child has been retained below.
    if (firstChild) process.on('SIGTERM', propagateTermination);
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      if (firstChild && activeChildren.size === 0) process.off('SIGTERM', propagateTermination);
      observe('spawn-error', { errno: error.code });
      clearInterval(heartbeat);
      reject(Object.assign(error, { processDiagnostics }));
      return;
    }
    processDiagnostics.pid = child.pid;
    observe('spawn-return', { pid: child.pid });
    retainChild(child);
    let stdout = '',
      stderr = '',
      timedOut = false,
      closed = false,
      forced = false,
      closeCode,
      closeSignal;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-maxOutputBytes);
      if (inheritOutput) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-maxOutputBytes);
      if (inheritOutput) process.stderr.write(chunk);
    });
    function finish() {
      if (!closed || (timedOut && !forced)) return;
      // Post-hoc host context for a check failure; the child is already gone, so the
      // tree is empty. Bounded by the same 1 s enumeration limit as the watchdog path.
      const elapsedMs = performance.now() - started;
      clearInterval(heartbeat);
      // One last look: a sleep that ended just before settlement has no beat after it yet.
      const finalGap = wallClock() - lastBeat;
      if (finalGap > sleepGapMs) {
        hostSleptMs += finalGap;
        observe('host-slept', { gapMs: finalGap, hostSleptMs });
      }
      processDiagnostics.hostSleptMs = hostSleptMs;
      if (!timedOut && closeCode !== 0 && !processDiagnostics.snapshot) takeSnapshot('exit', null);
      observe('settlement', { code: closeCode, signal: closeSignal, timedOut, hostSleptMs });
      const failed = timedOut || closeCode !== 0;
      const result = {
        processDiagnostics,
        stdout,
        stderr,
        output: stdout + stderr,
        elapsedMs,
        hostSleptMs,
        code: closeCode,
        signal: closeSignal,
        failureKind: !failed
          ? null
          : hostSleptMs > 0
            ? 'host-slept'
            : timedOut
              ? 'watchdog'
              : 'check-failure',
      };
      if (failed) {
        const summary =
          hostSleptMs > 0
            ? `host slept ${Math.round(hostSleptMs / 1000)} s during the check (${timedOut ? `watchdog after ${timeoutMs} ms` : `exit ${closeCode ?? closeSignal}`}): not evaluated: ${command} ${args.join(' ')}`
            : `${timedOut ? `timed out after ${timeoutMs} ms` : `check exited ${closeCode ?? closeSignal}`}: ${command} ${args.join(' ')}`;
        reject(Object.assign(new Error(`${summary}\n${result.output}`), result, { summary }));
      } else resolve(result);
    }
    const dueMs = performance.now() - started + timeoutMs;
    const timer = setTimeout(() => {
      observe('watchdog-fired', { dueMs });
      timedOut = true;
      if (process.platform === 'win32') {
        takeSnapshot('watchdog', child.pid);
        observe('taskkill-requested', { target: child.pid });
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once(
          'error',
          () => child.kill('SIGKILL'),
        );
        forced = true;
        finish();
        return;
      }
      // Enumerate while the root still exists, then terminate detached descendants
      // from leaves upward. This path also handles synchronously blocked runners.
      try {
        observe('enumeration-started');
        const enumerationStarted = performance.now();
        const rows = listProcesses();
        // The same inventory names who else was busy at the stall.
        takeSnapshot('watchdog', child.pid, rows, performance.now() - enumerationStarted);
        const descendants = [child.pid];
        for (let i = 0; i < descendants.length; i++)
          for (const { pid, ppid } of rows)
            if (ppid === descendants[i] && !descendants.includes(pid)) descendants.push(pid);
        observe('enumeration-finished', {
          ownedCount: descendants.length,
          processes: rows
            .filter(({ pid }) => descendants.includes(pid))
            .slice(0, 64)
            .map(({ pid, ppid, pgid, uid, stat }) => ({ pid, ppid, pgid, uid, state: stat })),
        });
        for (const pid of descendants.slice(1).reverse())
          try {
            process.kill(pid, 'SIGKILL');
            observe('signal', { target: pid, signal: 'SIGKILL', outcome: 'sent' });
          } catch (error) {
            observe('signal', {
              target: pid,
              signal: 'SIGKILL',
              outcome: 'error',
              errno: error.code,
            });
            if (error.code !== 'ESRCH') throw error;
          }
      } catch (error) {
        observe('enumeration-error', { errno: error.code });
        if (!processDiagnostics.snapshot) {
          processDiagnostics.snapshot = {
            at: 'watchdog',
            snapshotError: error.code ?? error.message,
            snapshotMs: 0,
          };
          observe('snapshot', { at: 'watchdog', error: processDiagnostics.snapshot.snapshotError });
        }
        stderr += `\nProcess tree enumeration unavailable: ${error.message}`;
      }
      try {
        signalGroup(child, 'SIGTERM', observe);
      } catch (error) {
        stderr += `\nTermination failed: ${error.message}`;
      }
      // Do not cancel this escalation when the immediate process exits: a child
      // that ignores SIGTERM can outlive that process within the same group.
      setTimeout(() => {
        observe('escalation-fired');
        try {
          signalGroup(child, 'SIGKILL', observe);
        } catch (error) {
          stderr += `\nForced termination failed: ${error.message}`;
        }
        forced = true;
        // An escaped descendant must not keep inherited output pipes and the
        // caller's deadline open forever when process inventory was unavailable.
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, TERMINATION_GRACE_MS);
    }, timeoutMs);
    child.once('exit', (code, signal) => observe('exit', { code, signal }));
    child.once('error', (error) => {
      observe('process-error', { errno: error.code });
      clearTimeout(timer);
      clearInterval(heartbeat);
      releaseChild(child);
      reject(Object.assign(error, { processDiagnostics }));
    });
    child.once('close', (code, signal) => {
      observe('close', { code, signal });
      clearTimeout(timer);
      releaseChild(child);
      closed = true;
      closeCode = code;
      closeSignal = signal;
      finish();
    });
  });
}
export function runModuleCheck(modulePath, exportName, args = [], options = {}) {
  const source = `const m=await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const fn=m[${JSON.stringify(exportName)}]; if(typeof fn!=='function') throw new Error('missing check export'); await fn(...${JSON.stringify(args)});`;
  return runProcess(process.execPath, ['--input-type=module', '-e', source], options);
}
