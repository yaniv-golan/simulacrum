import { readFileSync } from 'node:fs';
import { createLeafLedger } from './verification-resume.mjs';
import { reusableLeaf } from './candidate-after.mjs';
import {
  RELEVANT_ENVIRONMENT,
  relevantEnvironmentDigest,
  environmentForensics,
  processIdentity,
} from './verification-environment.mjs';
import { assertRuntime } from './runtime-preflight.mjs';
import { readHostProfile, profileDeadline, childEnvironment } from './host-profile.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';
import { runProcess, runModuleCheck } from './run-check.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setImmediate as yieldToProcesses } from 'node:timers/promises';
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
export { RELEVANT_ENVIRONMENT, relevantEnvironmentDigest, environmentForensics };
export function verificationIdentity() {
  // The installed dependency digest (browser runtime included) is bound by the candidate.
  return { source: sourceIdentity(), build: appFingerprint(), ...processIdentity() };
}
/** Invocation receipts may reconstruct audited same-candidate leaves. Every reuse revalidates identity. */
export function createVerificationRun({
  readIdentity = verificationIdentity,
  resumeLedger,
  writeLedger,
  assertAdmission = () => {},
} = {}) {
  const identity = structuredClone(readIdentity()),
    key = stable(identity),
    checks = new Map();
  const unchanged = () => {
    if (stable(readIdentity()) !== key)
      throw Error('verification identity changed during invocation');
  };
  return {
    identity,
    async check(id, configuration, execute) {
      const started = performance.now();
      assertAdmission();
      unchanged();
      assertAdmission();
      const config = stable(configuration),
        existing = checks.get(id);
      if (existing) {
        if (existing.configuration !== config) throw Error(`check configuration mismatch: ${id}`);
        existing.reused++;
        return existing.promise;
      }
      const receipt = { id, configuration: config, reused: 0 };
      checks.set(id, receipt);
      receipt.promise = Promise.resolve()
        .then(async () => {
          assertAdmission();
          const previous = resumeLedger?.load(id, configuration);
          if (previous) {
            receipt.resumed = true;
            receipt.originalElapsedMs = previous.elapsedMs;
            if (previous.origin)
              receipt.origin = { ...previous.origin, depth: (previous.origin.depth ?? 0) + 1 };
            return previous.value;
          }
          return execute();
        })
        .then((value) => {
          unchanged();
          receipt.ok = true;
          if (value?.processDiagnostics) receipt.processDiagnostics = value.processDiagnostics;
          writeLedger?.save(
            id,
            configuration,
            value,
            receipt.originalElapsedMs ?? performance.now() - started,
            receipt.origin ?? null,
          );
          return value;
        })
        .catch((error) => {
          receipt.ok = false;
          receipt.error = error.message;
          for (const field of ['code', 'signal', 'failureKind', 'unexecuted', 'processDiagnostics'])
            if (error[field] !== undefined) receipt[field] = error[field];
          if (error.elapsedMs !== undefined) receipt.processElapsedMs = error.elapsedMs;
          throw error;
        })
        .finally(() => {
          receipt.elapsedMs = performance.now() - started;
        });
      return receipt.promise;
    },
    receipts() {
      return [...checks.values()].map(({ promise, ...record }) => ({
        ...record,
        configuration: JSON.parse(record.configuration),
      }));
    },
  };
}
/** Shape of the retry selection a ledger configuration may carry; anything else is refused. The
 * configuration is honoured only for the attempt it was written for: its origin attempt must be
 * the one the tier was launched under. */
