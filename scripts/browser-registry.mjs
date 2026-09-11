import { normalizeSelectedFiles } from './test-selection.mjs';
import { readManifest } from './validate-manifest.mjs';
import { readdirSync, readFileSync } from 'node:fs';
export function browserChecks() {
  return readManifest().browserChecks;
}
export function validateBrowserCoverage(root = process.cwd()) {
  const checks = browserChecks();
  const registered = new Set(checks.map((c) => c.script));
  for (const name of readdirSync(`${root}/scripts`))
    if (name.endsWith('.mjs')) {
      const path = `scripts/${name}`,
        source = readFileSync(`${root}/${path}`, 'utf8');
      if (
        checks.find((c) => c.script === path)?.execution === 'parallel' &&
        /(?:profile\s*:\s*['"](?:focus|recording|performance)['"]|headless\s*:\s*false)/.test(
          source,
        )
      )
        throw Error(`parallel browser check requires exclusive profile: ${path}`);
      if (
        (/from\s+['"]playwright['"]/.test(source) ||
          (/from\s+['"]\.\/browser-evidence\.mjs['"]/.test(source) && /\.launch\(/.test(source))) &&
        !registered.has(path)
      )
        throw Error(`unregistered browser check: ${path}`);
    }
}

export function selectChecks(mode) {
  const all = browserChecks();
  if (Array.isArray(mode)) {
    if (!mode.length) throw Error('empty browser check selection');
    const ids = [...new Set(mode)];
    for (const id of ids)
      if (!all.some((c) => c.id === id)) throw Error(`unknown browser check: ${id}`);
    return all.filter((c) => ids.includes(c.id));
  }
  const selected =
    mode === 'all'
      ? all
      : mode === 'smoke'
        ? all.filter((c) => c.smoke)
        : mode === 'performance'
          ? all.filter((c) => c.tier === 'performance')
          : all.filter((c) => c.id === mode);
  if (!selected.length) throw Error(`unknown browser suite: ${mode}`);
  return selected;
}
export function suiteDeadline(mode) {
  return selectChecks(mode).reduce((sum, c) => sum + c.timeoutMs, 30000);
}

export function parseBrowserArgs(args) {
  const result = {
    mode: undefined,
    files: undefined,
    workers: 2,
    reuseBuild: false,
    summary: false,
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (seen.has(arg)) throw Error(`duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === '--checks' || arg === '--files' || arg === '--priority-files') {
        const values = [];
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) values.push(args[++i]);
        if (!values.length) throw Error(`${arg} needs values`);
        if (arg === '--priority-files') result.priorityFiles = normalizeSelectedFiles(values);
        else if (arg === '--files') result.files = values;
        else {
          if (result.mode) throw Error('conflicting browser selectors');
          result.mode = values;
        }
      } else if (arg === '--workers') {
        result.workers = Number(args[++i]);
        if (![1, 2].includes(result.workers)) throw Error('workers must be 1 or 2');
      } else if (arg === '--reuse-build') result.reuseBuild = true;
      else if (arg === '--summary') result.summary = true;
      else throw Error(`unknown browser option: ${arg}`);
    } else {
      if (result.mode) throw Error('conflicting browser selectors');
      result.mode = arg;
    }
  }
  if (result.files && result.mode)
    throw Error('conflicting browser selectors: --files and explicit checks');
  result.mode ??= 'all';
  return result;
}
