import { verificationOutcome, formatVerificationOutcome } from './verification-outcome.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
import { runGate } from './gate.mjs';
if (process.argv.length > 2) throw Error('verify-final accepts no arguments');
const context = createVerificationContext(),
  started = performance.now(),
  results = [];
for (const [id, execute] of [
  ['ci', () => runCI(context)],
  ['browser', () => verifyBrowserSuite('all', { context })],
  ['gate', () => runGate(undefined, context)],
]) {
  try {
    const result = await execute();
    results.push({ id, ok: result?.ok !== false, result });
  } catch (error) {
    results.push({ id, ok: false, error: error.message });
    console.error(`${id}: ${error.stack}`);
  }
}
const report = {
  ...context.identity,
  elapsedMs: performance.now() - started,
  results,
  checks: context.receipts(),
};
report.outcome = verificationOutcome(results, report.checks);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/verification-final.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  `Final verification: ${report.checks.length} unique checks; human bars are evaluated separately by the gate.`,
);
console.log(formatVerificationOutcome(report.outcome));
process.exitCode = report.outcome.exitCode;
