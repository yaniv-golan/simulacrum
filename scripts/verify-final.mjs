import { runVerificationPhases, parseCompletionArgs } from './verification-tiers.mjs';
import { verificationOutcome, formatVerificationOutcome } from './verification-outcome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { runGate } from './gate.mjs';
const started = performance.now();
const report = {
  status: 'running',
  results: [],
  checks: [],
  outcome: verificationOutcome([], []),
};
const write = () => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verification-final.json', JSON.stringify(report, null, 2) + '\n');
};
write();
try {
  const options = parseCompletionArgs('final', process.argv.slice(2));
  report.priority = options;
  const context = createVerificationContext();
  Object.assign(report, context.identity);
  const results = await runVerificationPhases([
    ['ci', () => runCI(context)],
    ['browser', () => verifyBrowserSuite('all', { context, ...options })],
    ['gate', () => runGate(undefined, context)],
  ]);
  Object.assign(report, { results, checks: context.receipts() });
  report.outcome = verificationOutcome(results, report.checks);
} catch (error) {
  report.failure = error.message;
  report.results.push({ id: 'admission', ok: false, error: error.message });
  report.outcome = verificationOutcome(report.results, report.checks);
  console.error(error.stack ?? error);
} finally {
  report.elapsedMs = performance.now() - started;
  report.status = report.outcome.automation.status === 'PASS' ? 'passed' : 'failed';
  write();
}
console.log(
  `Final verification: ${report.checks.length} unique checks; human bars are evaluated separately by the gate.`,
);
console.log(formatVerificationOutcome(report.outcome));
process.exitCode = report.outcome.exitCode;
