import { readManifest } from './validate-manifest.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { buildModuleGraph, listProjectFiles } from './module-graph.mjs';
import { browserChecks } from './browser-registry.mjs';
import { normalizeSelectedFiles } from './test-selection.mjs';
export function browserGraphEntrypoints(root) {
  return listProjectFiles(root).filter(
    (p) =>
      /\.(?:mjs|cjs|js|d\.ts)$/.test(p) || p === 'index.html' || p === 'test/browser/index.html',
  );
}
/** URL-loaded application roots are dependencies too. Unresolved inputs never authorize omission. */
export function selectAffectedBrowserChecks({ checks, graph, files, scopes = [] }) {
  const fallback = graph.errors.length
    ? 'dependency graph errors'
    : !files?.length
      ? 'changed files unavailable'
      : files.some((p) => !graph.nodes.has(p))
        ? 'unknown changed inputs'
        : null;
  // Local behavioral contracts are explicit, not proofs inferred from an import graph.
  // Frozen direct dependencies prevent a new integration edge silently retaining narrow coverage.
  if (!fallback) {
    const matched = files.map((file) =>
      scopes.find((scope) => {
        const node = graph.nodes.get(file);
        return (
          scope.entrypoint === file &&
          JSON.stringify(
            (node.imports ?? [])
              .filter((i) => i.target === null)
              .map((i) => i.specifier)
              .sort(),
          ) === JSON.stringify([...(scope.externalImports ?? [])].sort()) &&
          !node.opaqueInputs &&
          JSON.stringify([...node.dependencies].sort()) ===
            JSON.stringify([...scope.dependencies].sort())
        );
      }),
    );
    if (matched.every(Boolean)) {
      const ids = new Set(matched.flatMap((scope) => scope.checks));
      if ([...ids].some((id) => !checks.some((c) => c.id === id)))
        throw Error('unknown local browser contract check');
      return {
        files,
        fallback: null,
        scope: 'local-contract',
        checks: checks.filter((c) => ids.has(c.id)),
        reasons: [...ids].map((id) => ({
          id,
          reason: 'manifest local behavioral contract',
          path: files,
        })),
      };
    }
  }
  const targets = new Set(files),
    reasons = [];
  for (const check of checks) {
    let reason = fallback,
      path = null;
    const roots = [
      check.script,
      ...(check.environment === 'workshop'
        ? ['index.html']
        : check.environment === 'probe'
          ? ['test/browser/index.html']
          : []),
    ];
    if (!reason && check.environment === 'self') reason = 'self-hosted runtime inputs';
    const queue = roots.map((p) => [p]),
      seen = new Set();
    for (const chain of queue) {
      if (reason) break;
      const p = chain.at(-1),
        node = graph.nodes.get(p);
      if (seen.has(p)) continue;
      seen.add(p);
      if (targets.has(p)) {
        reason = 'changed dependency';
        path = chain;
        break;
      }
      if (!node || node.opaqueInputs) {
        reason = node ? 'opaque runtime input' : 'unresolved runtime root';
        path = chain;
        break;
      }
      queue.push(...[...node.dependencies].sort().map((d) => [...chain, d]));
    }
    if (reason) reasons.push({ id: check.id, reason, path });
  }
  return {
    files,
    fallback,
    checks: checks.filter((c) => reasons.some((r) => r.id === c.id)),
    reasons,
  };
}
export function affectedBrowserChecks(files) {
  const root = process.cwd();
  const source = sourceIdentity();
  const graph = buildModuleGraph(root, {
    purpose: 'test-selection',
    entrypoints: browserGraphEntrypoints(root),
  });
  const selection = selectAffectedBrowserChecks({
    checks: browserChecks(),
    scopes: readManifest().browserLocalScopes ?? [],
    graph,
    files: normalizeSelectedFiles(files, root),
  });
  if (JSON.stringify(sourceIdentity()) !== JSON.stringify(source))
    throw Error('source changed during browser selection');
  return { source, ...selection };
}
