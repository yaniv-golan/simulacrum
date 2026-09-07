import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';
import { runProcess, runModuleCheck } from './run-check.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
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
    environmentDigest: createHash('sha256').update(stable(process.env)).digest('hex'),
  };
}
/** Receipts exist only in this invocation. Every reuse revalidates all identity fields. */
export function createVerificationRun({ readIdentity = verificationIdentity } = {}) {
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
      unchanged();
      const config = stable(configuration),
        existing = checks.get(id);
      if (existing) {
        if (existing.configuration !== config) throw Error(`check configuration mismatch: ${id}`);
        existing.reused++;
        return existing.promise;
      }
      const receipt = { id, configuration: config, reused: 0 },
        started = performance.now();
      checks.set(id, receipt);
      receipt.promise = Promise.resolve()
        .then(execute)
        .then((value) => {
          unchanged();
          receipt.ok = true;
          return value;
        })
        .catch((error) => {
          receipt.ok = false;
          receipt.error = error.message;
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
  process.env.NODE_ENV ??= 'production';
}
export function createVerificationContext(options) {
  initializeVerificationEnvironment();
  const run = createVerificationRun(options);
  let deadline = Infinity;
  const remaining = (limit) => {
    const value = Math.min(limit, deadline - performance.now());
    if (value <= 0) throw Error('iteration-budget: exhausted before next check');
    return value;
  };
  return Object.assign(run, {
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
        runProcess(process.execPath, args, { timeoutMs: remaining(timeoutMs) }),
      );
    },
    module(id, path, exportName, args, timeoutMs = 5000) {
      return run.check(id, { path, exportName, args, timeoutMs }, () =>
        runModuleCheck(resolve(path), exportName, args, { timeoutMs: remaining(timeoutMs) }),
      );
    },
    async unit(files) {
      const queue = [...new Set(files)].sort(),
        failures = [];
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length) {
            const file = queue.shift();
            try {
              await this.node(`unit:${file}`, ['--test', file], 30000);
            } catch (error) {
              failures.push({ file, error });
            }
          }
        }),
      );
      if (failures.length)
        throw new AggregateError(
          failures.map((x) => x.error),
          `unit tests failed: ${failures.map((x) => x.file).join(', ')}\n${failures.map((x) => x.error.output ?? x.error.message).join('\n')}`,
        );
    },
  });
}
