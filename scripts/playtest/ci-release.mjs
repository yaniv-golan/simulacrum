// Trusted workflow glue. No credentials or recording payloads are written to artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyPackage, deployRelease } from './release.mjs';
import { assertStagingOrder } from './release-policy.mjs';
import { retrieveGitHubEvidence } from './experiment-transport.mjs';
import { retrieveCalibrationBundle } from './calibration-bundle.mjs';
import { readCalibrationEvidence } from './calibration-evidence.mjs';
import { releaseEligible } from './ci-verification.mjs';
import { selectExperiments, verifyExperimentResults, validateProfile } from './experiments.mjs';
const policy = JSON.parse(
  await readFile(new URL('./release-policy.json', import.meta.url), 'utf8'),
);
export function latestReleaseRun(query, repository, branch) {
  const candidates = ['push', 'workflow_dispatch'].flatMap((event) => {
    const response = query(
      `repos/${repository}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&event=${event}&status=success&per_page=1`,
    );
    if (!Array.isArray(response.workflow_runs)) throw Error('Invalid GitHub release listing');
    return response.workflow_runs.filter(
      (run) =>
        run.event === event &&
        run.head_branch === branch &&
        run.conclusion === 'success' &&
        run.path === '.github/workflows/ci.yml' &&
        run.head_repository?.full_name === repository,
    );
  });
  if (
    candidates.some(
      (run) =>
        !Number.isSafeInteger(run.run_number) ||
        run.run_number <= 0 ||
        !Number.isSafeInteger(run.id),
    )
  )
    throw Error('Invalid GitHub release ordering');
  return candidates.sort((a, b) => b.run_number - a.run_number)[0];
}
export function assertExperimentAdmission(
  verification,
  { production = false, rollback = false, staged, artifact } = {},
) {
  if (!['auto', 'full', 'bypass-expensive'].includes(verification.mode))
    throw Error('Unknown experiment mode');
  if (verification.mode !== 'bypass-expensive') validateProfile(verification.profile);
  if (
    production &&
    !rollback &&
    (staged?.schema !== 2 || staged.artifact !== artifact || staged.smoke?.status !== 'PASS')
  )
    throw Error('Exact staging smoke evidence required');
}
export async function admitGitHubCalibration(verification, directory, options) {
  if (verification.mode === 'bypass-expensive') return;
  // Both fresh runners retrieve the same pinned private inputs before owner admission.
  verification.calibrationFile = await retrieveCalibrationBundle(
    verification.calibrationBundle,
    `${directory}/calibration`,
    options,
  );
  delete verification.corpus;
  await readCalibrationEvidence(verification.profile, verification.calibrationFile);
}
async function main() {
  const [command, environment = 'staging', directory = '.release-private/ci'] =
    process.argv.slice(2);
  const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
  const repo = process.env.GITHUB_REPOSITORY;
  const rollback = process.env.RELEASE_ROLLBACK === 'true';
  const prefix = environment === 'production' ? 'PRODUCTION' : 'STAGING';
  const config = JSON.parse(process.env.RELEASE_CONFIG || '{}');
  config.environment = environment;
  config.repository = repo;
  config.origin = environment === 'production' ? policy.productionOrigin : config.origin;
  config.publisher = 'github';
  // Workflow inputs are per-dispatch, never a persistent bypass preference in vars.
  config.verification = {
    ...config.verification,
    mode: process.env.RELEASE_VERIFICATION_MODE || 'auto',
    reason: process.env.RELEASE_VERIFICATION_REASON || '',
    acknowledgeFailures: JSON.parse(process.env.RELEASE_ACKNOWLEDGE_FAILURES || '[]'),
  };

  if (command === 'eligible') {
    if (releaseEligible(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF_NAME))
      console.log('true');
    else console.log('false');
  } else {
    if (!['staging', 'production'].includes(environment) || !repo)
      throw Error('Trusted environment/repository required');
    const manifest = await verifyPackage(directory, { rollback });
    config.artifact = manifest.artifact;
    if (environment === 'production') {
      const id = process.env.RELEASE_RUN_ID;
      if (!/^\d+$/.test(id || '')) throw Error('Eligible release run ID required');
      const run = gh(`repos/${repo}/actions/runs/${id}`);
      if (run.conclusion !== 'success' || run.head_repository?.full_name !== repo)
        throw Error('Untrusted release provenance');
      if (rollback) {
        if (
          run.event !== 'workflow_dispatch' ||
          run.path !== '.github/workflows/deploy-production.yml'
        )
          throw Error('Previously successful production run required');
      } else {
        if (
          !['push', 'workflow_dispatch'].includes(run.event) ||
          run.head_branch !== policy.releaseBranch ||
          run.head_sha !== manifest.head ||
          run.path !== '.github/workflows/ci.yml'
        )
          throw Error('Untrusted release provenance');
        const latest = latestReleaseRun(gh, repo, policy.releaseBranch);
        if (String(latest?.id) !== id)
          throw Error('Superseded release; use explicit compatible rollback');
      }
      if (process.env.RELEASE_DIGEST !== manifest.artifact)
        throw Error('Selected artifact digest mismatch');
      config.evidence = `${directory}/verified-staging.json`;
    }
    const staged =
      environment === 'production' && !rollback
        ? JSON.parse(await readFile(config.evidence, 'utf8'))
        : undefined;
    assertExperimentAdmission(config.verification, {
      production: environment === 'production',
      rollback,
      staged,
      artifact: manifest.artifact,
    });
    await admitGitHubCalibration(config.verification, directory);
    if (config.verification.mode === 'bypass-expensive') {
      const response = await fetch(new URL('/experiment-failures', config.coordinator), {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.PLAYTEST_CONTROL_TOKEN}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error('Cannot read durable experiment history');
      const failures = (await response.json()).failures;
      if (!Array.isArray(failures)) throw Error('Invalid durable experiment history');
      selectExperiments({ ...config.verification, profile: null, evidence: failures });
    } else if (environment === 'production' && !rollback && config.verification.mode === 'auto')
      verifyExperimentResults(staged.experiments);
    const checkStagingOrder = () => {
      if (environment !== 'staging') return;
      const latest = latestReleaseRun(gh, repo, policy.releaseBranch);
      assertStagingOrder({
        candidate: process.env.GITHUB_RUN_NUMBER,
        latestSuccessful: latest?.run_number,
      });
    };
    checkStagingOrder();
    const enabled = gh(`repos/${repo}/actions/variables/DEPLOY_${prefix}_ENABLED`).value;
    if (enabled !== 'true') throw Error('Deployment paused');
    const secret = process.env.PLAYTEST_CONTROL_TOKEN;
    if (!secret || secret.length < 32) throw Error('Coordinator credential required');
    const currentResponse = await fetch(new URL('/current', config.coordinator), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!currentResponse.ok) throw Error('Cannot read coordinator version');
    const observed = (await currentResponse.json()).version;
    if (environment === 'production') {
      config.expectedPredecessor = process.env.RELEASE_PREDECESSOR;
      if (!config.expectedPredecessor || (observed && observed !== config.expectedPredecessor))
        throw Error('Production predecessor changed; dispatch a fresh reviewed release');
    } else config.expectedPredecessor = observed || config.expectedPredecessor;
    const attemptId = `github-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${environment}`;
    const owner = {
      attempt: attemptId,
      token: createHmac('sha256', secret).update(attemptId).digest('hex'),
      artifact: manifest.artifact,
      predecessor: config.expectedPredecessor,
    };
    if (command === 'preflight') {
      const response = await fetch(new URL('/acquire', config.coordinator), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(owner),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error(`Publisher admission failed ${response.status}`);
    } else if (command === 'deploy') {
      if (environment === 'staging') {
        const prior = await retrieveGitHubEvidence(
          repo,
          policy.releaseBranch,
          process.env.GITHUB_RUN_ID,
        );
        const evidencePath = `${directory}/prior-experiment-evidence.json`;
        await writeFile(evidencePath, JSON.stringify(prior), { mode: 0o600 });
        config.verification.evidenceFiles = [
          ...(config.verification.evidenceFiles || []),
          evidencePath,
        ];
      }
      const wranglerPath = `${directory}/environment.json`;
      if (!config.wrangler) throw Error('Reviewed environment configuration required');
      await writeFile(wranglerPath, JSON.stringify(config.wrangler));
      config.wranglerConfig = wranglerPath;
      const path = `${directory}/ci-config.json`;
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      await deployRelease(directory, path, owner, {
        rollback,
        eligibilityGuard: () => {
          checkStagingOrder();
          if (environment === 'production' && !rollback) {
            const latest = latestReleaseRun(gh, repo, policy.releaseBranch);
            if (String(latest?.id) !== process.env.RELEASE_RUN_ID)
              throw Error('Release superseded before mutation');
          }
        },
      });
    } else throw Error('Unknown CI release command');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
