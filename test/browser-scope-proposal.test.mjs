import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveScopeProposal,
  digest,
  canonical,
  validateScopeReview,
} from '../scripts/browser-scope-proposal.mjs';
import {
  selectAffectedBrowserChecks,
  browserScopeConsumers,
  browserScopeRoots,
} from '../scripts/browser-selection.mjs';
function fixture() {
  const manifest = {
    browserChecks: [
      { id: 'a', script: 'scripts/a.mjs', environment: 'self' },
      { id: 'b', script: 'scripts/b.mjs', environment: 'self' },
    ],
    checks: [{ id: 'controls' }, { id: 'extra' }],
    browserLocalScopes: [
      { entrypoint: 'scripts/a.mjs', dependencies: ['scripts/read.mjs'], checks: ['a'] },
    ],
    browserReviewMetadataScopes: [
      {
        entrypoint: 'scripts/read.mjs',
        checks: ['controls'],
        reads: [{ expression: 'path', purpose: 'identity', excludedInputs: ['documentation'] }],
      },
    ],
  };
  const node = (dependencies = [], opaqueReads = []) => ({
    dependencies: new Set(dependencies),
    imports: [],
    opaqueReads,
    opaqueInputs: !!opaqueReads.length,
  });
  const graph = {
    errors: [],
    nodes: new Map([
      ['scripts/a.mjs', node(['scripts/read.mjs'])],
      ['scripts/b.mjs', node()],
      ['scripts/read.mjs', node([], ['path'])],
    ]),
  };
  const input = {
    manifestText: JSON.stringify(manifest),
    source: {
      head: 'head',
      index: 'index',
      files: { 'scripts/manifest.json': { sha256: 'before', mode: 420 } },
    },
    graph,
    read: (p) => p,
  };
  return { input, manifest, graph, node };
}
const review = (p) => ({
  proposalDigest: p.digest,
  decisions: p.changes.map((c) => ({
    key: c.key,
    accept: true,
    rationale: 'Read boundary examined for this fixture.',
  })),
});
test('preparation binds deterministic graph facts and exposes old/new semantics without modifying inputs', () => {
  const { input } = fixture(),
    before = canonical(input.source);
  const p = deriveScopeProposal(input);
  assert.equal(p.blocked.length, 0);
  assert.deepEqual(p, deriveScopeProposal(input));
  assert.equal(canonical(input.source), before);
  assert.equal(p.expected.files['scripts/manifest.json'].sha256, digest(p.proposedManifest));
  assert.ok(
    p.changes.find((c) => c.kind === 'metadata').changedFields.includes('consumerSourceHash'),
  );
  validateScopeReview(p, review(p));
  const accepted = { ...input, manifestText: p.proposedManifest, source: p.expected };
  assert.equal(deriveScopeProposal(accepted).changes.length, 0);
});
test('unknown reads cannot be accepted through hashes or prose; authored classifications are explicit', () => {
  const { input, graph } = fixture();
  graph.nodes.get('scripts/read.mjs').opaqueReads.push('otherPath');
  const p = deriveScopeProposal(input);
  assert.match(p.blocked.join(), /unclassified/);
  assert.throws(() => validateScopeReview(p, review(p)), /blocked/);
  assert.throws(
    () =>
      deriveScopeProposal(input, [
        { kind: 'metadata', entrypoint: 'scripts/read.mjs', sourceSha256: 'fake' },
      ]),
    /Invalid/,
  );
  const d = {
    kind: 'metadata',
    entrypoint: 'scripts/read.mjs',
    reads: [
      { expression: 'path', purpose: 'identity', excludedInputs: [] },
      { expression: 'otherPath', purpose: 'runtime', excludedInputs: [] },
    ],
  };
  const good = deriveScopeProposal(input, [d]);
  assert.equal(good.blocked.length, 0);
  assert.ok(good.changes.find((c) => c.kind === 'metadata').changedFields.includes('reads'));
  const r = review(good);
  r.decisions.pop();
  assert.throws(() => validateScopeReview(good, r), /Missing/);
});
test('consumer edges, exclusions and changed witness sets are visible and retain previous witnesses', () => {
  const { input, graph } = fixture();
  const first = deriveScopeProposal(input);
  input.manifestText = first.proposedManifest;
  graph.nodes.get('scripts/b.mjs').dependencies.add('scripts/read.mjs');
  const p = deriveScopeProposal(input, [
    {
      kind: 'metadata',
      entrypoint: 'scripts/read.mjs',
      checks: ['extra'],
      reads: [{ expression: 'path', purpose: 'runtime', excludedInputs: [] }],
    },
  ]);
  const row = p.changes.find((c) => c.kind === 'metadata');
  assert.ok(row.changedFields.includes('consumers'));
  assert.deepEqual(row.witnesses, ['controls', 'extra']);
  assert.ok(row.changedFields.includes('reads'));
  const r = review(p);
  r.decisions[0].accept = false;
  assert.throws(() => validateScopeReview(p, r), /explicit/);
  const tampered = structuredClone(p);
  tampered.proposedManifest += ' ';
  assert.throws(() => validateScopeReview(tampered, review(tampered)), /modified/);
});
test('new opaque owners require both a classification and registered witness', () => {
  const { input, graph, node } = fixture();
  graph.nodes.set('scripts/new.mjs', node([], ['p']));
  graph.nodes.get('scripts/a.mjs').dependencies.add('scripts/new.mjs');
  const p = deriveScopeProposal(input);
  assert.match(p.blocked.join(), /registered witness/);
  assert.match(p.blocked.join(), /unclassified/);
});
test('script local scopes cannot hide an added reverse consumer or changed browser roots', () => {
  const { input, graph } = fixture();
  const checks = JSON.parse(input.manifestText).browserChecks;
  graph.nodes.get('scripts/a.mjs').dependencies.clear();
  graph.nodes.get('scripts/read.mjs').opaqueInputs = false;
  const scope = {
    entrypoint: 'scripts/a.mjs',
    dependencies: [],
    externalImports: [],
    checks: ['a'],
    consumers: browserScopeConsumers(graph, 'scripts/a.mjs'),
    roots: browserScopeRoots(checks),
  };
  const select = () =>
    selectAffectedBrowserChecks({ checks, graph, files: ['scripts/a.mjs'], scopes: [scope] });
  assert.equal(select().checks.length, 1);
  graph.nodes.get('scripts/b.mjs').dependencies.add('scripts/a.mjs');
  assert.equal(select().checks.length, 2);
});
test('removing the last opaque read produces an explicit removal diff', () => {
  const { input, graph } = fixture();
  const before = deriveScopeProposal(input);
  input.manifestText = before.proposedManifest;
  delete graph.nodes.get('scripts/read.mjs').opaqueReads;
  graph.nodes.get('scripts/read.mjs').opaqueInputs = false;
  const p = deriveScopeProposal(input);
  assert.equal(p.blocked.length, 0);
  const row = p.changes.find((c) => c.kind === 'metadata');
  assert.deepEqual(row.proposed.reads, []);
  assert.equal(row.before.reads.length, 1);
});
test('witness admission rejects substituted requests, empty or failed receipts and different candidate bytes', async () => {
  const { scopeWitnessRequest, validateScopeWitnessResult } = await import(
    '../scripts/browser-scope-witness-contract.mjs'
  );
  const { input } = fixture();
  const p = deriveScopeProposal(input);
  const result = {
    ok: true,
    requested: scopeWitnessRequest(p),
    candidateIdentity: p.expected,
    checks: [
      { id: 'scope:controls', ok: true },
      { id: 'browser:a', ok: true },
    ],
  };
  validateScopeWitnessResult(p, result);
  for (const mutate of [
    (r) => (r.requested.scopes = []),
    (r) => (r.checks = []),
    (r) => (r.checks[0].ok = false),
    (r) => (r.candidateIdentity.head = 'other'),
  ]) {
    const r = structuredClone(result);
    mutate(r);
    assert.throws(() => validateScopeWitnessResult(p, r), /witness/);
  }
  const m = JSON.parse(p.proposedManifest);
  m.checks[0] = {
    id: 'controls',
    module: 'scripts/check-invariant-controls.mjs',
    export: 'checkInvariantControls',
  };
  m.invariants = [
    {
      controls: {
        positive: [{ path: 'test/control.mjs' }],
        negative: [{ path: 'test/control.mjs' }],
      },
    },
  ];
  p.proposedManifest = JSON.stringify(m);
  assert.throws(() => validateScopeWitnessResult(p, result), /receipts/);
  result.checks.push({ id: 'unit:test/control.mjs', ok: true });
  validateScopeWitnessResult(p, result);
});
test('new occurrences of identical read text require explicit classification', () => {
  const { input, graph } = fixture();
  graph.nodes.get('scripts/read.mjs').opaqueReads.push('path');
  const p = deriveScopeProposal(input);
  assert.match(p.blocked.join(), /unclassified/);
  const approved = deriveScopeProposal(input, [
    {
      kind: 'metadata',
      entrypoint: 'scripts/read.mjs',
      reads: [{ expression: 'path', purpose: 'fixture', excludedInputs: [] }],
    },
  ]);
  assert.equal(approved.blocked.length, 0);
  assert.equal(approved.changes.find((c) => c.kind === 'metadata').proposed.reads.length, 2);
});
