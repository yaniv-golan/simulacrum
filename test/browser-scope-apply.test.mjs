import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareScopeProposal } from '../scripts/browser-scope-proposal.mjs';
import {
  applyScopeProposal,
  scopeArtifact,
  assertScopeEnvironment,
} from '../scripts/browser-scope-apply.mjs';
import { candidateIdentity } from '../scripts/candidate.mjs';
import { scopeWitnessRequest } from '../scripts/browser-scope-witness-contract.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scope-apply-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'artifacts'));
  writeFileSync(join(root, '.gitignore'), 'artifacts/\n');
  writeFileSync(join(root, 'scripts/a.mjs'), 'export const a=1;');
  writeFileSync(
    join(root, 'scripts/manifest.json'),
    JSON.stringify({
      browserChecks: [{ id: 'a', script: 'scripts/a.mjs', environment: 'self' }],
      checks: [],
      browserLocalScopes: [{ entrypoint: 'scripts/a.mjs', dependencies: [], checks: ['a'] }],
      browserReviewMetadataScopes: [],
    }),
  );
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const proposal = prepareScopeProposal(root),
    review = {
      proposalDigest: proposal.digest,
      decisions: proposal.changes.map((c) => ({
        key: c.key,
        accept: true,
        rationale: 'Verified isolated a has no consumers.',
      })),
    };
  assert.equal(proposal.blocked.length, 0);
  return { root, proposal, review, git };
}
const withWindow = (f) => f();
test('apply verifies captured bytes, changes only manifest, preserves staged and untracked work, and is idempotent without claiming another pass', async (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'notes'), 'staged');
  git('add', 'notes');
  writeFileSync(join(root, 'notes'), 'unstaged');
  writeFileSync(join(root, 'new'), 'untracked');
  const proposal = prepareScopeProposal(root),
    review = {
      proposalDigest: proposal.digest,
      decisions: proposal.changes.map((c) => ({
        key: c.key,
        accept: true,
        rationale: 'Examined owner boundary.',
      })),
    };
  let calls = 0;
  const result = await applyScopeProposal(root, proposal, review, {
    withWindow,
    runWitnesses: async (candidate) => {
      calls++;
      assert.deepEqual(candidateIdentity(candidate), proposal.expected);
      return { ok: true };
    },
  });
  t.after(() => rmSync(join(result.candidate, '..'), { recursive: true, force: true }));
  assert.equal(result.status, 'applied');
  assert.deepEqual(candidateIdentity(root), proposal.expected);
  const again = await applyScopeProposal(root, proposal, review, {
    withWindow,
    runWitnesses: () => {
      throw Error('must not rerun');
    },
  });
  assert.equal(again.witnesses, 'NOT_EVALUATED');
  assert.equal(calls, 1);
});
for (const kind of ['failure', 'candidate drift', 'origin drift'])
  test(`${kind} rejects application and retains evidence`, async (t) => {
    const { root, proposal, review } = fixture(t),
      before = readFileSync(join(root, 'scripts/manifest.json'), 'utf8');
    let destination;
    await assert.rejects(
      applyScopeProposal(root, proposal, review, {
        withWindow,
        runWitnesses: async (candidate) => {
          destination = candidate;
          if (kind === 'failure') return { ok: false };
          writeFileSync(
            join(kind === 'candidate drift' ? candidate : root, 'scripts/a.mjs'),
            'changed',
          );
          return { ok: true };
        },
      }),
      (error) => {
        assert.ok(error.reportPath);
        assert.equal(JSON.parse(readFileSync(error.reportPath)).ok, false);
        return true;
      },
    );
    t.after(() => rmSync(join(destination, '..'), { recursive: true, force: true }));
    assert.equal(readFileSync(join(root, 'scripts/manifest.json'), 'utf8'), before);
  });
