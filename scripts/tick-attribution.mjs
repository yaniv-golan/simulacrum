/** Diagnostic decomposition only: never changes budgets or establishes regression causality. */
export function summarizeTickAttribution(samples) {
  const fields = ['phaseMs', 'checkpointMs', 'frameMs', 'publicationMs', 'overheadMs'];
  const total = samples?.totalMs;
  if (
    !Array.isArray(total) ||
    !total.length ||
    ![total, ...fields.map((field) => samples[field])].every(
      (values) =>
        Array.isArray(values) &&
        values.length === total.length &&
        values.every((value) => Number.isFinite(value) && value >= 0),
    )
  )
    throw Error('Incomplete tick attribution samples');
  for (let i = 0; i < total.length; i++)
    if (Math.abs(total[i] - fields.reduce((sum, field) => sum + samples[field][i], 0)) > 1e-6)
      throw Error('Tick attribution does not reconcile');
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanMs = Object.fromEntries(fields.map((field) => [field, mean(samples[field])]));
  return {
    sampleTicks: total.length,
    meanTotalMs: mean(total),
    meanMs,
    largestMeasuredComponent: fields.reduce((a, b) => (meanMs[a] >= meanMs[b] ? a : b)),
    causalStatus: 'UNRESOLVED',
    interpretation:
      'Measured attribution, not proof of regression or suitable conditions. Compare a matched baseline before assigning cause. Final timing-envelope and history updates are outside this sample.',
  };
}
