import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args, options = {}) => execFileSync('git', args, { cwd: root, ...options });
const text = (root, args) => git(root, args, { encoding: 'utf8' }).trim();
export function candidateSelection(root, base) {
  return [
    ...new Set(
      [
        ...git(root, ['diff', '--name-only', '-z', base, '--']).toString().split('\0'),
        ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0'),
      ].filter(Boolean),
    ),
  ].sort();
}
function inventory(root) {
  const head = text(root, ['rev-parse', 'HEAD']);
  const index = git(root, ['ls-files', '--stage', '-z']);
  if (git(root, ['ls-files', '--unmerged', '-z']).length)
    throw Error('Unmerged index cannot be captured');
  const paths = [
    ...new Set(
      git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .toString()
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  const files = {},
    bytes = new Map();
  for (const path of paths) {
    if (/(^|\/)(\.env(?:\.|$)|\.dev\.vars|secrets?\.)/.test(path))
      throw Error(`Secret-like source input: ${path}`);
    const absolute = resolve(root, path);
    // Check every segment: lstat(file) alone follows directory symlinks.
    for (let parent = absolute; parent !== resolve(root); parent = dirname(parent)) {
      let stat;
      try {
        stat = lstatSync(parent);
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        throw e;
      }
      if (stat.isSymbolicLink()) throw Error(`Unsupported source input: ${path}`);
    }
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (e) {
      if (e.code === 'ENOENT') {
        files[path] = { deleted: true };
        continue;
      }
      throw e;
    }
    if (!stat.isFile()) throw Error(`Unsupported source input: ${path}`);
    const value = readFileSync(absolute);
    bytes.set(path, value);
    files[path] = { sha256: hash(value), mode: stat.mode & 0o777 };
  }
  return { head, index: index.toString(), files, bytes };
}
const comparable = ({ head, index, files }) => JSON.stringify({ head, index, files });
export function candidateIdentity(root) {
  const { bytes, ...identity } = inventory(root);
  return identity;
}
export async function candidateMatchesOrigin(root, candidate) {
  try {
    return comparable(inventory(root)) === comparable(candidate);
  } catch {
    return false;
  }
}
/** Observed before/after stability, not an atomic filesystem snapshot. */
export async function captureCandidate(
  root,
  destination,
  { base = 'HEAD', afterRead = () => {} } = {},
) {
  root = resolve(root);
  destination = resolve(destination);
  const captured = inventory(root),
    resolvedBase = text(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const originSelection = candidateSelection(root, resolvedBase);
  await afterRead();
  if (comparable(inventory(root)) !== comparable(captured))
    throw Error('Source changed during capture');
  git(root, ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, destination]);
  git(destination, ['update-ref', '--no-deref', 'HEAD', captured.head]);
  git(destination, ['read-tree', '--empty']);
  // Staged objects need not be reachable from HEAD. Transfer any missing blobs.
  for (const entry of captured.index.split('\0').filter(Boolean)) {
    const oid = entry.split(' ')[1];
    try {
      git(destination, ['cat-file', '-e', oid], { stdio: 'ignore' });
    } catch {
      git(destination, ['hash-object', '-w', '--stdin'], {
        input: git(root, ['cat-file', 'blob', oid]),
      });
    }
  }
  git(destination, ['update-index', '-z', '--index-info'], { input: captured.index });
  for (const [path, bytes] of captured.bytes) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    chmodSync(target, captured.files[path].mode);
  }
  const copied = inventory(destination);
  if (
    comparable(copied) !== comparable(captured) ||
    comparable(inventory(root)) !== comparable(captured)
  )
    throw Error('Source changed during capture');
  const selected = candidateSelection(destination, resolvedBase);
  if (JSON.stringify(selected) !== JSON.stringify(originSelection))
    throw Error('Candidate selection differs from origin');
  return {
    head: captured.head,
    index: captured.index,
    files: captured.files,
    base: resolvedBase,
    originSelection,
    candidateSelection: selected,
    destination,
  };
}
