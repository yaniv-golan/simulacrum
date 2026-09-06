import { runProcess } from './run-check.mjs';
import { buildModuleGraph, affectedTests } from './module-graph.mjs';
const started = performance.now();
function remaining() {
  const milliseconds = 180_000 - (performance.now() - started);
  if (milliseconds <= 0) throw Error('iteration-budget: unit tests exhausted 180 seconds');
  return milliseconds;
}
const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
let changed;
try {
  const tracked = await runProcess('git', ['diff', '--name-only', 'HEAD', '-z'], {
    timeoutMs: Math.min(10_000, remaining()),
  });
  const untracked = await runProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    timeoutMs: Math.min(10_000, remaining()),
  });
  changed = [
    ...new Set([...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean)),
  ];
} catch {
  changed = undefined;
}
const selected = process.argv.includes('--all')
  ? affectedTests(graph, undefined)
  : affectedTests(graph, changed);
console.log(
  `unit tests: ${selected.length} selected from module graph${graph.errors.length ? ' (conservative full fallback)' : ''}`,
);
if (selected.length)
  try {
    await runProcess(process.execPath, ['--test', ...selected], {
      inheritOutput: true,
      timeoutMs: remaining(),
    });
  } catch (error) {
    console.error(error.summary ?? error.message);
    process.exitCode = 1;
  }
