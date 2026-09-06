/** Collect independent check failures, but abort if the evidence source changes. */
export async function runCheckSequence(checks, execute, afterEach = () => {}) {
  const results = [];
  for (const check of checks) {
    try {
      results.push({ id: check.id, ok: true, value: await execute(check) });
    } catch (error) {
      results.push({ id: check.id, ok: false, error });
    }
    await afterEach(check);
  }
  return results;
}
