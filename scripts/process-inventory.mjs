import { execFileSync } from 'node:child_process';

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
