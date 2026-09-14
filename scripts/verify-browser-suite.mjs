import { loadavg, cpus, getPriority } from 'node:os';
import { readBrowserHistory, writeBrowserHistory } from './browser-history.mjs';
import { createTiming } from './verification-timing.mjs';
import { affectedBrowserChecks, prioritizeBrowserChecks } from './browser-selection.mjs';
import { assertLocalServerAccess, assertUnnicedLaunch } from './runtime-preflight.mjs';
import { build, preview, createServer } from 'vite';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';
import { selectChecks, validateBrowserCoverage, parseBrowserArgs } from './browser-registry.mjs';
import { runProcess } from './run-check.mjs';
import { systemBrowserVersion } from './verification-environment.mjs';
import { checkBreadth } from './check-breadth.mjs';
import {
  createVerificationContext,
  initializeVerificationEnvironment,
} from './verification-run.mjs';
import {
  runCheckSequence,
  planBrowserPhases,
  admitQuietHost,
  tierWorkers,
} from './check-sequence.mjs';
import { errorMessages, withCleanup } from './verification-cleanup.mjs';
/** What a browser receipt is bound to: the registered row, not the run. The worker count is a
 * scheduling condition recorded on the row (measurementConditions), never part of identity, or
 * a parent's receipts would never match a child scheduled with a different pool size. A system
 * browser channel is not pinned by installed dependencies; its version is part of that check's
 * configuration so a browser update refuses reuse of this receipt and nothing else. */
