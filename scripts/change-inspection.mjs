import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildModuleGraph, explainAffectedTests } from './module-graph.mjs';
import { queryNavigation } from './navigation.mjs';
import { explainInvariant, validateInvariantCoverage } from './invariant-coverage.mjs';
import { inspectDocumentation } from './documentation.mjs';
import { analyzeSnapshot } from './analysis-snapshot.mjs';
import { parseTestSelectionArgs, normalizeSelectedFiles } from './test-selection.mjs';

export function parseChangeInspectionArgs(args) {
  const options = parseTestSelectionArgs(args);
  if (!options.files || options.all || options.explain || options.summary)
    throw Error('Usage: node scripts/inspect-change.mjs --files <project-path> [more-paths]');
  return options.files;
}

// Shortest known directed import/data path. Absence is not proof of independence.
function dependencyPath(graph, start, targets) {
  const queue = [[start]],
    seen = new Set();
  for (const path of queue) {
    const current = path.at(-1);
    if (seen.has(current)) continue;
    seen.add(current);
    if (targets.has(current)) return path;
    for (const dependency of [...(graph.nodes.get(current)?.dependencies ?? [])].sort())
      queue.push([...path, dependency]);
  }
  return null;
}

/** Compose existing authorities; this report executes no checks and grants no approval. */
export function composeChangeInspection({ graph, files, manifest, documentation, read }) {
  const targets = new Set(files);
  const navigation = files.map((file) => queryNavigation(graph, file, read ? { read } : {}));
  const owners = navigation.flatMap((result, i) =>
    result.matches.filter((row) => row.path === files[i]),
  );
  const parseErrors = [
    ...new Map(navigation.flatMap((x) => x.parseErrors).map((x) => [x.path, x])).values(),
  ];
  const invariants = manifest.invariants
    .filter((invariant) =>
      [...invariant.owners, ...Object.values(invariant.controls).flat()].some((pointer) =>
        dependencyPath(graph, pointer.path, targets),
      ),
    )
    .map((invariant) => explainInvariant(manifest, invariant.id));
  const selection = explainAffectedTests(graph, files);
  const browserChecks = manifest.browserChecks.map((check) => ({
    id: check.id,
    script: check.script,
    status: 'REGISTERED_NOT_EXECUTED',
    dependencyPath: dependencyPath(graph, check.script, targets),
    invariantIds: invariants
      .filter((invariant) => invariant.checks.includes(check.id))
      .map((x) => x.id),
  }));
  const sections = documentation.sections.flatMap((section) => {
    const matchingDependencies = Object.keys({
      ...section.reviewDependencies,
      ...section.dependencies,
    }).filter((path) => targets.has(path.split('#')[0]));
    return targets.has(section.file) || matchingDependencies.length
      ? [
          {
            file: section.file,
            id: section.id,
            stale: section.stale,
            matchingDependencies,
            scopeNotes: section.scopeNotes ?? [],
          },
        ]
      : [];
  });
  return {
    executed: false,
    fallback: selection.fallback,
    files,
    owners,
    invariants,
    parseErrors,
    tests: {
      total: graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path)).length,
      selectedCount: selection.tests.length,
      fallback: selection.fallback,
      causal: selection.reasons.filter((x) => x.reason === 'changed dependency'),
      conservative: selection.reasons.filter((x) => x.reason !== 'changed dependency'),
    },
    browserChecks,
    documentation: { sections, errors: documentation.errors },
    limitations: [
      'Registered checks are not execution evidence. This command runs no tests or browser checks.',
      'Relevance follows known graph paths and manifest pointers; no match does not prove independence or exhaustive coverage.',
      'Documentation impacts use existing section dependency records; stale or missing reviews remain unresolved.',
    ],
  };
}

export async function inspectChange(root = process.cwd(), { files } = {}) {
  if (!files?.length) throw Error('At least one changed project path is required.');
  const normalized = [...new Set(normalizeSelectedFiles(files, root))].sort();
  if (normalized.some((path) => path.startsWith('docs/internal/')))
    throw Error('Private planning is outside change inspection scope.');
  return analyzeSnapshot(
    root,
    { format: 'change-inspection/v1', options: { files: normalized } },
    () => {
      const graph = buildModuleGraph(root, { purpose: 'test-selection' });
      const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8'));
      validateInvariantCoverage(manifest, { root });
      const documentation = inspectDocumentation(root);
      return {
        graph,
        value: composeChangeInspection({ graph, files: normalized, manifest, documentation }),
      };
    },
  );
}