test('stale proposal and review reject before running witnesses', async (t) => {
  const { root, proposal, review } = fixture(t);
  writeFileSync(join(root, 'scripts/a.mjs'), 'changed');
  await assert.rejects(
    applyScopeProposal(root, proposal, review, {
      withWindow,
      runWitnesses: () => {
        assert.fail('ran witnesses');
      },
    }),
    /Stale/,
  );
  review.proposalDigest = 'wrong';
  await assert.rejects(applyScopeProposal(root, proposal, review), /Review/);
});
test('artifact paths reject outside destinations and dangling symlinks; runtime overrides cannot authorize witnesses', (t) => {
  const { root } = fixture(t);
  assert.throws(() => scopeArtifact(root, 'scripts/output.json'), /artifacts/);
  symlinkSync(join(root, 'outside.json'), join(root, 'artifacts/proposal.json'));
  assert.throws(() => scopeArtifact(root, 'artifacts/proposal.json'), /Symlink/);
  assert.doesNotThrow(() => scopeArtifact(root, 'artifacts/safe.json'));
  assert.doesNotThrow(() => assertScopeEnvironment({}));
  for (const key of ['FEEDBACK_SOURCE', 'PLAYTEST_URL', 'SIMULACRUM_BROWSER_OUTPUT'])
    assert.throws(() => assertScopeEnvironment({ [key]: 'override' }), /clean local/);
});
/** A workshop check whose served page loads scripts/a.mjs reaches it without importing it. */
async function reachingFixture(t) {
  const { root, git } = fixture(t);
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><script type="module" src="scripts/a.mjs"></script>',
  );
  git('add', 'index.html');
  git('commit', '-qm', 'served root');
  const first = prepareScopeProposal(root);
  const populate = {
    proposalDigest: first.digest,
    decisions: first.changes.map((c) => ({ key: c.key, accept: true, rationale: 'Populated.' })),
  };
  const applied = await applyScopeProposal(root, first, populate, {
    withWindow,
    runWitnesses: async () => ({ ok: true }),
  });
  t.after(() => rmSync(join(applied.candidate, '..'), { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.browserLocalScopes[0].reachingChecks, ['a']);
  manifest.browserChecks.push({ id: 'c', script: 'scripts/c.mjs', environment: 'workshop' });
  writeFileSync(join(root, 'scripts/c.mjs'), 'export const c=1;');
  writeFileSync(join(root, 'scripts/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  git('add', 'scripts/c.mjs', 'scripts/manifest.json');
  git('commit', '-qm', 'new reaching check');
  const proposal = prepareScopeProposal(root);
  const row = proposal.changes.find((c) => c.entrypoint === 'scripts/a.mjs');
  assert.deepEqual(row.changedFields, ['reachingChecks']);
  assert.deepEqual(row.reachingNotDeclared, ['c']);
  assert.deepEqual(row.witnesses, []);
  return { root, proposal, row, git };
}
test('additive-only proposal applies with NOT_REQUIRED and no witness execution', async (t) => {
  const { root, proposal, row } = await reachingFixture(t);
  const review = {
    proposalDigest: proposal.digest,
    decisions: [
      {
        key: row.key,
        accept: true,
        rationale: 'c only exercises the served page.',
        undeclared: 'acknowledged',
      },
    ],
  };
  const result = await applyScopeProposal(root, proposal, review, {
    withWindow,
    runWitnesses: () => assert.fail('no witness may execute for an additive row'),
  });
  t.after(() => rmSync(join(result.candidate, '..'), { recursive: true, force: true }));
  assert.equal(result.status, 'applied');
  assert.equal(result.witnesses.status, 'NOT_REQUIRED');
  assert.equal(result.installed, 'skipped');
  assert.ok(result.candidate);
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.browserLocalScopes[0].reachingChecks, ['a', 'c']);
  assert.deepEqual(manifest.browserLocalScopes[0].checks, ['a']);
  assert.deepEqual(candidateIdentity(root), result.after);
});
test('a declared reaching check joins the row and its witnesses execute before application', async (t) => {
  const { root, proposal, row } = await reachingFixture(t);
  const review = {
    proposalDigest: proposal.digest,
    decisions: [{ key: row.key, accept: true, rationale: 'c drives a.', declare: ['c'] }],
  };
  let requested;
  const result = await applyScopeProposal(root, proposal, review, {
    withWindow,
    runWitnesses: async (candidate, resolved) => {
      requested = scopeWitnessRequest(resolved);
      assert.deepEqual(candidateIdentity(candidate), resolved.expected);
      return { ok: true };
    },
  });
  t.after(() => rmSync(join(result.candidate, '..'), { recursive: true, force: true }));
  assert.deepEqual(requested.scopes, [{ kind: 'local', witnesses: ['a', 'c'] }]);
  assert.deepEqual(result.declared, { [row.key]: ['c'] });
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.browserLocalScopes[0].checks, ['a', 'c']);
  assert.deepEqual(manifest.browserLocalScopes[0].reachingChecks, ['a', 'c']);
  // The unacknowledged form is refused before any capture.
  await assert.rejects(
    applyScopeProposal(root, proposal, {
      ...review,
      decisions: [{ key: row.key, accept: true, rationale: 'x' }],
    }),
    /undeclared|declare/,
  );
});

test('apply records what the candidate delta selects but no witness executes, on every path', async (t) => {
  // A waived or partial run must be able to read what it skipped from the report itself;
  // the field is present on the applied path and on already-current, never absent.
  const { root, git } = fixture(t);
  // Register a second self check whose script is the delta: selected (self-hosted runtime
  // inputs), declared by no row, witnessed by nothing — the enumeration must name it.
  writeFileSync(join(root, 'scripts/b.mjs'), 'export const b=2;');
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json'), 'utf8'));
  manifest.browserChecks.push({ id: 'b', script: 'scripts/b.mjs', environment: 'self' });
  writeFileSync(join(root, 'scripts/manifest.json'), JSON.stringify(manifest));
  git('add', 'scripts/b.mjs', 'scripts/manifest.json');
  git('commit', '-qm', 'add b');
  const base = git('rev-parse', 'HEAD~1').toString().trim();
  const proposal = prepareScopeProposal(root, [], { base });
  assert.equal(proposal.affectedNotWitnessed.basis.base, base);
  assert.deepEqual(proposal.affectedNotWitnessed.basis.files, [
    'scripts/b.mjs',
    'scripts/manifest.json',
  ]);
  assert.deepEqual(proposal.affectedNotWitnessed.checks, ['b']);
  const review = {
    proposalDigest: proposal.digest,
    decisions: proposal.changes.map((c) => ({
      key: c.key,
      accept: true,
      rationale: 'Verified isolated a has no consumers.',
      ...(c.reachingNotDeclared ? { undeclared: 'acknowledged' } : {}),
    })),
  };
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  const capture = (work) => work().finally(() => (console.log = original));
  const result = await capture(() =>
    applyScopeProposal(root, proposal, review, {
      withWindow,
      runWitnesses: async () => ({ ok: true, checks: [] }),
    }),
  );
  if (result.candidate)
    t.after(() => rmSync(join(result.candidate, '..'), { recursive: true, force: true }));
  assert.ok('affectedNotWitnessed' in result, 'field present on the applied report');
  assert.deepEqual(result.affectedNotWitnessed, proposal.affectedNotWitnessed);
  assert.ok(lines.includes('Affected but not witnessed (NOT_EXECUTED; enumeration only): b'));
  // Once applied, a fresh proposal is already current; the report still carries the field.
  const current = prepareScopeProposal(root, [], { base });
  lines.length = 0;
  console.log = (line) => lines.push(String(line));
  const idle = await capture(() =>
    applyScopeProposal(
      root,
      current,
      { proposalDigest: current.digest, decisions: [] },
      { withWindow, runWitnesses: () => assert.fail('already-current must not run witnesses') },
    ),
  );
  assert.equal(idle.status, 'already-current');
  assert.ok('affectedNotWitnessed' in idle, 'field present on already-current');
  assert.deepEqual(idle.affectedNotWitnessed, current.affectedNotWitnessed);
  // With nothing left to change, nothing is witnessed: every selected check is enumerated.
  assert.deepEqual(current.affectedNotWitnessed.checks, ['a', 'b']);
  assert.ok(lines.includes('Affected but not witnessed (NOT_EXECUTED; enumeration only): a, b'));
});

test('scope CLI accepts --base on prepare only and records the basis', async (t) => {
  const { scopeCLI } = await import('../scripts/browser-scopes.mjs');
  const { root, git } = fixture(t);
  const base = git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(root, 'scripts/extra.mjs'), 'export const extra=1;');
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    assert.equal(await scopeCLI(['prepare', '--base', base, '--out', 'artifacts/p.json'], root), 0);
  } finally {
    console.log = original;
  }
  const saved = JSON.parse(readFileSync(join(root, 'artifacts/p.json'), 'utf8'));
  assert.equal(saved.affectedNotWitnessed.basis.base, base);
  assert.deepEqual(saved.affectedNotWitnessed.basis.files, ['scripts/extra.mjs']);
  assert.ok(
    logs.some((l) => l.includes('Affected but not witnessed (NOT_EXECUTED; enumeration only): ')),
  );
  writeFileSync(
    join(root, 'artifacts/r.json'),
    JSON.stringify({ proposalDigest: saved.digest, decisions: [] }),
  );
  await assert.rejects(
    scopeCLI(['apply', 'artifacts/p.json', '--review', 'artifacts/r.json', '--base', base], root),
    /Use browser:scopes/,
  );
});
