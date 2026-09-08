// Explicit characterization, never a release prerequisite or automatic profile approval.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { CALIBRATION_CASES } from './calibration-evidence.mjs';
import { writeCorpus, readCorpus } from './corpus.mjs';
import { inspectDeployment, captureAdmin, cleanupSynthetic } from './verify-deployment.mjs';
import { assertCaptureBacklog, measureCaptureLoad } from './load.mjs';
import { normalizeExperimentEvidence } from './experiments.mjs';
import { sourceIdentity } from '../source-identity.mjs';
export function compareCaptureWindows(capture) {
  if (capture.outboxSamples?.some((sample) => !Number.isFinite(sample.bytes) || sample.bytes < 0))
    throw Error('Invalid outbox samples');
  // Validate coverage separately: a failing growth/drain observation is useful data.
  assertCaptureBacklog(
    {
      ...capture,
      finalOutbox: { bytes: 0, pending: 0 },
      outboxSamples: capture.outboxSamples?.map((sample) => ({ ...sample, bytes: 0 })),
    },
    1800,
  );
  return [360, 600, 1800].map((seconds) => {
    const start = capture.outboxSamples[0].at - 3000;
    const samples = capture.outboxSamples.filter((s) => s.at <= start + seconds * 1000);
    // Prefixes expose the growth predicate only. They have no independent stop/drain.
    let growth = 'not detected';
    try {
      assertCaptureBacklog(
        {
          ...capture,
          captureSeconds: seconds,
          outboxSamples: samples,
          ...(seconds < 1800 ? { finalOutbox: { bytes: 0, pending: 0 } } : {}),
        },
        seconds,
      );
    } catch (error) {
      growth = error.message;
    }
    return { seconds, samples: samples.length, growth, independentDrain: seconds === 1800 };
  });
}
// Hold the same exclusive publisher owner through measurement and cleanup. Errors retain
// the private owner record for explicit recovery; characterization never updates deployed version.
export async function withCalibrationOwner(
  config,
  directory,
  operation,
  { request = fetch, token = process.env.PLAYTEST_CONTROL_TOKEN } = {},
) {
  if (config.environment !== 'staging') throw Error('Calibration requires isolated staging');
  if (
    !/^[a-f0-9]{64}$/.test(config.artifact || '') ||
    !config.expectedPredecessor ||
    !config.coordinator
  )
    throw Error('Calibration artifact, predecessor and coordinator required');
  if (typeof token !== 'string' || token.length < 32)
    throw Error('Coordinator credential required');
  const owner = {
    attempt: `calibration-${randomUUID()}`,
    token: randomBytes(32).toString('hex'),
    artifact: config.artifact,
    predecessor: config.expectedPredecessor,
  };
  const control = async (path, body = owner) => {
    const response = await request(new URL(path, config.coordinator), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(`Calibration publisher control ${response.status}; retain owner for recovery`);
    return response.json();
  };
  if ((await control('/current', {})).version !== config.expectedPredecessor)
    throw Error('Calibration predecessor changed');
  await writeFile(join(directory, `owner-${owner.attempt}.json`), JSON.stringify(owner), {
    mode: 0o600,
    flag: 'wx',
  });
  await control('/acquire');
  await control('/phase', { ...owner, phase: 'verifying' });
  const check = () => control('/check');
  check.measure = async (family, caseId, execute) => {
    if (!['endurance', 'capacity'].includes(family)) throw Error('Unknown calibration family');
    const source = sourceIdentity();
    try {
      return await execute();
    } catch (error) {
      const failure = {
        id: randomUUID(),
        family,
        status: 'FAIL',
        artifact: owner.artifact,
        identity: createHash('sha256')
          .update(JSON.stringify({ source, artifact: owner.artifact, family, caseId }))
          .digest('hex'),
        measuredAt: Date.now(),
        reason: 'Calibration measurement failed; inspect private case evidence',
      };
      // Write before the remote operation: loss of acknowledgment cannot erase the failure.
      await writeFile(
        join(directory, `experiment-failure-${failure.id}.json`),
        JSON.stringify({ failure, source, caseId }),
        { mode: 0o600, flag: 'wx' },
      );
      const historyPath = join(
        resolve(directory, '..'),
        `experiment-history-${config.environment}.json`,
      );
      const history = await readFile(historyPath, 'utf8')
        .then(JSON.parse)
        .catch((e) => {
          if (e.code === 'ENOENT') return [];
          throw e;
        });
      await writeFile(
        historyPath,
        JSON.stringify(normalizeExperimentEvidence([...history, failure])),
        { mode: 0o600 },
      );
      try {
        await control('/experiment-failed', { ...owner, failure });
      } catch (historyError) {
        throw new AggregateError(
          [error, historyError],
          'Calibration failure persistence uncertain; retain private history and owner',
        );
      }
      throw error;
    }
  };
  const result = await operation(check);
  if (result?.cases?.some((c) => c.status === 'FAIL') || result?.capacity?.status === 'FAIL')
    throw Error('Failed calibration cannot release publisher ownership');
  await control('/check');
  await control('/release');
  return result;
}
export function characterizationControls() {
  const capture = (bytes) => ({
    captureSeconds: 1800,
    finalOutbox: { bytes: 0, pending: 0 },
    outboxSamples: Array.from({ length: 600 }, (_, i) => ({ at: (i + 1) * 3000, bytes: bytes(i) })),
  });
  const fast = compareCaptureWindows(capture((i) => i * 100000));
  const slow = compareCaptureWindows(capture((i) => i * 14000));
  const burst = compareCaptureWindows(capture((i) => (i % 100 < 10 ? 2000000 : 0)));
  const late = compareCaptureWindows(capture((i) => (i < 220 ? 0 : (i - 220) * 100000)));
  let undrainedRejected = false;
  try {
    assertCaptureBacklog({ ...capture(() => 0), finalOutbox: { bytes: 1, pending: 1 } });
  } catch {
    undrainedRejected = true;
  }
  const result = {
    fastDetected: fast.every((x) => /growth/.test(x.growth)),
    slowDetected: slow.every((x) => /growth/.test(x.growth)),
    burstAccepted: burst.every((x) => x.growth === 'not detected'),
    undrainedRejected,
    lateOnlyLongDetected:
      late[0].growth === 'not detected' &&
      late[1].growth === 'not detected' &&
      /growth/.test(late[2].growth),
    limitation:
      'Outbox observations cannot prove absence of browser or provider resource leaks; growth slower than the declared predicate remains unqualified.',
  };
  if (Object.values(result).some((v) => v === false))
    throw Error('Characterization negative control failed');
  return result;
}
export async function calibrateCapture(config, directory) {
  if (config.environment !== 'staging') throw Error('Calibration requires isolated staging');
  const out = resolve(directory);
  if (!out.startsWith(resolve('.release-private') + '/'))
    throw Error('Private calibration destination required');
  await mkdir(out, { recursive: false, mode: 0o700 });
  console.log(
    JSON.stringify({
      operation: 'explicit-characterization',
      captureCases: CALIBRATION_CASES,
      captureSeconds: CALIBRATION_CASES.reduce((n, c) => n + c.seconds, 0),
      capacitySeconds: 600,
      routineReleasePrerequisite: false,
    }),
  );
  return withCalibrationOwner(config, out, async (checkOwner) => {
    const source = sourceIdentity(),
      effective = await inspectDeployment(config);
    const report = {
      schema: 2,
      protocol: 'capture-characterization-v2',
      source,
      effective,
      artifact: config.artifact,
      build: config.appBuild,
      cases: [],
      controls: characterizationControls(),
      calibrationStatus: 'MEASURED_NOT_APPROVED',
    };
    const save = () =>
      writeFile(join(out, 'comparison.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    let corpus;
    // Independent stop/drain and fresh browser for every duration and fault case.
    // Reservations are bounded per case, not held for the whole characterization.
    for (const spec of CALIBRATION_CASES) {
      await checkOwner();
      const caseDir = join(out, spec.id);
      await mkdir(caseDir, { mode: 0o700 });
      const reservation = await captureAdmin(config.origin, 'synthetic', {
        slots: 2,
        bytes: 2 * 1024 ** 3,
        metadataBytes: 128 * 1024 ** 2,
      });
      try {
        await checkOwner.measure('endurance', spec.id, async () => {
          if (reservation.expires - Date.now() < (spec.seconds + 180) * 1000)
            throw Error('Insufficient calibration reservation lifetime');
          const invitation = await captureAdmin(
            config.origin,
            `synthetic/${reservation.id}/invitation`,
          );
          const file = join(caseDir, 'capture.json');
          execFileSync(process.execPath, ['scripts/verify-remote-playtest.mjs'], {
            stdio: 'inherit',
            timeout: (spec.seconds + 180) * 1000,
            env: {
              ...process.env,
              PLAYTEST_VERIFY_ORIGIN: config.origin,
              PLAYTEST_VERIFY_TOKEN: invitation.token,
              PLAYTEST_VERIFY_BUILD: config.appBuild,
              PLAYTEST_VERIFY_ADAPTER: 'cloud',
              PLAYTEST_VERIFY_PRIVATE_ROOT: caseDir,
              PLAYTEST_VERIFY_RESULT: file,
              PLAYTEST_CAPTURE_SECONDS: String(spec.seconds),
              PLAYTEST_ACTIVE_WORKLOAD: 'true',
              PLAYTEST_CHARACTERIZATION: 'true',
              PLAYTEST_CAPTURE_FAULT: spec.fault ?? '',
            },
          });
          const bytes = await readFile(file),
            capture = JSON.parse(bytes);
          if (capture.syntheticRun !== reservation.id)
            throw Error('Synthetic capture reservation identity mismatch');
          report.browserVersion ??= capture.browserVersion;
          if (capture.browserVersion !== report.browserVersion)
            throw Error('Calibration browser changed');
          let status = 'PASS',
            reason;
          try {
            if (!spec.fault) assertCaptureBacklog(capture, spec.seconds);
          } catch (error) {
            status = 'FAIL';
            reason = error.message;
          }
          report.cases.push({
            id: spec.id,
            seconds: spec.seconds,
            status,
            ...(reason ? { reason } : {}),
            resourceTrend: {
              scope: 'browser CDP samples; no leak-free claim',
              first: capture.resourceSamples?.[0],
              last: capture.resourceSamples?.at(-1),
            },
            file: `${spec.id}/capture.json`,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          if (spec.id === 'long') report.windows = compareCaptureWindows(capture);
          if (spec.id === 'short-360-a') {
            const manifest = await writeCorpus(join(out, 'corpus'), capture);
            report.corpusId = manifest.id;
            corpus = await readCorpus(join(out, 'corpus'), manifest.id);
          }
          await save();
          if (status === 'FAIL') throw Error(reason);
        });
      } finally {
        await cleanupSynthetic(config.origin, reservation.id);
      }
    }
    await checkOwner();
    try {
      const measurement = await checkOwner.measure('capacity', 'capacity', () =>
        measureCaptureLoad({
          origin: config.origin,
          capture: corpus,
          seconds: 600,
        }),
      );
      const bytes = JSON.stringify(measurement);
      await writeFile(join(out, 'capacity.json'), bytes, { mode: 0o600, flag: 'wx' });
      report.capacity = {
        status: 'PASS',
        seconds: measurement.seconds,
        p95Ms: measurement.p95Ms,
        finalBacklog: measurement.finalBacklog,
        file: 'capacity.json',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    } catch (error) {
      report.capacity = { status: 'FAIL', reason: error.message };
      await save();
      throw error;
    }
    if (JSON.stringify(sourceIdentity()) !== JSON.stringify(source))
      throw Error('Calibration source changed');
    report.completedAt = Date.now();
    await save();
    return report;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath, directory] = process.argv.slice(2);
  if (!configPath || !directory)
    throw Error(
      'Usage: node scripts/playtest/calibrate.mjs <private-staging-config> <new-private-directory>',
    );
  const result = await calibrateCapture(JSON.parse(await readFile(configPath, 'utf8')), directory);
  console.log(JSON.stringify({ status: result.calibrationStatus, windows: result.windows }));
}
