import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const activeChildren = new Set();
const TERMINATION_GRACE_MS = 250;
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
        const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,uid=,stat='], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1000,
        })
          .trim()
          .split('\n')
          .map((line) => {
            const [pid, ppid, pgid, uid, state] = line.trim().split(/\s+/);
            return [Number(pid), Number(ppid), Number(pgid), Number(uid), state];
          });
        const descendants = [child.pid];
        for (let i = 0; i < descendants.length; i++)
          for (const [pid, ppid] of rows)
            if (ppid === descendants[i] && !descendants.includes(pid)) descendants.push(pid);
        observe('enumeration-finished', {
          ownedCount: descendants.length,
          processes: rows
            .filter(([pid]) => descendants.includes(pid))
            .slice(0, 64)
            .map(([pid, ppid, pgid, uid, state]) => ({ pid, ppid, pgid, uid, state })),
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
