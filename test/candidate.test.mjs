import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureCandidate, candidateMatchesOrigin } from '../scripts/candidate.mjs';
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
