/** Work-conserving workers; exclusive checks are barriers. Fatal integrity errors drain started work. */
export async function runCheckSequence(
  checks,
  execute,
  afterEach = () => {},
  { workers = 1 } = {},
) {
  if (![1, 2].includes(workers)) throw Error('browser workers must be 1 or 2');
  const results = new Array(checks.length);
  let next = 0,
    fatal;
  async function run(index) {
    const check = checks[index];
    try {
      results[index] = { id: check.id, ok: true, value: await execute(check) };
    } catch (error) {
      results[index] = { id: check.id, ok: false, error };
    }
    try {
      await afterEach(check);
    } catch (error) {
      fatal ??= error;
    }
  }
  while (next < checks.length && !fatal) {
    if (checks[next].execution !== 'parallel') await run(next++);
    else {
      let end = next;
      while (checks[end]?.execution === 'parallel') end++;
      await Promise.all(
        Array.from({ length: Math.min(workers, end - next) }, async () => {
          while (next < end && !fatal) await run(next++);
        }),
      );
    }
  }
  if (fatal) throw fatal;
  return results;
}

/** Pack only undersized admitted parallel runs. Existing runs are never split;
 * runs of four or more remain in place. New combined groups contain at most four
 * checks. The priority prefix and relative exclusive order are unchanged.
 */
export function packParallelChecks(checks, { workers = 1, priorityCount = 0 } = {}) {
  if (![1, 2].includes(workers)) throw Error('browser workers must be 1 or 2');
  if (!Number.isInteger(priorityCount) || priorityCount < 0 || priorityCount > checks.length)
    throw Error('invalid priority prefix');
  if (workers === 1) return [...checks];
  const ordered = checks.slice(0, priorityCount);
  let smallRuns = [], exclusive = [];
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
  for (let i = priorityCount; i < checks.length;) {
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
