import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appFingerprint } from './build-fingerprint.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { compareRuns } from './verify-m1.mjs';
import { digest } from '../test/fixtures/m1-run.mjs';
import { blueprint, configuration, inputTrace } from '../test/fixtures/m3-run.mjs';
const execute = promisify(execFile);
export const comparePoweredRuns = compareRuns;
export async function runPoweredProcesses() {
  const drivers = ['step', 'step', 'elapsed', 'elapsed'];
  const runs = await Promise.all(
    drivers.map(async (driver) => {
      const { stdout } = await execute(
        process.execPath,
        [fileURLToPath(new URL('../test/fixtures/m3-run.mjs', import.meta.url)), driver],
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    }),
  );
  if (new Set(runs.map((run) => run.pid)).size !== 4)
    throw Error('expected four distinct processes');
  for (const [index, run] of runs.entries()) {
    if (
      run.driver !== drivers[index] ||
      run.runtime !== process.version ||
      run.hashes.length !== 120 ||
      run.hashes.some((value, i) => value.tick !== i + 1)
    )
      throw Error('incomplete driver/runtime/tick coverage');
    if (
      run.blueprintId !== digest(blueprint) ||
      run.configurationId !== digest(configuration) ||
      run.inputTraceId !== digest(inputTrace)
    )
      throw Error('powered fixture identity changed');
    comparePoweredRuns(runs[0], run);
  }
  return runs;
}
export async function verifyM3() {
  const source = sourceIdentity(),
    build = appFingerprint(),
    runs = await runPoweredProcesses();
  const libraryEntry = fileURLToPath(
    import.meta.resolve('@dimforge/rapier3d-deterministic-compat'),
  );
  const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest || appFingerprint() !== build)
    throw Error('source changed during powered qualification');
  const report = {
    version: 1,
    check: 'M3 powered Node determinism',
    recordedAt: new Date().toISOString(),
    sourceIdentity: source,
    appFingerprint: build,
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
    },
    library: {
      package: '@dimforge/rapier3d-deterministic-compat',
      version: packageData.dependencies['@dimforge/rapier3d-deterministic-compat'],
      entryDigest: digest(readFileSync(libraryEntry)),
    },
    scope: {
      nodeClocksVerified: true,
      browserRafVerified: false,
      ticks: 120,
      description:
        'Ordinary authored powered rotor in free fall; no terrain or locomotion qualification',
    },
    blueprint,
    numericConfiguration: configuration,
    inputTrace,
    runs,
  };
  mkdirSync('artifacts/m3', { recursive: true });
  writeFileSync('artifacts/m3/qualification.json', JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifyM3();
    console.log(
      `M3 powered determinism: ${report.runs.length} processes, 120 ticks each; artifacts/m3/qualification.json`,
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
