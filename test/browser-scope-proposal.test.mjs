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
        reads: [
          {
            expression: 'path',
            purpose: 'identity',
            excludedInputs: ['documentation', 'unit-test'],
          },
        ],
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
      { expression: 'path', purpose: 'identity', excludedInputs: ['documentation', 'unit-test'] },
      {
        expression: 'otherPath',
        purpose: 'runtime',
        excludedInputs: ['documentation', 'unit-test'],
      },
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
      reads: [
        { expression: 'path', purpose: 'runtime', excludedInputs: ['documentation', 'unit-test'] },
      ],
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
    reachingChecks: browserScopeRoots(checks, graph, 'scripts/a.mjs'),
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
  const { scopeWitnessRequest, validateScopeWitnessResult } =
    await import('../scripts/browser-scope-witness-contract.mjs');
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
      reads: [
        { expression: 'path', purpose: 'fixture', excludedInputs: ['documentation', 'unit-test'] },
      ],
    },
  ]);
  assert.equal(approved.blocked.length, 0);
  assert.equal(approved.changes.find((c) => c.kind === 'metadata').proposed.reads.length, 2);
});

test('a proposal records which checks the candidate delta selects but no witness executes', async () => {
  const { summarizeScopeProposal } = await import('../scripts/browser-scope-proposal.mjs');
  // The affected selection for the candidate's own delta is what a waived or partial run
  // skips; witnesses cover only the rows whose scope metadata changed. The proposal must
  // name the difference (enumeration only) and carry an always-present field, so a report
  // can never be read as "nothing affected" by omission.
  const { input } = fixture();
  const delta = { base: 'main', files: ['scripts/b.mjs'] };
  const p = deriveScopeProposal({ ...input, delta });
  assert.deepEqual(p.affectedNotWitnessed, {
    basis: delta,
    checks: ['b'],
  });
  assert.match(
    summarizeScopeProposal(p),
    /Affected but not witnessed \(NOT_EXECUTED; enumeration only\): b$/m,
  );
  assert.deepEqual(p, deriveScopeProposal({ ...input, delta }), 'pure in its inputs');
  // Witnesses cover the delta → empty list, field still present.
  const covered = deriveScopeProposal({
    ...input,
    delta: { base: 'main', files: ['scripts/a.mjs'] },
  });
  assert.deepEqual(covered.affectedNotWitnessed.checks, []);
  assert.match(
    summarizeScopeProposal(covered),
    /Affected but not witnessed \(NOT_EXECUTED; enumeration only\): none$/m,
  );
  // No delta supplied → unknown, never silently empty.
  const unknown = deriveScopeProposal(input);
  assert.deepEqual(unknown.affectedNotWitnessed, { basis: null, checks: null });
  assert.match(summarizeScopeProposal(unknown), /Affected but not witnessed .*: not computed/);
  // A selection failure is recorded, never swallowed into "none", and never blocks the proposal.
  const failed = deriveScopeProposal({
    ...input,
    delta,
    selectAffected: () => {
      throw Error('graph unavailable');
    },
  });
  assert.equal(failed.blocked.length, 0);
  assert.deepEqual(failed.affectedNotWitnessed, {
    basis: delta,
    checks: null,
    error: 'graph unavailable',
  });
  assert.match(
    summarizeScopeProposal(failed),
    /Affected but not witnessed .*: not computed \(graph unavailable\)/,
  );
  // The review binds the proposal including this field: editing it invalidates the digest.
  const tampered = { ...p, affectedNotWitnessed: { basis: delta, checks: [] } };
  assert.throws(() => validateScopeReview(tampered, review(p)), /Invalid or modified proposal/);
});

