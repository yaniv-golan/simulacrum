import { readManifest } from './validate-manifest.mjs';
import { readdirSync, readFileSync } from 'node:fs';
export function browserChecks() {
  return readManifest().browserChecks;
}
export function validateBrowserCoverage(root = process.cwd()) {
  const registered = new Set(browserChecks().map((c) => c.script));
  for (const name of readdirSync(`${root}/scripts`))
    if (name.endsWith('.mjs')) {
      const path = `scripts/${name}`,
        source = readFileSync(`${root}/${path}`, 'utf8');
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
