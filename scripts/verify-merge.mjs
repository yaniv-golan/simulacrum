import { mkdirSync, writeFileSync } from 'node:fs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { browserChecks } from './browser-registry.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { mergeChanges, mergeSelection } from './merge-selection.mjs';
import {
  runVerificationPhases,
  localOutcome,
  parseCompletionArgs,
  sleptSummary,
  launchAdmission,
  LAUNCH_ADMISSION_ID,
} from './verification-tiers.mjs';
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
  const changes = mergeChanges(options);
  const context = createVerificationContext();
  Object.assign(report, context.identity, { integration: changes, priority: options });
  let selection;
  const results = await runVerificationPhases(
    [
      [LAUNCH_ADMISSION_ID, () => launchAdmission()],
      ['ci', () => runCI(context)],
      [
        'selection',
        () =>
          context.check('selection:merge', { refs: changes.refs, files: changes.files }, () => {
            if (JSON.stringify(mergeChanges(options)) !== JSON.stringify(changes))
              throw Error('Integration scope changed during verification');
            selection = {
              ...mergeSelection({
                checks: browserChecks(),
                selection: affectedBrowserChecks(
                  changes.files.filter((path) => !changes.metadataOnlyFiles?.includes(path)),
                ),
                files: changes.files,
                reviewOnlyFiles: changes.reviewOnlyFiles,
                metadataOnlyFiles: changes.metadataOnlyFiles,
              }),
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
  `Merge automation: ${report.outcome.automation.status} (${(report.elapsedMs / 1000).toFixed(1)}s). Qualification and human acceptance: NOT EVALUATED.${sleptSummary(report.checks)}`,
);
process.exitCode = report.outcome.exitCode;