export function readRetrySelection(value, { origin, attempt } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('invalid retry selection');
  if (!attempt || origin?.attempt !== attempt)
    throw Error('retry selection is bound to the attempt that wrote the ledger configuration');
  const list = (name) => {
    const rows = value[name];
    if (rows === undefined) return undefined;
    if (!Array.isArray(rows) || rows.some((row) => typeof row !== 'string' || !row))
      throw Error(`invalid retry selection ${name}`);
    return [...new Set(rows)].sort();
  };
  for (const key of Object.keys(value))
    if (!['changedFiles', 'required', 'covered'].includes(key))
      throw Error(`invalid retry selection field ${key}`);
  return {
    changedFiles: list('changedFiles') ?? null,
    required: list('required') ?? [],
    covered: list('covered') ?? [],
  };
}
export function initializeVerificationEnvironment() {
  assertRuntime();
  process.env.NODE_ENV ??= 'production';
}
export function createVerificationContext(options) {
  initializeVerificationEnvironment();
  let ledgerOptions = {},
    selection = null;
  if (process.env.SIMULACRUM_LEAF_LEDGER && !options?.readIdentity) {
    const config = JSON.parse(readFileSync(process.env.SIMULACRUM_LEAF_LEDGER, 'utf8'));
    // A diagnosed retry hands its selection through this private, attempt-scoped file only:
    // the byte delta the tier's policy classifies in place of the git diff, and the browser
    // checks it must add to whatever it selects. No command-line flag carries either.
    selection = readRetrySelection(config.selection, {
      origin: config.origin,
      attempt: process.env.SIMULACRUM_VERIFICATION_ATTEMPT,
    });
    const manifest = JSON.parse(readFileSync('scripts/manifest.json', 'utf8'));
    const identity = verificationIdentity();
    const shared = { key: Buffer.from(config.key, 'hex'), identity };
    // Every passing leaf is saved so a later diagnosed retry has receipts; plain resume reads
    // only the audited pure leaves, a retry reads the explicit reuse list it was given.
    ledgerOptions = {
      writeLedger: createLeafLedger({
        ...shared,
        directory: config.output,
        eligible: [],
        // Only leaves a diagnosed retry may reuse are saved: unit files and browser checks that
        // are not timing-sensitive. Aggregates, gates and builds never enter the ledger.
        saveEligible: (id) => reusableLeaf(id, manifest),
        origin: config.origin ?? null,
      }),
      ...(config.previous
        ? {
            resumeLedger: createLeafLedger({
              ...shared,
              directory: config.previous,
              eligible: Array.isArray(config.reuse)
                ? config.reuse
                : (manifest.verificationResumeLeaves ?? []),
            }),
          }
        : {}),
    };
  }
  let deadline = Infinity;
  const remaining = (limit) => {
    const value = Math.min(limit, deadline - performance.now());
    if (value <= 0)
      throw Object.assign(Error('iteration-budget: exhausted before next check'), {
        code: 'ITERATION_BUDGET_EXHAUSTED',
      });
    return value;
  };
  async function boundedProcess(limit, execute) {
    const timeoutMs = remaining(limit);
    try {
      return await execute(timeoutMs);
    } catch (error) {
      if (timeoutMs < limit && error.failureKind === 'watchdog') {
        error.message = `iteration-budget: shared deadline expired; ${error.message}`;
        error.summary = `iteration-budget: shared deadline expired; ${error.summary ?? ''}`;
        error.code = 'ITERATION_BUDGET_EXHAUSTED';
        error.failureKind = 'iteration-budget';
      }
      throw error;
    }
  }
  // Only a hosted workflow sets the profile; local runs and fixtures never read the manifest here.
  const hostProfile = process.env.SIMULACRUM_HOST_PROFILE
    ? readHostProfile(JSON.parse(readFileSync('scripts/manifest.json', 'utf8')))
    : null;
  const run = createVerificationRun({
    ...ledgerOptions,
    ...options,
    assertAdmission: () => remaining(Infinity),
  });
  return Object.assign(run, {
    selection,
    hostProfile,
    async withDeadline(limit, execute) {
      const previous = deadline;
      deadline = Math.min(deadline, performance.now() + limit);
      try {
        return await execute();
      } finally {
        deadline = previous;
      }
    },
    node(id, args, timeoutMs = 30000) {
      return run.check(id, { args, timeoutMs }, () =>
        boundedProcess(timeoutMs, (limit) =>
          runProcess(process.execPath, args, { timeoutMs: limit, env: childEnvironment() }),
        ),
      );
    },
    module(id, path, exportName, args, timeoutMs = 5000) {
      timeoutMs = profileDeadline(hostProfile, 'moduleTimeoutMs', timeoutMs);
      return run.check(id, { path, exportName, args, timeoutMs }, () =>
        boundedProcess(timeoutMs, (limit) =>
          runModuleCheck(resolve(path), exportName, args, { timeoutMs: limit }),
        ),
      );
    },
    async unit(files) {
      const queue = [...new Set(files)].sort(),
        failures = [],
        unexecuted = [];
      await Promise.all(
        Array.from({ length: Math.min(hostProfile?.unitWorkers ?? 4, queue.length) }, async () => {
          while (queue.length) {
            // Let process close/watchdog callbacks run before another admission.
            await yieldToProcesses();
            if (!queue.length) break;
            if (deadline <= performance.now()) {
              unexecuted.push(...queue.splice(0));
              break;
            }
            const file = queue.shift();
            try {
              await this.node(
                `unit:${file}`,
                ['--test', file],
                profileDeadline(hostProfile, 'unitTimeoutMs', 30000),
              );
            } catch (error) {
              if (error.code === 'ITERATION_BUDGET_EXHAUSTED' && !error.processDiagnostics)
                unexecuted.push(file);
              else failures.push({ file, error });
            }
          }
        }),
      );
      if (failures.length || unexecuted.length)
        throw Object.assign(
          new AggregateError(
            failures.map((x) => x.error),
            `unit tests failed: ${failures.map((x) => x.file).join(', ')}\n${failures.map((x) => x.error.message).join('\n')}\n${unexecuted.length ? `iteration-budget: ${unexecuted.length} unit tests not executed` : ''}`,
          ),
          { unexecuted: unexecuted.sort() },
        );
    },
  });
}
