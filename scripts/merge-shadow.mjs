import { execFileSync } from 'node:child_process';

/** Compare both branch deltas and the actual candidate, including conflict resolutions. */
export function integrationChanges(
  { base, incoming, destination },
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  for (const [name, value] of Object.entries({ base, incoming, destination }))
    if (typeof value !== 'string' || !value || value.startsWith('-'))
      throw Error(`Explicit ${name} commit required`);
  const resolve = (ref) =>
    git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  const refs = {
    base: resolve(base),
    incoming: resolve(incoming),
    destination: resolve(destination),
    head: resolve('HEAD'),
  };
  for (const ref of [refs.incoming, refs.destination, refs.head])
    git(['merge-base', '--is-ancestor', refs.base, ref]);
  const lists = [
    git(['diff', '--no-renames', '--name-only', '-z', refs.base, refs.incoming, '--']),
    git(['diff', '--no-renames', '--name-only', '-z', refs.base, refs.destination, '--']),
    git(['diff', '--no-renames', '--name-only', '-z', refs.base, '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return { refs, files: [...new Set(lists.flatMap((x) => x.split('\0')).filter(Boolean))].sort() };
}

/** A proposal only. Shared runtime retains full coverage until omission witnesses exist. */
export function mergeShadowReport({ checks, selection, files, historical }) {
  const ids = new Set(checks.map((c) => c.id));
  if (ids.size !== checks.length || selection.checks.some((c) => !ids.has(c.id)))
    throw Error('Invalid shadow check registry');
  const fullReason =
    selection.fallback ||
    (!files.length ? 'changed files unavailable' : null) ||
    (files.some((p) => /^src\/(?:model|simulation|core|scripting)\//.test(p))
      ? 'shared runtime: narrower coverage unvalidated'
      : null);
  const proposed = checks.filter(
    (c) => fullReason || c.smoke || selection.checks.some((x) => x.id === c.id),
  );
  const chosen = new Set(proposed.map((c) => c.id));
  const claim = (c) => ({
    id: c.id,
    script: c.script,
    ruleId: c.ruleId,
    barId: c.barId,
    tier: c.tier,
  });
  const report = {
    mode: 'SHADOW_ONLY',
    activation: 'NOT_AUTHORIZED',
    qualification: 'NOT_EVALUATED',
    requiredNow: checks.map((c) => c.id),
    files,
    fallback: fullReason,
    proposed: proposed.map((c) => ({
      ...claim(c),
      reason:
        fullReason ||
        (c.smoke ? 'registered integration smoke' : 'existing conservative affected selection'),
    })),
    omitted: checks
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        ...claim(c),
        coverage: 'NOT_EXECUTED',
        reason:
          'not selected by current affected selection or registered smoke; omission safety unproven',
      })),
    selectionReasons: selection.reasons,
    validation: {
      status: 'NOT_EVALUATED',
      remaining: [
        'Historical regression replay',
        'Held-out counterexamples',
        'Matched full versus proposed measurement',
        'Explicit policy approval before activation',
      ],
    },
  };
  if (historical) {
    if (!Array.isArray(historical.runs)) throw Error('Expected browser suite report with runs');
    const rows = new Map();
    for (const row of historical.runs) {
      if (rows.has(row.id)) throw Error(`duplicate historical check: ${row.id}`);
      rows.set(row.id, row);
    }
    const missing = checks
      .filter((c) => !Number.isFinite(rows.get(c.id)?.elapsedMs) || rows.get(c.id).elapsedMs < 0)
      .map((c) => c.id);
    const sum = (cs) => cs.reduce((total, c) => total + rows.get(c.id).elapsedMs, 0);
    report.historical = {
      source: historical.source,
      coverage: 'UNPROVEN',
      omittedFailures: checks
        .filter((c) => !chosen.has(c.id) && ['failed', 'FAIL'].includes(rows.get(c.id)?.status))
        .map((c) => c.id),
      missingTimings: missing,
      estimate: missing.length
        ? null
        : {
            kind: 'historical check work; not measured candidate wall time',
            fullCheckWorkMs: sum(checks),
            selectedCheckWorkMs: sum(proposed),
            wallClockSavingsMs: null,
          },
    };
  }
  return report;
}
