import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { appFingerprint } from './build-fingerprint.mjs';
import { configuration, inputTrace, digest } from '../test/fixtures/m1-run.mjs';
const execute = promisify(execFile);
export function compareRuns(expected, actual) {
  if (!Array.isArray(actual.hashes) || expected.hashes.length !== actual.hashes.length)
    throw Error('trace length mismatch');
  for (let i = 0; i < expected.hashes.length; i++) {
    const a = expected.hashes[i],
      b = actual.hashes[i];
    if (a.tick !== b.tick || a.hash !== b.hash)
      throw Error(
        `deterministic divergence at tick ${a.tick}: expected ${a.hash}, got ${b.hash} at ${b.tick}`,
      );
  }
}
export async function verifyM1() {
  const build = appFingerprint();
  const runs = await Promise.all(
    ['step', 'step', 'elapsed', 'elapsed'].map(async (driver) => {
      const { stdout } = await execute(
        process.execPath,
        [fileURLToPath(new URL('../test/fixtures/m1-run.mjs', import.meta.url)), driver],
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    }),
  );
  if (new Set(runs.map((run) => run.pid)).size !== 4)
    throw Error('verification did not use four distinct processes');
  for (const run of runs) {
    if (run.hashes.length !== 120 || run.hashes.some((item, index) => item.tick !== index + 1))
      throw Error('trace is not the required complete 120 ticks');
    if (run.configurationId !== digest(configuration) || run.inputTraceId !== digest(inputTrace))
      throw Error('fixture identity mismatch');
    compareRuns(runs[0], run);
  }
  if (appFingerprint() !== build) throw Error('source changed during verification');
  const libraryEntry = fileURLToPath(
    import.meta.resolve('@dimforge/rapier3d-deterministic-compat'),
  );
  const libraryBytes = readFileSync(libraryEntry);
  const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return {
    version: 1,
    check: 'M1 Node determinism',
    nodeClocksVerified: true,
    browserRafVerified: false,
    recordedAt: new Date().toISOString(),
    build,
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
    },
    library: {
      package: '@dimforge/rapier3d-deterministic-compat',
      version: packageData.dependencies['@dimforge/rapier3d-deterministic-compat'],
      entryDigest: digest(libraryBytes),
    },
    configuration,
    inputTrace,
    configurationId: digest(configuration),
    inputTraceId: digest(inputTrace),
    runs,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyM1();
    if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(`M1 verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
