import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { candidateIdentity } from './candidate.mjs';
import { buildModuleGraph } from './module-graph.mjs';
import {
  browserGraphEntrypoints,
  browserScopeConsumers,
  browserScopeRoots,
  browserConsumerSourceHash,
} from './browser-selection.mjs';

export const scopeFields = { local: 'browserLocalScopes', metadata: 'browserReviewMetadataScopes' };
export const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const same = (a, b) => canonical(a) === canonical(b);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => record(v) && Object.keys(v).every((k) => keys.includes(k));
const pathOK = (v) =>
  typeof v === 'string' &&
  /^(?:src|scripts)\/[\w./-]+\.mjs$/.test(v) &&
  !v.split('/').some((p) => ['.', '..', ''].includes(p));
const strings = (v) =>
  Array.isArray(v) &&
  v.every((x) => typeof x === 'string' && x.length) &&
  new Set(v).size === v.length;
const keyOf = (kind, path) => `${kind}:${path}`;
function validateDeclaration(d) {
  if (
    !only(d, ['kind', 'entrypoint', 'reads', 'checks']) ||
    !['local', 'metadata'].includes(d.kind) ||
    !pathOK(d.entrypoint) ||
    (d.checks !== undefined && (!strings(d.checks) || !d.checks.length)) ||
    (d.kind === 'local' && d.reads !== undefined)
  )
    throw Error(
      'Invalid scope declaration; supply kind, entrypoint and authored reads/checks only',
    );
  if (
    d.reads !== undefined &&
    (!Array.isArray(d.reads) ||
      d.reads.some(
        (r) =>
          !only(r, ['expression', 'purpose', 'excludedInputs']) ||
          typeof r.expression !== 'string' ||
          !r.expression ||
          !['identity', 'fixture', 'runtime', 'source-analysis'].includes(r.purpose) ||
          !strings(r.excludedInputs) ||
          r.excludedInputs.some((k) => !['documentation', 'unit-test'].includes(k)),
      ))
  )
    throw Error('Invalid read classification');
  if (d.reads && new Set(d.reads.map((r) => r.expression)).size !== d.reads.length)
    throw Error('Duplicate read classification');
}
export function inspectScopeInputs(root) {
  const source = candidateIdentity(root);
  const manifestText = readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8');
  const graph = buildModuleGraph(root, {
    purpose: 'test-selection',
    entrypoints: browserGraphEntrypoints(root),
  });
  if (!same(source, candidateIdentity(root)))
    throw Error('Source changed during scope preparation');
  return { source, manifestText, graph, read: (p) => readFileSync(resolve(root, p)) };
}
/** Pure proposal derivation; audit declarations are authored, graph facts and hashes are computed. */
export function deriveScopeProposal({ source, manifestText, graph, read }, declarations = []) {
  if (!Array.isArray(declarations)) throw Error('Declarations must be an array');
  const declared = new Map();
  for (const d of declarations) {
    validateDeclaration(d);
    const key = keyOf(d.kind, d.entrypoint);
    if (declared.has(key)) throw Error(`Duplicate declaration: ${key}`);
    declared.set(key, d);
  }
  const before = JSON.parse(manifestText),
    after = structuredClone(before),
    blocked = [...graph.errors];
  const checks = before.browserChecks;
  const roots = checks.map((c) => `${c.id}:${c.environment}:${c.script}`).sort();
  const reachable = new Set(
    checks.flatMap((c) => [
      c.script,
      ...(c.environment === 'workshop'
        ? ['index.html']
        : c.environment === 'probe'
          ? ['test/browser/index.html']
          : []),
    ]),
  );
  for (const path of reachable)
    for (const dependency of graph.nodes.get(path)?.dependencies ?? []) reachable.add(dependency);
  const newMetadata = [...reachable].filter(
    (p) =>
      graph.nodes.get(p)?.opaqueInputs &&
      !before.browserReviewMetadataScopes.some((s) => s.entrypoint === p),
  );
  const rows = [];
  for (const [kind, field] of Object.entries(scopeFields)) {
    const known = new Set(after[field].map((r) => r.entrypoint));
    for (const path of [
      ...(kind === 'metadata' ? newMetadata : []),
      ...declarations.filter((d) => d.kind === kind).map((d) => d.entrypoint),
    ].sort()) {
      if (!known.has(path)) {
        after[field].push({ entrypoint: path, checks: [] });
        known.add(path);
      }
    }
    for (const proposed of after[field]) {
      const path = proposed.entrypoint,
        key = keyOf(kind, path),
        d = declared.get(key),
        node = graph.nodes.get(path);
      const old = before[field].find((s) => s.entrypoint === path) ?? null;
      if (!node) {
        blocked.push(`${key}: missing graph owner`);
        continue;
      }
      if (d?.checks) proposed.checks = d.checks;
      const registry = kind === 'local' ? checks : before.checks;
      if (
        !strings(proposed.checks) ||
        proposed.checks.length < (kind === 'local' && path.startsWith('src/') ? 2 : 1) ||
        proposed.checks.some((id) => !registry.some((c) => c.id === id))
      )
        blocked.push(`${key}: declare registered witness checks`);
      if (
        kind === 'local' &&
        !path.startsWith('src/') &&
        !checks.some((c) => c.script === path && proposed.checks.includes(c.id))
      )
        blocked.push(`${key}: local verifier scope must retain its own browser check`);
      proposed.dependencies = [...node.dependencies].sort();
      proposed.externalImports = node.imports
        .filter((i) => i.target === null)
        .map((i) => i.specifier)
        .sort();
      proposed.consumers = browserScopeConsumers(graph, path);
      proposed.roots = browserScopeRoots(checks);
      if (kind === 'local') {
        if (node.opaqueInputs)
          blocked.push(`${key}: opaque local owner cannot admit narrow coverage`);
      } else {
        const discovered = [...(node.opaqueReads ?? [])].sort();
        const authored = d?.reads ?? old?.reads ?? [];
        const remaining = [...discovered],
          expressions = [];
        for (const row of old?.reads ?? []) {
          const i = remaining.indexOf(row.expression);
          if (i >= 0) {
            expressions.push(row.expression);
            remaining.splice(i, 1);
          }
        }
        expressions.push(...remaining);
        const available = [...authored];
        proposed.reads = expressions.map((expression) => {
          const index = available.findIndex((r) => r.expression === expression);
          if (index >= 0) return d?.reads ? available[index] : available.splice(index, 1)[0];
          return { expression, purpose: null, excludedInputs: [] };
        });
        if (proposed.reads.some((r) => r.purpose === null))
          blocked.push(`${key}: unclassified reads require explicit declarations`);
        if (d?.reads?.some((r) => !expressions.includes(r.expression)))
          blocked.push(`${key}: declaration names an absent read`);
        proposed.sourceSha256 = digest(read(path));
      }
      rows.push({ key, kind, entrypoint: path, before: old, proposed });
    }
  }
  // Compute consumer hashes only after all semantic rows have been assembled.
  const overlay = (p) => (p === 'scripts/manifest.json' ? JSON.stringify(after) : read(p));
  for (const row of rows.filter((r) => r.kind === 'metadata'))
    row.proposed.consumerSourceHash = browserConsumerSourceHash(
      graph,
      row.entrypoint,
      overlay,
      checks,
    );
  const changes = rows
    .filter((r) => !same(r.before, r.proposed))
    .map((r) => ({
      ...r,
      changedFields: [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.proposed)])]
        .sort()
        .filter((f) => !same(r.before?.[f], r.proposed[f])),
      witnesses: [...new Set([...(r.before?.checks ?? []), ...r.proposed.checks])].sort(),
    }));
  const proposedManifest = changes.length ? JSON.stringify(after, null, 2) + '\n' : manifestText;
  const expected = structuredClone(source);
  expected.files['scripts/manifest.json'] = {
    ...expected.files['scripts/manifest.json'],
    sha256: digest(proposedManifest),
  };
  const proposal = {
    format: 'browser-scope-proposal/v1',
    source,
    manifestSha256: digest(manifestText),
    declarations,
    roots: { current: roots, note: 'Recorded root digests do not preserve historical membership.' },
    blocked: [...new Set(blocked)].sort(),
    changes,
    proposedManifest,
    expected,
  };
  return { ...proposal, digest: digest(canonical(proposal)) };
}
export function prepareScopeProposal(root, declarations = []) {
  return deriveScopeProposal(inspectScopeInputs(root), declarations);
}
export function validateScopeReview(proposal, review) {
  const { digest: id, ...contents } = proposal;
  if (proposal.format !== 'browser-scope-proposal/v1' || digest(canonical(contents)) !== id)
    throw Error('Invalid or modified proposal');
  if (proposal.blocked.length)
    throw Error(`Scope proposal blocked: ${proposal.blocked.join('; ')}`);
  if (
    !only(review, ['proposalDigest', 'decisions']) ||
    review.proposalDigest !== id ||
    !Array.isArray(review.decisions)
  )
    throw Error('Review must name this proposal digest and separate decisions');
  const decisions = new Map();
  for (const d of review.decisions) {
    if (
      !only(d, ['key', 'accept', 'rationale']) ||
      d.accept !== true ||
      typeof d.rationale !== 'string' ||
      !d.rationale.trim() ||
      decisions.has(d.key)
    )
      throw Error('Each scope needs a distinct explicit acceptance and technical rationale');
    decisions.set(d.key, d);
  }
  if (!same([...decisions.keys()].sort(), proposal.changes.map((c) => c.key).sort()))
    throw Error('Missing or extra scope review decisions');
  return proposal.changes;
}
export function summarizeScopeProposal(p) {
  return [
    `Proposal ${p.digest}: ${p.changes.length} scope(s), ${p.blocked.length} blocker(s).`,
    ...p.changes.map(
      (c) =>
        `${c.key}\n  changed: ${c.changedFields.join(', ')}\n  witnesses: ${c.witnesses.join(', ')}`,
    ),
    ...p.blocked.map((b) => `BLOCKED ${b}`),
    'Full old/proposed rows are in the proposal. Hash drift requires semantic review; old source cannot be reconstructed from a digest.',
  ].join('\n');
}
