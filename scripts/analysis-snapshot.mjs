import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProjectFiles } from './module-graph.mjs';

// Reuse graph discovery instead of maintaining another source inventory. Private
// planning is neither report input nor public evidence; generated outputs are
// already excluded by graph discovery. Names and bytes bind additions/deletions.
export function analysisContentIdentity(root) {
  const hash = createHash('sha256');
  for (const path of listProjectFiles(root).filter((path) => !path.startsWith('docs/internal/'))) {
    const full = resolve(root, path);
    hash.update(JSON.stringify(path)).update('\0');
    hash.update(
      lstatSync(full).isSymbolicLink() ? `symlink:${readlinkSync(full)}` : readFileSync(full),
    );
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Check content identity before and after a synchronous or asynchronous analysis.
 * This is not an atomic filesystem snapshot: transient changes restored before
 * the second hash (ABA) are not detected.
 * Completeness refers to statically known dependencies, never runtime proof.
 * analyze returns {value, graph}; callers retain their existing result shape.
 */
export async function analyzeSnapshot(root, { format, options }, analyze) {
  const before = analysisContentIdentity(root);
  const { value, graph } = await analyze();
  const after = analysisContentIdentity(root);
  if (before !== after) throw Error('Source changed during analysis; rerun the command.');
  const privateInput = (text) => String(text).replaceAll('\\', '/').includes('docs/internal/');
  if (
    [...graph.nodes.keys()].some(privateInput) ||
    graph.errors.some(privateInput) ||
    (value.parseErrors ?? []).some(
      (error) => privateInput(error.path) || privateInput(error.message),
    )
  )
    throw Error(
      'Refusing incomplete analysis: excluded private input; remove its analysis dependency and rerun.',
    );
  const diagnostics = [
    ...graph.errors,
    ...(value.parseErrors ?? []).map(
      (error) =>
        `${error.path}${error.line == null ? '' : `:${error.line}:${error.column ?? 0}`}: ${error.message}`,
    ),
  ];
  if (diagnostics.length)
    throw Error(
      `Refusing incomplete analysis; repair these inputs and rerun:\n${diagnostics.join('\n')}`,
    );
  const opaqueInputs = [...graph.nodes.values()].filter((node) => node.opaqueInputs).length;
  return {
    value,
    analysis: {
      format,
      contentIdentity: before,
      identityScope: 'module-graph project files excluding docs/internal; names and content',
      options: structuredClone(options),
      completeness: {
        complete: opaqueInputs === 0 && !value.fallback,
        selectionFallback: value.fallback ?? null,
        graphErrors: 0,
        parseErrors: 0,
        opaqueInputs,
        basis: 'static dependency analysis; opaque inputs require conservative selection',
      },
    },
  };
}
