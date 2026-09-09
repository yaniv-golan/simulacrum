// Read effective configuration, then exercise only a reserved synthetic session.
import { verifyCredentialIsolation } from './credential-isolation.mjs';
import { validateEffectiveBindings } from './release-config.mjs';
import { downloadCapture } from './download.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export async function inspectDeployment(config) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const request = (path, options = {}) =>
    fetch(`https://api.cloudflare.com/client/v4/${path}`, {
      ...options,
      headers: { ...options.headers, authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  const get = async (path) => {
    const r = await request(path);
    if (!r.ok) throw Error(`Configuration inspection failed ${r.status}`);
    const j = await r.json();
    if (!j.success) throw Error('Configuration inspection failed');
    return j.result;
  };
  const isolation = await verifyCredentialIsolation(config, request);
  const settings = await get(
    `accounts/${config.accountId}/workers/scripts/${config.workerName}/settings`,
  );
  const scriptSettings = await get(
    `accounts/${config.accountId}/workers/scripts/${config.workerName}/script-settings`,
  );
  // Cloudflare returns explicit null when observability is disabled. Missing
  // fields remain unverified; versioned binding settings are not this read model.
  const observability = scriptSettings?.observability;
  if (
    !scriptSettings ||
    !Object.hasOwn(scriptSettings, 'observability') ||
    scriptSettings.logpush !== false ||
    !(
      scriptSettings.tail_consumers === null ||
      (Array.isArray(scriptSettings.tail_consumers) && scriptSettings.tail_consumers.length === 0)
    ) ||
    !(
      observability === null ||
      (observability?.enabled === false &&
        observability.logs?.enabled === false &&
        observability.logs?.invocation_logs === false &&
        observability.traces?.enabled === false)
    )
  )
    throw Error('Unverified Worker logging destination');
  validateEffectiveBindings(config, settings);
  const scheduling = await get(
    `accounts/${config.accountId}/workers/scripts/${config.workerName}/schedules`,
  );
  if (!scheduling.schedules?.some((s) => s.cron === '*/5 * * * *'))
    throw Error('Effective cleanup Cron missing');
  if (!config.bucketName) throw Error('Recording bucket identity required');
  const bucket = `accounts/${config.accountId}/r2/buckets/${config.bucketName}`;
  const managed = await get(`${bucket}/domains/managed`),
    custom = await get(`${bucket}/domains/custom`),
    lifecycle = await get(`${bucket}/lifecycle`);
  if (
    managed.enabled !== false ||
    !Array.isArray(custom.domains) ||
    custom.domains.some((domain) => domain.enabled) ||
    !Array.isArray(lifecycle.rules) ||
    lifecycle.rules.some((rule) => rule.enabled)
  )
    throw Error('Private bucket and permanent deletion markers required');
  const accountJobs = await get(`accounts/${config.accountId}/logpush/jobs`);
  if (accountJobs.some((job) => job.enabled && job.dataset === 'workers_trace_events'))
    throw Error('Active Worker Logpush destination requires review');
  let zoneJobs = [];
  if (config.environment === 'production') {
    if (!config.zoneId) throw Error('Production zone logging inspection required');
    const zone = await get(`zones/${config.zoneId}`);
    if (zone.account?.id !== config.accountId) throw Error('Production zone account mismatch');
    zoneJobs = await get(`zones/${config.zoneId}/logpush/jobs`);
    if (zoneJobs.some((job) => job.enabled && job.dataset === 'http_requests'))
      throw Error('Active request Logpush destination requires review');
  }
  return {
    accountIsolation: isolation,
    loggingVerified: true,
    loggingMode: 'all-account-controlled-destinations-disabled',
    effectiveDigest: createHash('sha256')
      .update(
        JSON.stringify({
          settings,
          scriptSettings,
          managed,
          custom,
          lifecycle,
          accountJobs,
          zoneJobs,
        }),
      )
      .digest('hex'),
  };
}
export async function captureAdmin(origin, path, body, method = 'POST') {
  const token = process.env.PLAYTEST_ADMIN_TOKEN;
  if (!token || token.length < 32) throw Error('PLAYTEST_ADMIN_TOKEN required');
  const r = await fetch(new URL('/admin/playtest/' + path, origin), {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw Error(`Synthetic control failed ${r.status}`);
  return r.json();
}
export async function cleanupSynthetic(origin, runId, { preserveReservation = false } = {}) {
  await captureAdmin(
    origin,
    `synthetic/${runId}${preserveReservation ? '/drain' : ''}`,
    undefined,
    preserveReservation ? 'POST' : 'DELETE',
  );
  const deadline = Date.now() + 15 * 60000;
  while (Date.now() < deadline) {
    const sessions = await captureAdmin(origin, 'sessions', undefined, 'GET');
    if (!sessions.some((s) => s.synthetic === runId)) return;
    await captureAdmin(origin, 'reconcile');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error('Synthetic cleanup incomplete; capacity remains charged');
}
export async function verifySynthetic(config, reservation, directory) {
  const invitation = await captureAdmin(config.origin, `synthetic/${reservation.id}/invitation`);
  const login = await fetch(
    new URL(`/join?token=${encodeURIComponent(invitation.token)}`, config.origin),
    { redirect: 'manual', signal: AbortSignal.timeout(15000) },
  );
  if (login.status !== 303 || login.headers.get('location') !== '/')
    throw Error('Invitation redirect failed');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw Error('Missing invitation cookie');
  // No diagnostic sinks are allowed by inspectDeployment. Exercise capability
  // rejection paths with synthetic credentials, never real participant secrets.
  for (const [path, options, expected] of [
    [`/join?token=invalid-${crypto.randomUUID()}`, {}, 401],
    [
      '/api/playtest/v2/session',
      { method: 'POST', body: '{}', headers: { origin: config.origin } },
      401,
    ],
    [
      '/api/playtest/v2/session',
      { method: 'POST', body: '{}', headers: { cookie, origin: 'https://wrong.invalid' } },
      403,
    ],
    [
      '/admin/playtest/sessions',
      { headers: { cookie, authorization: `Bearer synthetic-invalid-${crypto.randomUUID()}` } },
      403,
    ],
  ]) {
    const probe = await fetch(new URL(path, config.origin), {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    await probe.arrayBuffer();
    if (probe.status !== expected) throw Error('Synthetic authentication boundary failed');
  }
  const post = async (path, body) => {
    const response = await fetch(new URL(path, config.origin), {
      method: 'POST',
      headers: { cookie, origin: config.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error(`Synthetic upload failed ${response.status}`);
    return response.json();
  };
  const created = await post('/api/playtest/v2/session', {
    requestId: crypto.randomUUID(),
    metadata: { build: config.artifact, synthetic: true },
  });
  const receipt = await post(`/api/playtest/v2/${created.sessionId}/event`, {
    id: 'smoke',
    kind: 'release-smoke',
    data: { synthetic: true },
  });
  if (receipt.protocolVersion !== 2 || receipt.sessionId !== created.sessionId)
    throw Error('Synthetic receipt mismatch');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await downloadCapture({
    origin: config.origin,
    sessionId: created.sessionId,
    directory: join(directory, created.sessionId),
  });
  return { sessionId: created.sessionId, protocolVersion: 2, cookie };
}

export async function verifyServedAssets(manifest, origin, cookie, request = fetch) {
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!path.startsWith('assets/')) continue;
    // Workers Static Assets canonicalizes index.html to the directory URL.
    const route = path === 'assets/index.html' ? '/' : '/' + path.slice(7);
    const response = await request(new URL(route, origin), {
      headers: { cookie },
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    if (
      !response.ok ||
      createHash('sha256')
        .update(new Uint8Array(await response.arrayBuffer()))
        .digest('hex') !== hash
    )
      throw Error('Served artifact integrity mismatch');
  }
}
