import { mkdirSync, writeFileSync } from 'node:fs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { browserChecks } from './browser-registry.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { mergeChanges, mergeSelection } from './merge-selection.mjs';
import { withRequiredChecks, resolveRetrySelection } from './candidate-after.mjs';
import { runVerificationPhases, localOutcome, parseCompletionArgs } from './verification-tiers.mjs';
const started = performance.now();
const report = {
  attempt: process.env.SIMULACRUM_VERIFICATION_ATTEMPT ?? null,
  scope: 'MERGE_ONLY',
  status: 'running',
  results: [],
  checks: [],
  outcome: localOutcome([], []),
};
const write = () => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verification-merge.json', JSON.stringify(report, null, 2) + '\n');
};
write();
try {
  const options = parseCompletionArgs('merge', process.argv.slice(2));
  const context = createVerificationContext();
  // The integration scope is always the real git scope; a diagnosed retry's byte delta arrives
  // through the attempt ledger only and yields a second, narrower scope for coverage reasoning.
  const changes = mergeChanges(options);
  const retry = context.selection;
  const narrowScope = retry?.changedFiles ? { ...options, changedFiles: retry.changedFiles } : null;
  const narrowChanges = narrowScope ? mergeChanges(narrowScope) : null;
  Object.assign(report, context.identity, {
    integration: changes,
    priority: options,
    retry,
    ...(narrowChanges ? { retryIntegration: narrowChanges } : {}),
  });
  let selection;
  const results = await runVerificationPhases(
    [
      ['ci', () => runCI(context)],
      [
        'selection',
        () =>
          context.check('selection:merge', { refs: changes.refs, files: changes.files }, () => {
            if (JSON.stringify(mergeChanges(options)) !== JSON.stringify(changes))
              throw Error('Integration scope changed during verification');
            const registry = browserChecks();
            const select = (scope) =>
              mergeSelection({
                checks: registry,
                selection: affectedBrowserChecks(
                  scope.files.filter((path) => !scope.metadataOnlyFiles?.includes(path)),
                ),
                files: scope.files,
                reviewOnlyFiles: scope.reviewOnlyFiles,
                metadataOnlyFiles: scope.metadataOnlyFiles,
              });
            const merged = select(changes);
            const resolved = narrowChanges
              ? resolveRetrySelection({
                  fresh: merged,
                  narrow: select(narrowChanges),
                  required: retry.required,
                  covered: retry.covered,
                  checks: registry,
                })
              : withRequiredChecks(merged, retry?.required ?? [], registry);
            // The merge selection's selected/omitted split follows the resolved checks: rows the
            // fresh policy chose keep their reason, added rows name the retry, skipped rows say so.
            const chosen = new Set(resolved.checks.map((c) => c.id));
            const reasonOf = (id) =>
              merged.selected?.find((c) => c.id === id)?.reason ??
              'diagnosed retry: required re-execution';
            const skipped = new Set(resolved.skippedByDelta ?? []);
            selection =
              resolved === merged
                ? { ...merged, source: context.identity.source }
                : {
                    ...resolved,
                    selected: resolved.checks.map((check) => ({
                      ...check,
                      reason: reasonOf(check.id),
                    })),
                    omitted: registry
                      .filter((check) => !chosen.has(check.id))
                      .map((check) => ({
                        ...check,
                        reason: skipped.has(check.id)
                          ? 'covered by a parent attempt receipt the byte delta does not reach'
                          : (merged.omitted?.find((c) => c.id === check.id)?.reason ??
                            `outside audited ${merged.scope} selection and registered merge smoke`),
                        coverage: 'NOT_EXECUTED',
                      })),
                    source: context.identity.source,
                  };
            report.selection = selection;
            console.log(
              `Merge browser selection: ${selection.checks.length}; ${selection.fullReason ?? 'audited affected checks plus integration smoke'}`,
            );
            return selection;
          }),
      ],
      [
        'browser',
        () =>
          verifyBrowserSuite(
            selection.checks.map((c) => c.id),
            { context, selection, ...options },
          ),
      ],
      [
        'scope-stability',
        () => {
          if (JSON.stringify(mergeChanges(options)) !== JSON.stringify(changes))
            throw Error('Integration scope changed during verification');
          return { ok: true };
        },
      ],
    ],
    {
      onProgress: (rows) => {
        report.results = rows;
        report.checks = context.receipts();
        write();
      },
    },
  );
  Object.assign(report, { results, checks: context.receipts() });
  report.outcome = localOutcome(results, report.checks);
  if (results.some((r) => !r.ok)) {
    report.outcome.automation.status = 'FAIL';
    report.outcome.exitCode = 1;
  }
} catch (error) {
  report.failure = error.message;
  report.results.push({ id: 'admission', ok: false, error: error.message });
  report.outcome = localOutcome([], []);
  console.error(error.stack);
} finally {
  report.elapsedMs = performance.now() - started;
  report.status = report.outcome.automation.status === 'PASS' ? 'passed' : 'failed';
  write();
}
console.log(
  `Merge automation: ${report.outcome.automation.status} (${(report.elapsedMs / 1000).toFixed(1)}s). Qualification and human acceptance: NOT EVALUATED.`,
);
process.exitCode = report.outcome.exitCode;
