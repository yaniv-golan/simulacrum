import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceIdentity, releaseVersion } from '../scripts/source-identity.mjs';
test('source identity includes uncommitted additions and deletions', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-identity-'));
  const previous = process.cwd();
  try {
    process.chdir(root);
    execFileSync('git', ['init', '-q']);
    writeFileSync('file.txt', 'first');
    execFileSync('git', ['add', 'file.txt']);
    execFileSync('git', [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ]);
    const first = sourceIdentity();
    assert.deepEqual(sourceIdentity(), first);
    rmSync('file.txt');
    const removed = sourceIdentity();
    assert.notEqual(removed.workingTreeDigest, first.workingTreeDigest);
    writeFileSync('new.txt', 'new');
    assert.notEqual(sourceIdentity().workingTreeDigest, removed.workingTreeDigest);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('release version is the semver tag on the built commit itself, never a nearby or non-semver tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-version-')),
    plain = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  try {
    git('init', '-q');
    writeFileSync(join(root, 'file.txt'), 'first');
    git('add', 'file.txt');
    git('commit', '-qm', 'first');
    assert.equal(releaseVersion(root), null, 'untagged commit has no version');
    git('tag', '-a', 'v9.9.9', '-m', 'release');
    assert.equal(releaseVersion(root), 'v9.9.9');
    writeFileSync(join(root, 'file.txt'), 'second');
    git('commit', '-qam', 'second');
    assert.equal(releaseVersion(root), null, 'a commit past the tag is not that release');
    git('tag', '-a', 'v1-final-x', '-m', 'not semver');
    assert.equal(releaseVersion(root), null, 'a non-semver tag never names a version');
    writeFileSync(join(root, 'file.txt'), 'third');
    git('commit', '-qam', 'third');
    git('tag', 'v10.0.0');
    assert.equal(releaseVersion(root), 'v10.0.0', 'lightweight semver tags count');
    assert.equal(releaseVersion(plain), null, 'outside any repository there is no version');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});
