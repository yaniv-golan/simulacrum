import { buildModuleGraph } from './module-graph.mjs';
import { queryNavigation } from './navigation.mjs';
const args = process.argv.slice(2);
const allSymbols = args.includes('--all-symbols');
const queries = args.filter((arg) => arg !== '--all-symbols');
if (
  queries.length !== 1 ||
  !queries[0].trim() ||
  queries[0].startsWith('-') ||
  args.filter((arg) => arg === '--all-symbols').length > 1
) {
  console.error('Usage: node scripts/navigate.mjs <path-or-symbol-substring> [--all-symbols]');
  process.exitCode = 1;
} else {
  const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
  const { matches, parseErrors } = queryNavigation(graph, queries[0], { allSymbols });
  console.log(
    JSON.stringify(
      {
        query: queries[0],
        allSymbols,
        graphErrors: graph.errors,
        parseErrors,
        note: 'Generated from current imports and declarations. Path queries show module owners by default; nested function searches include enclosing scope. Test reachability is navigation, not complete test selection; opaque inputs, graph and parse errors require conservative verification.',
        matches,
      },
      null,
      2,
    ),
  );
  if (!matches.length || parseErrors.length) process.exitCode = 1;
}
