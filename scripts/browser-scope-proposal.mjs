import { createHash } from 'node:crypto';
import {
  classifyReads,
  declarationSkeleton,
  READ_PURPOSES,
  REQUIRED_EXCLUSIONS,
} from './read-classification.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { candidateIdentity, candidateSelection } from './candidate.mjs';
import { buildModuleGraph } from './module-graph.mjs';
import {
  browserGraphEntrypoints,
  browserScopeConsumers,
  browserScopeRoots,
  browserCheckClosures,
  legacyBrowserScopeRoots,
  browserConsumerSourceHash,
  selectAffectedBrowserChecks,
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
          !READ_PURPOSES.includes(r.purpose) ||
          !strings(r.excludedInputs) ||
          r.excludedInputs.some((k) => !REQUIRED_EXCLUSIONS.includes(k)),
      ))
  )
    throw Error('Invalid read classification');
  if (d.reads && new Set(d.reads.map((r) => r.expression)).size !== d.reads.length)
    throw Error('Duplicate read classification');
}
/** The candidate delta a waiver or partial run would skip: tracked changes against `base` plus
 * untracked files, enumerated the way source identity does. Absent when no base is named. */
export function scopeDelta(root, base) {
  if (!base) return null;
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  return { base: commit, files: candidateSelection(root, commit) };
}
export function inspectScopeInputs(root, { base = null } = {}) {
  const source = candidateIdentity(root);
  const manifestText = readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8');
  const graph = buildModuleGraph(root, {
    purpose: 'test-selection',
    entrypoints: browserGraphEntrypoints(root),
  });
  const delta = scopeDelta(root, base);
  if (!same(source, candidateIdentity(root)))
    throw Error('Source changed during scope preparation');
  return { source, manifestText, graph, read: (p) => readFileSync(resolve(root, p)), delta };
}
/** Enumeration only: checks the candidate delta would select that no witness of this proposal
 * executes. Never blocks a proposal and never changes what apply runs; the field is always
 * present so a report cannot be read as "nothing affected" by omission. */
export function affectedNotWitnessed({ delta, selectAffected, manifest, graph, read, changes }) {
  if (!delta) return { basis: null, checks: null };
  // An empty delta selects nothing; the tier's clean-source default of "all checks" is a
  // completion policy, not a statement about what a change affected.
  if (!delta.files.length) return { basis: delta, checks: [] };
  const witnessed = new Set(changes.flatMap((c) => c.witnesses ?? []));
  try {
    // Root-bound reads and an environment-independent audit keep the result a pure function
    // of the inputs, so the review digest binds it and apply's rebuild reproduces it.
    const selected = selectAffected({
      checks: manifest.browserChecks,
      graph,
      files: delta.files,
      scopes: manifest.browserLocalScopes ?? [],
      metadataScopes: manifest.browserReviewMetadataScopes ?? [],
      readSource: read,
      metadataEnvironmentSafe: true,
    }).checks.map((c) => c.id);
    return { basis: delta, checks: selected.filter((id) => !witnessed.has(id)).sort() };
  } catch (error) {
    return { basis: delta, checks: null, error: error.message };
  }
}
const witnessUnion = (before, proposed) =>
  [...new Set([...(before?.checks ?? []), ...proposed.checks])].sort();
/** Membership changes decide witnesses. A legacy digest recorded against the current inventory
 * was never narrower than reachability, so the recomputed set is its membership and only the
 * representation changes. Additions are reviewed explicitly; removals, unknown legacy membership,
 * new rows and every other field keep the witness union. */
