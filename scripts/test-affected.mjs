import { parseTestSelectionArgs, normalizeSelectedFiles } from './test-selection.mjs';
import { runProcess } from './run-check.mjs';
import { buildModuleGraph, explainAffectedTests } from './module-graph.mjs';
const options = parseTestSelectionArgs(process.argv.slice(2));
const started = performance.now();
function remaining() {
  const milliseconds = 180_000 - (performance.now() - started);
  if (milliseconds <= 0) throw Error('iteration-budget: unit tests exhausted 180 seconds');
  return milliseconds;
}
const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
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
      ...new Set([...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean)),
    ];
  } catch {
    changed = undefined;
  }
const selection = explainAffectedTests(
    graph,
    options.all ? undefined : options.files ? normalizeSelectedFiles(options.files) : changed,
  ),
  selected = selection.tests;
console.log(
  `unit tests: ${selected.length} selected from module graph${selection.fallback ? ` (${selection.fallback})` : ''}`,
);
if (options.explain) console.log(JSON.stringify(selection, null, 2));
if (!options.explain && selected.length)
  try {
    await runProcess(process.execPath, ['--test', ...selected], {
      inheritOutput: true,
      timeoutMs: remaining(),
    });
  } catch (error) {
    console.error(error.summary ?? error.message);
    process.exitCode = 1;
  }
