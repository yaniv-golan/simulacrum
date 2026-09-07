import { buildModuleGraph } from './module-graph.mjs';
import { queryNavigation } from './navigation.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 || !args[0].trim() || args[0].startsWith('-')) {
  console.error('Usage: node scripts/navigate.mjs <path-or-symbol-substring>');
  process.exitCode = 1;
} else {
  const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
  const matches = queryNavigation(graph, args[0]);
  console.log(
    JSON.stringify(
      {
        query: args[0],
        graphErrors: graph.errors,
        note: 'Generated from current imports and declarations. Test reachability is navigation, not a complete test-selection decision; opaque inputs and graph errors require conservative verification.',
        matches,
      },
      null,
      2,
    ),
  );
  if (!matches.length) process.exitCode = 1;
}