function classifyScopeChange(row, legacyInventory) {
  const { before, proposed } = row;
  let changedFields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(proposed)])]
    .sort()
    .filter((f) => !same(before?.[f], proposed[f]));
  const membership = { reachingChecks: 0, roots: 0 };
  const other = changedFields.filter((f) => !(f in membership));
  const legacy = typeof before?.roots === 'string';
  let additive = false,
    reachingNotDeclared;
  if (before && legacy && before.roots === legacyInventory) {
    changedFields = [...other, 'roots-format'].sort();
    additive = true;
  } else if (before && !legacy && Array.isArray(before.reachingChecks)) {
    const previous = new Set(before.reachingChecks);
    const added = proposed.reachingChecks.filter((id) => !previous.has(id));
    additive = before.reachingChecks.every((id) => proposed.reachingChecks.includes(id));
    if (additive && added.length) {
      const undeclared = added.filter((id) => !proposed.checks.includes(id));
      if (undeclared.length) reachingNotDeclared = undeclared;
    }
  }
  const witnesses = additive && !other.length ? [] : witnessUnion(before, proposed);
  return {
    ...row,
    changedFields,
    witnesses,
    ...(reachingNotDeclared !== undefined ? { reachingNotDeclared } : {}),
  };
}
/** Pure proposal derivation; audit declarations are authored, graph facts and hashes are computed. */
export function deriveScopeProposal(
  { source, manifestText, graph, read, delta = null, selectAffected = selectAffectedBrowserChecks },
  declarations = [],
) {
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
    blocked = [...graph.errors],
    skeletons = [];
  const checks = before.browserChecks;
  const roots = checks.map((c) => `${c.id}:${c.environment}:${c.script}`).sort();
  const closures = browserCheckClosures(checks, graph),
    legacyInventory = legacyBrowserScopeRoots(checks);
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
      proposed.reachingChecks = browserScopeRoots(checks, graph, path, closures);
      delete proposed.roots;
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
        if (proposed.reads.some((r) => r.purpose === null)) {
          blocked.push(`${key}: unclassified reads require explicit declarations`);
          skeletons.push(
            declarationSkeleton(
              path,
              proposed.reads.filter((r) => r.purpose === null).map((r) => r.expression),
              { checks: proposed.checks ?? [] },
            ),
          );
        }
        // A classification selection would not trust is refused here, naming the read and the
        // field, instead of surfacing later as a widened selection inside the witness battery.
        const classified = classifyReads(proposed.reads.filter((r) => r.purpose !== null));
        if (!classified.ok) blocked.push(`${key}: ${classified.reasons.join('; ')}`);
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
    .map((r) => classifyScopeChange(r, legacyInventory));
  const proposedManifest = changes.length ? JSON.stringify(after, null, 2) + '\n' : manifestText;
  const skipped = affectedNotWitnessed({
    delta,
    selectAffected,
    manifest: after,
    graph,
    read,
    changes,
  });
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
    ...(skeletons.length ? { declarationSkeletons: skeletons } : {}),
    changes,
    affectedNotWitnessed: skipped,
    proposedManifest,
    expected,
  };
  return { ...proposal, digest: digest(canonical(proposal)) };
}
export function prepareScopeProposal(root, declarations = [], { base = null } = {}) {
  return deriveScopeProposal(inspectScopeInputs(root, { base }), declarations);
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
      !only(d, ['key', 'accept', 'rationale', 'undeclared', 'declare']) ||
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
  for (const change of proposal.changes) {
    const d = decisions.get(change.key),
      pending = change.reachingNotDeclared ?? null;
    const fields = ['undeclared', 'declare'].filter((f) => f in d);
    if (!pending) {
      if (fields.length)
        throw Error(`${change.key}: undeclared/declare apply only to added reaching checks`);
      continue;
    }
    if (fields.length !== 1)
      throw Error(
        `${change.key}: reaching checks not declared (${pending.join(', ')}); the review must carry exactly one of undeclared: "acknowledged" or declare: [ids]`,
      );
    if (fields[0] === 'undeclared' && d.undeclared !== 'acknowledged')
      throw Error(`${change.key}: undeclared must be the literal "acknowledged"`);
    if (fields[0] === 'declare' && change.kind !== 'local')
      throw Error(
        `${change.key}: metadata rows witness registered controls, not browser checks; acknowledge instead`,
      );
    if (
      fields[0] === 'declare' &&
      (!strings(d.declare) || !d.declare.length || d.declare.some((id) => !pending.includes(id)))
    )
      throw Error(`${change.key}: declare must list a non-empty subset of ${pending.join(', ')}`);
  }
  return proposal.changes;
}
/** Apply review declarations to the proposal: declared checks join the row, its witnesses and the
 * proposed manifest. The result is proposal-shaped so witness requests and application read it;
 * the original proposal digest is retained for identity. */
