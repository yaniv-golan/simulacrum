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
export function browserScopeConsumers(graph, entrypoint) {
  const reached = new Set([entrypoint]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, node] of graph.nodes)
      if (!reached.has(path) && [...node.dependencies].some((p) => reached.has(p))) {
        reached.add(path);
        changed = true;
      }
  }
  reached.delete(entrypoint);
  return [...reached].sort();
}
export function browserConsumerSourceHash(graph, path, readSource, checks) {
  const reachable = new Set(
    checks?.flatMap((c) => [
      c.script,
      ...(c.environment === 'workshop'
        ? ['index.html']
        : c.environment === 'probe'
          ? ['test/browser/index.html']
          : []),
    ]),
  );
  for (const input of reachable)
    for (const dependency of graph.nodes.get(input)?.dependencies ?? []) reachable.add(dependency);
  const inputs = new Set(
    browserScopeConsumers(graph, path).filter((p) => !checks || reachable.has(p)),
  );
  for (const input of inputs)
    for (const dependency of graph.nodes.get(input)?.dependencies ?? []) inputs.add(dependency);
  const hash = createHash('sha256');
  for (const input of [...inputs].sort()) {
    let bytes = readSource(input);
    if (input === 'scripts/manifest.json') {
      // Digest values are self-referential provenance, not read-domain configuration.
      // Keep every other field, including purposes, exclusions and dependency lists.
      const manifest = JSON.parse(bytes);
      for (const audit of manifest.browserReviewMetadataScopes ?? []) {
        delete audit.sourceSha256;
        delete audit.consumerSourceHash;
      }
      bytes = JSON.stringify(manifest);
    }
    hash.update(input).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

export function browserScopeRoots(checks) {
  return createHash('sha256')
    .update(JSON.stringify(checks.map((c) => `${c.id}:${c.environment}:${c.script}`).sort()))
    .digest('hex');
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
    readKindsAudited = metadataEnvironmentSafe;
  for (const path of queue) {
    if (seen.has(path)) continue;
    seen.add(path);
    const node = graph.nodes.get(path);
    if (!node) {
      unresolved = true;
      readKindsAudited = false;
      readKindsAudited = false;
      continue;
    }
    if (node.opaqueInputs) {
      unresolved = true;
      let hash;
      try {
        hash = createHash('sha256').update(readSource(path)).digest('hex');
      } catch {
        readKindsAudited = false;
      }
      const audit = metadataScopes.find(
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
      );
      if (!audit) readKindsAudited = false;
      if (
        !audit?.reads ||
        JSON.stringify(audit.reads.map((r) => r.expression).sort()) !==
          JSON.stringify([...(node.opaqueReads ?? [])].sort()) ||
        !audit.reads.every(
          (r) =>
            ['identity', 'fixture', 'runtime', 'source-analysis'].includes(r.purpose) &&
            ['documentation', 'unit-test'].every((kind) => r.excludedInputs?.includes(kind)),
        ) ||
        JSON.stringify(audit.consumers) !== JSON.stringify(browserScopeConsumers(graph, path)) ||
        JSON.stringify(audit.roots) !== JSON.stringify(browserScopeRoots(checks)) ||
        audit.consumerSourceHash !== browserConsumerSourceHash(graph, path, readSource, checks)
      )
        readKindsAudited = false;
    }
    queue.push(...node.dependencies);
  }
  const documentation = (files ?? []).filter(
    (p) =>
      (!unresolved || readKindsAudited) &&
      !graph.nodes.has(p) &&
      !p.startsWith('docs/internal/') &&
      (['AGENTS.md', 'README.md'].includes(p) ||
        /^docs\/[\w./-]+\.md$/.test(p) ||
        /^docs\/development\/\.reviews\/[\w-]+\/[\w-]+\.json$/.test(p)),
  );
  const unitTests = (files ?? []).filter(
    (p) =>
      (!unresolved || readKindsAudited) &&
      /^test\/.+\.test\.(?:mjs|js|cjs)$/.test(p) &&
      graph.nodes.has(p) &&
      !seen.has(p),
  );
  const runtimeFiles = (files ?? []).filter(
    (p) => !documentation.includes(p) && !unitTests.includes(p),
  );
  if (files?.length && !runtimeFiles.length && !graph.errors.length)
    return {
      files,
      documentation,
      unitTests,
      fallback: null,
      scope: unitTests.length ? 'non-runtime' : 'documentation',
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
          (!file.startsWith('src/') ||
            (JSON.stringify(scope.consumers) ===
              JSON.stringify(browserScopeConsumers(graph, file)) &&
              JSON.stringify(scope.roots) === JSON.stringify(browserScopeRoots(checks)))) &&
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
        unitTests,
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
    unitTests,
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
