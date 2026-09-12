import { createTiming } from './verification-timing.mjs';
import { affectedBrowserChecks, prioritizeBrowserChecks } from './browser-selection.mjs';
import { assertLocalServerAccess } from './runtime-preflight.mjs';
import { build, preview, createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
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
import { runCheckSequence, packParallelChecks } from './check-sequence.mjs';
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
  const runId = randomUUID();
  const attempt = resolve(directory, 'runs', runId);
  mkdirSync(attempt, { recursive: true });
  const report = {
    runId,
    directory: attempt,
    reportPath: join(attempt, 'report.json'),
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
    for (const path of [
      report.reportPath,
      `${directory}/${name}.json`,
      `${directory}/last-run.json`,
    ]) {
      const temporary = `${path}.${runId}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, path);
    }
  };
  write();
  try {
    const result = await execute(report, write);
    report.ok = true;
    report.status = 'passed';
    return result;
  } catch (error) {
    report.failure = error?.message ?? String(error);
    report.errors = errorMessages(error);
    report.status = 'failed';
    throw error;
  } finally {
    for (const row of report.runs)
      if (row.status === 'queued' || row.status === 'running') {
        row.status = 'not evaluated';
        row.reason = report.failure ?? 'Execution interrupted';
      }
    report.finishedAt = new Date().toISOString();
    try {
      write();
    } catch (error) {
      report.ok = false;
      report.status = 'failed';
      report.errors = [...(report.errors ?? []), ...errorMessages(error)];
      report.failure = `Report publication failed: ${error.message}`;
      // Retire any already-published success. Persistent storage failure still
      // rejects execution; no filesystem can guarantee writing to failed media.
      const bytes = JSON.stringify(report, null, 2) + '\n';
      for (const path of [
        report.reportPath,
        `${directory}/${name}.json`,
        `${directory}/last-run.json`,
      ]) {
        try {
          const temporary = `${path}.${runId}.tmp`;
          writeFileSync(temporary, bytes);
          renameSync(temporary, path);
        } catch (repair) {
          console.error(`Could not retire report ${path}: ${repair.message}`);
        }
      }
      throw error;
    }
  }
}
export async function verifyBrowserSuite(mode = 'all', options = {}) {
  return withBrowserReport(mode, options, (report, publish) =>
    executeBrowserSuite(mode, options, report, publish),
  );
}
async function executeBrowserSuite(
  mode,
  {
    reuseBuild = false,
    context,
    workers = 2,
    selection = null,
    priorityFiles = [],
    priorityProvenance,
  },
  report,
  publish,
) {
  context ??= createVerificationContext();
  report.phase = 'selection';
  if (![1, 2].includes(workers)) throw Error('browser workers must be 1 or 2');
  if (selection && JSON.stringify(selection.source) !== JSON.stringify(sourceIdentity()))
    throw Error('browser selection does not match current source');
  const checks = selectChecks(mode),
    source = sourceIdentity();
  const priority = prioritizeBrowserChecks(checks, priorityFiles, priorityProvenance);
  report.priority = { ...priority, checks: priority.checks.map((c) => c.id) };
  const priorityCount = new Set(priority.reasons.map((row) => row.id)).size;
  const scheduled = packParallelChecks(priority.checks, { workers, priorityCount });
  report.schedule = {
    policy: workers === 1 ? 'original order' : 'undersized admitted parallel packing',
    priorityCount,
    maxNewCombinedGroupSize: workers === 1 ? 0 : 4,
    checks: scheduled.map((check) => check.id),
  };
  report.source = source;
  report.runs = checks.map((check) => ({ id: check.id, status: 'queued' }));
  const timing = createTiming({
    publish: () => {
      report.timings = timing.snapshot();
      publish();
    },
  });
  report.phase = 'build';
  publish();
  const identity =
    reuseBuild && existsSync(stamp)
      ? JSON.parse(readFileSync(stamp))
      : await timing.measure('build', () => prepareBrowserBuild(context));
  if (
    identity.source.workingTreeDigest !== source.workingTreeDigest ||
    identity.app !== appFingerprint()
  )
    throw Error('browser build does not match current source');
  report.build = identity.app;
  report.phase = 'server';
  publish();
  let server;
  const runs = report.runs;
  await withCleanup(
    async () => {
      await timing.measure('server-start', async () => {
        server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
      });
      const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
      mkdirSync('artifacts/browser-suite', { recursive: true });
      report.phase = 'checks';
      const outcomes = await runCheckSequence(
        scheduled,
        async (check) => {
          const row = runs.find((row) => row.id === check.id);
          row.status = 'running';
          publish();
          let target = url,
            probe,
            evidenceOrigin;
          const retainOrigin = (origin) => {
            if (!origin) return;
            evidenceOrigin = origin;
            Object.assign(row, {
              evidenceOrigin: origin,
              evidenceDirectory: origin.evidenceDirectory,
              log: origin.log,
              reused: origin.runId !== report.runId,
            });
          };
          try {
            const result = await context.check(
              `browser:${check.id}`,
              {
                script: check.script,
                timeoutMs: check.timeoutMs,
                environment: check.environment ?? 'workshop',
                workers,
                execution: check.execution ?? 'exclusive',
              },
              async () => {
                const origin = {
                  runId: report.runId,
                  reportPath: report.reportPath,
                  evidenceDirectory: join(report.directory, check.id),
                  log: join(report.directory, `${check.id}.log`),
                };
                retainOrigin(origin);
                let completedProcess;
                try {
                  mkdirSync(origin.evidenceDirectory, { recursive: true });
                  publish();
                  console.log(`RUN ${check.id}`);
                  const result = await withCleanup(
                    async () => {
                      if (check.environment === 'probe') {
                        probe = await createServer({
                          server: { host: '127.0.0.1', port: 0 },
                          logLevel: 'error',
                        });
                        if (!probe.httpServer.listening) await probe.listen();
                        target = `http://127.0.0.1:${probe.httpServer.address().port}/test/browser/`;
                      }
                      return (completedProcess = await runProcess(
                        process.execPath,
                        [check.script, target],
                        {
                          timeoutMs: check.timeoutMs,
                          env: {
                            ...process.env,
                            SIMULACRUM_BROWSER_ARTIFACT_ROOT: origin.evidenceDirectory,
                            SIMULACRUM_BROWSER_EXECUTION: check.execution ?? 'exclusive',
                          },
                        },
                      ));
                    },
                    () => probe?.close(),
                  );
                  writeFileSync(origin.log, result.output);
                  return { ...result, evidenceOrigin: origin };
                } catch (error) {
                  error.evidenceOrigin = origin;
                  try {
                    writeFileSync(
                      origin.log,
                      [error.output ?? completedProcess?.output, ...errorMessages(error)]
                        .filter(Boolean)
                        .join('\n'),
                    );
                  } catch (retention) {
                    const combined = new AggregateError(
                      [error, retention],
                      'Browser execution or log retention failed',
                    );
                    combined.evidenceOrigin = origin;
                    throw combined;
                  }
                  throw error;
                }
              },
            );
            retainOrigin(result.evidenceOrigin);
            if (!evidenceOrigin || !existsSync(row.log) || !existsSync(row.evidenceDirectory))
              throw Error('Retained browser evidence is missing');
            Object.assign(row, { ok: true, status: 'passed', elapsedMs: result.elapsedMs });
            publish();
            console.log(
              `${row.reused ? 'REUSE PASS' : 'PASS'} ${check.id} ${Math.round(result.elapsedMs)}ms — ${row.log}`,
            );
          } catch (error) {
            retainOrigin(error.evidenceOrigin ?? evidenceOrigin);
            Object.assign(row, {
              status: 'failed',
              ok: false,
              elapsedMs: error.elapsedMs,
              errors: errorMessages(error),
              failureKind: error.failureKind ?? 'unknown',
              checkKind: check.tier,
              measurementConditions:
                'Not inferred from a failure; inspect retained benchmark controls and verification-window report.',
            });
            publish();
            console.log(
              `${row.reused ? 'REUSE FAIL' : 'FAIL'} ${check.id}: ${error.summary ?? error.message} — ${row.log ?? 'no retained log'}`,
            );
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
      report.notRun = checks
        .filter((c) => !runs.some((r) => r.id === c.id && typeof r.ok === 'boolean'))
        .map((c) => c.id);
      if (!server) return;
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
    await withBrowserReport(requested, {}, async (report, publish) => {
      report.phase = 'admission';
      const { options, selection, mode } = discover();
      Object.assign(report, { mode, workers: options.workers, selection });
      if (selection && !mode.length) {
        report.skipped = 'No affected browser checks. Qualification not evaluated.';
        console.log(report.skipped);
        return [];
      }
      return executeBrowserSuite(mode, { ...options, selection }, report, publish);
    });
  }
}
