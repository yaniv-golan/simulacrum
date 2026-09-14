import {
  readBrowserHistory,
  writeBrowserHistory,
  returnBrowserHistory,
  browserHistoryRunId,
} from './browser-history.mjs';
import { mergeChanges } from './merge-selection.mjs';
import { parseCompletionArgs } from './verification-tiers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  captureCandidate,
  candidateMatchesOrigin,
  destinationStillMatches,
  currentBranch,
} from './candidate.mjs';
import { assertRuntime } from './runtime-preflight.mjs';
import { assertVerificationReady } from './verification-preparation.mjs';
import {
  dependencyDigest,
  writeResumeDescriptor,
  readResumeDescriptor,
} from './candidate-resume.mjs';
import {
  acquireCandidateAttempt,
  releaseCandidateAttempt,
  requireAttemptReport,
} from './candidate-attempt.mjs';
import { createTiming } from './verification-timing.mjs';
import { runProcess } from './run-check.mjs';
import {
  parseAfterArgs,
  classifyParentLeaves,
  validateCauses,
  reexecutionSet,
  reusableLeaf,
  afterMode,
  afterSummary,
  validateAfterReport,
} from './candidate-after.mjs';
import { environmentForensics, processIdentity } from './verification-environment.mjs';
const origin = process.cwd(),
  originBranch = currentBranch(origin),
  started = performance.now();
const report = {
  status: 'running',
  qualification: 'NOT_EVALUATED',
  startedAt: new Date().toISOString(),
};
const output = 'artifacts/verification-candidate.json';
let attemptOutput, lock;
const write = () => {
  report.elapsedMs = performance.now() - started;
  mkdirSync('artifacts', { recursive: true });
  const text = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(output, text);
  if (attemptOutput) writeFileSync(attemptOutput, text);
};
const timing = createTiming({
  publish: () => {
    report.timings = timing.snapshot();
    write();
  },
});
// Read selected prior report before overwriting the ordinary latest pointer.
let argv = process.argv.slice(2),
  previous,
  retry = null;
