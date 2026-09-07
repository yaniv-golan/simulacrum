import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createVerificationContext } from './verification-run.mjs';
import { runStructuralChecks } from './gate-structural.mjs';
import { buildModuleGraph } from './module-graph.mjs';
export async function runCI(context = createVerificationContext()) {
  return context.check('ci:budget', { limitMs: 180000 }, () =>
    context.withDeadline(180000, async () => {
      const start = performance.now();
      const structural = await runStructuralChecks(undefined, context);
      const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
      await context.unit(graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path)));
      if (structural.failed) throw Error(`${structural.failed} structural checks failed`);
      const elapsedMs = performance.now() - start;
      if (elapsedMs >= 180000) throw Error(`iteration-budget: ${elapsedMs}ms`);
      mkdirSync('artifacts', { recursive: true });
      writeFileSync(
        'artifacts/ci.json',
        JSON.stringify({ ...context.identity, elapsedMs }, null, 2) + '\n',
      );
      console.log(`every-commit checks passed in ${elapsedMs.toFixed(1)}ms`);
      return { elapsedMs };
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCI();
