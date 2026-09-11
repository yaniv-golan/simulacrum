import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateInvariantCoverage } from './invariant-coverage.mjs';
import { runProcess } from './run-check.mjs';
export function invariantTestFiles(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8'));
  validateInvariantCoverage(manifest, { root });
  return [
    ...new Set(
      manifest.invariants.flatMap((x) =>
        [...x.controls.positive, ...x.controls.negative].map((p) => p.path),
      ),
    ),
  ].sort();
}
export async function checkInvariantControls(
  root = process.cwd(),
  { metadataOnly = false, executeTests } = {},
) {
  const tests = invariantTestFiles(root);
  if (metadataOnly) return { tests };
  if (executeTests) return executeTests(tests);
  return runProcess(process.execPath, ['--test', ...tests], { cwd: root, timeoutMs: 30000 });
}
