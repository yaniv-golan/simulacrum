/** A failed prerequisite prevents expensive downstream work. Qualification uses a separate gate. */
export async function runVerificationPhases(phases) {
  const rows = [];
  for (const [id, execute] of phases) {
    try {
      const result = await execute();
      rows.push({ id, ok: result?.ok !== false, result });
    } catch (error) {
      rows.push({ id, ok: false, error: error.message });
      console.error(`${id}: ${error.stack}`);
    }
    if (!rows.at(-1).ok) break;
  }
  return rows;
}
export function localOutcome(results, checks) {
  const complete = ['ci', 'browser'].every((id) => results.some((r) => r.id === id && r.ok));
  const ok = complete && checks.every((r) => r.ok);
  return {
    automation: { status: ok ? 'PASS' : 'FAIL' },
    humanAcceptance: { status: 'NOT_EVALUATED' },
    qualification: { status: 'NOT_EVALUATED' },
    exitCode: ok ? 0 : 1,
  };
}

/** Executed gate counterexamples for local/qualification separation and prerequisite ordering. */
export async function checkVerificationTiers() {
  const accepted = [
    { id: 'ci', ok: true },
    { id: 'browser', ok: true },
  ];
  if (
    localOutcome(accepted, []).exitCode !== 0 ||
    localOutcome(accepted, []).qualification.status !== 'NOT_EVALUATED'
  )
    throw Error('local success confused with qualification');
  if (
    localOutcome(accepted, [{ ok: false }]).exitCode !== 1 ||
    localOutcome(accepted.slice(0, 1), []).exitCode !== 1
  )
    throw Error('incomplete local work accepted');
  let ran = false;
  await runVerificationPhases([
    ['ci', async () => ({ ok: false })],
    [
      'browser',
      async () => {
        ran = true;
      },
    ],
  ]);
  if (ran) throw Error('failed prerequisites did not stop browser execution');
  return { ok: true };
}
