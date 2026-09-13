import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  deriveScopeProposal,
  validateScopeReview,
  resolveScopeReview,
  summarizeScopeProposal,
} from '../scripts/browser-scope-proposal.mjs';
import { scopeWitnessRequest } from '../scripts/browser-scope-witness-contract.mjs';
import {
  browserScopeRoots,
  legacyBrowserScopeRoots,
  browserScopeConsumers,
  browserConsumerSourceHash,
  selectAffectedBrowserChecks,
} from '../scripts/browser-selection.mjs';
import { validateManifest, readManifest } from '../scripts/validate-manifest.mjs';

const node = (dependencies = [], extra = {}) => ({
  dependencies: new Set(dependencies),
  imports: [],
  opaqueReads: [],
  opaqueInputs: false,
  ...extra,
});
/** Workshop check a reaches src/app.mjs and src/shared.mjs through index.html; probe check p reaches
 * src/probe.mjs through the probe page; self check s reaches only its own script; scripts/helper.mjs
 * is imported by the check scripts a and s directly. */
function graphFixture() {
  return {
    errors: [],
    nodes: new Map([
      ['index.html', node(['src/app.mjs'])],
      ['test/browser/index.html', node(['src/probe.mjs'])],
      ['src/app.mjs', node(['src/shared.mjs'])],
      ['src/shared.mjs', node()],
      ['src/probe.mjs', node(['src/shared.mjs'])],
      ['scripts/helper.mjs', node([], { opaqueReads: ['path'], opaqueInputs: true })],
      ['scripts/a.mjs', node(['scripts/helper.mjs'])],
      ['scripts/p.mjs', node()],
      ['scripts/s.mjs', node(['scripts/helper.mjs'])],
      ['scripts/w.mjs', node()],
    ]),
  };
}
const checks = () => [
  { id: 'a', script: 'scripts/a.mjs', environment: 'workshop' },
  { id: 'p', script: 'scripts/p.mjs', environment: 'probe' },
  { id: 's', script: 'scripts/s.mjs', environment: 'self' },
  { id: 'w', script: 'scripts/w.mjs', environment: 'workshop' },
];
function manifestFixture(graph, list = checks()) {
  const row = (entrypoint, extra) => ({
    entrypoint,
    dependencies: [...graph.nodes.get(entrypoint).dependencies].sort(),
    externalImports: [],
    consumers: browserScopeConsumers(graph, entrypoint),
    reachingChecks: browserScopeRoots(list, graph, entrypoint),
    ...extra,
  });
  const manifest = {
    browserChecks: list,
    checks: [{ id: 'controls' }],
    browserLocalScopes: [
      row('src/shared.mjs', { checks: ['a', 'w'] }),
      row('scripts/s.mjs', { checks: ['s'] }),
    ],
    browserReviewMetadataScopes: [
      row('scripts/helper.mjs', {
        checks: ['controls'],
        reads: [{ expression: 'path', purpose: 'identity', excludedInputs: ['documentation'] }],
        sourceSha256: '',
        consumerSourceHash: '',
      }),
    ],
  };
  const read = (p) => (p === 'scripts/manifest.json' ? JSON.stringify(manifest) : p);
  const metadata = manifest.browserReviewMetadataScopes[0];
  metadata.sourceSha256 = createHash('sha256').update('scripts/helper.mjs').digest('hex');
  metadata.consumerSourceHash = browserConsumerSourceHash(graph, 'scripts/helper.mjs', read, list);
  return manifest;
}
function input(manifest, graph) {
  return {
    manifestText: JSON.stringify(manifest),
    source: {
      head: 'head',
      index: 'index',
      files: { 'scripts/manifest.json': { sha256: 'before', mode: 420 } },
    },
    graph,
    read: (p) => (p === 'scripts/manifest.json' ? JSON.stringify(manifest) : p),
  };
}
const accept = (p, extra = {}) => ({
  proposalDigest: p.digest,
  decisions: p.changes.map((c) => ({
    key: c.key,
    accept: true,
    rationale: 'Inspected the reaching checks against the graph.',
    ...(extra[c.key] ?? {}),
  })),
});

test('reaching checks follow the full import closure of each check script and its served root, ignoring opacity', () => {
  const graph = graphFixture(),
    list = checks();
  assert.deepEqual(browserScopeRoots(list, graph, 'src/shared.mjs'), ['a', 'p', 'w']);
  assert.deepEqual(browserScopeRoots(list, graph, 'src/app.mjs'), ['a', 'w']);
  assert.deepEqual(browserScopeRoots(list, graph, 'src/probe.mjs'), ['p']);
  assert.deepEqual(browserScopeRoots(list, graph, 'scripts/s.mjs'), ['s']);
  // The opaque helper is reached through the opaque check scripts; opacity governs reads, not edges.
  assert.deepEqual(browserScopeRoots(list, graph, 'scripts/helper.mjs'), ['a', 's']);
  assert.deepEqual(browserScopeRoots(list, graph, 'scripts/unknown.mjs'), []);
  assert.match(legacyBrowserScopeRoots(list), /^[a-f0-9]{64}$/);
});

