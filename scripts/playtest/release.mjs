import { captureIdentity, assertCaptureIdentity } from './load.mjs';
import { assertPackageVerification } from './package-verification.mjs';
import { readCalibrationEvidence } from './calibration-evidence.mjs';
import { readCorpus } from './corpus.mjs';
import { prepareRelease } from './prepare-release.mjs';
export { prepareRelease };
import {
  selectExperiments,
  experimentReservation,
  experimentReceipt,
  verifyExperimentResults,
  behaviorConfiguration,
  stagingResults,
  normalizeExperimentEvidence,
  validateProfile,
} from './experiments.mjs';
import { measureCaptureLoad, assertCaptureBacklog, assertCaptureWorkload } from './load.mjs';
import { assertReservationLifetime, captureBrowserTimeoutMs } from './release-policy.mjs';
import { validateReleaseConfig } from './release-config.mjs';
import {
  inspectDeployment,
  captureAdmin,
  verifySynthetic,
  verifyServedAssets,
  cleanupSynthetic,
} from './verify-deployment.mjs';
// Explicit local/CI release entry point. All control files and frozen sources stay private.
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  lstat,
  rm,
  mkdtemp,
} from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
const text = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
async function inventory(root) {
  const result = {};
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('Release symlinks forbidden');
      if (entry.isDirectory()) await visit(path);
      else result[relative(root, path).replaceAll('\\', '/')] = sha(await readFile(path));
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export async function verifyPackage(directory, { rollback = false } = {}) {
  const manifest = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
  const files = await inventory(join(directory, 'payload'));
  if (
    JSON.stringify(files) !== JSON.stringify(manifest.files) ||
    sha(JSON.stringify(files)) !== manifest.artifact
  )
    throw Error('Artifact integrity mismatch');
  if (manifest.protocolVersion !== 2 || manifest.createOnlyPayloads !== true)
    throw Error('Incompatible capture rollback');
  if (!Number.isFinite(manifest.expires)) throw Error('Release expiry required');
  if (rollback) {
    const prior = JSON.parse(await readFile(join(directory, 'verified-production.json'), 'utf8'));
    if (prior.artifact !== manifest.artifact || prior.status !== 'passed' || !prior.version)
      throw Error('Previously verified production package required');
  } else if (Date.now() > manifest.expires) throw Error('Release artifact expired');
  assertPackageVerification(manifest);
  return manifest;
}
export async function persistOwner(path, owner, { recovery = false } = {}) {
  try {
    await writeFile(path, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (
      saved.attempt !== owner.attempt ||
      saved.token !== owner.token ||
      (saved.artifact === owner.artifact &&
        saved.verificationIdentity !== owner.verificationIdentity) ||
      (!recovery &&
        (saved.artifact !== owner.artifact ||
          saved.predecessor !== owner.predecessor ||
          saved.verificationIdentity !== owner.verificationIdentity))
    )
      throw Error('Owner file identity mismatch');
    const newVerificationIdentity = owner.verificationIdentity;
    Object.assign(owner, saved);
    if (recovery) owner.verificationIdentity = newVerificationIdentity;
  }
}

// Persist receipts and resolution evidence before deleting durable failure records.
// A lost coordinator acknowledgement leaves local failures conservative and replayable.
export async function recordExperimentPasses(
  directory,
  historyPath,
  evidence,
  results,
  families,
  control,
) {
  const writeImmutable = async (path, value) => {
    const body = JSON.stringify(value, null, 2);
    try {
      await writeFile(path, body, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST' || (await readFile(path, 'utf8')) !== body) throw error;
    }
  };
  for (const result of Object.values(results))
    if (result.status === 'PASS') {
      await writeImmutable(
        join(directory, `experiment-pass-${result.receipt.id}.json`),
        result.receipt,
      );
    }
  await writeFile(
    join(directory, 'experiment-evidence.json'),
    JSON.stringify(
      Object.values(results).flatMap((r) => (r.receipt ? [r.receipt] : [])),
      null,
      2,
    ),
    { mode: 0o600 },
  );
  for (const family of families) {
    const result = results[family];
    if (result.status !== 'PASS') throw Error('Experiment did not complete');
    const failureIds = evidence
      .filter((e) => e.status === 'FAIL' && e.family === family)
      .map((e) => e.id);
    // Keep immutable failure evidence even after the active history is resolved.
    for (const failure of evidence.filter((e) => failureIds.includes(e.id))) {
      await writeImmutable(
        join(directory, `resolved-failure-${sha(String(failure.id))}-${result.receipt.id}.json`),
        { failure, resolvedBy: result.receipt },
      );
    }
    await control('/experiment-passed', {
      family,
      receiptId: result.receipt.id,
      identity: result.receipt.identity,
      measuredAt: result.receipt.measuredAt,
      artifact: result.receipt.artifact,
      failureIds,
    });
    for (let i = evidence.length - 1; i >= 0; i--)
      if (failureIds.includes(evidence[i].id)) evidence.splice(i, 1);
    evidence.push(result.receipt);
    await writeFile(historyPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  }
}

export async function deployRelease(
  directory,
  configPath,
  admittedOwner,
  { rollback = false, recovery = false, eligibilityGuard } = {},
) {
  const restoration = recovery || rollback;
  const manifest = await verifyPackage(directory, { rollback }),
    config = JSON.parse(await readFile(configPath, 'utf8'));
  if (
    !['staging', 'production'].includes(config.environment) ||
    !/^[a-f0-9]{32}$/.test(config.accountId || '') ||
    config.accountId === config.otherAccountId ||
    !/^[a-f0-9]{32}$/.test(config.otherAccountId || '')
  )
    throw Error('Separate verified environment accounts required');
  if (config.environment === 'production' && config.origin !== 'https://simulacrum.build')
    throw Error('Unexpected production domain');
  if (
    config.artifact !== manifest.artifact ||
    !config.expectedPredecessor ||
    !config.coordinator ||
    !config.workerName
  )
    throw Error('Explicit artifact and predecessor required');
  if (
    !process.env.CLOUDFLARE_API_TOKEN ||
    !process.env.PLAYTEST_CONTROL_TOKEN ||
    !process.env.GH_TOKEN
  )
    throw Error('Environment-scoped Cloudflare, coordinator and GitHub credentials required');
  let stagingEvidence;
  if (
    config.environment === 'production' &&
    !rollback &&
    !(recovery && admittedOwner?.artifact === manifest.artifact)
  ) {
    const evidence = JSON.parse(await readFile(config.evidence, 'utf8'));
    stagingEvidence = evidence;
    if (
      evidence.artifact !== manifest.artifact ||
      evidence.environment !== 'staging' ||
      evidence.status !== 'passed' ||
      evidence.schema !== 2 ||
      evidence.smoke?.status !== 'PASS' ||
      !Number.isFinite(evidence.expires) ||
      evidence.expires <= Date.now()
    )
      throw Error('Exact artifact requires fresh staging verification');
  }
  const desired = JSON.parse(await readFile(config.wranglerConfig, 'utf8'));
  validateReleaseConfig(config, desired);
  config.bucketName = desired.r2_buckets[0].bucket_name;
  const verification = config.verification || { mode: 'auto' };
  const profile = verification.profile || null;
  const captureMode = {
    recordingMode: config.recordingMode ?? 'data',
    captureSchema: config.captureSchema ?? 1,
  };
  captureIdentity(captureMode);
  if ((desired.vars?.CAPTURE_OPTIONAL_VIDEO === 'true') !== (config.optionalVideo === true))
    throw Error('Optional video configuration mismatch');
  if (config.optionalVideo === true || captureMode.recordingMode === 'video')
    throw Error(
      'Optional video releases require dual-mode qualification; single-mode evidence cannot authorize both modes',
    );
  if (stagingEvidence) assertCaptureIdentity(stagingEvidence, captureMode);
  if (!['auto', 'full', 'bypass-expensive'].includes(verification.mode || 'auto'))
    throw Error('Unknown experiment mode');
  let calibration;
  if (verification.mode !== 'bypass-expensive') {
    validateProfile(profile);
    assertCaptureIdentity(profile, captureMode);
    calibration = await readCalibrationEvidence(profile, verification.calibrationFile);
  }
  const historyPath = join(
    resolve(directory, '..'),
    `experiment-history-${config.environment}.json`,
  );
  let evidence = await readFile(historyPath, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const failureResponse = await fetch(new URL('/experiment-failures', config.coordinator), {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.PLAYTEST_CONTROL_TOKEN}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!failureResponse.ok)
    throw Error('Cannot read durable experiment failures; coordinator update required');
  const knownFailures = (await failureResponse.json()).failures;
  if (!Array.isArray(knownFailures)) throw Error('Invalid coordinator failure history');
  evidence.push(...knownFailures);
  for (const file of verification.evidenceFiles || []) {
    const record = JSON.parse(await readFile(file, 'utf8'));
    evidence.push(...(Array.isArray(record) ? record : [record]));
  }
  evidence = normalizeExperimentEvidence(evidence);
  const { experimentInputs } = await import('./experiment-inputs.mjs');
  const effectiveBefore = await inspectDeployment(config);
  const runtimeInputs = profile
    ? {
        capacityRuntime: {
          ...captureMode,
          calibrationEvidence: profile.calibration?.evidence,
          workload: profile.calibration?.workload,
          browserVersion: profile.calibration?.browserVersion,
          effectiveProvider: effectiveBefore.effectiveDigest,
        },
      }
    : {};
  const context = {
    ...(verification.mode === 'bypass-expensive'
      ? { inputs: {}, configuration: sha(JSON.stringify(desired)) }
      : await experimentInputs(manifest, desired, runtimeInputs)),
    artifact: manifest.artifact,
    environment: config.environment,
    profile,
    evidence,
    mode: verification.mode || 'auto',
    reason: verification.reason,
    acknowledgeFailures: verification.acknowledgeFailures || [],
  };
  let experimentPlan;
  if (stagingEvidence && context.mode === 'auto') {
    if (evidence.some((record) => record.status === 'FAIL'))
      throw Error(
        'Known production experiment failure requires full retest or explicit exception acknowledgement',
      );
    experimentPlan = {
      mode: 'auto',
      smokeSeconds: 60,
      run: [],
      results: stagingResults(stagingEvidence, manifest.artifact, desired, profile),
      stagingArtifact: manifest.artifact,
    };
  } else experimentPlan = selectExperiments(context);
  const budget = experimentReservation(experimentPlan, profile);
  console.log(
    JSON.stringify({
      artifact: manifest.artifact,
      environment: config.environment,
      verification: experimentPlan,
      budget,
    }),
  );
  const attempt = admittedOwner
    ? { ...admittedOwner }
    : {
        attempt: crypto.randomUUID(),
        token: randomBytes(32).toString('hex'),
        artifact: manifest.artifact,
        predecessor: config.expectedPredecessor,
      };
  const ownerPath = join(directory, `owner-${config.environment}-${attempt.attempt}.json`);
  const verificationIdentity = sha(
    JSON.stringify({
      mode: context.mode,
      profile,
      exception: experimentPlan.exception,
    }),
  );
  attempt.verificationIdentity = verificationIdentity;
  await persistOwner(ownerPath, attempt, { recovery });
  const control = async (path, extra = {}) => {
    const r = await fetch(new URL(path, config.coordinator), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.PLAYTEST_CONTROL_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...attempt, ...extra }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error(`Publisher control ${r.status}; retain owner record for recovery`);
    return r.json();
  };
  if (recovery) {
    await control('/check');
    const recovered = await control('/recover', {
      artifact: manifest.artifact,
      predecessor: config.expectedPredecessor,
    });
    Object.assign(attempt, { artifact: recovered.artifact, predecessor: recovered.predecessor });
    await writeFile(ownerPath, JSON.stringify(attempt), { mode: 0o600 });
  } else await control('/acquire');
  let activeExperiment = null,
    measured;
  let reservation,
    privateDirectory,
    cleaned = false;
  try {
    const reserve = () =>
      captureAdmin(config.origin, 'synthetic', {
        slots: budget.slots,
        bytes: budget.bytes,
        metadataBytes: budget.metadataBytes,
      });
    // Restoration retains ownership and provider binding checks, but cannot
    // depend on the application's broken admin API. Validate it after restoring.
    if (!restoration) reservation = await reserve();
    // Never release automatically on errors: a remote timeout has an unknown outcome.
    const variable =
      config.environment === 'production' ? 'DEPLOY_PRODUCTION_ENABLED' : 'DEPLOY_STAGING_ENABLED';
    const observedPause = text('gh', ['variable', 'get', variable, '--repo', config.repository]);
    const prior = admittedOwner?.priorPause ?? observedPause;
    await writeFile(
      ownerPath,
      JSON.stringify({
        ...attempt,
        priorPause: prior,
        reservationId: reservation?.id ?? attempt.reservationId,
      }),
      { mode: 0o600 },
    );
    if (config.publisher === 'github' && observedPause !== 'true') throw Error('Deployment paused');
    if (config.publisher !== 'github')
      run('gh', ['variable', 'set', variable, '--repo', config.repository, '--body', 'false']);
    await control('/phase', { phase: 'paused' });
    const api = async (path) => {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/${path}`,
        {
          headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok) throw Error(`Cloudflare read ${r.status}`);
      const value = await r.json();
      if (!value.success) throw Error('Cloudflare read failed');
      return value.result;
    };
    const deployments = await api(`workers/scripts/${config.workerName}/deployments`);
    if (deployments.deployments?.[0]?.versions?.[0]?.version_id !== config.expectedPredecessor)
      throw Error('Unexpected deployed predecessor');
    await control('/check');
    if (
      config.publisher === 'github' &&
      text('gh', ['variable', 'get', variable, '--repo', config.repository]) !== 'true'
    )
      throw Error('Deployment paused');
    if (!restoration) assertReservationLifetime(reservation, budget.requiredMs);
    await control('/phase', { phase: 'deploying' });
    const wrangler = JSON.parse(await readFile(config.wranglerConfig, 'utf8'));
    if (
      wrangler.account_id !== config.accountId ||
      wrangler.name !== config.workerName ||
      wrangler.observability?.logs?.invocation_logs !== false ||
      wrangler.observability?.enabled !== false
    )
      throw Error('Unsafe deployment config');
    const generated = {
      ...wrangler,
      main: join(resolve(directory), 'payload/backend/worker.js'),
      assets: { ...wrangler.assets, directory: join(resolve(directory), 'payload/assets') },
      no_bundle: true,
    };
    const generatedPath = join(directory, `deploy-${config.environment}.json`);
    await writeFile(generatedPath, JSON.stringify(generated), { mode: 0o600 });
    if (JSON.stringify(wrangler) !== JSON.stringify(desired))
      throw Error('Deployment config changed');
    await verifyPackage(directory, { rollback });
    await eligibilityGuard?.();
    await control('/check');
    run('npx', ['--no-install', 'wrangler', 'deploy', '--config', generatedPath, '--no-bundle']);
    await control('/phase', { phase: 'verifying' });
    let effectiveAfter;
    let verificationError, performanceEvidence;
    privateDirectory = await mkdtemp(join(resolve(directory), 'synthetic-private-'));
    const browserResultPath = join(privateDirectory, 'browser-result.json');
    try {
      effectiveAfter = await inspectDeployment(config);
      if (profile && !experimentPlan.stagingArtifact && !experimentPlan.exception) {
        const afterInputs = await experimentInputs(manifest, desired, {
          capacityRuntime: {
            ...runtimeInputs.capacityRuntime,
            effectiveProvider: effectiveAfter.effectiveDigest,
          },
        });
        for (const family of ['endurance', 'capacity'])
          if (
            experimentPlan.results[family].status === 'REUSED' &&
            context.inputs[family] !== afterInputs.inputs[family]
          )
            throw Error('Effective configuration changed; reused evidence invalid');
        Object.assign(context, afterInputs);
      }
      if (!experimentPlan.exception) {
        for (const result of Object.values(experimentPlan.results))
          if (result.status === 'REUSED' && result.receipt.expires <= Date.now())
            throw Error('Experiment evidence expired during deployment');
      }
      if (restoration) {
        if (attempt.reservationId) await cleanupSynthetic(config.origin, attempt.reservationId);
        reservation = await reserve();
        assertReservationLifetime(reservation, budget.requiredMs);
        await writeFile(
          ownerPath,
          JSON.stringify({ ...attempt, priorPause: prior, reservationId: reservation.id }),
          { mode: 0o600 },
        );
      }
      const synthetic = await verifySynthetic(config, reservation, join(privateDirectory, 'smoke'));
      const invitation = await captureAdmin(
        config.origin,
        `synthetic/${reservation.id}/invitation`,
      );
      try {
        activeExperiment = experimentPlan.run.includes('endurance') ? 'endurance' : null;
        execFileSync(process.execPath, ['scripts/verify-remote-playtest.mjs'], {
          env: {
            ...process.env,
            PLAYTEST_RECORDING_MODE: captureMode.recordingMode,
            PLAYTEST_VERIFY_ORIGIN: config.origin,
            PLAYTEST_VERIFY_TOKEN: invitation.token,
            PLAYTEST_VERIFY_BUILD: manifest.appBuild,
            PLAYTEST_VERIFY_ADAPTER: 'cloud',
            PLAYTEST_CAPTURE_SECONDS: String(
              experimentPlan.run.includes('endurance')
                ? profile.enduranceSeconds
                : experimentPlan.smokeSeconds,
            ),
            PLAYTEST_ACTIVE_WORKLOAD: 'true',
            PLAYTEST_VERIFY_RESULT: browserResultPath,
            PLAYTEST_VERIFY_PRIVATE_ROOT: privateDirectory,
          },
          stdio: 'pipe',
          timeout: captureBrowserTimeoutMs(
            experimentPlan.run.includes('endurance')
              ? profile.enduranceSeconds
              : experimentPlan.smokeSeconds,
          ),
        });
      } catch {
        throw Error('Deployed browser verification failed; synthetic diagnostics removed');
      }
      measured = JSON.parse(await readFile(browserResultPath, 'utf8'));
      assertCaptureIdentity(measured, captureMode);
      assertCaptureWorkload(measured, profile?.calibration.workload);
      if (profile && measured.browserVersion !== profile.calibration.browserVersion)
        throw Error('Browser changed; calibrated evidence cannot be reused');
      if (experimentPlan.run.includes('endurance')) {
        assertCaptureBacklog(measured, profile.enduranceSeconds);
        experimentPlan.results.endurance = {
          status: 'PASS',
          receipt: experimentReceipt('endurance', context, {
            captureSeconds: measured.captureSeconds,
            outboxSamples: measured.outboxSamples,
            finalOutbox: measured.finalOutbox,
            workload: assertCaptureWorkload(measured),
          }),
        };
      }
      activeExperiment = null;
      await verifyServedAssets(manifest, config.origin, synthetic.cookie);
    } catch (error) {
      verificationError = error;
    }
    await control('/phase', { phase: 'cleanup' });
    if (reservation)
      await cleanupSynthetic(config.origin, reservation.id, {
        preserveReservation: experimentPlan.run.includes('capacity') && !verificationError,
      });
    cleaned = !experimentPlan.run.includes('capacity') || !!verificationError;
    if (verificationError) throw verificationError;
    if (experimentPlan.run.includes('capacity')) {
      activeExperiment = 'capacity';
      const corpusDirectory =
        verification.corpus?.directory || resolve(verification.calibrationFile, '..', 'corpus');
      if (verification.corpus && verification.corpus.id !== calibration.corpusId)
        throw Error('Corpus was not characterized by this calibration');
      const workload = await readCorpus(corpusDirectory, calibration.corpusId);
      if (workload.browserVersion !== profile.calibration.browserVersion)
        throw Error('Corpus browser differs from calibration');
      assertCaptureWorkload(workload, profile.calibration.workload);
      performanceEvidence = await measureCaptureLoad({
        origin: config.origin,
        capture: workload,
        seconds: profile.capacitySeconds,
        reservation,
      });
      cleaned = true;
      experimentPlan.results.capacity = {
        status: 'PASS',
        receipt: experimentReceipt('capacity', context, performanceEvidence),
      };
    }
    activeExperiment = null;
    if (!experimentPlan.exception) verifyExperimentResults(experimentPlan.results);
    await recordExperimentPasses(
      directory,
      historyPath,
      evidence,
      experimentPlan.results,
      experimentPlan.run,
      control,
    );

    const current = await api(`workers/scripts/${config.workerName}/deployments`);
    const version = current.deployments?.[0]?.versions?.[0]?.version_id;
    if (!version || version === config.expectedPredecessor)
      throw Error('Deployed version did not change');
    if (!experimentPlan.exception) verifyExperimentResults(experimentPlan.results);
    await writeFile(
      join(directory, `verified-${config.environment}.json`),
      JSON.stringify({
        artifact: manifest.artifact,
        environment: config.environment,
        status: 'passed',
        schema: 2,
        ...captureMode,
        behaviorConfiguration: behaviorConfiguration(desired),
        qualification: experimentPlan.exception ? 'EXCEPTION' : 'PASS',
        experiments: experimentPlan.results,
        exception: experimentPlan.exception
          ? {
              ...experimentPlan.exception,
              artifact: manifest.artifact,
              environment: config.environment,
              attempt: attempt.attempt,
              actor: config.publisher || 'local',
              policyVersion: 1,
            }
          : undefined,
        smoke: {
          status: 'PASS',
          captureSeconds: measured.captureSeconds,
          workload: assertCaptureWorkload(measured),
          finalOutbox: measured.finalOutbox,
        },
        performance: performanceEvidence,
        version,
        configuration: { before: effectiveBefore, after: effectiveAfter },
        configHash: sha(await readFile(configPath)),
        expires: manifest.expires,
      }),
      { mode: 0o600 },
    );
    await rm(privateDirectory, { recursive: true, force: true });
    privateDirectory = null;
    await control('/phase', { phase: 'complete', version });
    if (config.publisher !== 'github')
      run('gh', ['variable', 'set', variable, '--repo', config.repository, '--body', prior]);
    await control('/release');
    console.log(
      JSON.stringify({
        environment: config.environment,
        version,
        artifact: manifest.artifact,
        status: experimentPlan.exception ? 'deployed-with-exception' : 'passed',
      }),
    );
  } catch (error) {
    if (activeExperiment) {
      const diagnosticPath = join(directory, `experiment-failure-${attempt.attempt}.json`);
      // Preserve useful numeric evidence, never invitation URLs, media or private events.
      const diagnostic = {
        family: activeExperiment,
        artifact: manifest.artifact,
        attempt: attempt.attempt,
        errorType: error.name,
        reason: String(error.message)
          .replace(/https?:\/\/[^\s]+/g, '[redacted URL]')
          .slice(0, 2000),
        capture: measured
          ? {
              captureSeconds: measured.captureSeconds,
              browserVersion: measured.browserVersion,
              outboxSamples: measured.outboxSamples,
              finalOutbox: measured.finalOutbox,
              screenBytes: measured.screenBytes,
              maximumScreenChunkBytes: measured.maximumScreenChunkBytes,
              workloadActions: measured.workloadActions,
            }
          : null,
      };
      await writeFile(diagnosticPath, JSON.stringify(diagnostic, null, 2), { mode: 0o600 });
      const failed = {
        ...experimentReceipt(activeExperiment, context, {}, Date.now()),
        status: 'FAIL',
        id: crypto.randomUUID(),
        artifact: manifest.artifact,
        attempt: attempt.attempt,
        reason: 'Experiment failed; inspect artifact-bound experiment-failure report',
      };
      evidence.push(failed);
      try {
        await control('/experiment-failed', {
          failure: Object.fromEntries(
            ['id', 'family', 'status', 'identity', 'artifact', 'measuredAt', 'reason'].map(
              (key) => [key, failed[key]],
            ),
          ),
        });
      } catch (historyError) {
        await writeFile(historyPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
        throw new AggregateError(
          [error, historyError],
          'Experiment failed and coordinator persistence failed; retain local history and owner',
        );
      }

      await writeFile(historyPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
      console.error(`Preserved experiment failure ${failed.id} in ${historyPath}`);
    }
    throw error;
  } finally {
    try {
      if (reservation && !cleaned) await cleanupSynthetic(config.origin, reservation.id);
    } finally {
      if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory, config, ownerFile, quiescence] = process.argv.slice(2);
  if (command === 'prepare' && directory) await prepareRelease(directory);
  else if (['deploy', 'rollback'].includes(command) && directory && config)
    await deployRelease(directory, config, undefined, { rollback: command === 'rollback' });
  else if (
    ['recover', 'recover-rollback'].includes(command) &&
    directory &&
    config &&
    ownerFile &&
    quiescence === '--publisher-stopped'
  ) {
    const owner = JSON.parse(await readFile(ownerFile, 'utf8'));
    await deployRelease(directory, config, owner, {
      recovery: true,
      rollback: command === 'recover-rollback',
    });
  } else
    throw Error(
      'Usage: release prepare <new-private-directory> | deploy|rollback <release-directory> <private-config.json> | recover|recover-rollback <selected-release> <private-config.json> <private-owner-file> --publisher-stopped',
    );
}