export function browserReceiptConfiguration(check) {
  return {
    script: check.script,
    timeoutMs: check.timeoutMs,
    environment: check.environment ?? 'workshop',
    execution: check.execution ?? 'exclusive',
    ...(check.browserChannel
      ? {
          browserChannel: check.browserChannel,
          browserVersion: systemBrowserVersion(check.browserChannel),
        }
      : {}),
  };
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
  const historyPath = options.historyPath ?? `${directory}/scheduling-history.json`;
  const history = readBrowserHistory(historyPath);
  for (const [id, row] of readBrowserHistory(`${directory}/last-run.json`))
    if (!history.has(id)) history.set(id, row);
  const previousFailures = [...history.values()]
    .filter((row) => row.ok === false)
    .map((row) => row.id);
  const durations = Object.fromEntries(
    [...history.values()]
      .filter((row) => row.ok && row.elapsedMs > 0)
      .map((row) => [row.id, row.elapsedMs]),
  );
  const report = {
    previousFailures,
    durations,
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
      writeBrowserHistory(
        historyPath,
        report.runs.filter((row) => !row.reused && row.status !== 'not evaluated'),
      );
    } catch (error) {
      report.historyWarning = `Scheduling hints could not be saved: ${error.message}`;
    }
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
function findRunnerError(error, depth = 0) {
  if (!error || depth > 4) return null;
  if (error.processDiagnostics) return error;
  for (const cause of error.errors ?? []) {
    const found = findRunnerError(cause, depth + 1);
    if (found) return found;
  }
  return null;
}
const installedAt = Date.parse(process.env.SIMULACRUM_CANDIDATE_INSTALLED_AT ?? '') || null;
/** What the application announced when a check failed: every browser session's
 * status sidecar under the evidence directory (sessions are named by script or option). */
function readAppStatus(directory) {
  if (!directory || !existsSync(directory)) return [];
  const status = [];
  try {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true }))
      if (entry.isFile() && entry.name === 'failure-status.json')
        try {
          const rows = JSON.parse(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
          if (Array.isArray(rows))
            for (const row of rows) if (typeof row === 'string') status.push(row);
        } catch {
          status.push(`unreadable ${entry.name}`);
        }
  } catch {
    return status;
  }
  return [...new Set(status)].slice(0, 16);
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
    failFast = false,
    context,
    workers,
    selection = null,
    priorityFiles = [],
    priorityProvenance,
    seed = process.env.SIMULACRUM_BROWSER_SCHEDULE_SEED ?? 'tier',
    host = { cores: cpus().length, load1: () => loadavg()[0], priority: () => getPriority() },
  },
  report,
  publish,
) {
  if (failFast && (context || !Array.isArray(mode)))
    throw Error('fail-fast is restricted to explicit development probes');
  report.failFast = failFast;
  report.phase = 'selection';
  // A tier (a run with a verification context) takes one worker per two idle cores, at most
  // four, measured at start; a run without a tier context — the hosted CI route, witnesses —
  // keeps today's two workers and, below, today's unconditional timing execution. An explicit
  // worker count above two remains a probe privilege.
  const tierContext = Boolean(context); // a default context is created below for the run
  const derived = workers === undefined && tierContext;
  const load1AtStart = host.load1();
  if (derived) workers = tierWorkers({ cores: host.cores, load1: load1AtStart });
  else if (workers === undefined) workers = 2;
  const niceness = host.priority?.() ?? null;
  // Derived workers assume the host's ordinary priority; a niced tier loses to every other
  // process regardless of idle cores, so the derivation would mean nothing.
  if (derived) assertUnnicedLaunch({ priority: niceness ?? 0 });
  report.workersBasis = derived
    ? { cores: host.cores, load1: load1AtStart, niceness, derived: true }
    : { explicit: workers, load1: load1AtStart, niceness, derived: false };
  report.workers = workers;
  if (![1, 2, 3, 4].includes(workers)) throw Error('browser workers must be 1 to 4');
  if (!derived && workers > 2 && (context || !Array.isArray(mode)))
    throw Error('more than two workers requires explicit development probes');
  context ??= createVerificationContext();
  if (selection && JSON.stringify(selection.source) !== JSON.stringify(sourceIdentity()))
    throw Error('browser selection does not match current source');
  const checks = selectChecks(mode),
    source = sourceIdentity();
  const priority = prioritizeBrowserChecks(
    checks,
    priorityFiles.length ? priorityFiles : (selection?.files ?? []),
    priorityFiles.length ? priorityProvenance : 'captured changed files',
  );
  const failed = new Set(report.previousFailures ?? []);
  priority.checks = [
    ...priority.checks.filter((check) => failed.has(check.id)),
    ...priority.checks.filter((check) => !failed.has(check.id)),
  ];
  priority.reasons.push(
    ...checks
      .filter((check) => failed.has(check.id))
      .map((check) => ({
        id: check.id,
        reason: 'previous failed browser check; ordering hint only',
      })),
  );
  report.priority = { ...priority, checks: priority.checks.map((c) => c.id) };
  const priorityCount = new Set(priority.reasons.map((row) => row.id)).size;
  const plan = planBrowserPhases(priority.checks, {
    durations: report.durations,
    priorityIds: priority.reasons.map((row) => row.id),
    seed,
  });
  const scheduled = plan.order;
  report.schedule = {
    policy:
      'phased: headless pool (longest first, priority as queue order), serialized lane, timing-sensitive last',
    priorityCount,
    workers,
    seed,
    phases: {
      pool: plan.pool.map((c) => c.id),
      lane: plan.lane.map((c) => c.id),
      timing: plan.timing.map((c) => c.id),
    },
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
          if (check.phase === 'timing' && !report.timingAdmission) {
            // Timing-sensitive checks need a quiet host: wait once, bounded; a refusal is a
            // skipped gate, never a pass and never a retry. Only a tier that derived its
            // workers from the host is admitted this way; a run without a tier context (the
            // hosted CI route, witnesses) or with an explicit worker count keeps today's
            // unconditional execution and records that it did.
            const bound = Number(process.env.SIMULACRUM_TIMING_LOAD_BOUND);
            report.timingAdmission = derived
              ? await admitQuietHost({
                  cores: host.cores,
                  ...(Number.isFinite(bound) && bound > 0 ? { bound } : {}),
                  load1: host.load1,
                })
              : {
                  admitted: true,
                  skipped: tierContext ? 'explicit workers' : 'no tier context',
                  load1: host.load1(),
                };
            publish();
          }
          row.measurementConditions = {
            phase: check.phase,
            workers,
            scheduleIndex: scheduled.findIndex((c) => c.id === check.id),
            startedAt: new Date().toISOString(),
            activeBrowserChecks: runs.filter((r) => r.status === 'running').map((r) => r.id),
            hostLoadAverage: loadavg(),
            load1: host.load1(),
            note: 'Schedule and host-load context only; warmup and external contention are not controlled by these observations.',
          };
          if (check.phase === 'timing' && !report.timingAdmission.admitted) {
            const refused = Error(`not evaluated: ${report.timingAdmission.reason}`);
            refused.notEvaluated = true;
            refused.failureKind = 'host-load';
            throw refused;
          }
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
              browserReceiptConfiguration(check),
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
            Object.assign(row, {
              ok: true,
              status: 'passed',
              elapsedMs: result.elapsedMs,
              observedAt: performance.timeOrigin + performance.now(),
            });
            publish();
            console.log(
              `${row.reused ? 'REUSE PASS' : 'PASS'} ${check.id} ${Math.round(result.elapsedMs)}ms — ${row.log}`,
            );
          } catch (error) {
            retainOrigin(error.evidenceOrigin ?? evidenceOrigin);
            // Cleanup or retention failures wrap the runner error, possibly twice;
            // keep the runner's own diagnostics and failure kind.
            const runnerError = findRunnerError(error);
            const diagnostics = runnerError?.processDiagnostics;
            const appStatus = readAppStatus(row.evidenceDirectory);
            Object.assign(row, {
              status: error.notEvaluated ? 'not evaluated' : 'failed',
              ...(error.notEvaluated ? { reason: error.message } : {}),
              ok: false,
              observedAt: performance.timeOrigin + performance.now(),
              elapsedMs: error.elapsedMs,
              errors: errorMessages(error),
              failureKind: error.failureKind ?? runnerError?.failureKind ?? 'unknown',
              checkKind: check.tier,
              processSnapshot: diagnostics?.snapshot ?? null,
              appStatus,
              // H1 signal: how fresh this candidate's installed binaries were at the failure.
              msSinceInstall: installedAt ? Date.now() - installedAt : null,
            });
            publish();
            console.log(
              `${row.reused ? 'REUSE FAIL' : 'FAIL'} ${check.id}: ${error.summary ?? error.message} — ${row.log ?? 'no retained log'}${appStatus.length ? ` — app: ${appStatus.map((text) => text.slice(0, 120)).join(' | ')}` : ''}`,
            );
            throw error;
          }
        },
        () => {
          if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
            throw Error('source changed during browser verification');
        },
        { workers, failFast },
      );
      const failures = outcomes.filter((outcome) => outcome.ok === false);
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