export function resolveScopeReview(proposal, review, inputs = null) {
  validateScopeReview(proposal, review);
  const manifest = JSON.parse(proposal.proposedManifest);
  const declared = new Map(
    review.decisions.filter((d) => Array.isArray(d.declare)).map((d) => [d.key, d.declare]),
  );
  const changes = proposal.changes.map((change) => {
    const ids = declared.get(change.key);
    if (!ids) return { ...change };
    const rows = manifest[scopeFields[change.kind]],
      row = rows.find((r) => r.entrypoint === change.entrypoint);
    row.checks = [...row.checks, ...ids.filter((id) => !row.checks.includes(id))];
    const proposed = { ...change.proposed, checks: [...row.checks] };
    const { reachingNotDeclared, ...rest } = change;
    const remaining = reachingNotDeclared.filter((id) => !ids.includes(id));
    return {
      ...rest,
      proposed,
      changedFields: [...new Set([...change.changedFields, 'checks'])].sort(),
      witnesses: witnessUnion(change.before, proposed),
      declared: ids,
      ...(remaining.length ? { reachingNotDeclared: remaining } : {}),
    };
  });
  if (declared.size && inputs) {
    // Declared checks are hashed manifest content; refresh the consumer closures that read it.
    const checks = manifest.browserChecks,
      overlay = (p) => (p === 'scripts/manifest.json' ? JSON.stringify(manifest) : inputs.read(p));
    for (const row of manifest.browserReviewMetadataScopes ?? [])
      row.consumerSourceHash = browserConsumerSourceHash(
        inputs.graph,
        row.entrypoint,
        overlay,
        checks,
      );
    for (const change of changes)
      if (change.kind === 'metadata') {
        const row = manifest.browserReviewMetadataScopes.find(
          (r) => r.entrypoint === change.entrypoint,
        );
        change.proposed = { ...change.proposed, consumerSourceHash: row.consumerSourceHash };
        if (!same(change.before?.consumerSourceHash, row.consumerSourceHash))
          change.changedFields = [
            ...new Set([...change.changedFields, 'consumerSourceHash']),
          ].sort();
      }
  }
  const proposedManifest = declared.size
    ? JSON.stringify(manifest, null, 2) + '\n'
    : proposal.proposedManifest;
  const expected = structuredClone(proposal.expected);
  expected.files['scripts/manifest.json'] = {
    ...expected.files['scripts/manifest.json'],
    sha256: digest(proposedManifest),
  };
  const witnessed = new Set(changes.flatMap((c) => c.witnesses ?? []));
  const skipped = proposal.affectedNotWitnessed;
  return {
    ...proposal,
    changes,
    ...(skipped?.checks
      ? {
          affectedNotWitnessed: {
            ...skipped,
            checks: skipped.checks.filter((id) => !witnessed.has(id)),
          },
        }
      : {}),
    proposedManifest,
    expected,
  };
}
export function summarizeScopeProposal(p) {
  return [
    `Proposal ${p.digest}: ${p.changes.length} scope(s), ${p.blocked.length} blocker(s).`,
    ...p.changes.map(
      (c) =>
        `${c.key}\n  changed: ${c.changedFields.join(', ')}\n  witnesses: ${c.witnesses.length ? c.witnesses.join(', ') : 'none required'}` +
        (c.reachingNotDeclared?.length
          ? `\n  reaching, not declared: ${c.reachingNotDeclared.join(', ')} (review with undeclared: "acknowledged" or declare: [ids])`
          : ''),
    ),
    ...p.blocked.map((b) => `BLOCKED ${b}`),
    `Affected but not witnessed (NOT_EXECUTED; enumeration only): ${
      p.affectedNotWitnessed?.checks
        ? p.affectedNotWitnessed.checks.join(', ') || 'none'
        : `not computed${p.affectedNotWitnessed?.error ? ` (${p.affectedNotWitnessed.error})` : ''}`
    }`,
    'Full old/proposed rows are in the proposal. Hash drift requires semantic review; old source cannot be reconstructed from a digest.',
  ].join('\n');
}
