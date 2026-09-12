/** Intervals may overlap or nest: never sum them to infer wall time. */
export function createTiming({ now = () => performance.now(), publish = () => {} } = {}) {
  const origin = now(),
    rows = [];
  return {
    snapshot: () => rows.map((r) => ({ ...r })),
    async measure(name, execute) {
      const start = now();
      const row = { name, startMs: start - origin, status: 'running' };
      const reportingErrors = [];
      const report = () => {
        try {
          publish();
        } catch (error) {
          reportingErrors.push(error);
        }
      };
      rows.push(row);
      report();
      let value,
        primary,
        failed = false;
      // Reporting must never prevent the operation, particularly resource cleanup.
      try {
        value = await execute();
        row.status = 'passed';
      } catch (error) {
        failed = true;
        primary = error;
        row.status = 'failed';
      }
      row.elapsedMs = now() - start;
      report();
      if (reportingErrors.length) {
        throw new AggregateError(
          failed ? [primary, ...reportingErrors] : reportingErrors,
          failed
            ? `${primary?.message ?? String(primary)} (timing evidence also failed)`
            : 'Timing evidence could not be written',
          failed ? { cause: primary } : undefined,
        );
      }
      if (failed) throw primary;
      return value;
    },
  };
}
