import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadavg } from 'node:os';
import { basename } from 'node:path';

const activeChildren = new Set();
const TERMINATION_GRACE_MS = 250;
const SNAPSHOT_ROWS = 8;
// Host daemons whose activity is worth seeing at a stall regardless of ranking
// (Gatekeeper/XProtect assessment of freshly installed binaries, Spotlight indexing).
const WATCHED_DAEMONS =
  /^(?:syspolicyd|XProtect\w*|XprotectService|mds|mds_stores|mdworker\w*|trustd)$/;
/** Bounded host inventory at a failure. `comm` is the executable name only; no
 * arguments or environment values are read. Diagnostics, never attribution. */
function listProcesses() {
  return execFileSync(
    'ps',
    ['-A', '-o', 'pid=,ppid=,pgid=,uid=,stat=,pcpu=,rss=,time=,etime=,comm='],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // comm is last because macOS prints the executable path, which may contain spaces.
      const [pid, ppid, pgid, uid, stat, pcpu, rss, time, etime, ...comm] = line
        .trim()
        .split(/\s+/);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        pgid: Number(pgid),
        uid: Number(uid),
        stat,
        pcpu: Number(pcpu),
        rssKb: Number(rss),
        time,
        etime,
        comm: basename(comm.join(' ')),
      };
    });
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
    comm,
  });
  const tree = [];
  const root = rows.find((row) => row.pid === rootPid);
  if (root) tree.push(root);
  for (let i = 0; i < tree.length; i++)
    for (const row of rows) if (row.ppid === tree[i].pid && !tree.includes(row)) tree.push(row);
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
    watch: rows.filter((row) => WATCHED_DAEMONS.test(row.comm)).map(brief),
    tree: tree.map(brief),
  };
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
      events: [],
      droppedEvents: 0,
    };
    const observe = (type, details = {}) => {
      if (processDiagnostics.events.length < 256)
        processDiagnostics.events.push({
          type,
          elapsedMs: performance.now() - started,
          ...details,
        });
      else processDiagnostics.droppedEvents++;
    };
    const takeSnapshot = (at, rootPid, rows = null) => {
      if (process.platform === 'win32') {
        processDiagnostics.snapshot = { at, unsupported: 'win32' };
        return;
      }
      const snapshotStarted = performance.now();
      try {
        processDiagnostics.snapshot = {
          ...processSnapshot(rows ?? listProcesses(), rootPid, at),
          snapshotMs: performance.now() - snapshotStarted,
        };
      } catch (error) {
        processDiagnostics.snapshot = {
          at,
          snapshotError: error.code ?? error.message,
          snapshotMs: performance.now() - snapshotStarted,
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
      if (!timedOut && closeCode !== 0 && !processDiagnostics.snapshot) takeSnapshot('exit', null);
      observe('settlement', { code: closeCode, signal: closeSignal, timedOut });
      const result = {
        processDiagnostics,
        stdout,
        stderr,
        output: stdout + stderr,
        elapsedMs: performance.now() - started,
        code: closeCode,
        signal: closeSignal,
        failureKind: timedOut ? 'watchdog' : closeCode !== 0 ? 'check-failure' : null,
      };
      if (timedOut || closeCode !== 0) {
        const summary = `${timedOut ? `timed out after ${timeoutMs} ms` : `check exited ${closeCode ?? closeSignal}`}: ${command} ${args.join(' ')}`;
        reject(Object.assign(new Error(`${summary}\n${result.output}`), result, { summary }));
      } else resolve(result);
    }
    const dueMs = performance.now() - started + timeoutMs;
    const timer = setTimeout(() => {
      observe('watchdog-fired', { dueMs });
      timedOut = true;
      if (process.platform === 'win32') {
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
        const rows = listProcesses();
        // The same inventory names who else was busy at the stall.
        takeSnapshot('watchdog', child.pid, rows);
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
