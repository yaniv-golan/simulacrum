import { cpus } from 'node:os';
import { listProcesses, descendantsOf } from './process-inventory.mjs';

/** What the one-minute load average cannot see: a video call, the window server compositing,
 * an indexer — one or two busy cores on a fourteen-core host barely move load1, yet they are
 * exactly what perturbs a 2 ms physics-phase p95. Two readings: host CPU idle over one second
 * (two `os.cpus()` tick reads; every platform, no subprocess) and the CPU share of the busiest
 * processes outside this process's own tree (the same `ps` reader the failure snapshot uses;
 * on macOS `ps` pcpu is a decaying average over up to a minute, recorded as such). Names only,
 * never arguments. A sampler that cannot read the host says so instead of guessing. */
export const PRESSURE_WINDOWS = Object.freeze({ idleMs: 1000, foreignMs: 60000 });
export async function samplePressure({
  sampleMs = PRESSURE_WINDOWS.idleMs,
  ownPid = process.pid,
  readCpus = cpus,
  readProcesses = listProcesses,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  top = 5,
} = {}) {
  const sampledAt = new Date().toISOString();
  try {
    const before = readCpus();
    await sleep(sampleMs);
    const after = readCpus();
    let idle = 0,
      total = 0;
    for (let i = 0; i < Math.min(before.length, after.length); i++)
      for (const key of Object.keys(after[i].times)) {
        const delta = after[i].times[key] - before[i].times[key];
        total += delta;
        if (key === 'idle') idle += delta;
      }
    const rows = readProcesses();
    const own = new Set(descendantsOf(rows, ownPid).map((row) => row.pid));
    own.add(ownPid);
    const foreign = rows
      .filter((row) => !own.has(row.pid) && row.pcpu >= 1)
      .sort((a, b) => b.pcpu - a.pcpu)
      .slice(0, top)
      .map(({ comm, pcpu, pid }) => ({ comm, pcpu, pid }));
    return {
      method: 'cpus+ps',
      sampledAt,
      idlePercent: total > 0 ? Number(((100 * idle) / total).toFixed(1)) : null,
      foreign,
      windows: PRESSURE_WINDOWS,
    };
  } catch (error) {
    return {
      method: 'unavailable',
      sampledAt,
      error: error.message,
      idlePercent: null,
      foreign: [],
    };
  }
}
