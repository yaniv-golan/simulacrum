import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  createVerificationContext,
  initializeVerificationEnvironment,
} from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { runVerificationPhases, localOutcome, parseCompletionArgs } from './verification-tiers.mjs';
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
  Object.assign(report, context.identity, { base });
  let selection;
  const results = await runVerificationPhases(
    [
      ['ci', () => runCI(context)],
      [
        'selection',
        () =>
          context.check('selection:browser', { base, changedFiles: options.changedFiles }, () => {
            const files = options.changedFiles ?? [
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
            selection = affectedBrowserChecks(files);
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
  `Local automation: ${report.outcome.automation.status} (${(report.elapsedMs / 1000).toFixed(1)}s). Qualification and human acceptance: NOT EVALUATED.`,
);
process.exitCode = report.outcome.exitCode;
