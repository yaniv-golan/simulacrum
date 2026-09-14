import { mkdirSync, writeFileSync } from 'node:fs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { browserChecks } from './browser-registry.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { mergeChanges, mergeSelection } from './merge-selection.mjs';
import { withRequiredChecks } from './candidate-after.mjs';
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
  // A diagnosed retry's byte delta arrives through the attempt ledger, never as an argument.
  const scope = {
    ...options,
    ...(context.selection?.changedFiles ? { changedFiles: context.selection.changedFiles } : {}),
  };
  const changes = mergeChanges(scope);
  Object.assign(report, context.identity, {
    integration: changes,
    priority: options,
    retry: context.selection,
  });
  let selection;
  const results = await runVerificationPhases(
    [
      ['ci', () => runCI(context)],
      [
        'selection',
        () =>
          context.check('selection:merge', { refs: changes.refs, files: changes.files }, () => {
            if (JSON.stringify(mergeChanges(scope)) !== JSON.stringify(changes))
              throw Error('Integration scope changed during verification');
            const merged = mergeSelection({
              checks: browserChecks(),
              selection: affectedBrowserChecks(
                changes.files.filter((path) => !changes.metadataOnlyFiles?.includes(path)),
              ),
              files: changes.files,
              reviewOnlyFiles: changes.reviewOnlyFiles,
              metadataOnlyFiles: changes.metadataOnlyFiles,
            });
            const widened = withRequiredChecks(
              merged,
              context.selection?.required ?? [],
              browserChecks(),
            );
            // Widening only adds rows: the merge selection's selected/omitted split follows.
            const added = widened.checks.filter(
              (check) => !merged.checks.some((c) => c.id === check.id),
            );
            selection = {
              ...widened,
              ...(added.length
                ? {
                    selected: [
                      ...(merged.selected ?? []),
                      ...added.map((check) => ({
                        ...check,
                        reason: 'diagnosed retry: required re-execution',
                      })),
                    ],
                    omitted: (merged.omitted ?? []).filter(
                      (check) => !added.some((c) => c.id === check.id),
                    ),
                  }
                : {}),
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
          if (JSON.stringify(mergeChanges(scope)) !== JSON.stringify(changes))
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
