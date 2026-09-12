import { assertLocalServerAccess } from './runtime-preflight.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createVerificationContext } from './verification-run.mjs';
import { runStructuralChecks } from './gate-structural.mjs';
import { buildModuleGraph } from './module-graph.mjs';
export async function runCI(context = createVerificationContext()) {
  await context.check('environment:localhost', {}, assertLocalServerAccess);
  return context.check('ci:budget', { limitMs: 180000 }, () =>
    context.withDeadline(180000, async () => {
      const start = performance.now();
      const structural = await runStructuralChecks(undefined, context, { stopOnFailure: true });
      if (structural.failed) throw Error(`${structural.failed} structural checks failed`);
      const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
      await context.unit(graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path)));
      const elapsedMs = performance.now() - start;
      if (elapsedMs >= 180000) throw Error(`iteration-budget: ${elapsedMs}ms`);
      const resumed = context.receipts().filter((r) => r.resumed).length;
      const timingClaim = resumed
        ? 'resumed work only; not a fresh CI duration qualification'
        : 'fresh CI duration';
      mkdirSync('artifacts', { recursive: true });
      writeFileSync(
        'artifacts/ci.json',
        JSON.stringify({ ...context.identity, elapsedMs, resumed, timingClaim }, null, 2) + '\n',
      );
      console.log(
        `every-commit checks passed in ${elapsedMs.toFixed(1)}ms; ${timingClaim}; ${resumed} resumed leaves`,
      );
      return { elapsedMs, resumed, timingClaim };
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCI();
