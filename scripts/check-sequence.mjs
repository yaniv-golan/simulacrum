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