test('an unrelated added check keeps narrow selection; a reaching one restores broad coverage', () => {
  const graph = graphFixture(),
    list = checks();
  const scope = {
    entrypoint: 'src/shared.mjs',
    dependencies: [],
    externalImports: [],
    checks: ['a', 'w'],
    consumers: browserScopeConsumers(graph, 'src/shared.mjs'),
    reachingChecks: browserScopeRoots(list, graph, 'src/shared.mjs'),
  };
  const select = () =>
    selectAffectedBrowserChecks({
      checks: list,
      graph,
      files: ['src/shared.mjs'],
      scopes: [scope],
    });
  assert.equal(select().checks.length, 2);
  list.push({ id: 'd', script: 'scripts/d.mjs', environment: 'self' });
  graph.nodes.set('scripts/d.mjs', node());
  assert.equal(select().checks.length, 2, 'a self check that does not reach the entrypoint');
  list.push({ id: 'e', script: 'scripts/e.mjs', environment: 'workshop' });
  graph.nodes.set('scripts/e.mjs', node());
  assert.equal(select().checks.length, 6, 'a workshop check reaches through index.html');
});

test('additive reaching checks are reviewed without witnesses and name the undeclared checks', () => {
  const graph = graphFixture(),
    manifest = manifestFixture(graph);
  const current = deriveScopeProposal(input(manifest, graph));
  assert.deepEqual(current.changes, [], 'fixture rows are current');
  manifest.browserChecks.push({ id: 'e', script: 'scripts/e.mjs', environment: 'workshop' });
  graph.nodes.set('scripts/e.mjs', node());
  const p = deriveScopeProposal(input(manifest, graph));
  const shared = p.changes.find((c) => c.entrypoint === 'src/shared.mjs');
  assert.deepEqual(shared.changedFields, ['reachingChecks']);
  assert.deepEqual(shared.proposed.reachingChecks, ['a', 'e', 'p', 'w']);
  assert.deepEqual(shared.witnesses, []);
  assert.deepEqual(shared.reachingNotDeclared, ['e']);
  assert.ok(
    p.changes.every((c) => c.entrypoint !== 'scripts/s.mjs'),
    'self row unaffected',
  );
  assert.match(summarizeScopeProposal(p), /reaching, not declared: e/);
  assert.throws(() => validateScopeReview(p, accept(p)), /undeclared|declare/);
  const acknowledged = accept(p, { [shared.key]: { undeclared: 'acknowledged' } });
  validateScopeReview(p, acknowledged);
  assert.deepEqual(scopeWitnessRequest(resolveScopeReview(p, acknowledged)).scopes, []);
  assert.throws(
    () => validateScopeReview(p, accept(p, { [shared.key]: { declare: ['a'] } })),
    /declare/,
  );
  assert.throws(
    () =>
      validateScopeReview(
        p,
        accept(p, { [shared.key]: { undeclared: 'acknowledged', declare: ['e'] } }),
      ),
    /one of/,
  );
});

test('declaring a reaching check appends it and its witnesses run before it is trusted', () => {
  const graph = graphFixture(),
    manifest = manifestFixture(graph);
  manifest.browserChecks.push({ id: 'e', script: 'scripts/e.mjs', environment: 'workshop' });
  graph.nodes.set('scripts/e.mjs', node());
  const p = deriveScopeProposal(input(manifest, graph));
  const shared = p.changes.find((c) => c.entrypoint === 'src/shared.mjs');
  const resolved = resolveScopeReview(p, accept(p, { [shared.key]: { declare: ['e'] } }));
  const row = resolved.changes.find((c) => c.entrypoint === 'src/shared.mjs');
  assert.deepEqual(row.proposed.checks, ['a', 'w', 'e']);
  assert.deepEqual(row.witnesses, ['a', 'e', 'w']);
  assert.deepEqual(scopeWitnessRequest(resolved).scopes, [
    { kind: 'local', witnesses: ['a', 'e', 'w'] },
  ]);
  const written = JSON.parse(resolved.proposedManifest);
  assert.deepEqual(
    written.browserLocalScopes.find((r) => r.entrypoint === 'src/shared.mjs').checks,
    ['a', 'w', 'e'],
  );
  assert.notEqual(
    resolved.expected.files['scripts/manifest.json'].sha256,
    p.expected.files['scripts/manifest.json'].sha256,
  );
  assert.equal(resolved.digest, p.digest);
  // A row the review did not touch cannot acquire the field.
  assert.throws(
    () =>
      validateScopeReview(p, accept(p, { 'local:scripts/s.mjs': { undeclared: 'acknowledged' } })),
    /Missing or extra|declare|undeclared/,
  );
});

