import { relative, resolve } from 'node:path';
export function parseTestSelectionArgs(args) {
  const result = { all: false, files: undefined, explain: false, summary: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw Error(`duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--all') result.all = true;
    else if (arg === '--explain') result.explain = true;
    else if (arg === '--summary') result.summary = true;
    else if (arg === '--files') {
      result.files = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('-')) result.files.push(args[++i]);
      if (!result.files.length) throw Error('--files needs at least one path');
    } else throw Error(`unknown test-selection argument: ${arg}`);
  }
  if (result.all && result.files) throw Error('--all and --files conflict');
  if (result.summary && result.explain) throw Error('--summary and --explain conflict');
  return result;
}
export function normalizeSelectedFiles(files, root = process.cwd()) {
  return files?.map((path) => {
    const local = relative(root, resolve(root, path)).split('\\').join('/');
    if (!local || local === '..' || local.startsWith('../'))
      throw Error(`file selection must stay inside project: ${path}`);
    return local;
  });
}

/** Presentation only: consume the selector's recorded shortest paths without changing selection. */
export function summarizeTestSelection(
  selection,
  { totalTests = selection.tests.length, all = false } = {},
) {
  const lines = [
    `DRY RUN — no tests executed. ${selection.tests.length}/${totalTests} tests selected.`,
  ];
  if (selection.fallback) {
    lines.push(
      `All-suite fallback: ${selection.tests.length}`,
      `  ${all ? 'All tests explicitly requested (--all).' : selection.fallback}`,
    );
    lines.push('  No narrower causal path is asserted. Use --explain for the full selection JSON.');
    return lines.join('\n');
  }
  for (const [label, reason] of [
    ['Causal dependency', 'changed dependency'],
    ['Conservative opaque input', 'opaque runtime input'],
  ]) {
    const rows = selection.reasons.filter((row) => row.reason === reason);
    lines.push(`${label}: ${rows.length}`);
    for (const row of rows.slice(0, 5)) {
      const path = row.edges.length
        ? row.edges.reduce((text, edge) => `${text} --${edge.kind}--> ${edge.to}`, row.path[0])
        : row.path[0];
      lines.push(`  ${path}`);
    }
    if (rows.length > 5) lines.push(`  … ${rows.length - 5} more; use --explain for every path.`);
  }
  const other = selection.reasons.filter(
    (row) => !['changed dependency', 'opaque runtime input'].includes(row.reason),
  );
  if (other.length) {
    lines.push(`Other conservative reasons: ${other.length}`);
    for (const row of other.slice(0, 5)) lines.push(`  ${row.test}: ${row.reason}`);
  }
  lines.push(
    'Paths are the selector’s shortest known reasons; opaque inputs are not proof of a causal dependency.',
  );
  return lines.join('\n');
}
