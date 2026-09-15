import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveStack, landingOrderText } from '../scripts/candidate-stack.mjs';

// A real repository: first-parent semantics, merge-bases and ancestry come from git itself.
function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'candidate-stack-'));
  const git = (args, options = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'user.name', 'Fixture']);
  let n = 0;
  const commit = (message = `c${++n}`) => {
    writeFileSync(join(cwd, `${message}.txt`), message);
    git(['add', '.']);
    git(['commit', '-qm', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const sha = (ref) => git(['rev-parse', ref]).trim();
  return { cwd, git, commit, sha, dispose: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('a branch that merged the earlier integration branch stacks on it: incoming is its pre-integration tip, base their merge-base', (t) => {
  const r = repository();
  t.after(r.dispose);
  const base = r.commit('base');
  r.git(['checkout', '-qb', 'earlier']);
  const earlier = r.commit('earlier-1');
  r.git(['checkout', '-q', 'main']);
  r.git(['checkout', '-qb', 'mine']);
  r.commit('mine-1');
  const tip = r.commit('mine-2');
  r.git(['merge', '-q', '--no-edit', 'earlier']);
  const head = r.commit('docs-closure');
  const derived = deriveStack('earlier', r.git);
  assert.deepEqual(derived, {
    stack: 'earlier',
    destinationName: 'earlier',
    destination: earlier,
    incoming: tip,
    base,
    head,
    chain: { stack: 'earlier', destination: earlier, incoming: tip, base, head },
    landingOrder: [`earlier @ ${earlier.slice(0, 7)}`, `this candidate @ ${head.slice(0, 7)}`],
  });
  assert.equal(
    landingOrderText(derived),
    `landing order: earlier @ ${earlier.slice(0, 7)}, then this candidate @ ${head.slice(0, 7)}`,
  );
  // The earlier branch moved and was re-merged: the branch's own history now ends at the
  // commit before the re-merge (it contains the old ref tip, not the moved one), and the base
  // is the old ref tip — the scope is what the branch added since the first integration plus
  // what the ref added since; nothing is verified twice and nothing is missed.
  r.git(['checkout', '-q', 'earlier']);
  const earlier2 = r.commit('earlier-2');
  r.git(['checkout', '-q', 'mine']);
  // Before the re-merge the branch does not contain the moved ref: refused, naming both.
  assert.throws(
    () => deriveStack('earlier', r.git),
    (error) => {
      assert.match(
        error.message,
        new RegExp(
          `HEAD ${r.sha('HEAD').slice(0, 7)} does not contain earlier @ ${earlier2.slice(0, 7)}; merge earlier into the branch first`,
        ),
      );
      return true;
    },
  );
  r.git(['merge', '-q', '--no-edit', 'earlier']);
  const again = deriveStack('earlier', r.git);
  assert.equal(again.incoming, head, 'the commit before the re-merge');
  assert.equal(again.destination, earlier2);
  assert.equal(again.base, earlier, 'the old ref tip the branch already contained');
  assert.equal(r.git(['merge-base', again.incoming, again.destination]).trim(), again.base);
});

test('a branch built linearly on the earlier branch integrates whole: incoming is HEAD, base the ref', (t) => {
  const r = repository();
  t.after(r.dispose);
  r.commit('base');
  r.git(['checkout', '-qb', 'earlier']);
  const earlier = r.commit('earlier-1');
  r.git(['checkout', '-qb', 'mine']);
  r.commit('mine-1');
  const head = r.commit('mine-2');
  const derived = deriveStack('earlier', r.git);
  assert.equal(derived.incoming, head);
  assert.equal(derived.base, earlier);
  assert.equal(derived.destination, earlier);
});

test('stacks are refused by name when HEAD is the ref, the ref is main, the ref is missing, or the merge-base is not unique', (t) => {
  const r = repository();
  t.after(r.dispose);
  const base = r.commit('base');
  r.git(['checkout', '-qb', 'earlier']);
  const earlier = r.commit('earlier-1');
  // HEAD is the ref itself.
  assert.throws(
    () => deriveStack('earlier', r.git),
    new RegExp(
      `HEAD is earlier @ ${earlier.slice(0, 7)}; a stack needs a branch with its own commits`,
    ),
  );
  assert.throws(() => deriveStack('main', r.git), /--stack main is not a stack/);
  assert.throws(() => deriveStack('nowhere', r.git), /nowhere does not resolve to a commit/);
  assert.throws(() => deriveStack('', r.git), /needs the earlier integration branch name/);
  assert.throws(() => deriveStack('--base', r.git), /needs the earlier integration branch name/);
  // Criss-cross: each branch merged the other's earlier tip, so two best common ancestors.
  r.git(['checkout', '-q', 'main']);
  r.git(['checkout', '-qb', 'mine']);
  const mine1 = r.commit('mine-1');
  r.git(['checkout', '-q', 'earlier']);
  r.git(['merge', '-q', '--no-edit', mine1]);
  const earlier2 = r.commit('earlier-2');
  r.git(['checkout', '-q', 'mine']);
  r.git(['merge', '-q', '--no-edit', earlier]);
  r.commit('mine-2');
  r.git(['merge', '-q', '--no-edit', 'earlier']);
  assert.throws(
    () => deriveStack('earlier', r.git),
    (error) => {
      assert.match(error.message, /have 2 merge-bases \(/);
      assert.match(error.message, new RegExp(mine1.slice(0, 7)));
      assert.match(error.message, new RegExp(earlier.slice(0, 7)));
      return true;
    },
  );
  assert.ok(base && earlier2);
});
