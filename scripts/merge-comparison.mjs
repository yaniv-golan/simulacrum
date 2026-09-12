/** Observation only: unmatched or unfinished evidence never implies coverage agreement. */
export function compareMergeCoverage({ full, source, scope, selection, checks }) {
  const unavailable = (reason) => ({ status: 'NOT_EVALUATED', reason, omittedFailures: [] });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!full || !source || !scope || !Array.isArray(selection))
    return unavailable('comparison identity unavailable');
  if (full.mode !== 'all' || !['passed', 'failed'].includes(full.status))
    return unavailable('full suite not terminal');
  if (!same(full.source, source)) return unavailable('full report source mismatch');
  const observed = full.selection?.mergeComparison;
  if (!observed || !same(observed.scope, scope) || !same(observed.selection, selection))
    return unavailable('scope or selection identity mismatch');
  const ids = checks.map((check) => check.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(selection).size !== selection.length ||
    selection.some((id) => !ids.includes(id))
  )
    return unavailable('invalid comparison registry or selection');
  if (
    !Array.isArray(full.runs) ||
    full.runs.length !== ids.length ||
    new Set(full.runs.map((row) => row.id)).size !== ids.length ||
    full.runs.some((row) => !ids.includes(row.id) || !['passed', 'failed'].includes(row.status))
  )
    return unavailable('full check outcomes incomplete or invalid');
  const omittedFailures = full.runs
    .filter((row) => !selection.includes(row.id) && row.status === 'failed')
    .map((row) => row.id);
  return {
    status: omittedFailures.length ? 'COVERAGE_GAP' : 'NO_OBSERVED_GAP',
    omittedFailures,
    limitation: 'One full run observes disagreement; it does not prove omission safety.',
  };
}