test('the default affected selector under a live candidate agrees with execution discovery', async () => {
  // The unit fixtures stub the selector; this proves the production default reads the same
  // graph and manifest the tier would use, minus the proposal's own witnesses.
  const { prepareScopeProposal, inspectScopeInputs } =
    await import('../scripts/browser-scope-proposal.mjs');
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
  const proposal = prepareScopeProposal(process.cwd(), [], { base: 'HEAD' });
  const { basis, checks } = proposal.affectedNotWitnessed;
  assert.match(basis.base, /^[0-9a-f]{40}$/);
  assert.ok(Array.isArray(checks), proposal.affectedNotWitnessed.error);
  // The enumeration is defined under the PROPOSED manifest (the rows a reviewer is about to
  // accept), so the reference selection must use it too: on a stale registry the current
  // manifest's audited rows fall back to opaque and would select everything.
  const proposed = JSON.parse(proposal.proposedManifest);
  const { graph, read } = inspectScopeInputs(process.cwd());
  const witnessed = new Set(proposal.changes.flatMap((c) => c.witnesses));
  const expected = basis.files.length
    ? selectAffectedBrowserChecks({
        checks: proposed.browserChecks,
        graph,
        files: basis.files,
        scopes: proposed.browserLocalScopes ?? [],
        metadataScopes: proposed.browserReviewMetadataScopes ?? [],
        readSource: read,
        metadataEnvironmentSafe: true,
      })
        .checks.map((c) => c.id)
        .filter((id) => !witnessed.has(id))
        .sort()
    : [];
  assert.deepEqual(checks, expected);
});

test('an empty candidate delta enumerates no skipped checks', () => {
  const { input } = fixture();
  const p = deriveScopeProposal({ ...input, delta: { base: 'main', files: [] } });
  assert.deepEqual(p.affectedNotWitnessed, { basis: { base: 'main', files: [] }, checks: [] });
});

test('a declaration selection would not trust is blocked at prepare naming the read and the field; an unclassified read gets a skeleton', () => {
  const { input, graph } = fixture();
  graph.nodes.get('scripts/read.mjs').opaqueReads.push('execFileSync(esbuild)');
  // The 2026-09-15 case: purpose given, exclusions empty. Prepare used to accept this and the
  // apply's witness battery then failed on a conservative selection with nothing naming the read.
  const partial = deriveScopeProposal(input, [
    {
      kind: 'metadata',
      entrypoint: 'scripts/read.mjs',
      reads: [
        { expression: 'path', purpose: 'identity', excludedInputs: ['documentation', 'unit-test'] },
        { expression: 'execFileSync(esbuild)', purpose: 'runtime', excludedInputs: [] },
      ],
    },
  ]);
  assert.equal(partial.blocked.length, 1, partial.blocked.join('\n'));
  assert.match(partial.blocked[0], /metadata:scripts\/read\.mjs/);
  assert.match(partial.blocked[0], /execFileSync\(esbuild\)/);
  assert.match(partial.blocked[0], /must exclude documentation and unit-test/);
  assert.equal(partial.declarationSkeletons, undefined, 'a classified read needs no skeleton');
  // No declaration at all: blocked as before, and the proposal carries the skeleton to author.
  const none = deriveScopeProposal(input);
  assert.match(none.blocked.join(), /unclassified/);
  assert.deepEqual(none.declarationSkeletons, [
    {
      kind: 'metadata',
      entrypoint: 'scripts/read.mjs',
      reads: [
        {
          expression: 'execFileSync(esbuild)',
          purpose: '<one of identity|fixture|runtime|source-analysis>',
          excludedInputs: ['documentation', 'unit-test'],
        },
      ],
      checks: ['controls'],
    },
  ]);
  // A complete declaration proposes the row and no witness sees an unaudited selection.
  const good = deriveScopeProposal(input, [
    {
      kind: 'metadata',
      entrypoint: 'scripts/read.mjs',
      reads: [
        { expression: 'path', purpose: 'identity', excludedInputs: ['documentation', 'unit-test'] },
        {
          expression: 'execFileSync(esbuild)',
          purpose: 'runtime',
          excludedInputs: ['documentation', 'unit-test'],
        },
      ],
    },
  ]);
  assert.equal(good.blocked.length, 0);
});
