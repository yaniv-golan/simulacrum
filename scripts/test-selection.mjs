import { relative, resolve } from 'node:path';
export function parseTestSelectionArgs(args) {
  const result = { all: false, files: undefined, explain: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw Error(`duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--all') result.all = true;
    else if (arg === '--explain') result.explain = true;
    else if (arg === '--files') {
      result.files = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) result.files.push(args[++i]);
      if (!result.files.length) throw Error('--files needs at least one path');
    } else throw Error(`unknown test-selection argument: ${arg}`);
  }
  if (result.all && result.files) throw Error('--all and --files conflict');
  return result;
}
export function normalizeSelectedFiles(files, root = process.cwd()) {
  return files?.map((path) => {
    const local = relative(root, resolve(root, path)).split('\\').join('/');
    if (!local || local === '..' || local.startsWith('../'))
      throw Error(`file selection must stay inside project: ${path}`);
    return local;
  });
}
