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

test('release version is package.json at build time, cross-checked by a semver tag on the built commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-version-')),
    plain = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  const setVersion = (version) =>
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  try {
    git('init', '-q');
    setVersion('0.3.0');
    git('add', 'package.json');
    git('commit', '-qm', 'first');
    assert.deepEqual(releaseVersion(root), {
      package: 'v0.3.0',
      tag: null,
      consistent: true,
      version: 'v0.3.0',
    });
    git('tag', '-a', 'v0.3.0', '-m', 'release');
    assert.deepEqual(releaseVersion(root), {
      package: 'v0.3.0',
      tag: 'v0.3.0',
      consistent: true,
      version: 'v0.3.0',
    });
    setVersion('0.4.0');
    git('commit', '-qam', 'bump without a matching tag');
    git('tag', '-a', 'v0.3.1', '-m', 'wrong tag on the bumped commit');
    const mismatch = releaseVersion(root);
    assert.equal(mismatch.consistent, false, 'a tag differing from package.json is a wrong trace');
    assert.equal(mismatch.version, null, 'the app then names its build id');
    git('tag', '-d', 'v0.3.1');
    git('tag', '-a', 'v1-final-x', '-m', 'not semver');
    assert.equal(releaseVersion(root).version, 'v0.4.0', 'non-semver tags are ignored');
    setVersion('2.0.0-alpha.0');
    assert.equal(releaseVersion(root).version, 'v2.0.0-alpha.0', 'prerelease semver still names');
    setVersion('not a version');
    assert.deepEqual(
      releaseVersion(root),
      { package: null, tag: null, consistent: true, version: null },
      'a non-semver package version names nothing',
    );
    git('tag', '-a', 'v0.5.0', '-m', 'semver tag on a non-semver package');
    assert.deepEqual(releaseVersion(root), {
      package: null,
      tag: 'v0.5.0',
      consistent: false,
      version: null,
    });
    assert.deepEqual(
      releaseVersion(plain),
      { package: null, tag: null, consistent: true, version: null },
      'no package.json, no version',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});
