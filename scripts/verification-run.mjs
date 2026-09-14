import { readFileSync } from 'node:fs';
import { createLeafLedger } from './verification-resume.mjs';
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
export function verificationIdentity() {
  return {
    source: sourceIdentity(),
    build: appFingerprint(),
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    environmentDigest: createHash('sha256')
      .update(
        stable(
          Object.fromEntries(
            Object.entries(process.env).filter(
              ([k]) =>
                ![
                  'SIMULACRUM_VERIFICATION_WINDOW',
                  'SIMULACRUM_LEAF_LEDGER',
                  'SIMULACRUM_VERIFICATION_ATTEMPT',
                ].includes(k),
            ),
          ),
        ),
      )
      .digest('hex'),
  };
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
          );
          return value;
        })
        .catch((error) => {
          receipt.ok = false;
          receipt.error = error.message;
          for (const field of ['code', 'signal', 'failureKind', 'unexecuted', 'processDiagnostics'])
            if (error[field] !== undefined) receipt[field] = error[field];
          if (error.elapsedMs !== undefined) receipt.processElapsedMs = error.elapsedMs;
          // A leaf the host slept through was not evaluated: the failure names the sleep, the
          // leaf is neither a pass nor a defect, and no receipt is saved (save runs on success).
          if (error.failureKind === 'host-slept') {
            receipt.notEvaluated = true;
            receipt.hostSleptMs = error.hostSleptMs;
          }
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
export function initializeVerificationEnvironment() {
  assertRuntime();
  process.env.NODE_ENV ??= 'production';
}
export function createVerificationContext(options) {
  initializeVerificationEnvironment();
  let ledgerOptions = {};
  if (process.env.SIMULACRUM_LEAF_LEDGER && !options?.readIdentity) {
    const config = JSON.parse(readFileSync(process.env.SIMULACRUM_LEAF_LEDGER, 'utf8'));
    const manifest = JSON.parse(readFileSync('scripts/manifest.json', 'utf8'));
    const identity = verificationIdentity();
    const shared = {
      key: Buffer.from(config.key, 'hex'),
      identity,
      eligible: manifest.verificationResumeLeaves ?? [],
    };
    ledgerOptions = {
      writeLedger: createLeafLedger({ ...shared, directory: config.output }),
      ...(config.previous
        ? { resumeLedger: createLeafLedger({ ...shared, directory: config.previous }) }
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
      // A sleep-spanning leaf keeps its own name even under the shared deadline.
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
          runProcess(process.execPath, args, {
            timeoutMs: limit,
            env: childEnvironment(),
            ...(options?.processOptions ?? {}),
          }),
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
        unexecuted = [],
        slept = [];
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
              if (error.failureKind === 'host-slept') slept.push({ file, error });
              else if (error.code === 'ITERATION_BUDGET_EXHAUSTED' && !error.processDiagnostics)
                unexecuted.push(file);
              else failures.push({ file, error });
            }
          }
        }),
      );
      // A host sleep leads the report: the files that slept were not evaluated, the files the
      // spent budget left unexecuted were not executed after the sleep — neither is a defect.
      if (slept.length)
        throw Object.assign(
          new AggregateError(
            [...slept, ...failures].map((x) => x.error),
            `host slept: ${slept.length} unit tests not evaluated (${slept.map((x) => x.file).join(', ')})${unexecuted.length ? `; ${unexecuted.length} not executed after host sleep` : ''}${failures.length ? `\nunit tests failed: ${failures.map((x) => x.file).join(', ')}\n${failures.map((x) => x.error.message).join('\n')}` : ''}`,
          ),
          {
            failureKind: 'host-slept',
            hostSleptMs: Math.max(...slept.map((x) => x.error.hostSleptMs ?? 0)),
            notEvaluated: slept.map((x) => x.file).sort(),
            unexecuted: unexecuted.sort(),
          },
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
