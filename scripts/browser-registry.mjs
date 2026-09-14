import { normalizeSelectedFiles } from './test-selection.mjs';
import { readManifest } from './validate-manifest.mjs';
import { readdirSync, readFileSync } from 'node:fs';
export function browserChecks() {
  return readManifest().browserChecks;
}
/** A script that asserts a timing budget; declared, not inferred, so the schedule and receipt
 * reuse read one registered fact. One-directional: an assertion must be declared; declaring
 * without an assertion is allowed. The probe is source-local and lexical: budgets asserted in
 * an imported helper (spring-performance via measure-springs.mjs) or phrased as wall-clock
 * caps and sampling-gap guards (starter, shared-sensing) are not caught and must be declared
 * by their owners; the audit of 2026-09-14 lists them. */
export const TIMING_ASSERTION =
  /\b(?:p95|quantile|renderP95Ms|cadenceP95Ms|tickP95Ms|realTimeRatio|frameCpuMs|audioCpuMs)\b/;
export function timingSensitiveChecks(checks = browserChecks()) {
  return checks.filter((c) => c.timingSensitive === true);
}
/** A self-hosted check may share the pool only when the source shows it is isolated: it binds
 * its servers to port 0, keeps every artifact path under the per-check root, and starts no Vite
 * dev server (those share one dependency-optimizer cache). Local script imports are inspected
 * one level down so a thin wrapper cannot hide a server. */
export function selfCheckIsolationProblems(path, read) {
  const sources = [read(path)];
  for (const match of read(path).matchAll(
    /from\s+['"](\.\/[^'"]+\.mjs)['"]|import\(['"](\.\/[^'"]+\.mjs)['"]\)/g,
  )) {
    const specifier = match[1] ?? match[2];
    // Shared harness modules (browser-*.mjs, catalog actions) are the isolation mechanism
    // itself and are inspected by their own tests, not as part of a check.
    if (/^\.\/(?:browser-[a-z-]+|catalog-browser-actions)\.mjs$/.test(specifier)) continue;
    try {
      sources.push(read(`scripts/${specifier.slice(2)}`));
    } catch {
      /* an unreadable import is reported by the module graph, not here */
    }
  }
  const problems = [];
  for (const source of sources) {
    if (/\b(?:listen\(\s*[1-9]\d*|port\s*:\s*[1-9]\d*)/.test(source)) problems.push('fixed port');
    if (/from\s+['"]vite['"]/.test(source)) problems.push('vite dev server (shared cache)');
    // Every artifact literal must be the argument of browserArtifactPath(...), whichever line
    // the formatter put it on; strip those calls first, then any remaining literal is a leak.
    const unremapped = source.replace(/browserArtifactPath\(\s*[^)]*\)/g, '');
    if (/['"`]artifacts\//.test(unremapped))
      problems.push('artifact path outside the per-check root');
  }
  return [...new Set(problems)];
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
      const registeredCheck = checks.find((c) => c.script === path);
      if (registeredCheck && !registeredCheck.timingSensitive && TIMING_ASSERTION.test(source))
        throw Error(`timing budget assertion requires timingSensitive: ${path}`);
      if (registeredCheck?.execution === 'parallel' && registeredCheck.environment === 'self') {
        const problems = selfCheckIsolationProblems(path, (p) =>
          readFileSync(`${root}/${p}`, 'utf8'),
        );
        if (problems.length)
          throw Error(
            `parallel self-hosted check must be isolated: ${path}: ${problems.join(', ')}`,
          );
      }
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
        if (![1, 2, 3, 4].includes(result.workers)) throw Error('workers must be 1 to 4');
      } else if (arg === '--reuse-build') result.reuseBuild = true;
      else if (arg === '--fail-fast') result.failFast = true;
      else if (arg === '--summary') result.summary = true;
      else throw Error(`unknown browser option: ${arg}`);
    } else {
      if (result.mode) throw Error('conflicting browser selectors');
      result.mode = arg;
    }
  }
  if (result.files && result.mode)
    throw Error('conflicting browser selectors: --files and explicit checks');
  if (result.failFast && !Array.isArray(result.mode))
    throw Error('--fail-fast requires explicit --checks development probes');
  if (result.workers > 2 && !Array.isArray(result.mode))
    throw Error('more than two workers requires explicit development probes');
  result.mode ??= 'all';
  return result;
}
