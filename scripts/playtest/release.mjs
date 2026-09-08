import { measureCaptureLoad } from './load.mjs';
import { assertReservationLifetime } from './release-policy.mjs';
import { validateReleaseConfig } from './release-config.mjs';
import {
  inspectDeployment,
  captureAdmin,
  verifySynthetic,
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
  return manifest;
}
export async function prepareRelease(destination) {
  const root = process.cwd(),
    out = resolve(destination);
  if (!relative(root, out).startsWith('.release-private/'))
    throw Error('Prepare destination must be a new .release-private/<release> directory');
  const head = text('git', ['rev-parse', 'HEAD']);
  const paths = text('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort();
  if (paths.some((path) => /(^|\/)(\.env(?:\.|$)|\.dev\.vars|secrets?\.)/.test(path)))
    throw Error('Review secret-like source paths before packaging');
  const source = {};
  for (const path of paths) {
    const info = await lstat(path).catch(() => null);
    if (!info) continue;
    if (!info.isFile()) throw Error(`Unsupported source input: ${path}`);
    source[path] = sha(await readFile(path));
  }
  await mkdir(resolve(out, '..'), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  const snapshot = join(out, 'source');
  run('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, snapshot]);
  for (const path of Object.keys(source)) {
    const target = join(snapshot, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(root, path), target);
  }
  await writeFile(join(out, 'source.json'), JSON.stringify({ head, source }, null, 2), {
    mode: 0o600,
  });
  run('npm', ['ci'], snapshot);
  // Qualification exit 2 is acceptable for release automation only when its report
  // confirms automation passed; human acceptance is never invented by deployment.
  try {
    run('npm', ['run', 'verify:final'], snapshot);
  } catch (error) {
    const report = JSON.parse(
      await readFile(join(snapshot, 'artifacts', 'verification-final.json'), 'utf8'),
    );
    if (error.status !== 2 || report.outcome?.automation?.status !== 'PASS') throw error;
  }
  const payload = join(out, 'payload');
  await mkdir(payload);
  await mkdir(join(payload, 'assets'));
  const assets = await inventory(join(snapshot, 'dist'));
  for (const path of Object.keys(assets)) {
    if (path.startsWith('.') || path.endsWith('.map')) continue;
    const target = join(payload, 'assets', path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(snapshot, 'dist', path), target);
  }
  run(
    'npx',
    ['--no-install', 'wrangler', 'deploy', '--dry-run', '--outdir', join(payload, 'backend')],
    snapshot,
  );
  // Source drift outside the frozen copy is also a rejection, never a silent selection.
  for (const [path, hash] of Object.entries(source))
    if (sha(await readFile(join(root, path))) !== hash)
      throw Error('Source changed during release preparation');
  const current = text('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(paths) !== JSON.stringify(current))
    throw Error('Source input list changed during preparation');
  const files = await inventory(payload),
    artifact = sha(JSON.stringify(files));
  const manifest = {
    schema: 1,
    protocolVersion: 2,
    createOnlyPayloads: true,
    artifact,
    files,
    head,
    sourceHash: sha(JSON.stringify(source)),
    origin: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local',
    appBuild: /<meta[^>]+name="build-id"[^>]+content="([^"]+)"/.exec(
      await readFile(join(payload, 'assets/index.html'), 'utf8'),
    )?.[1],
    created: Date.now(),
    expires: Date.now() + 14 * 86400000,
  };
  await writeFile(join(out, 'release.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory: out, artifact }));
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
      (!recovery && (saved.artifact !== owner.artifact || saved.predecessor !== owner.predecessor))
    )
      throw Error('Owner file identity mismatch');
    Object.assign(owner, saved);
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
  if (
    config.environment === 'production' &&
    !rollback &&
    !(recovery && admittedOwner?.artifact === manifest.artifact)
  ) {
    const evidence = JSON.parse(await readFile(config.evidence, 'utf8'));
    if (
      evidence.artifact !== manifest.artifact ||
      evidence.environment !== 'staging' ||
      evidence.status !== 'passed' ||
      !Number.isFinite(evidence.expires) ||
      evidence.expires <= Date.now()
    )
      throw Error('Exact artifact requires fresh staging verification');
  }
  const desired = JSON.parse(await readFile(config.wranglerConfig, 'utf8'));
  validateReleaseConfig(config, desired);
  config.bucketName = desired.r2_buckets[0].bucket_name;
  const attempt = admittedOwner
    ? { ...admittedOwner }
    : {
        attempt: crypto.randomUUID(),
        token: randomBytes(32).toString('hex'),
        artifact: manifest.artifact,
        predecessor: config.expectedPredecessor,
      };
  const ownerPath = join(directory, `owner-${config.environment}-${attempt.attempt}.json`);
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
  let reservation,
    privateDirectory,
    cleaned = false;
  try {
    const effectiveBefore = await inspectDeployment(config);
    const reserve = () =>
      captureAdmin(config.origin, 'synthetic', {
        slots: config.environment === 'staging' ? 20 : 2,
        bytes: config.environment === 'staging' ? 20 * 1024 ** 3 : 32 * 1024 ** 2,
        metadataBytes: config.environment === 'staging' ? 1024 ** 3 : 1024 ** 2,
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
    if (!restoration)
      assertReservationLifetime(
        reservation,
        config.environment === 'staging' ? 3600000 : 20 * 60000,
      );
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
      if (restoration) {
        if (attempt.reservationId) await cleanupSynthetic(config.origin, attempt.reservationId);
        reservation = await reserve();
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
        execFileSync(process.execPath, ['scripts/verify-remote-playtest.mjs'], {
          env: {
            ...process.env,
            PLAYTEST_VERIFY_ORIGIN: config.origin,
            PLAYTEST_VERIFY_TOKEN: invitation.token,
            PLAYTEST_VERIFY_BUILD: manifest.appBuild,
            PLAYTEST_VERIFY_ADAPTER: 'cloud',
            PLAYTEST_CAPTURE_SECONDS: config.environment === 'staging' ? '1800' : '0',
            PLAYTEST_VERIFY_RESULT: browserResultPath,
            PLAYTEST_VERIFY_PRIVATE_ROOT: privateDirectory,
          },
          stdio: 'pipe',
          timeout: config.environment === 'staging' ? 1950000 : 90000,
        });
      } catch {
        throw Error('Deployed browser verification failed; synthetic diagnostics removed');
      }
      for (const [path, hash] of Object.entries(manifest.files)) {
        if (!path.startsWith('assets/')) continue;
        const response = await fetch(new URL('/' + path.slice(7), config.origin), {
          headers: { cookie: synthetic.cookie },
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        });
        if (!response.ok || sha(new Uint8Array(await response.arrayBuffer())) !== hash)
          throw Error('Served artifact integrity mismatch');
      }
    } catch (error) {
      verificationError = error;
    }
    await control('/phase', { phase: 'cleanup' });
    if (reservation)
      await cleanupSynthetic(config.origin, reservation.id, {
        preserveReservation: config.environment === 'staging' && !verificationError,
      });
    cleaned = config.environment !== 'staging' || !!verificationError;
    if (verificationError) throw verificationError;
    if (config.environment === 'staging') {
      const measured = JSON.parse(await readFile(browserResultPath, 'utf8'));
      if (measured.captureSeconds !== 1800) throw Error('Thirty-minute capture evidence required');
      performanceEvidence = await measureCaptureLoad({
        origin: config.origin,
        capture: measured,
        reservation,
      });
      cleaned = true;
    }
    const current = await api(`workers/scripts/${config.workerName}/deployments`);
    const version = current.deployments?.[0]?.versions?.[0]?.version_id;
    if (!version || version === config.expectedPredecessor)
      throw Error('Deployed version did not change');
    await writeFile(
      join(directory, `verified-${config.environment}.json`),
      JSON.stringify({
        artifact: manifest.artifact,
        environment: config.environment,
        status: 'passed',
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
        status: 'passed',
      }),
    );
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
