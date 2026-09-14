import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  createVerificationContext,
  initializeVerificationEnvironment,
} from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { browserChecks } from './browser-registry.mjs';
import { withRequiredChecks, resolveRetrySelection } from './candidate-after.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import {
  runVerificationPhases,
  localOutcome,
  parseCompletionArgs,
  sleptSummary,
  launchAdmission,
  selectionReach,
  assertSelectionReach,
  LAUNCH_ADMISSION_ID,
} from './verification-tiers.mjs';
const started = performance.now();
const report = {
  attempt: process.env.SIMULACRUM_VERIFICATION_ATTEMPT ?? null,
  scope: 'local',
  status: 'running',
  results: [],
  checks: [],
  outcome: localOutcome([], []),
};
const write = () => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verification-local.json', JSON.stringify(report, null, 2) + '\n');
};
write();
try {
  initializeVerificationEnvironment();
  const options = parseCompletionArgs('local', process.argv.slice(2));
  report.priority = options;
  const base = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`],
    { encoding: 'utf8' },
  ).trim();
  const context = createVerificationContext();
  Object.assign(report, context.identity, { base, retry: context.selection });
  // One selection computation over the candidate's base diff: called once before the launch
  // admission to learn what the tier will reach, and again inside the selection phase as the
  // recorded selection (the phase refuses if the reach moved meanwhile). The tier's own policy
  // always applies; a diagnosed retry may only widen it (required checks) or skip checks the
  // parent already passed that its byte delta does not reach.
  const resolveSelection = () => {
    const files = [
      ...new Set(
        [
          ...execFileSync('git', ['diff', '--name-only', '-z', base, '--'], {
            encoding: 'utf8',
          }).split('\0'),
          ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
            encoding: 'utf8',
          }).split('\0'),
        ].filter(Boolean),
      ),
    ];
    const fresh = affectedBrowserChecks(files);
    const retry = context.selection;
    return retry?.changedFiles
      ? resolveRetrySelection({
          fresh,
          narrow: affectedBrowserChecks(retry.changedFiles),
          required: retry.required,
          covered: retry.covered,
          checks: browserChecks(),
        })
      : withRequiredChecks(fresh, retry?.required ?? [], browserChecks());
  };
  const reach = selectionReach(resolveSelection());
  report.reach = reach;
  let selection;
  const results = await runVerificationPhases(
    [
      [LAUNCH_ADMISSION_ID, () => launchAdmission({ reach })],
      ['ci', () => runCI(context)],
      [
        'selection',
        () =>
          context.check('selection:browser', { base, retry: context.selection }, () => {
            selection = resolveSelection();
            selection.reach = assertSelectionReach(selection, reach);
            report.selection = selection;
            console.log(
              `Browser selection: ${selection.checks.length} checks; ${selection.fallback ?? 'see recorded dependency reasons'}`,
            );
            return selection;
          }),
      ],
      [
        'browser',
        () =>
          selection.checks.length
            ? verifyBrowserSuite(
                selection.checks.map((c) => c.id),
                { context, selection, ...options },
              )
            : [],
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
} catch (error) {
  report.failure = error.message;
  report.results.push({ id: 'admission', ok: false, error: error.message });
  report.outcome = localOutcome(report.results, report.checks);
  console.error(error.stack ?? error);
} finally {
  report.elapsedMs = performance.now() - started;
  report.status = report.outcome.automation.status === 'PASS' ? 'passed' : 'failed';
  write();
}
console.log(
  `Local automation: ${report.outcome.automation.status} (${(report.elapsedMs / 1000).toFixed(1)}s). Qualification and human acceptance: NOT EVALUATED.${sleptSummary(report.checks)}`,
);
process.exitCode = report.outcome.exitCode;
