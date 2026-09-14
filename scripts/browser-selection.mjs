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
      // Reaching-check membership is derived from the graph, never read at runtime.
      for (const row of [
        ...(manifest.browserLocalScopes ?? []),
        ...(manifest.browserReviewMetadataScopes ?? []),
      ]) {
        delete row.reachingChecks;
        delete row.roots;
      }
      bytes = JSON.stringify(manifest);
    }
    hash.update(input).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

/** Served application roots that a check environment loads besides its own script. */
export function browserCheckRoots(check) {
  return [
    check.script,
    ...(check.environment === 'workshop'
      ? ['index.html']
      : check.environment === 'probe'
        ? ['test/browser/index.html']
        : []),
  ];
}
/** Full import closure of each check's script and served root over the plain graph.
 * Opacity governs runtime reads, not import edges, so opaque nodes are traversed. */
export function browserCheckClosures(checks, graph) {
  const closures = new Map();
  for (const check of checks) {
    const reached = new Set(browserCheckRoots(check));
    for (const path of reached)
      for (const dependency of graph.nodes.get(path)?.dependencies ?? []) reached.add(dependency);
    closures.set(check.id, reached);
  }
  return closures;
}
/** Sorted ids of the checks whose root chain reaches the entrypoint. Self-hosted checks serve
 * their own pages and may load any application module at runtime, so every self check is
 * treated as reaching every entrypoint; the static graph cannot bound them. */
export function browserScopeRoots(
  checks,
  graph,
  entrypoint,
  closures = browserCheckClosures(checks, graph),
) {
  return checks
    .filter((c) => c.environment === 'self' || closures.get(c.id)?.has(entrypoint))
    .map((c) => c.id)
    .sort();
}
/** The former whole-inventory digest; retained only to classify legacy rows during migration. */
export function legacyBrowserScopeRoots(checks) {
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
  const queue = checks.flatMap(browserCheckRoots);
  const closures = browserCheckClosures(checks, graph);
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
        JSON.stringify(audit.reachingChecks) !==
          JSON.stringify(browserScopeRoots(checks, graph, path, closures)) ||
        audit.consumerSourceHash !== browserConsumerSourceHash(graph, path, readSource, checks)
      )
        readKindsAudited = false;
    }
    queue.push(...node.dependencies);
  }
  const documentation = (files ?? []).filter(
    (p) =>
      (!unresolved || readKindsAudited) &&
      // Unit-only readers belong to CI; only browser reachability makes this runtime data.
      !seen.has(p) &&
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
          JSON.stringify(scope.consumers) === JSON.stringify(browserScopeConsumers(graph, file)) &&
          JSON.stringify(scope.reachingChecks) ===
            JSON.stringify(browserScopeRoots(checks, graph, file, closures)) &&
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
    const roots = browserCheckRoots(check);
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
  return {
    source,
    ...selection,
    closureReached: closureReached(browserChecks(), graph, selection.files),
  };
}
/** Which timing-sensitive checks have a changed file inside their own import closure (their
 * script, the harness modules and fixtures it imports, opaque nodes traversed). The affected
 * walk stops at the first opaque hit and cannot say this; the closure can. */
export function closureReached(checks, graph, files) {
  const changed = new Set(files);
  const closures = browserCheckClosures(
    checks.filter((check) => check.timingSensitive === true),
    graph,
  );
  return Object.fromEntries(
    [...closures].map(([id, reached]) => [id, [...reached].some((path) => changed.has(path))]),
  );
}
/** What a timing-sensitive row measures, and the files that can move it. `physics` rows run
 * the engine in node with no browser; `render` rows measure the application in a browser. */
export const MEASURED_SCOPE = Object.freeze({
  physics: [
    /^src\/(?:simulation|model|scripting)\//,
    /^(?:package\.json|package-lock\.json)$/,
    /^vendor\//,
  ],
  render: [
    /^src\/(?:simulation|model|scripting|presentation|application|core)\//,
    /^(?:package\.json|package-lock\.json|index\.html|vite\.config\.mjs)$/,
    /^vendor\//,
  ],
});
export function measuredScopeReached(check, files, closureReached = {}) {
  const patterns = MEASURED_SCOPE[check.measures] ?? MEASURED_SCOPE.render;
  return (
    closureReached[check.id] === true ||
    (files ?? []).some((path) => patterns.some((pattern) => pattern.test(path)))
  );
}

/** Positive static associations affect order only; opaque/unknown input never narrows coverage. */
export function prioritizeBrowserChecks(checks, files, provenance = 'explicit integration paths') {
  const normalized = normalizeSelectedFiles(files ?? []);
  if (!normalized.length) return { checks, reasons: [], files: normalized, provenance };
  const graph = buildModuleGraph(process.cwd(), {
    purpose: 'test-selection',
    entrypoints: browserGraphEntrypoints(process.cwd()),
  });
  if (graph.errors.length) throw Error('Cannot prioritize checks: dependency graph errors');
  const targets = new Set(normalized),
    reasons = [];
  for (const check of checks) {
    const queue = [
      [check.script],
      ...(check.environment === 'workshop'
        ? [['index.html']]
        : check.environment === 'probe'
          ? [['test/browser/index.html']]
          : []),
    ];
    const seen = new Set();
    for (const chain of queue) {
      const path = chain.at(-1);
      if (seen.has(path)) continue;
      seen.add(path);
      if (targets.has(path)) {
        reasons.push({ id: check.id, path: chain, reason: 'static integration dependency' });
        break;
      }
      for (const dependency of graph.nodes.get(path)?.dependencies ?? [])
        queue.push([...chain, dependency]);
    }
  }
  const prioritized = new Set(reasons.map((row) => row.id));
  return {
    checks: [
      ...checks.filter((row) => prioritized.has(row.id)),
      ...checks.filter((row) => !prioritized.has(row.id)),
    ],
    reasons,
    files: normalized,
    provenance,
  };
}
