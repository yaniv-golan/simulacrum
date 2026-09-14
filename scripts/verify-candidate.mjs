import {
  readBrowserHistory,
  writeBrowserHistory,
  returnBrowserHistory,
  browserHistoryRunId,
} from './browser-history.mjs';
import { mergeChanges } from './merge-selection.mjs';
import { parseCompletionArgs } from './verification-tiers.mjs';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir, getPriority } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  captureCandidate,
  candidateMatchesOrigin,
  destinationStillMatches,
  currentBranch,
  resolveCandidateBase,
} from './candidate.mjs';
import { assertRuntime, assertUnnicedLaunch } from './runtime-preflight.mjs';
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
  requiredReexecution,
  reusableLeaf,
  reuseSet,
  REUSE_TIERS,
  afterMode,
  deltaSelection,
  afterSummary,
  reuseSummary,
  validateAfterReport,
  attestReport,
  verifyAttestation,
} from './candidate-after.mjs';
import { environmentForensics, processIdentity } from './verification-environment.mjs';
/** Spotlight indexes every fresh copy under /var/folders (three mdworker_shared workers per
 * candidate, observed tripping 30 s unit watchdogs); the marker at the candidate root, above
 * `source`, keeps the tree out of the index without entering the candidate's identity. */
const excludeFromIndexing = (root) =>
  writeFileSync(join(root, '.metadata_never_index'), '', { mode: 0o600, flag: 'wx' });
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
// Once the candidate's resume key exists, every published report is attested under it so a
// later --after trusts classification and coverage only from a report this candidate wrote.
let attestKey = null;
const write = () => {
  report.elapsedMs = performance.now() - started;
  mkdirSync('artifacts', { recursive: true });
  if (attestKey) report.attestation = attestReport(report, attestKey);
  else delete report.attestation;
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
  if (previous?.after)
    throw Error(
      'resume cannot continue a diagnosed retry; retry from its report with --after so the chain is kept',
    );
  if (afterArgs.after) {
    // A diagnosed retry: every non-pass leaf of the parent needs a cause before anything runs.
    const parent = JSON.parse(readFileSync(afterArgs.after, 'utf8'));
    // The parent report is trusted only when its own candidate key attests it: the receipts
    // it classifies and the coverage it claims are then this candidate's own record.
    verifyAttestation(parent, () => readFileSync(join(resolve(parent.directory), 'resume-key')));
    // The chain is recorded before anything is validated or run, so a refused or dying retry
    // still carries it; a later --after on this report cannot restart the count.
    report.after = {
      parentAttempt: parent.attempt ?? null,
      causes: Object.fromEntries(afterArgs.causes),
      chain: [...(parent.after?.chain ?? []), parent.attempt ?? null],
    };
    const classification = classifyParentLeaves(parent);
    const coverage = validateCauses(classification, afterArgs.causes);
    retry = { parent, classification, coverage, causes: afterArgs.causes };
    report.after.kind = classification.kind;
    if (classification.kind === 'reuse') {
      // A passed parent offers receipts only from a terminal, owned, current attempt.
      requireAttemptReport(parent.verification, parent.attempt);
      if (
        typeof parent.directory !== 'string' ||
        existsSync(join(parent.directory, 'active-attempt'))
      )
        throw Error(
          'parent candidate has an active attempt; receipts are offered only by a finished one',
        );
    }
  }
  write();
  assertRuntime();
  report.launchNiceness = assertUnnicedLaunch({ priority: getPriority() });
  let directory, candidate, options, tier, key, installed, installedAt;
  if (retry) {
    [tier] = argv;
    options = parseCompletionArgs(tier, argv.slice(1));
    const { parent } = retry,
      reuse = retry.classification.kind === 'reuse';
    const parentDirectory = resolve(parent.directory);
    // The parent's bytes come from its signed descriptor, never from the unsigned report.
    const parentKey = readFileSync(join(parentDirectory, 'resume-key'));
    const parentDescriptor = readResumeDescriptor(parentDirectory, parentKey);
    if (reuse) {
      // Receipts cross tiers (an author's local into a reviewer's merge) but never into final;
      // the child selects its own scope, so the parent's --base/--incoming are not repeated.
      if (!REUSE_TIERS.includes(parentDescriptor.tier) || !REUSE_TIERS.includes(tier))
        throw Error(
          'receipt reuse needs local or merge tiers on both sides; final always executes',
        );
    } else if (parentDescriptor.tier !== tier || parent.tier !== tier)
      throw Error('--after tier differs from the parent attempt tier');
    // The frozen clone was captured for one scope; a retry may not change it. Refs are compared
    // as the commits they name now, so a moved base or destination is refused, not silently
    // re-pinned.
    if (tier === 'merge') {
      const scope = mergeChanges(options);
      options.base = scope.refs.base;
      if (options.incoming) {
        options.incoming = scope.refs.incoming;
        options.destination = scope.refs.destination;
        options.destinationName = scope.refs.destinationName;
      }
    } else options.base = resolveCandidateBase(origin, options.base);
    if (!reuse) {
      if ((parentDescriptor.candidate?.base ?? null) !== options.base)
        throw Error(
          "--after must repeat the parent attempt's --base (the ref now names another commit)",
        );
      for (const key of ['incoming', 'destination'])
        if ((parentDescriptor.options?.[key] ?? null) !== (options[key] ?? null))
          throw Error(`--after must repeat the parent attempt's --${key}`);
    }
    // Identity and installed dependencies are read from the signed descriptor, never the report.
    const identity = processIdentity(),
      parentIdentity = parentDescriptor.identity;
    const sameIdentity =
      !!parentIdentity &&
      ['runtime', 'platform', 'arch', 'environmentDigest'].every(
        (k) => identity[k] === parentIdentity[k],
      );
    const sameSource = await candidateMatchesOrigin(origin, parentDescriptor.candidate);
    let sameDependencies = false;
    try {
      sameDependencies =
        sameSource &&
        dependencyDigest(join(parentDirectory, 'source')) === parentDescriptor.installed;
    } catch {
      sameDependencies = false;
    }
    retry.mode = afterMode({ sameSource, sameDependencies, sameIdentity });
    report.after.mode = retry.mode;
    report.after.sameBytes = { sameSource, sameDependencies, sameIdentity };
    report.after.environment = environmentForensics();
    // A reuse child is its own candidate: fresh capture and install, its own descriptor and key,
    // so a later resume of it reconstructs this tier and scope, not the parent's.
    if (retry.mode === 'same-bytes' && !reuse) {
      directory = parentDirectory;
      key = parentKey;
      attestKey = key;
      ({ candidate, installed, installedAt } = parentDescriptor);
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
      excludeFromIndexing(directory);
      report.directory = directory;
      write();
      candidate = await timing.measure('capture', () =>
        captureCandidate(origin, join(directory, 'source'), { base: options.base }),
      );
      report.candidate = candidate;
      // The byte delta between the two captured candidates drives selection under the tier's
      // policy, but only while identity and dependencies still match; otherwise every parent
      // browser pass is stale and the tier applies its ordinary fresh policy.
      const before = parentDescriptor.candidate?.files ?? {},
        after = candidate.files ?? {};
      const delta = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(
          (path) =>
            before[path]?.sha256 !== after[path]?.sha256 ||
            before[path]?.mode !== after[path]?.mode,
        )
        .sort();
      report.after.delta = delta;
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
      // Whether the delta narrows selection is decided on what was actually installed: the
      // new candidate's dependencies against the parent's, and the identity compared above.
      const sameInstalled = installed === parentDescriptor.installed;
      report.after.sameBytes.sameInstalledDependencies = sameInstalled;
      retry.deltaSelection = deltaSelection({ sameDependencies: sameInstalled, sameIdentity });
      report.after.deltaSelection = retry.deltaSelection;
      retry.changedFiles = retry.deltaSelection === 'source-only' ? delta : null;
      // A reuse child keeps the tier's own selection: a delta only means nothing is reused.
      if (reuse) retry.changedFiles = null;
      write();
      // Retained in the descriptor so a resume reproduces the same tier environment.
      installedAt = new Date().toISOString();
      key = randomBytes(32);
      attestKey = key;
      writeFileSync(join(directory, 'resume-key'), key, { mode: 0o600, flag: 'wx' });
      writeResumeDescriptor(
        directory,
        { candidate, options, tier, installed, installedAt, identity: processIdentity() },
        key,
      );
      if (reuse) {
        // The child's own install decides dependency identity; the parent's tree is not consulted.
        const sameDependencies = sameSource && installed === parentDescriptor.installed;
        retry.mode = afterMode({ sameSource, sameDependencies, sameIdentity });
        report.after.mode = retry.mode;
        report.after.sameBytes = { sameSource, sameDependencies, sameIdentity };
        if (retry.mode === 'same-bytes') {
          retry.previous = join(parentDirectory, 'attempts', parent.attempt, 'leaves');
          retry.previousKey = parentKey.toString('hex');
        }
      }
    }
  } else if (previous) {
    directory = resolve(previous.directory);
    key = readFileSync(join(directory, 'resume-key'));
    attestKey = key;
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
    excludeFromIndexing(directory);
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
    attestKey = key;
    writeFileSync(join(directory, 'resume-key'), key, { mode: 0o600, flag: 'wx' });
    writeResumeDescriptor(
      directory,
      { candidate, options, tier, installed, installedAt, identity: processIdentity() },
      key,
    );
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
  if (retry?.classification.kind === 'reuse') {
    const set = reuseSet({ classification: retry.classification, manifest });
    retry.offered = retry.mode === 'same-bytes' ? set.offered : [];
    // A reuse child never narrows the tier's selection: nothing is required or covered by delta.
    retry.required = new Set();
    retry.covered = [];
    report.after.offered = retry.offered;
  } else if (retry) {
    retry.reexecute = reexecutionSet({ classification: retry.classification, manifest });
    retry.required = requiredReexecution({ classification: retry.classification, manifest });
    // Browser checks the parent chain passed or already skipped on receipts; a source-only delta
    // may skip these when its byte delta does not reach them, and nothing else.
    // Coverage names the attempt whose receipt stands behind each id; inherited skips are
    // re-admitted through this candidate's manifest so a row that stopped being reusable drops out.
    retry.coveringAttempt = new Map();
    for (const row of retry.parent.after?.skippedByDelta ?? [])
      if (reusableLeaf(row.id, manifest)) retry.coveringAttempt.set(row.id, row.parentAttempt);
    for (const r of retry.classification.passing)
      if (r.id.startsWith('browser:') && reusableLeaf(r.id, manifest))
        retry.coveringAttempt.set(r.id, retry.parent.attempt);
    retry.covered = [...retry.coveringAttempt.keys()].sort();
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
        : retry?.previous
          ? retry.previous
          : retry?.mode === 'same-bytes'
            ? join(directory, 'attempts', retry.parent.attempt, 'leaves')
            : null,
      // Another candidate's receipts were signed with its key; the offered ids are the reuse list.
      ...(retry?.previousKey ? { previousKey: retry.previousKey, reuse: retry.offered } : {}),
      ...(retry?.reuse && retry.mode === 'same-bytes' ? { reuse: retry.reuse } : {}),
      // The tier reads its retry selection here and nowhere else: the byte delta (source-only
      // delta retries) and the browser checks it must add to its own selection.
      ...(retry
        ? {
            selection: {
              ...(retry.changedFiles ? { changedFiles: retry.changedFiles } : {}),
              required: [...retry.required]
                .filter((id) => id.startsWith('browser:'))
                .map((id) => id.slice('browser:'.length)),
              covered: retry.covered.map((id) => id.slice('browser:'.length)),
            },
          }
        : {}),
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
    // Δ-skipped leaves are what the tier's selection left out on the strength of a parent
    // receipt the delta does not reach: reasoning, never receipts. Validation refuses any entry
    // outside the covered set, any that ran, and any overlap with re-execution.
    const skippedByDelta =
      retry.mode === 'delta' &&
      retry.deltaSelection === 'source-only' &&
      retry.classification.kind === 'retry'
        ? (report.verification.selection?.skippedByDelta ?? []).map((id) => ({
            id: `browser:${id}`,
            parentAttempt: retry.coveringAttempt.get(`browser:${id}`) ?? retry.parent.attempt,
          }))
        : [];
    const summary =
      retry.classification.kind === 'reuse'
        ? reuseSummary({
            parent: retry.parent,
            mode: retry.mode,
            sameBytes: report.after.sameBytes,
            offered: retry.offered,
            child: report.verification,
          })
        : afterSummary({
            parent: retry.parent,
            mode: retry.mode,
            deltaSelection: retry.deltaSelection ?? null,
            causes: retry.causes,
            coverage: retry.coverage,
            reexecute: retry.reexecute,
            required: retry.required,
            child: report.verification,
            skippedByDelta,
            covered: retry.covered,
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
