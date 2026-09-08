// Trusted workflow glue. No credentials or recording payloads are written to artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyPackage, deployRelease } from './release.mjs';
import { assertStagingOrder } from './release-policy.mjs';
const policy = JSON.parse(
  await readFile(new URL('./release-policy.json', import.meta.url), 'utf8'),
);
const [command, environment = 'staging', directory = '.release-private/ci'] = process.argv.slice(2);
const gh = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
const repo = process.env.GITHUB_REPOSITORY;
const rollback = process.env.RELEASE_ROLLBACK === 'true';
const prefix = environment === 'production' ? 'PRODUCTION' : 'STAGING';
const config = JSON.parse(process.env.RELEASE_CONFIG || '{}');
config.environment = environment;
config.repository = repo;
config.origin = environment === 'production' ? policy.productionOrigin : config.origin;
config.publisher = 'github';
if (command === 'eligible') {
  if (
    process.env.GITHUB_EVENT_NAME === 'push' &&
    process.env.GITHUB_REF_NAME === policy.releaseBranch
  )
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
        run.event !== 'push' ||
        run.head_branch !== policy.releaseBranch ||
        run.head_sha !== manifest.head ||
        run.path !== '.github/workflows/ci.yml'
      )
        throw Error('Untrusted release provenance');
      const latest = gh(
        `repos/${repo}/actions/workflows/ci.yml/runs?branch=${policy.releaseBranch}&event=push&status=success&per_page=1`,
      );
      if (String(latest.workflow_runs?.[0]?.id) !== id)
        throw Error('Superseded release; use explicit compatible rollback');
    }
    if (process.env.RELEASE_DIGEST !== manifest.artifact)
      throw Error('Selected artifact digest mismatch');
    config.evidence = `${directory}/verified-staging.json`;
  }
  const checkStagingOrder = () => {
    if (environment !== 'staging') return;
    const latest = gh(
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=${policy.releaseBranch}&event=push&status=success&per_page=1`,
    );
    assertStagingOrder({
      candidate: process.env.GITHUB_RUN_NUMBER,
      latestSuccessful: latest.workflow_runs?.[0]?.run_number,
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
          const latest = gh(
            `repos/${repo}/actions/workflows/ci.yml/runs?branch=${policy.releaseBranch}&event=push&status=success&per_page=1`,
          );
          if (String(latest.workflow_runs?.[0]?.id) !== process.env.RELEASE_RUN_ID)
            throw Error('Release superseded before mutation');
        }
      },
    });
  } else throw Error('Unknown CI release command');
}
