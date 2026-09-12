import { browserGraphEntrypoints, selectAffectedBrowserChecks } from './browser-selection.mjs';
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
    browserSelection: selectAffectedBrowserChecks({
      checks: manifest.browserChecks,
      scopes: manifest.browserLocalScopes ?? [],
      metadataScopes: manifest.browserReviewMetadataScopes ?? [],
      readSource: read ?? ((path) => readFileSync(path)),
      graph,
      files,
    }),
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
      const graph = buildModuleGraph(root, {
        purpose: 'test-selection',
        entrypoints: browserGraphEntrypoints(root),
      });
      const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8'));
      validateInvariantCoverage(manifest, { root });
      const documentation = inspectDocumentation(root);
      return {
        graph,
        value: composeChangeInspection({
          graph,
          files: normalized,
          manifest,
          documentation,
          read: (path) => readFileSync(resolve(root, path), 'utf8'),
        }),
      };
    },
  );
}

/** A compact view of the same analysis; never a narrower verification policy. */
export function summarizeChangeInspection({ analysis, value: report }) {
  const lines = [
    `Change inspection · ${analysis.contentIdentity}`,
    `Files: ${report.files.join(', ')}`,
    `Owners: ${report.owners.map((owner) => owner.path).join(', ') || 'none found'}`,
    `Invariants: ${report.invariants.map((row) => row.id).join(', ') || 'none associated'}`,
    `Tests: ${report.tests.selectedCount}/${report.tests.total} (${report.tests.causal.length} causal, ${report.tests.conservative.length} conservative)`,
  ];
  if (report.tests.fallback) lines.push(`Fallback: ${report.tests.fallback}`);
  for (const row of report.tests.causal) lines.push(`  ${row.test}`);
  lines.push('Browser checks (registered, not executed):');
  const associated = report.browserChecks.filter(
    (row) => row.dependencyPath || row.invariantIds.length,
  );
  lines.push(`  Associated: ${associated.map((row) => row.id).join(', ') || 'none'}`);
  lines.push(
    `  Also registered: ${
      report.browserChecks
        .filter((row) => !associated.includes(row))
        .map((row) => row.id)
        .join(', ') || 'none'
    }`,
  );
  lines.push(
    `Executable conservative browser selection: ${report.browserSelection.checks.length}/${report.browserChecks.length}. Use test:browser:affected -- --files <paths> --summary for reasons.`,
  );
  if (report.browserSelection.unknownInputs?.length)
    lines.push(`  Unknown browser inputs: ${report.browserSelection.unknownInputs.join(', ')}`);
  lines.push('Affected documentation:');
  for (const row of report.documentation.sections)
    lines.push(`  ${row.stale ? 'STALE' : 'current'} ${row.file}#${row.id}`);
  for (const error of [...report.parseErrors, ...report.documentation.errors]) {
    const text = typeof error === 'string' ? error : JSON.stringify(error);
    lines.push(`ERROR: ${text.slice(0, 220)}${text.length > 220 ? '… (full detail: --json)' : ''}`);
  }
  const paths = report.files.map((path) => "'" + path.replaceAll("'", "'\\''") + "'").join(' ');
  lines.push(`Run selected tests: npm run test:unit -- --files ${paths}`);
  lines.push(
    'Before closure: npm run docs:prepare and review pending explanations. Use verify:candidate -- local, merge --base <commit> for routine merge readiness, or final for release/milestone qualification.',
  );
  lines.push(
    'No checks executed. No inferred association does not prove independence. Add --json for every dependency and conservative selection reason.',
  );
  return lines.join('\n');
}
