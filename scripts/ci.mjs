import { runProcess } from './run-check.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const start = performance.now();
for (const args of [['scripts/gate-structural.mjs'], ['scripts/test-affected.mjs', '--all']]) {
  const remaining = 180_000 - (performance.now() - start);
  if (remaining <= 0) throw new Error('iteration-budget: exhausted before next check');
  await runProcess(process.execPath, args, { inheritOutput: true, timeoutMs: remaining });
}
const elapsedMs = performance.now() - start;
if (elapsedMs >= 180_000) throw new Error(`iteration-budget: ${elapsedMs}ms`);
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/ci.json',
  JSON.stringify({ runtime: process.version, elapsedMs }, null, 2) + '\n',
);
console.log(`every-commit checks passed in ${elapsedMs.toFixed(1)}ms`);