test('removed reaching checks and same-id script edits that stop importing a helper require witnesses', () => {
  const graph = graphFixture(),
    manifest = manifestFixture(graph);
  manifest.browserChecks.splice(1, 1); // remove probe check p
  let p = deriveScopeProposal(input(manifest, graph));
  const shared = p.changes.find((c) => c.entrypoint === 'src/shared.mjs');
  assert.deepEqual(shared.changedFields, ['reachingChecks']);
  assert.deepEqual(shared.proposed.reachingChecks, ['a', 'w']);
  assert.deepEqual(shared.witnesses, ['a', 'w']);
  assert.equal(shared.reachingNotDeclared, undefined);
  validateScopeReview(p, accept(p));
  // Same id, script edit: a stops importing the helper.
  const again = graphFixture(),
    m2 = manifestFixture(again);
  again.nodes.get('scripts/a.mjs').dependencies.clear();
  p = deriveScopeProposal(input(m2, again));
  const helper = p.changes.find((c) => c.entrypoint === 'scripts/helper.mjs');
  assert.ok(helper.changedFields.includes('reachingChecks'));
  assert.deepEqual(helper.proposed.reachingChecks, ['s']);
  assert.deepEqual(helper.witnesses, ['controls']);
});

test('migration is a format change with no membership change; a check added before migration is unknown', () => {
  const graph = graphFixture(),
    manifest = manifestFixture(graph);
  for (const row of [...manifest.browserLocalScopes, ...manifest.browserReviewMetadataScopes]) {
    delete row.reachingChecks;
    row.roots = legacyBrowserScopeRoots(manifest.browserChecks);
  }
  const read = (p) => (p === 'scripts/manifest.json' ? JSON.stringify(manifest) : p);
  manifest.browserReviewMetadataScopes[0].consumerSourceHash = browserConsumerSourceHash(
    graph,
    'scripts/helper.mjs',
    read,
    manifest.browserChecks,
  );
  const p = deriveScopeProposal(input(manifest, graph));
  assert.equal(p.changes.length, 3);
  for (const c of p.changes) {
    assert.deepEqual(c.changedFields, ['roots-format']);
    assert.deepEqual(c.witnesses, []);
    assert.equal(c.proposed.roots, undefined);
    assert.ok(Array.isArray(c.proposed.reachingChecks));
  }
  validateScopeReview(p, accept(p));
  assert.deepEqual(scopeWitnessRequest(resolveScopeReview(p, accept(p))).scopes, []);
  const migrated = JSON.parse(p.proposedManifest);
  assert.deepEqual(deriveScopeProposal(input(migrated, graph)).changes, []);
  // Ordering trap: adding a check before migrating makes every legacy digest unknown.
  manifest.browserChecks.push({ id: 'e', script: 'scripts/e.mjs', environment: 'workshop' });
  graph.nodes.set('scripts/e.mjs', node());
  const trapped = deriveScopeProposal(input(manifest, graph));
  for (const c of trapped.changes) {
    assert.ok(c.changedFields.includes('roots'));
    assert.ok(c.witnesses.length > 0);
  }
});

test('consumer hashes ignore reaching-check provenance in the manifest bytes', () => {
  const graph = graphFixture(),
    manifest = manifestFixture(graph);
  graph.nodes.get('scripts/helper.mjs').dependencies.add('scripts/manifest.json');
  graph.nodes.set('scripts/manifest.json', node());
  const read = (p) => (p === 'scripts/manifest.json' ? JSON.stringify(manifest) : p);
  const before = browserConsumerSourceHash(
    graph,
    'scripts/helper.mjs',
    read,
    manifest.browserChecks,
  );
  manifest.browserLocalScopes[0].reachingChecks = ['changed'];
  manifest.browserLocalScopes[1].roots = 'legacy';
  assert.equal(
    browserConsumerSourceHash(graph, 'scripts/helper.mjs', read, manifest.browserChecks),
    before,
  );
  manifest.browserLocalScopes[0].checks.push('other');
  assert.notEqual(
    browserConsumerSourceHash(graph, 'scripts/helper.mjs', read, manifest.browserChecks),
    before,
  );
});

test('manifest admits only sorted registered reaching check ids', () => {
  const real = readManifest();
  assert.ok(real.browserLocalScopes.every((s) => Array.isArray(s.reachingChecks)));
  assert.ok(real.browserReviewMetadataScopes.every((s) => Array.isArray(s.reachingChecks)));
  const wide = real.browserLocalScopes.findIndex((s) => s.reachingChecks.length > 1);
  assert.ok(wide >= 0, 'a src entrypoint is reached by several workshop checks');
  for (const mutate of [
    (m) => (m.browserLocalScopes[wide].reachingChecks = legacyBrowserScopeRoots(m.browserChecks)),
    (m) => m.browserLocalScopes[wide].reachingChecks.push('unregistered'),
    (m) => m.browserLocalScopes[wide].reachingChecks.reverse(),
    (m) =>
      m.browserLocalScopes[wide].reachingChecks.push(m.browserLocalScopes[wide].reachingChecks[0]),
    (m) => delete m.browserReviewMetadataScopes[0].reachingChecks,
    (m) => (m.browserReviewMetadataScopes[0].roots = legacyBrowserScopeRoots(m.browserChecks)),
  ]) {
    const m = structuredClone(real);
    mutate(m);
    assert.throws(() => validateManifest(m), /browser/);
  }
});
