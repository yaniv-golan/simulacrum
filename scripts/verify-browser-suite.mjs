import { affectedBrowserChecks } from './browser-selection.mjs';
import { assertLocalServerAccess } from './runtime-preflight.mjs';
import { build, preview, createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';
import { selectChecks, validateBrowserCoverage, parseBrowserArgs } from './browser-registry.mjs';
import { runProcess } from './run-check.mjs';
import { checkBreadth } from './check-breadth.mjs';
import {
  createVerificationContext,
  initializeVerificationEnvironment,
} from './verification-run.mjs';
import { runCheckSequence } from './check-sequence.mjs';
// Retain execution and cleanup causes without letting one hide the other.
function errorMessages(error, seen = new Set()) {
  if (seen.has(error)) return [];
  seen.add(error);
  return [
    error?.message ?? String(error),
    ...(error?.errors ?? []).flatMap((e) => errorMessages(e, seen)),
    ...(error?.cause ? errorMessages(error.cause, seen) : []),
  ];
}
async function withCleanup(execute, cleanup) {
  const failures = [];
  let result;
  try {
    result = await execute();
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, failures.flatMap((e) => errorMessages(e)).join('; '));
  return result;
}
const stamp = 'dist/.verification-source.json';
export async function prepareBrowserBuild(context) {
  initializeVerificationEnvironment();
  if (context)
    return context.check('build:browser', { mode: 'production' }, () => prepareBrowserBuild());
  await assertLocalServerAccess();
  const source = sourceIdentity();
  checkBreadth();
  validateBrowserCoverage();
  await build({ logLevel: 'error' });
  if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
    throw Error('source changed during build');
  const identity = { source, app: appFingerprint() };
  writeFileSync(stamp, JSON.stringify(identity));
  return identity;
}
/** Write a fresh non-green attempt before build/server work; failures never leave stale success. */
export async function withBrowserReport(
  mode,
  options,
  execute,
  directory = 'artifacts/browser-suite',
) {
  mkdirSync(directory, { recursive: true });
  const name = typeof mode === 'string' && /^[a-z0-9-]+$/.test(mode) ? mode : 'selected';
  const report = {
    mode,
    workers: options.workers ?? 2,
    selection: options.selection ?? null,
    startedAt: new Date().toISOString(),
    status: 'running',
    ok: false,
    runs: [],
  };
  const write = () => {
    const bytes = JSON.stringify(report, null, 2) + '\n';
    writeFileSync(`${directory}/${name}.json`, bytes);
    writeFileSync(`${directory}/last-run.json`, bytes);
  };
  write();
  try {
    const result = await execute(report);
    report.ok = true;
    report.status = 'passed';
    return result;
  } catch (error) {
    report.failure = error?.message ?? String(error);
    report.errors = errorMessages(error);
    report.status = 'failed';
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    write();
  }
}
export async function verifyBrowserSuite(mode = 'all', options = {}) {
  return withBrowserReport(mode, options, (report) => executeBrowserSuite(mode, options, report));
}
async function executeBrowserSuite(
  mode,
  { reuseBuild = false, context, workers = 2, selection = null },
  report,
) {
  context ??= createVerificationContext();
  report.phase = 'selection';
  if (![1, 2].includes(workers)) throw Error('browser workers must be 1 or 2');
  if (selection && JSON.stringify(selection.source) !== JSON.stringify(sourceIdentity()))
    throw Error('browser selection does not match current source');
  const checks = selectChecks(mode),
    source = sourceIdentity();
  report.source = source;
  report.phase = 'build';
  const identity =
    reuseBuild && existsSync(stamp)
      ? JSON.parse(readFileSync(stamp))
      : await prepareBrowserBuild(context);
  if (
    identity.source.workingTreeDigest !== source.workingTreeDigest ||
    identity.app !== appFingerprint()
  )
    throw Error('browser build does not match current source');
  report.build = identity.app;
  report.phase = 'server';
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`,
    runs = report.runs;
  mkdirSync('artifacts/browser-suite', { recursive: true });
  await withCleanup(
    async () => {
      report.phase = 'checks';
      const outcomes = await runCheckSequence(
        checks,
        async (check) => {
          let target = url,
            probe;
          try {
            console.log(`RUN ${check.id}`);
            const result = await context.check(
              `browser:${check.id}`,
              {
                script: check.script,
                timeoutMs: check.timeoutMs,
                environment: check.environment ?? 'workshop',
                workers,
                execution: check.execution ?? 'exclusive',
              },
              () =>
                withCleanup(
                  async () => {
                    if (check.environment === 'probe') {
                      probe = await createServer({
                        server: { host: '127.0.0.1', port: 0 },
                        logLevel: 'error',
                      });
                      if (!probe.httpServer.listening) await probe.listen();
                      target = `http://127.0.0.1:${probe.httpServer.address().port}/test/browser/`;
                    }
                    return runProcess(process.execPath, [check.script, target], {
                      timeoutMs: check.timeoutMs,
                      env: {
                        ...process.env,
                        SIMULACRUM_BROWSER_EXECUTION: check.execution ?? 'exclusive',
                      },
                    });
                  },
                  () => probe?.close(),
                ),
            );
            runs.push({ id: check.id, ok: true, elapsedMs: result.elapsedMs });
            writeFileSync(`artifacts/browser-suite/${check.id}.log`, result.output);
            console.log(`PASS ${check.id} ${Math.round(result.elapsedMs)}ms`);
          } catch (error) {
            runs.push({
              id: check.id,
              ok: false,
              elapsedMs: error.elapsedMs,
              errors: errorMessages(error),
            });
            writeFileSync(
              `artifacts/browser-suite/${check.id}.log`,
              [error.output, ...errorMessages(error)].filter(Boolean).join('\n'),
            );
            console.log(`FAIL ${check.id}: ${error.summary ?? error.message}`);
            throw error;
          }
        },
        () => {
          if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
            throw Error('source changed during browser verification');
        },
        { workers },
      );
      const failures = outcomes.filter((outcome) => !outcome.ok);
      if (failures.length)
        throw new AggregateError(
          failures.map((outcome) => outcome.error),
          `Browser checks failed: ${failures.map((outcome) => outcome.id).join(', ')}`,
        );
    },
    async () => {
      report.runs = checks.flatMap((c) => runs.filter((r) => r.id === c.id));
      report.notRun = checks.filter((c) => !runs.some((r) => r.id === c.id)).map((c) => c.id);
      await new Promise((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  );
  return checks.flatMap((c) => runs.filter((r) => r.id === c.id));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const discover = () => {
    initializeVerificationEnvironment();
    const options = parseBrowserArgs(args);
    const selection = options.files ? affectedBrowserChecks(options.files) : null;
    return {
      options,
      selection,
      mode: selection ? selection.checks.map((c) => c.id) : options.mode,
    };
  };
  if (args.includes('--summary')) {
    const { selection, mode } = discover();
    console.log(
      JSON.stringify(selection ?? { checks: selectChecks(mode), executed: false }, null, 2),
    );
  } else {
    // Admission may fail before mode is known. The attempted selector still names
    // its non-green report, and last-run always points to this execution attempt.
    const requested = args[0]?.startsWith('-') ? 'selected' : (args[0] ?? 'all');
    await withBrowserReport(requested, {}, async (report) => {
      report.phase = 'admission';
      const { options, selection, mode } = discover();
      Object.assign(report, { mode, workers: options.workers, selection });
      if (selection && !mode.length) {
        report.skipped = 'No affected browser checks. Qualification not evaluated.';
        console.log(report.skipped);
        return [];
      }
      return executeBrowserSuite(mode, { ...options, selection }, report);
    });
  }
}
