import { lstatSync } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';

/** Keep a check's evidence and generated input paths inside its suite-owned run root. */
export function browserArtifactPath(path, standalonePath = path) {
  const root = process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT;
  if (root === undefined) return standalonePath;
  if (!isAbsolute(root)) throw Error('browser artifact root must be absolute');
  if (
    typeof path !== 'string' ||
    !path.startsWith('artifacts/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  )
    throw Error(`invalid browser artifact path: ${path}`);
  const suffix = path.slice('artifacts/'.length);
  let ancestor = root;
  for (const part of suffix.split('/')) {
    ancestor = join(ancestor, part);
    if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink())
      throw Error(`browser artifact path contains a symlink: ${path}`);
  }
  return resolve(root, suffix);
}
