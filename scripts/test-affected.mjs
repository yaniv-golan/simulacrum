import { assertRuntime } from './runtime-preflight.mjs';
import { analyzeSnapshot } from './analysis-snapshot.mjs';
import {
  parseTestSelectionArgs,
  normalizeSelectedFiles,
  summarizeTestSelection,
} from './test-selection.mjs';
import { runProcess } from './run-check.mjs';
import { buildModuleGraph, explainAffectedTests } from './module-graph.mjs';
assertRuntime();
const options = parseTestSelectionArgs(process.argv.slice(2));
const started = performance.now();
function remaining() {
  const milliseconds = 180_000 - (performance.now() - started);
  if (milliseconds <= 0) throw Error('iteration-budget: unit tests exhausted 180 seconds');
  return milliseconds;
}
const analyze = async () => {
  let changed;
  if (!options.all && !options.files)
    try {
      const tracked = await runProcess('git', ['diff', '--name-only', 'HEAD', '-z'], {
        timeoutMs: Math.min(10_000, remaining()),
      });
      const untracked = await runProcess(
        'git',
        ['ls-files', '--others', '--exclude-standard', '-z'],
        {
          timeoutMs: Math.min(10_000, remaining()),
        },
      );
      changed = [
        ...new Set(
          [...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean),
        ),
      ];
    } catch {
      changed = undefined;
    }
  const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
  return {
    graph,
    value: explainAffectedTests(
      graph,
      options.all ? undefined : options.files ? normalizeSelectedFiles(options.files) : changed,
    ),
  };
};
let selection, graph, analysis;
if (options.explain || options.summary) {
  const result = await analyzeSnapshot(
    process.cwd(),
    {
      format: 'test-selection-v1',
      options: {
        ...options,
        selectionMode: options.all ? 'all' : options.files ? 'explicit' : 'git-diff',
      },
    },
    async () => {
      const result = await analyze();
      graph = result.graph;
      return result;
    },
  );
  selection = { ...result.value, analysis: result.analysis };
  analysis = result.analysis;
} else {
  const result = await analyze();
  graph = result.graph;
  selection = result.value;
}
const selected = selection.tests;
if (options.summary)
  console.log(
    summarizeTestSelection(selection, {
      totalTests: graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path)).length,
      all: options.all,
    }) +
      `\nAnalysis ${analysis.format}; content ${analysis.contentIdentity}; static coverage ${analysis.completeness.complete ? 'complete' : 'conservative'}.\nOptions: ${JSON.stringify(analysis.options)}`,
  );
else
  console.log(
    `unit tests: ${selected.length} selected from module graph${selection.fallback ? ` (${selection.fallback})` : ''}`,
  );
if (options.explain) console.log(JSON.stringify(selection, null, 2));
if (!options.explain && !options.summary && selected.length)
  try {
    await runProcess(process.execPath, ['--test', ...selected], {
      inheritOutput: true,
      timeoutMs: remaining(),
    });
  } catch (error) {
    console.error(error.summary ?? error.message);
    process.exitCode = 1;
  }
