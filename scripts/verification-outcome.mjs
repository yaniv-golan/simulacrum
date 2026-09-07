/** Summarize executed results, never infer human eligibility from a green test receipt. */
export function verificationOutcome(results, checks) {
  const gate = results.find((row) => row.id === 'gate')?.result;
  const bars = gate?.bars ?? [];
  const complete =
    ['ci', 'browser', 'gate'].every((id) => results.some((row) => row.id === id)) &&
    Array.isArray(gate?.bars) &&
    bars.length === gate.dueBarCount &&
    bars.every(
      (bar) =>
        typeof bar.human === 'boolean' &&
        ['RED', 'GREEN'].includes(bar.state) &&
        (!bar.human ||
          (bar.state === 'GREEN'
            ? bar.assessment === 'passed'
            : ['pending', 'failed', 'invalid'].includes(bar.assessment))),
    );
  const failures = [
    ...results.filter((row) => row.id !== 'gate' && !row.ok).map((row) => row.id),
    ...checks.filter((row) => !row.ok).map((row) => row.id),
    ...bars.filter((bar) => !bar.human && bar.state !== 'GREEN').map((bar) => bar.id),
  ];
  if (gate?.failed !== 0) failures.push('structural checks');
  if (gate?.unmet !== 0) failures.push('milestone obligations');
  if (!complete) failures.push('incomplete gate results');
  const human = bars.filter((bar) => bar.human);
  const blocked = human.filter((bar) => bar.state !== 'GREEN');
  const status = !complete
    ? 'UNKNOWN'
    : blocked.some((bar) => !['pending', 'failed'].includes(bar.assessment))
      ? 'INVALID'
      : blocked.some((bar) => bar.assessment === 'failed')
        ? 'FAILED'
        : blocked.length
          ? 'PENDING'
          : 'PASS';
  // An inconsistent gate cannot authorize qualification even when its counters look green.
  if (!failures.length && !blocked.length && !results.find((row) => row.id === 'gate')?.ok)
    failures.push('gate refused');
  const automation = {
    status: failures.length ? 'FAIL' : 'PASS',
    failures: [...new Set(failures)],
  };
  const exitCode = failures.length ? 1 : blocked.length ? 2 : 0;
  return {
    automation,
    humanAcceptance: { status, bars: human },
    qualification: { status: exitCode ? 'BLOCKED' : 'PASS' },
    exitCode,
  };
}
export function formatVerificationOutcome(outcome) {
  const human = outcome.humanAcceptance.bars
    .filter((bar) => bar.state !== 'GREEN')
    .map((bar) => `${bar.id}: ${bar.why}`)
    .join('; ');
  return [
    `Automation: ${outcome.automation.status}${outcome.automation.failures.length ? ' — ' + outcome.automation.failures.join(', ') : ''}`,
    `Human acceptance: ${outcome.humanAcceptance.status}${human ? ' — ' + human : ''}`,
    `Overall qualification: ${outcome.qualification.status} (exit ${outcome.exitCode})`,
  ].join('\n');
}
