import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function sourceIdentity() {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path).update('\0');
    try {
      hash.update(readFileSync(path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('\0DELETED\0');
    }
    hash.update('\0');
  }
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDigest: hash.digest('hex'),
  };
}
/** The semver release tag on HEAD itself (`v0.2.1`), the only version wired into the
 * served app; null for an untagged commit or a shallow checkout, in which case the app
 * names its build id instead. Release tags are applied after a build is served, so a
 * package built before tagging carries no version. Tag state is not part of the build
 * id (which hashes files, not refs), so tagged and untagged builds of one tree share it
 * while their served index.html differs by this meta tag. package.json's version is not
 * wired to the app. */
export function releaseVersion(cwd = process.cwd()) {
  try {
    return (
      execFileSync(
        'git',
        ['describe', '--tags', '--exact-match', '--match', 'v[0-9]*.[0-9]*.[0-9]*'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim() || null
    );
  } catch {
    return null;
  }
}