try {
  // Argument errors must still publish a failed report rather than leave a stale green one.
  const afterArgs = parseAfterArgs(argv);
  argv = afterArgs.rest;
  previous =
    argv[0] === 'resume' && argv.length === 2 ? JSON.parse(readFileSync(argv[1], 'utf8')) : null;
  if (afterArgs.after) {
    // A diagnosed retry: every non-pass leaf of the parent needs a cause before anything runs.
    const parent = JSON.parse(readFileSync(afterArgs.after, 'utf8'));
    const classification = classifyParentLeaves(parent);
    const coverage = validateCauses(classification, afterArgs.causes);
    retry = { parent, classification, coverage, causes: afterArgs.causes };
    report.after = { parentAttempt: parent.attempt, causes: Object.fromEntries(afterArgs.causes) };
  }
  write();
  assertRuntime();
  let directory, candidate, options, tier, key, installed, installedAt;
  if (retry) {
    [tier] = argv;
    options = parseCompletionArgs(tier, argv.slice(1));
    if (options.changedFiles) throw Error('--changed-files is supplied by --after, not by hand');
    const { parent } = retry;
    const parentDirectory = resolve(parent.directory);
    const identity = processIdentity(),
      parentIdentity = parent.verification;
    const sameIdentity = ['runtime', 'platform', 'arch', 'environmentDigest'].every(
      (k) => identity[k] === parentIdentity?.[k],
    );
    const sameSource = await candidateMatchesOrigin(origin, parent.candidate);
    let sameDependencies = false;
    try {
      sameDependencies =
        sameSource &&
        dependencyDigest(join(parentDirectory, 'source')) === parent.installedDependencies;
    } catch {
      sameDependencies = false;
    }
    retry.mode = afterMode({ sameSource, sameDependencies, sameIdentity });
    report.after.mode = retry.mode;
    report.after.sameBytes = { sameSource, sameDependencies, sameIdentity };
    report.after.environment = environmentForensics();
    if (parent.tier !== tier) throw Error('--after tier differs from the parent attempt tier');
    if (tier === 'merge') {
      const scope = mergeChanges(options);
      options.base = scope.refs.base;
      if (options.incoming) {
        options.incoming = scope.refs.incoming;
        options.destination = scope.refs.destination;
        options.destinationName = scope.refs.destinationName;
      }
    }
    if (retry.mode === 'same-bytes') {
      directory = parentDirectory;
      key = readFileSync(join(directory, 'resume-key'));
      const descriptor = readResumeDescriptor(directory, key);
      ({ candidate, installed, installedAt } = descriptor);
      if (descriptor.tier !== tier)
        throw Error('--after tier differs from the parent attempt tier');
      // The frozen clone was captured for one scope; a retry may not change it.
      for (const key of ['base', 'incoming', 'destination'])
        if ((descriptor.options?.[key] ?? null) !== (options[key] ?? null))
          throw Error(`--after must repeat the parent attempt's --${key}`);
      if (!(await candidateMatchesOrigin(candidate.destination, candidate)))
        throw Error('parent candidate bytes changed');
      if (resolve(candidate.destination) !== join(directory, 'source'))
        throw Error('candidate location mismatch');
      report.parentAttempt = parent.attempt;
      await timing.measure('preflight', () => assertVerificationReady(candidate.destination));
      if (
        (await timing.measure('dependency-validation', () =>
          dependencyDigest(candidate.destination),
        )) !== installed
      )
        throw Error('parent installed dependencies changed');
    } else {
      await timing.measure('preflight', () => assertVerificationReady(origin));
      directory = mkdtempSync(join(tmpdir(), 'simulacrum-candidate-'));
      report.directory = directory;
      write();
      candidate = await timing.measure('capture', () =>
        captureCandidate(origin, join(directory, 'source'), { base: options.base }),
      );
      report.candidate = candidate;
      // The byte delta between the two captured candidates drives selection under the tier's policy.
      const before = parent.candidate?.files ?? {},
        after = candidate.files ?? {};
      const delta = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(
          (path) =>
            before[path]?.sha256 !== after[path]?.sha256 ||
            before[path]?.mode !== after[path]?.mode,
        )
        .sort();
      report.after.delta = delta;
      // Only local and merge select by file list; final always runs its full coverage.
      if (tier !== 'final') options.changedFiles = delta;
      write();
      await timing.measure('install', () =>
        runProcess('npm', ['ci', '--prefer-offline'], {
          cwd: candidate.destination,
          timeoutMs: 300000,
          inheritOutput: true,
        }),
      );
      for (const path of ['.vite-temp', '.cache/prettier'])
        mkdirSync(join(candidate.destination, 'node_modules', path), { recursive: true });
      installed = await timing.measure('dependency-validation', () =>
        dependencyDigest(candidate.destination),
      );
      // Retained in the descriptor so a resume reproduces the same tier environment.
      installedAt = new Date().toISOString();
      key = randomBytes(32);
      writeFileSync(join(directory, 'resume-key'), key, { mode: 0o600, flag: 'wx' });
      writeResumeDescriptor(directory, { candidate, options, tier, installed, installedAt }, key);
    }
  } else if (previous) {
    directory = resolve(previous.directory);
    key = readFileSync(join(directory, 'resume-key'));
    const descriptor = readResumeDescriptor(directory, key);
    ({ candidate, options, tier, installed, installedAt } = descriptor);
    if (resolve(candidate.destination) !== join(directory, 'source'))
      throw Error('candidate location mismatch');
    report.parentAttempt = previous.attempt;
    if (!/^[\da-f-]{36}$/.test(previous.attempt ?? '')) throw Error('invalid parent attempt');
    if (!(await candidateMatchesOrigin(candidate.destination, candidate)))
      throw Error('resume source/index changed');
    await timing.measure('preflight', () => assertVerificationReady(candidate.destination));
    if (
      (await timing.measure('dependency-validation', () =>
        dependencyDigest(candidate.destination),
      )) !== installed
    )
      throw Error('resume installed dependencies changed');
  } else {
    [tier] = argv;
    options = parseCompletionArgs(tier, argv.slice(1));
    if (tier === 'merge') {
      const scope = mergeChanges(options);
      options.base = scope.refs.base;
      if (options.incoming) {
        options.incoming = scope.refs.incoming;
        options.destination = scope.refs.destination;
        options.destinationName = scope.refs.destinationName;
      }
    }
    await timing.measure('preflight', () => assertVerificationReady(origin));
    directory = mkdtempSync(join(tmpdir(), 'simulacrum-candidate-'));
    report.directory = directory;
    write();
    candidate = await timing.measure('capture', () =>
      captureCandidate(origin, join(directory, 'source'), { base: options.base }),
    );
    report.candidate = candidate;
    write();
    await timing.measure('install', () =>
      runProcess('npm', ['ci', '--prefer-offline'], {
        cwd: candidate.destination,
        timeoutMs: 300000,
        inheritOutput: true,
      }),
    );
    // Vite and Prettier create these empty scratch directories during normal checks.
    // Admit them before freezing; their contents remain fully fingerprinted.
    for (const path of ['.vite-temp', '.cache/prettier'])
      mkdirSync(join(candidate.destination, 'node_modules', path), { recursive: true });
    installed = await timing.measure('dependency-validation', () =>
      dependencyDigest(candidate.destination),
    );
    // Retained in the descriptor so a resume reproduces the same tier environment.
    installedAt = new Date().toISOString();
    key = randomBytes(32);
    writeFileSync(join(directory, 'resume-key'), key, { mode: 0o600, flag: 'wx' });
    writeResumeDescriptor(directory, { candidate, options, tier, installed, installedAt }, key);
  }
  lock = acquireCandidateAttempt(directory);
  const attempt = lock.attempt;
  const attemptDirectory = join(directory, 'attempts', attempt);
  mkdirSync(attemptDirectory, { recursive: true, mode: 0o700 });
  attemptOutput = join(attemptDirectory, 'report.json');
  const ledger = join(attemptDirectory, 'ledger.json');
  const manifest = retry
    ? JSON.parse(readFileSync(join(candidate.destination, 'scripts/manifest.json'), 'utf8'))
    : null;
  if (retry) {
    retry.reexecute = reexecutionSet({ classification: retry.classification, manifest });
    retry.reuse =
      retry.mode === 'same-bytes'
        ? retry.classification.passing
            .map((r) => r.id)
            .filter((id) => !retry.reexecute.has(id) && reusableLeaf(id, manifest))
        : [];
  }
  writeFileSync(
    ledger,
    JSON.stringify({
      key: key.toString('hex'),
      output: join(attemptDirectory, 'leaves'),
      previous: previous
        ? join(directory, 'attempts', previous.attempt, 'leaves')
        : retry?.mode === 'same-bytes'
          ? join(directory, 'attempts', retry.parent.attempt, 'leaves')
          : null,
      ...(retry?.mode === 'same-bytes' ? { reuse: retry.reuse } : {}),
      origin: { attempt, report: attemptOutput },
    }),
    { mode: 0o600 },
  );
  Object.assign(report, {
    directory,
    candidate,
    priority: options,
    tier,
    attempt,
    attemptReport: attemptOutput,
    installedDependencies: installed,
    ...(installedAt ? { installedAt } : {}),
  });
  write();
  // Copy scheduling hints as artifacts only; no prior report or receipt is admitted.
  const historyPath = 'artifacts/browser-suite/scheduling-history.json';
  const originHistory = join(origin, historyPath),
    candidateHistory = join(candidate.destination, historyPath);
  try {
    writeBrowserHistory(
      candidateHistory,
      [...readBrowserHistory(originHistory).values()].map((row) => ({
        ...row,
        observedAt: row.observedAt ?? 1,
      })),
    );
  } catch (error) {
    report.historyWarning = error.message;
  }
  const candidateBrowserReport = join(
    candidate.destination,
    'artifacts/browser-suite/last-run.json',
  );
  const previousBrowserRun = browserHistoryRunId(candidateBrowserReport);
  let result;
  try {
    result = await timing.measure('tier-including-window', () =>
      runProcess(
        process.execPath,
        [
          'scripts/verification-window.mjs',
          `scripts/verify-${tier}.mjs`,
          ...(['local', 'merge'].includes(tier) ? ['--base', candidate.base] : []),
          ...(tier === 'merge' && options.incoming
            ? ['--incoming', options.incoming, '--destination', options.destination]
            : []),
          ...(options.priorityFiles.length ? ['--priority-files', ...options.priorityFiles] : []),
          ...(options.changedFiles ? ['--changed-files', ...options.changedFiles] : []),
        ],
        {
          cwd: candidate.destination,
          timeoutMs: 3600000,
          inheritOutput: true,
          env: {
            ...process.env,
            SIMULACRUM_LEAF_LEDGER: ledger,
            SIMULACRUM_VERIFICATION_ATTEMPT: attempt,
            ...(installedAt ? { SIMULACRUM_CANDIDATE_INSTALLED_AT: installedAt } : {}),
            // Published to window contenders so a competing integration can stack
            // instead of racing; origin is the integrating worktree, not the candidate.
            SIMULACRUM_VERIFICATION_INTENT: JSON.stringify({
              script: `verify-${tier}.mjs`,
              tier,
              origin,
              ...(originBranch ? { head: originBranch } : {}),
              ...(candidate.base ? { base: candidate.base } : {}),
              ...(tier === 'merge' && options.incoming
                ? {
                    incoming: options.incoming,
                    destination: options.destination,
                    destinationName: options.destinationName ?? options.destination,
                  }
                : {}),
            }),
            SIMULACRUM_VITE_CACHE_DIR: join(directory, 'cache', 'vite'),
            MINIFLARE_CACHE_DIR: join(directory, 'cache', 'miniflare'),
          },
        },
      ),
    );
  } catch (error) {
    result = error;
  }
  try {
    returnBrowserHistory(originHistory, candidateBrowserReport, previousBrowserRun);
  } catch (error) {
    report.historyWarning = error.message;
  }
  report.verification = JSON.parse(
    readFileSync(join(candidate.destination, `artifacts/verification-${tier}.json`), 'utf8'),
  );
  requireAttemptReport(report.verification, attempt);
  const windows = join(candidate.destination, 'artifacts/verification-windows');
  report.windowReports = readdirSync(windows)
    .map((f) => ({
      path: join(windows, f),
      value: JSON.parse(readFileSync(join(windows, f), 'utf8')),
    }))
    .filter((r) => r.value.startedAt >= report.startedAt);
  report.suiteReports = [
    ...new Set(
      (report.verification.results ?? []).flatMap((r) =>
        Array.isArray(r.result)
          ? r.result.map((x) => x.evidenceOrigin?.reportPath).filter(Boolean)
          : [],
      ),
    ),
  ];
  if (!(await candidateMatchesOrigin(candidate.destination, candidate)))
    throw Error('Candidate changed during verification');
  if (dependencyDigest(candidate.destination) !== installed)
    throw Error('Installed dependencies changed during verification');
  report.originStillMatches = await candidateMatchesOrigin(origin, candidate);
  // A named destination that moved makes this evidence stale for that integration.
  report.destinationStillMatches =
    tier === 'merge' && options.incoming
      ? destinationStillMatches(origin, {
          destination: options.destination,
          destinationName: options.destinationName,
        })
      : 'NOT_EVALUATED';
  report.status = report.verification.status;
  if (retry) {
    // Δ-skipped leaves are reasoning under the tier's policy, never receipts; name them.
    const skippedByDelta =
      retry.mode === 'delta'
        ? retry.classification.passing
            .filter(
              (r) =>
                r.id.startsWith('browser:') &&
                reusableLeaf(r.id, manifest) &&
                !report.verification.checks.some((x) => x.id === r.id),
            )
            .map((r) => ({ id: r.id, parentAttempt: retry.parent.attempt }))
        : [];
    const summary = afterSummary({
      parent: retry.parent,
      mode: retry.mode,
      causes: retry.causes,
      coverage: retry.coverage,
      reexecute: retry.reexecute,
      child: report.verification,
      skippedByDelta,
    });
    report.status = summary.status;
    report.after = { ...report.after, ...summary.after };
    validateAfterReport(report);
  }
  report.qualification = report.verification.outcome?.qualification ?? 'NOT_EVALUATED';
  process.exitCode = [0, 2].includes(result.code) ? result.code : 1;
} catch (error) {
  report.status = 'failed';
  report.qualification = 'NOT_EVALUATED';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (lock) {
    try {
      releaseCandidateAttempt(lock);
    } catch (error) {
      report.status = 'failed';
      report.qualification = 'NOT_EVALUATED';
      report.error = error.message;
      process.exitCode = 1;
    }
  }
  write();
  console.log(
    JSON.stringify({
      status: report.status,
      directory: report.directory,
      attemptReport: report.attemptReport,
      originStillMatches: report.originStillMatches,
      destinationStillMatches: report.destinationStillMatches,
      elapsedMs: report.elapsedMs,
    }),
  );
}
