import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareMergeCoverage } from './merge-comparison.mjs';
const gitDefault = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
/** Event SHAs are data. A PR's destination tip is not the integration common ancestor. */
export function ciBrowserScope(eventName, event, git = gitDefault) {
  if (eventName === 'pull_request') {
    const incoming = event.pull_request?.head?.sha,
      destination = event.pull_request?.base?.sha;
    if (!commit(incoming) || !commit(destination))
      throw Error('PR event requires valid incoming and destination commits');
    const base = git(['merge-base', incoming, destination]).trim();
    if (!commit(base)) throw Error('PR common ancestor unavailable');
    return {
      mode: 'merge',
      changes: { base, incoming, destination },
      reason: 'PR integration branch union',
    };
  }
  if (eventName === 'push') {
    const base = event.before;
    if (commit(base)) {
      try {
        git(['cat-file', '-e', `${base}^{commit}`]);
        git(['merge-base', '--is-ancestor', base, 'HEAD']);
        return { mode: 'merge', changes: { base }, reason: 'push before to actual candidate' };
      } catch {
        /* Missing history and rewritten branches retain full coverage. */
      }
    }
    return { mode: 'all', reason: 'push base missing, zero or not an ancestor' };
  }
  let comparison;
  try {
    const base = git(['rev-parse', '--verify', 'HEAD~1^{commit}']).trim();
    if (commit(base)) comparison = { base };
  } catch {
    /* A root commit has no prior-commit comparison. */
  }
  return {
    mode: 'all',
    comparison,
    reason: 'scheduled, manual or unknown event retains full coverage',
  };
}
async function loadServices() {
  const { assertRuntime } = await import('./runtime-preflight.mjs');
  assertRuntime();
  return Object.assign(
    {},
    ...(await Promise.all([
      import('./source-identity.mjs'),
      import('./browser-selection.mjs'),
      import('./browser-registry.mjs'),
      import('./verify-browser-suite.mjs'),
      import('./merge-selection.mjs'),
    ])),
  );
}
const writeReport = (report) => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/verification-ci-browser.json', JSON.stringify(report, null, 2) + '\n');
};
const readFullReport = () => {
  try {
    return JSON.parse(readFileSync('artifacts/browser-suite/all.json', 'utf8'));
  } catch {
    return null;
  }
};
export async function runCIBrowser(options = {}) {
  const report = { status: 'running', qualification: 'NOT_EVALUATED' };
  const write = () => (options.writeReport ?? writeReport)(report);
  let source,
    scope,
    comparisonIdentity,
    checks,
    route,
    previousRun,
    suiteStarted = false;
  write();
  try {
    const {
      sourceIdentity,
      affectedBrowserChecks,
      browserChecks,
      verifyBrowserSuite,
      mergeChanges,
      mergeSelection,
    } = await (options.loadServices ?? loadServices)();
    source = sourceIdentity();
    const event =
      options.event ??
      (process.env.GITHUB_EVENT_PATH
        ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
        : {});
    route = ciBrowserScope(options.eventName ?? process.env.GITHUB_EVENT_NAME, event, options.git);
    checks = browserChecks();
    const inputs = route.changes ?? route.comparison;
    const scopeIdentity = (changes) => ({
      refs: changes.refs,
      scopeKind: changes.scopeKind,
      files: changes.files,
      reviewOnlyFiles: changes.reviewOnlyFiles,
      metadataOnlyFiles: changes.metadataOnlyFiles,
    });
    let selection;
    if (inputs) {
      const changes = mergeChanges(inputs);
      scope = scopeIdentity(changes);
      selection = {
        ...mergeSelection({
          checks,
          selection: affectedBrowserChecks(
            changes.files.filter((path) => !changes.metadataOnlyFiles?.includes(path)),
          ),
          files: changes.files,
          reviewOnlyFiles: changes.reviewOnlyFiles,
          metadataOnlyFiles: changes.metadataOnlyFiles,
        }),
        source,
        scope,
      };
      comparisonIdentity = { scope, selection: selection.checks.map((check) => check.id) };
    }
    const assertStable = () => {
      if (
        JSON.stringify(sourceIdentity()) !== JSON.stringify(source) ||
        (inputs && JSON.stringify(scopeIdentity(mergeChanges(inputs))) !== JSON.stringify(scope))
      )
        throw Error('CI browser source or scope changed');
    };
    Object.assign(report, { source, route, selection });
    assertStable();
    write();
    previousRun = readFullReport()?.runId;
    suiteStarted = true;
    await verifyBrowserSuite(
      route.mode === 'merge' ? selection.checks.map((check) => check.id) : 'all',
      {
        selection:
          route.mode === 'merge' ? selection : { source, mergeComparison: comparisonIdentity },
      },
    );
    assertStable();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.message;
    throw error;
  } finally {
    if (route?.mode === 'all') {
      let full = suiteStarted ? readFullReport() : null;
      if (full?.runId === previousRun) full = null;
      report.comparison = compareMergeCoverage({
        full,
        source,
        scope,
        selection: comparisonIdentity?.selection,
        checks: checks ?? [],
      });
    }
    write();
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runCIBrowser().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
