import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
/** The version the served app names: package.json's `version` read at build time
 * (`v0.3.0`), the one wired source; the last candidate of a release carries the bump.
 * The semver release tag on HEAD, when present, is only a cross-check — tags are
 * applied after serving, so most builds have none. When both exist and differ,
 * `version` is null (the app names its build id) and the release-notes check fails. */
export function releaseVersion(cwd = process.cwd()) {
  let pkg = null,
    tag = null;
  try {
    const raw = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version;
    if (typeof raw === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(raw))
      pkg = `v${raw}`;
  } catch {
    pkg = null;
  }
  try {
    tag =
      execFileSync(
        'git',
        ['describe', '--tags', '--exact-match', '--match', 'v[0-9]*.[0-9]*.[0-9]*'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim() || null;
  } catch {
    tag = null;
  }
  const consistent = tag === null || tag === pkg;
  return { package: pkg, tag, consistent, version: consistent ? pkg : null };
}
