import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
export function selectAffectedBrowserChecks({
  checks,
  graph,
  files,
  scopes = [],
  metadataScopes = [],
  readSource = (path) => readFileSync(path),
  metadataEnvironmentSafe = !process.env.FEEDBACK_SOURCE,
}) {
  // Absence from a static graph is not evidence of isolation when a reachable
  // reader can load an unresolved input. Include served roots as well as verifiers.
  const queue = checks.flatMap((c) => [
    c.script,
    ...(c.environment === 'workshop'
      ? ['index.html']
      : c.environment === 'probe'
        ? ['test/browser/index.html']
        : []),
  ]);
  const seen = new Set();
  let unresolved = false,
    metadataAudited = metadataEnvironmentSafe;
  for (const path of queue) {
    if (seen.has(path)) continue;
    seen.add(path);
    const node = graph.nodes.get(path);
    if (!node) {
      unresolved = true;
      metadataAudited = false;
      continue;
    }
    if (node.opaqueInputs) {
      unresolved = true;
      let hash;
      try {
        hash = createHash('sha256').update(readSource(path)).digest('hex');
      } catch {
        metadataAudited = false;
      }
      if (
        !metadataScopes.some(
          (scope) =>
            scope.entrypoint === path &&
            scope.sourceSha256 === hash &&
            JSON.stringify([...scope.dependencies].sort()) ===
              JSON.stringify([...node.dependencies].sort()) &&
            JSON.stringify([...scope.externalImports].sort()) ===
              JSON.stringify(
                (node.imports ?? [])
                  .filter((x) => x.target === null)
                  .map((x) => x.specifier)
                  .sort(),
              ),
        )
      )
        metadataAudited = false;
    }
    queue.push(...node.dependencies);
  }
  const documentation = (files ?? []).filter(
    (p) =>
      (!unresolved ||
        (metadataAudited && /^docs\/development\/\.reviews\/[\w-]+\/[\w-]+\.json$/.test(p))) &&
      !graph.nodes.has(p) &&
      !p.startsWith('docs/internal/') &&
      (['AGENTS.md', 'README.md'].includes(p) ||
        /^docs\/[\w./-]+\.md$/.test(p) ||
        /^docs\/development\/\.reviews\/[\w-]+\/[\w-]+\.json$/.test(p)),
  );
  const runtimeFiles = (files ?? []).filter((p) => !documentation.includes(p));
  if (files?.length && !runtimeFiles.length && !graph.errors.length)
    return {
      files,
      documentation,
      fallback: null,
      scope: 'documentation',
      checks: [],
      reasons: [],
    };
  const changed = runtimeFiles;
  const unknownInputs = [...new Set(changed.filter((p) => !graph.nodes.has(p)))].sort();
  const fallback = graph.errors.length
    ? 'dependency graph errors'
    : !files?.length
      ? 'changed files unavailable'
      : unknownInputs.length
        ? 'unknown changed inputs'
        : null;
  // Local behavioral contracts are explicit, not proofs inferred from an import graph.
  // Frozen direct dependencies prevent a new integration edge silently retaining narrow coverage.
  if (!fallback) {
    const matched = changed.map((file) =>
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
        documentation,
        fallback: null,
        scope: 'local-contract',
        checks: checks.filter((c) => ids.has(c.id)),
        reasons: [...ids].map((id) => ({
          id,
          reason: 'manifest local behavioral contract',
          path: changed,
        })),
      };
    }
  }
  const targets = new Set(changed),
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
    if (reason)
      reasons.push({
        id: check.id,
        reason,
        path,
        ...(reason === 'unknown changed inputs' ? { inputs: unknownInputs } : {}),
      });
  }
  return {
    files,
    documentation,
    fallback,
    unknownInputs,
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
    metadataScopes: readManifest().browserReviewMetadataScopes ?? [],
    graph,
    files: normalizeSelectedFiles(files, root),
  });
  if (JSON.stringify(sourceIdentity()) !== JSON.stringify(source))
    throw Error('source changed during browser selection');
  return { source, ...selection };
}
