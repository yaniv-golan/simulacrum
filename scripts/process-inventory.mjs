import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Bounded host inventory at a failure. `comm` is the executable name only; no
 * arguments or environment values are read. Diagnostics, never attribution. */
export function listProcesses() {
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
        executable: comm.join(' '),
      };
    });
}
/** The root and every process reachable from it through ppid. */
export function descendantsOf(rows, rootPid) {
  const tree = [];
  const root = rows.find((row) => row.pid === rootPid);
  if (root) tree.push(root);
  for (let i = 0; i < tree.length; i++)
    for (const row of rows) if (row.ppid === tree[i].pid && !tree.includes(row)) tree.push(row);
  return tree;
}
/** The kernel wait channel a blocked process sleeps in. Linux exports it per process;
 * macOS exports none to userland (`ps -o wchan` prints `-` for every row), so there the
 * stack sample carries the syscall instead. */
export function waitChannelOf(pid) {
  if (process.platform !== 'linux') return null;
  try {
    return readFileSync(`/proc/${pid}/wchan`, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
const SAMPLE_TARGETS = 1;
/** Owned descendants blocked in uninterruptible wait (`U` on macOS, `D` on Linux), never a
 * foreign process; the bounded set a watchdog may stack-sample. */
export function selectSampleTargets(rows, rootPid) {
  return descendantsOf(rows, rootPid)
    .filter((row) => /^[UD]/.test(row.stat ?? ''))
    .slice(0, SAMPLE_TARGETS);
}
const SAMPLE_TIMEOUT_MS = 3000;
/** Bounded stack sample of one own-user process: the top-of-stack section (which names
 * every thread's leaf frame, so the blocking syscall) and a short call-graph head. Output
 * goes to our pipe, never to /tmp. About one second; only taken on a failure path, and
 * killed after three — a sampler itself stuck in uninterruptible I/O cannot be killed
 * until that I/O returns, an accepted failure-path risk. */
export function sampleProcess(pid, { durationSeconds = 1, maxLines = 16 } = {}) {
  if (process.platform !== 'darwin') return { pid, unsupported: process.platform };
  try {
    const text = execFileSync(
      'sample',
      [String(pid), String(durationSeconds), '-mayDie', '-file', '/dev/stdout'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: SAMPLE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
    const section = (marker) => {
      const start = text.indexOf(marker);
      if (start < 0) return [];
      return text
        .slice(start)
        .split('\n')
        .slice(1)
        .filter((line) => line.trim())
        .slice(0, maxLines);
    };
    return {
      pid,
      topOfStack: section('Sort by top of stack'),
      callGraph: section('Call graph:').slice(0, 8),
    };
  } catch (error) {
    return { pid, error: error.code ?? error.message };
  }
}
/** Paging counters and free memory, so a stall's paging is measured against the row's start
 * rather than inferred from process state. Units differ by platform and are named: macOS
 * counts pages of `pageBytes`; Linux `pgpgin`/`pgpgout` and `MemFree` are kilobytes. */
export function readMemoryCounters() {
  try {
    if (process.platform === 'darwin') {
      const text = execFileSync('vm_stat', [], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000,
      });
      const value = (label) => {
        const match = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text);
        return match ? Number(match[1]) : null;
      };
      const pageBytes = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 0) || null;
      const counters = {
        pageins: value('Pageins'),
        pageouts: value('Pageouts'),
        free: value('Pages free'),
        unit: 'pages',
        pageBytes,
      };
      if ([counters.pageins, counters.pageouts, counters.free].some((v) => v === null))
        return { unsupported: 'vm_stat' };
      return counters;
    }
    if (process.platform === 'linux') {
      const stat = readFileSync('/proc/vmstat', 'utf8'),
        info = readFileSync('/proc/meminfo', 'utf8');
      const value = (source, label) => {
        const match = new RegExp(`^${label}[: ]+(\\d+)`, 'm').exec(source);
        return match ? Number(match[1]) : null;
      };
      const counters = {
        pageins: value(stat, 'pgpgin'),
        pageouts: value(stat, 'pgpgout'),
        free: value(info, 'MemFree'),
        unit: 'kB',
      };
      if ([counters.pageins, counters.pageouts, counters.free].some((v) => v === null))
        return { unsupported: 'procfs' };
      return counters;
    }
  } catch (error) {
    return { unsupported: error.code ?? error.message };
  }
  return { unsupported: process.platform };
}
