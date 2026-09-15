import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  captureCandidate,
  candidateMatchesOrigin,
  candidateIdentity,
  identityFiles,
} from '../scripts/candidate.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'candidate-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, '.gitignore'), 'private/\n');
  for (const p of ['keep', 'deleted', 'staged-delete', 'rename']) writeFileSync(join(root, p), p);
  g('add', '.');
  g('commit', '-qm', 'base');
  return { root, g };
}
test('candidate preserves exact dirty index, deletions, renames and untracked binary bytes', async (t) => {
  const { root, g } = fixture(t);
  rmSync(join(root, 'deleted'));
  g('rm', 'staged-delete');
  g('mv', 'rename', 'renamed');
  writeFileSync(join(root, 'keep'), 'staged');
  g('add', 'keep');
  writeFileSync(join(root, 'keep'), 'working');
  writeFileSync(join(root, 'new'), Buffer.from([0, 255, 128]));
  mkdirSync(join(root, 'private'));
  writeFileSync(join(root, 'private', 'ignored'), 'not captured');
  writeFileSync(join(root, 'private', 'tracked'), 'included');
  g('add', '-f', 'private/tracked');
  const out = join(root, 'private', 'candidate');
  const result = await captureCandidate(root, out);
  assert.equal(readFileSync(join(out, 'keep'), 'utf8'), 'working');
  assert.deepEqual(readFileSync(join(out, 'new')), Buffer.from([0, 255, 128]));
  assert.equal(readFileSync(join(out, 'private', 'tracked'), 'utf8'), 'included');
  assert.deepEqual(result.originSelection, result.candidateSelection);
  assert.equal(
    execFileSync('git', ['ls-files', '--stage'], { cwd: out, encoding: 'utf8' }),
    g('ls-files', '--stage'),
  );
  assert.equal(await candidateMatchesOrigin(root, result), true);
  writeFileSync(join(root, 'keep'), 'later independent work');
  assert.equal(await candidateMatchesOrigin(root, result), false);
  assert.equal(readFileSync(join(out, 'keep'), 'utf8'), 'working');
});
test('capture rejects observed drift and symlinks, rather than producing a green candidate', async (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'private'));
  await assert.rejects(
    captureCandidate(root, join(root, 'private', 'drift'), {
      afterRead: () => writeFileSync(join(root, 'keep'), 'changed'),
    }),
    /changed during capture/,
  );
  symlinkSync('keep', join(root, 'link'));
  await assert.rejects(
    captureCandidate(root, join(root, 'private', 'link-copy')),
    /Unsupported source input/,
  );
});

test('invalid candidate invocation replaces previous green report before admission', (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'artifacts'));
  writeFileSync(join(root, 'artifacts/verification-candidate.json'), '{"status":"passed"}');
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [new URL('../scripts/verify-candidate.mjs', import.meta.url).pathname, 'invalid'],
      { cwd: root, stdio: 'pipe' },
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, 'artifacts/verification-candidate.json'))).status,
    'failed',
  );
});

test('destination drift is detected for named refs and not evaluated for bare commits', async (t) => {
  const { destinationStillMatches } = await import('../scripts/candidate.mjs');
  const { root, g } = fixture(t);
  const head = g('rev-parse', 'HEAD').trim();
  assert.equal(destinationStillMatches(root, { destination: head, destinationName: 'HEAD' }), true);
  g('commit', '--allow-empty', '-qm', 'move');
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: 'HEAD' }),
    false,
  );
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: head }),
    'NOT_EVALUATED',
  );
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: head.slice(0, 12) }),
    'NOT_EVALUATED',
  );
  g('branch', 'deadbeef', 'HEAD');
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: 'deadbeef' }),
    false,
    'hex-looking branch names are refs, not commits',
  );
  // A branch whose name is literally a prefix of the pinned commit is still a ref.
  const lookalike = head.slice(0, 6);
  g('branch', lookalike, 'HEAD');
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: lookalike }),
    false,
  );
  g('branch', 'stacked', head);
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: 'stacked' }),
    true,
  );
  g('branch', '-D', 'stacked');
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: 'stacked' }),
    'UNRESOLVED',
    'a deleted stacked branch is not the same as a moved destination',
  );
  assert.equal(
    destinationStillMatches(root, { destination: head, destinationName: 'no-such-ref' }),
    'UNRESOLVED',
  );
  assert.equal(destinationStillMatches(root, {}), 'NOT_EVALUATED');
});

// The per-path record a release cites is the candidate's own `files` map, from one function.
test('identityFiles is the candidate identity files map: shas, modes, deletions, no index', async (t) => {
  const { root, g } = fixture(t);
  rmSync(join(root, 'deleted'));
  writeFileSync(join(root, 'keep'), 'working');
  writeFileSync(join(root, 'new'), 'untracked');
  execFileSync('chmod', ['755', join(root, 'new')]);
  const files = identityFiles(root);
  const before = candidateIdentity(root);
  assert.deepEqual(files, before.files);
  assert.deepEqual(files.deleted, { deleted: true });
  assert.equal(files.new.mode, 0o755);
  assert.match(files.keep.sha256, /^[a-f0-9]{64}$/);
  assert.equal('index' in files, false);
  // Staging a byte-identical file changes the index, never the files map.
  g('add', 'keep');
  assert.deepEqual(identityFiles(root), files);
  assert.notEqual(candidateIdentity(root).index, before.index);
});

test('a base ref resolves to the commit it names now, so a moved ref is a different base', async (t) => {
  const { resolveCandidateBase } = await import('../scripts/candidate.mjs');
  const { root, g } = fixture(t);
  const head = g('rev-parse', 'HEAD').trim();
  assert.equal(resolveCandidateBase(root), head);
  assert.equal(resolveCandidateBase(root, 'HEAD'), head);
  assert.equal(resolveCandidateBase(root, head), head, 'a commit resolves to itself');
  g('branch', 'topic', 'HEAD');
  assert.equal(resolveCandidateBase(root, 'topic'), head);
  g('commit', '--allow-empty', '-qm', 'move');
  g('branch', '-f', 'topic', 'HEAD');
  assert.notEqual(resolveCandidateBase(root, 'topic'), head, 'the moved ref names another commit');
  assert.equal(resolveCandidateBase(root, 'topic'), g('rev-parse', 'HEAD').trim());
  for (const bad of ['', '--output=/tmp/x', 'no-such-ref', 42])
    assert.throws(() => resolveCandidateBase(root, bad));
});
