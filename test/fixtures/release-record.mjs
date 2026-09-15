// A release directory's records as release:prepare leaves them, for citation tests: the source
// record (deploy's format), a final report at a given status, and a package whose verification
// envelope passes assertPackageVerification and binds that source record.
import { createHash } from 'node:crypto';
import { verificationHash } from '../../scripts/playtest/package-verification.mjs';
import { verificationOutcome } from '../../scripts/verification-outcome.mjs';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function sourceRecord({ head, files, installed }) {
  return {
    head,
    source: Object.fromEntries(Object.entries(files).map(([p, r]) => [p, r.sha256])),
    files,
    installed,
    installedAt: '2026-09-15T05:00:00.000Z',
    identity: { runtime: process.version, platform: process.platform, arch: process.arch },
  };
}
const gate = {
  failed: 0,
  unmet: 0,
  dueBarCount: 1,
  bars: [{ id: 'F1', human: true, state: 'RED', assessment: 'pending' }],
};
export const checks = [{ id: 'fixture-check', ok: true, configuration: {}, elapsedMs: 1 }];
export function finalReport({ head, status = 'passed', failure = null } = {}) {
  const results =
    status === 'running'
      ? [{ id: 'launch-admission', ok: true }]
      : status === 'passed'
        ? [
            { id: 'launch-admission', ok: true },
            { id: 'ci', ok: true },
            { id: 'browser', ok: true },
            { id: 'gate', ok: false, result: gate },
          ]
        : [
            { id: 'launch-admission', ok: true },
            { id: 'ci', ok: true },
            { id: 'browser', ok: false, error: failure ?? 'measure-gears p95 2.1 ms' },
          ];
  return {
    status,
    source: { head, workingTreeDigest: 'b'.repeat(64) },
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    environmentDigest: 'e'.repeat(64),
    build: 'fixture-build',
    results,
    checks: status === 'running' ? [] : checks,
    outcome: verificationOutcome(results, status === 'running' ? [] : checks),
    ...(status === 'failed' ? { failure: failure ?? 'measure-gears p95 2.1 ms' } : {}),
  };
}
export function packageRecord({ source, final, installed = source.installed }) {
  const files = { 'worker.js': sha('verified') };
  const artifact = sha(JSON.stringify(files));
  const manifest = {
    verification: {
      artifact,
      sourceHash: sha(JSON.stringify(source.source)),
      build: final.build,
      results: final.results.map(({ id, ok, result }) => ({
        id,
        ok,
        ...(id === 'gate' ? { result } : {}),
      })),
      automation: final.outcome.automation,
      humanAcceptance: final.outcome.humanAcceptance,
      source: final.source,
      runtime: final.runtime,
      checks: final.checks,
      installed,
    },
    schema: 1,
    protocolVersion: 2,
    createOnlyPayloads: true,
    artifact,
    files,
    head: source.head,
    sourceHash: sha(JSON.stringify(source.source)),
    appBuild: final.build,
    created: 1,
    expires: Date.now() + 86400000,
  };
  manifest.verificationHash = verificationHash(manifest.verification);
  return manifest;
}
