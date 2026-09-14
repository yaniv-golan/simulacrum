import { assertLocalServerAccess } from './runtime-preflight.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createVerificationContext } from './verification-run.mjs';
import { runStructuralChecks } from './gate-structural.mjs';
import { invariantTestFiles } from './check-invariant-controls.mjs';
import { buildModuleGraph } from './module-graph.mjs';
import { ciBudget, hostedReportFields } from './host-profile.mjs';
export async function runCI(context = createVerificationContext()) {
  await context.check('environment:localhost', {}, assertLocalServerAccess);
  const { deadlineMs, ...budget } = ciBudget(context.hostProfile ?? null);
  return context.check('ci:budget', budget, () =>
    context.withDeadline(deadlineMs, async () => {
      const start = performance.now();
      const structural = await runStructuralChecks(undefined, context, {
        stopOnFailure: true,
        includeUnitControls: false,
      });
      if (structural.failed) throw Error(`${structural.failed} structural checks failed`);
      const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
      await context.unit([
        ...new Set([
          ...invariantTestFiles(),
          ...graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path)),
        ]),
      ]);
      const elapsedMs = performance.now() - start;
      // Time the host was asleep counts against the budget only as a named cause, never as CI time.
      const hostSleptMs = context
        .receipts()
        .reduce((sum, r) => sum + (r.processDiagnostics?.hostSleptMs ?? r.hostSleptMs ?? 0), 0);
      if (elapsedMs >= deadlineMs)
        throw Error(
          hostSleptMs > 0
            ? `host slept ${Math.round(hostSleptMs / 1000)} s during CI: budget not evaluated (${elapsedMs}ms elapsed)`
            : `iteration-budget: ${elapsedMs}ms`,
        );
      const resumed = context.receipts().filter((r) => r.resumed).length;
      const hosted = hostedReportFields(context.hostProfile ?? null);
      const timingClaim = hosted.hostProfile
        ? `hosted profile ${hosted.hostProfile}${hosted.measurement ? ' (measurement, not evidence)' : ''}; not a local CI duration`
        : resumed
          ? 'resumed work only; not a fresh CI duration qualification'
          : 'fresh CI duration';
      mkdirSync('artifacts', { recursive: true });
      writeFileSync(
        'artifacts/ci.json',
        JSON.stringify(
          { ...context.identity, ...hosted, elapsedMs, resumed, timingClaim },
          null,
          2,
        ) + '\n',
      );
      console.log(
        `every-commit checks passed in ${elapsedMs.toFixed(1)}ms; ${timingClaim}; ${resumed} resumed leaves`,
      );
      return { elapsedMs, resumed, timingClaim };
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCI();
