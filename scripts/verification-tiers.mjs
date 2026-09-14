import { normalizeSelectedFiles } from './test-selection.mjs';
import { assertNoHostProfile } from './host-profile.mjs';
/** A failed prerequisite prevents expensive downstream work. Qualification uses a separate gate. */
export async function runVerificationPhases(
  phases,
  { now = () => performance.now(), onProgress = () => {} } = {},
) {
  const rows = [];
  for (const [id, execute] of phases) {
    const started = now();
    const row = { id, status: 'running', startedAt: new Date().toISOString() };
    rows.push(row);
    onProgress(rows);
    try {
      row.result = await execute();
      row.ok = row.result?.ok !== false;
    } catch (error) {
      row.ok = false;
      row.error = error.message;
      console.error(`${id}: ${error.stack}`);
    }
    row.status = row.ok ? 'passed' : 'failed';
    row.elapsedMs = now() - started;
    onProgress(rows);
    if (!row.ok) break;
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

/** Priority is scheduling metadata, never a verification selector. */
export function parseCompletionArgs(tier, args) {
  assertNoHostProfile();
  const result = {
    base: 'HEAD',
    priorityFiles: [],
    priorityProvenance: 'explicit integration paths',
  };
  const usage = () =>
    Error(
      'Usage: local [--base <commit>] | merge --base <commit> [--incoming <commit> --destination <commit>] | final; all support --priority-files <paths...>',
    );
  if (!['local', 'merge', 'final'].includes(tier)) throw usage();
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw usage();
    seen.add(arg);
    if (
      arg === '--base' &&
      ['local', 'merge'].includes(tier) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      result.base = args[++i];
    else if (
      ['--incoming', '--destination'].includes(arg) &&
      tier === 'merge' &&
      args[i + 1] &&
      !args[i + 1].startsWith('-')
    )
      result[arg.slice(2)] = args[++i];
    else if (arg === '--priority-files') {
      while (args[i + 1] && !args[i + 1].startsWith('-')) result.priorityFiles.push(args[++i]);
      if (!result.priorityFiles.length) throw usage();
    } else throw usage();
  }
  if (
    tier === 'merge' &&
    (!seen.has('--base') || Boolean(result.incoming) !== Boolean(result.destination))
  )
    throw usage();
  result.priorityFiles = [...new Set(normalizeSelectedFiles(result.priorityFiles))];
  return result;
}
