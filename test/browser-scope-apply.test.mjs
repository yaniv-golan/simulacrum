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
