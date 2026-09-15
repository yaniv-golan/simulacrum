import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage } from '../scripts/playtest/release.mjs';
import { validateReleaseConfig } from '../scripts/playtest/release-config.mjs';
import { verificationHash } from '../scripts/playtest/package-verification.mjs';
import { verificationOutcome } from '../scripts/verification-outcome.mjs';
function verifiedFixture(manifest) {
  const source = { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) };
  const checks = [{ id: 'fixture-check', ok: true, configuration: {}, elapsedMs: 1 }];
  const results = [
    { id: 'ci', ok: true },
    { id: 'browser', ok: true },
    {
      id: 'gate',
      ok: false,
      result: {
        failed: 0,
        unmet: 0,
        dueBarCount: 1,
        bars: [{ id: 'F1', human: true, state: 'RED', assessment: 'pending' }],
      },
    },
  ];
  const outcome = verificationOutcome(results, checks);
  Object.assign(manifest, {
    head: source.head,
    sourceHash: 'c'.repeat(64),
    appBuild: 'fixture-build',
  });
  manifest.verification = {
    artifact: manifest.artifact,
    sourceHash: manifest.sourceHash,
    build: manifest.appBuild,
    source,
    runtime: process.version,
    checks,
    results,
    automation: outcome.automation,
    humanAcceptance: outcome.humanAcceptance,
  };
  manifest.verificationHash = verificationHash(manifest.verification);
  return manifest;
}
test('release package rejects changed bytes, expiry and incompatible capture rollback', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'payload'));
  await writeFile(join(root, 'payload/worker.js'), 'verified');
  const hash = (v) => createHash('sha256').update(v).digest('hex'),
    files = { 'worker.js': hash('verified') };
  const manifest = verifiedFixture({
    protocolVersion: 2,
    createOnlyPayloads: true,
    artifact: hash(JSON.stringify(files)),
    files,
    expires: Date.now() + 10000,
  });
  const save = (value) => writeFile(join(root, 'release.json'), JSON.stringify(value));
  await save(manifest);
  assert.equal((await verifyPackage(root)).artifact, manifest.artifact);
  for (const verification of [undefined, { automation: { status: 'FAIL' } }]) {
    await save({ ...manifest, verification });
    await assert.rejects(verifyPackage(root), /verification/i);
  }
  for (const mutate of [
    (m) => m.verification.checks.pop(),
    (m) => m.verification.checks.push(m.verification.checks[0]),
    (m) => m.verification.results.pop(),
    (m) => (m.verification.source.head = 'd'.repeat(40)),
    (m) => (m.verification.build = 'wrong'),
    (m) => (m.verification.runtime = ''),
    (m) => (m.verification.artifact = 'e'.repeat(64)),
    (m) => (m.verification.checks[0].ok = false),
  ]) {
    const wrong = structuredClone(manifest);
    mutate(wrong);
    wrong.verificationHash = verificationHash(wrong.verification);
    await save(wrong);
    await assert.rejects(verifyPackage(root), /verification/i);
  }
  // Every tier since the launch admission opens its results with that row: a passed one is
  // admitted ahead of the three phases; a refused one, a misplaced one or any other extra row
  // is not a package.
  const admitted = structuredClone(manifest);
  admitted.verification.results.unshift({ id: 'launch-admission', ok: true });
  admitted.verificationHash = verificationHash(admitted.verification);
  await save(admitted);
  assert.equal((await verifyPackage(root)).artifact, manifest.artifact);
  for (const [mutate, message] of [
    [(m) => (m.verification.results[0].ok = false), /launch admission did not pass/],
    [(m) => m.verification.results.push(m.verification.results.shift()), /Incomplete/],
    [(m) => m.verification.results.push({ id: 'scope-stability', ok: true }), /Incomplete/],
    [(m) => (m.verification.results[0].id = 'admission'), /Incomplete/],
  ]) {
    const wrong = structuredClone(admitted);
    mutate(wrong);
    wrong.verificationHash = verificationHash(wrong.verification);
    await save(wrong);
    await assert.rejects(verifyPackage(root), message);
  }
  await save(manifest);
  await writeFile(join(root, 'payload/worker.js'), 'substituted');
  await assert.rejects(verifyPackage(root), /integrity/);
  await writeFile(join(root, 'payload/worker.js'), 'verified');
  await save({ ...manifest, expires: 0 });
  await assert.rejects(verifyPackage(root), /expired/);
  await save({ ...manifest, protocolVersion: 1 });
  await assert.rejects(verifyPackage(root), /Incompatible/);
});
test('release config rejects account overlap, alternate production URLs, logging and destructive migration', async () => {
  const worker = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const config = {
    environment: 'production',
    accountId: 'a'.repeat(32),
    otherAccountId: 'b'.repeat(32),
    workerName: 'workshop',
    origin: 'https://simulacrum.build',
  };
  Object.assign(worker, {
    account_id: config.accountId,
    name: config.workerName,
    routes: [{ pattern: 'simulacrum.build', custom_domain: true }],
  });
  worker.vars.ALLOWED_ORIGIN = config.origin;
  assert.doesNotThrow(() => validateReleaseConfig(config, worker));
  for (const mutate of [
    (w) => (w.workers_dev = true),
    (w) => (w.observability.logs.invocation_logs = true),
    (w) => (w.migrations = [{ tag: 'bad', deleted_classes: ['CaptureStore'] }]),
    (w) => (w.assets.run_worker_first = false),
  ]) {
    const wrong = structuredClone(worker);
    mutate(wrong);
    assert.throws(() => validateReleaseConfig(config, wrong));
  }
  assert.throws(() =>
    validateReleaseConfig({ ...config, otherAccountId: config.accountId }, worker),
  );
});

test('private export preserves exact raw event bytes and rejects corrupted payloads', async (t) => {
  const { downloadCapture } = await import('../scripts/playtest/download.mjs');
  const root = await mkdtemp(join(tmpdir(), 'capture-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = 'a'.repeat(32),
    objectKey = 'b'.repeat(32);
  const raw = ' { "kind" : "feedback-text", "data": "<script>" }\n';
  const hash = createHash('sha256').update(raw).digest('hex');
  let corrupted = false;
  const fetcher = async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${'x'.repeat(32)}`);
    return url.pathname.endsWith('/snapshot')
      ? Response.json({
          cutoff: 1,
          session: { sessionId },
          uploads: [
            {
              sessionId,
              objectKey,
              bytes: Buffer.byteLength(raw),
              sha256: hash,
              uploadHash: hash,
              receipt: {
                protocolVersion: 2,
                sessionId,
                logicalKey: 'event:e',
                uploadHash: hash,
                sequence: 1,
                receivedAt: new Date().toISOString(),
              },
            },
          ],
        })
      : new Response(corrupted ? raw + ' ' : raw);
  };
  const options = { origin: 'https://example.invalid', sessionId, token: 'x'.repeat(32), fetcher };
  await downloadCapture({ ...options, directory: join(root, 'good') });
  assert.equal(await readFile(join(root, 'good/event-1.json'), 'utf8'), raw);
  const journal = JSON.parse(await readFile(join(root, 'good/events.ndjson'), 'utf8'));
  assert.deepEqual(journal.rawEvent, {
    file: 'event-1.json',
    bytes: Buffer.byteLength(raw),
    sha256: hash,
  });
  corrupted = true;
  await assert.rejects(
    downloadCapture({ ...options, directory: join(root, 'corrupt') }),
    /checksum/,
  );
});

test('private export retries transient reads but never status or malformed responses', async (t) => {
  const { downloadCapture } = await import('../scripts/playtest/download.mjs');
  const root = await mkdtemp(join(tmpdir(), 'capture-read-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = 'a'.repeat(32);
  for (const mode of ['connect', 'body', 'exhausted', 'forbidden', 'redirect', 'malformed']) {
    let calls = 0;
    const options = {
      origin: 'https://example.invalid',
      sessionId,
      token: 'x'.repeat(32),
      directory: join(root, mode),
      fetcher: async (url, options) => {
        calls++;
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.authorization, `Bearer ${'x'.repeat(32)}`);
        assert.ok(options.signal instanceof AbortSignal);
        if (mode === 'forbidden') return new Response('', { status: 403 });
        if (mode === 'redirect') throw new TypeError('unexpected redirect');
        if (mode === 'malformed') return new Response('{');
        if (mode === 'exhausted' || (mode === 'connect' && calls === 1))
          throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
        if (mode === 'body' && calls === 1)
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('terminated', { cause: { code: 'ECONNRESET' } }));
              },
            }),
          );
        return Response.json({ cutoff: 0, session: { sessionId }, uploads: [] });
      },
    };
    if (['connect', 'body'].includes(mode)) {
      await downloadCapture(options);
      assert.equal(calls, 2);
    } else {
      await assert.rejects(downloadCapture(options));
      assert.equal(calls, mode === 'exhausted' ? 3 : 1);
    }
  }
});

test('staging admission rejects older runs and expired synthetic reservations', async () => {
  const { assertStagingOrder, assertReservationLifetime } = await import(
    '../scripts/playtest/release-policy.mjs'
  );
  assertStagingOrder({ candidate: '21', latestSuccessful: '20' });
  assertStagingOrder({ candidate: '21', latestSuccessful: '21' });
  assert.throws(
    () => assertStagingOrder({ candidate: '20', latestSuccessful: '21' }),
    /Superseded/,
  );
  assert.throws(
    () => assertStagingOrder({ candidate: 'oops', latestSuccessful: '21' }),
    /identity/,
  );
  assertReservationLifetime({ expires: 10000000 }, 3600000, 5000000);
  assert.throws(
    () => assertReservationLifetime({ expires: 8000000 }, 3600000, 5000000),
    /lifetime/,
  );
  assert.throws(() => assertReservationLifetime({}, 3600000, 5000000), /lifetime/);
});

test('effective bindings and cleanup scheduling cannot drift across a release', async () => {
  const { validateEffectiveBindings } = await import('../scripts/playtest/release-config.mjs');
  const config = { bucketName: 'recordings', captureNamespaceId: 'fixed-namespace' };
  const settings = {
    bindings: [
      { name: 'RECORDINGS', type: 'r2_bucket', bucket_name: 'recordings' },
      {
        name: 'CAPTURE',
        type: 'durable_object_namespace',
        namespace_id: 'fixed-namespace',
        class_name: 'CaptureStore',
      },
    ],
  };
  validateEffectiveBindings(config, settings);
  assert.throws(
    () => validateEffectiveBindings({ ...config, bucketName: 'replacement' }, settings),
    /binding/,
  );
  assert.throws(
    () => validateEffectiveBindings({ ...config, captureNamespaceId: 'replacement' }, settings),
    /binding/,
  );
});

test('persisted publisher identity supports retry without accepting another owner', async (t) => {
  const { persistOwner } = await import('../scripts/playtest/release.mjs');
  const root = await mkdtemp(join(tmpdir(), 'owner-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'owner.json'),
    a = {
      attempt: 'a',
      token: 'a'.repeat(32),
      artifact: 'a'.repeat(64),
      predecessor: 'v1',
      priorPause: 'true',
    };
  a.verificationIdentity = 'full';
  await persistOwner(path, a);
  await persistOwner(path, { ...a });
  await assert.rejects(persistOwner(path, { ...a, token: 'b'.repeat(32) }), /identity/);
  await assert.rejects(persistOwner(path, { ...a, artifact: 'b'.repeat(64) }), /identity/);
  await assert.rejects(
    persistOwner(path, { ...a, verificationIdentity: 'bypass' }, { recovery: true }),
    /identity/,
  );
  const recovered = { ...a, artifact: 'b'.repeat(64) };
  await persistOwner(path, recovered, { recovery: true });
  assert.equal(recovered.priorPause, 'true');
});

test('first staging recovery reuses ownership and cleans synthetic resources on either side of publication', async (t) => {
  const { deployRelease } = await import('../scripts/playtest/release.mjs');
  const { chmod, readdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'publisher-fault-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const savedEnv = { ...process.env },
    savedFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'payload'));
  for (const name of ['gh', 'npx']) {
    await writeFile(join(root, 'bin', name), '#!/bin/sh\nprintf true');
    await chmod(join(root, 'bin', name), 0o700);
  }
  Object.assign(process.env, {
    PATH: join(root, 'bin') + ':' + process.env.PATH,
    GH_TOKEN: 'test',
    CLOUDFLARE_API_TOKEN: 'test',
    PLAYTEST_CONTROL_TOKEN: 'c'.repeat(32),
    PLAYTEST_ADMIN_TOKEN: 'a'.repeat(32),
  });
  const artifact = createHash('sha256').update('{}').digest('hex');
  await writeFile(
    join(root, 'release.json'),
    JSON.stringify(
      verifiedFixture({
        files: {},
        artifact,
        protocolVersion: 2,
        createOnlyPayloads: true,
        expires: Date.now() + 3600000,
      }),
    ),
  );
  const worker = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  Object.assign(worker, { name: 'capture', account_id: 'a'.repeat(32), workers_dev: true });
  worker.vars.ALLOWED_ORIGIN = 'https://capture.example.workers.dev';
  await writeFile(join(root, 'worker.json'), JSON.stringify(worker));
  const config = {
    environment: 'staging',
    verification: { mode: 'bypass-expensive', reason: 'recovery fixture' },
    publisher: 'github',
    accountId: 'a'.repeat(32),
    otherAccountId: 'b'.repeat(32),
    origin: worker.vars.ALLOWED_ORIGIN,
    workerName: 'capture',
    captureNamespaceId: 'fixed',
    coordinator: 'https://control.invalid',
    repository: 'owner/repo',
    artifact,
    expectedPredecessor: 'initial',
    wranglerConfig: join(root, 'worker.json'),
    isolationTargets: {
      authorization: 'disposable-probes-only',
      currentWorker: 'simulacrum-isolation-current',
      otherWorker: 'simulacrum-isolation-other',
      currentBucket: 'simulacrum-isolation-current',
      otherBucket: 'simulacrum-isolation-other',
    },
  };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  // The real deployment entry point must refuse before admission or any remote mutation.
  globalThis.fetch = async () => {
    throw Error('Unexpected network before qualification guard');
  };
  for (const mode of ['auto', 'full']) {
    await writeFile(
      join(root, 'qualified.json'),
      JSON.stringify({ ...config, verification: { mode } }),
    );
    await assert.rejects(
      deployRelease(root, join(root, 'qualified.json')),
      /Feedback protocol v1 capacity is unqualified/,
    );
  }
  for (const stage of ['before', 'after', 'recovery', 'capacity']) {
    let inspections = 0,
      cleanups = 0;
    const controls = [];
    let restored = false;
    const owner = {
      attempt: stage,
      token: 'o'.repeat(32),
      artifact,
      predecessor: 'initial',
      priorPause: 'true',
      ...(stage === 'recovery' ? { reservationId: 'old-run' } : {}),
    };
    const { selectExperiments } = await import('../scripts/playtest/experiments.mjs');
    const planned = selectExperiments({ ...config.verification, profile: null });
    owner.verificationIdentity = createHash('sha256')
      .update(
        JSON.stringify({
          mode: config.verification.mode,
          profile: null,
          exception: planned.exception,
        }),
      )
      .digest('hex');
    if (stage === 'recovery')
      await writeFile(join(root, `owner-staging-${stage}.json`), JSON.stringify(owner));
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input),
        path = url.pathname;
      if (url.host === 'control.invalid' && path === '/experiment-failures')
        return Response.json({ failures: [] });
      if (url.host === 'control.invalid') {
        controls.push(path);
        if (path === '/phase' && JSON.parse(options.body).phase === 'verifying') restored = true;
        return Response.json({ ...owner, owned: true });
      }
      if (stage === 'recovery' && path.startsWith('/admin/') && !restored)
        return new Response('', { status: 503 });
      if (path === '/admin/playtest/synthetic/old-run') {
        cleanups++;
        return Response.json({ pending: true });
      }
      if (path === '/admin/playtest/synthetic/run/invitation')
        return new Response('', { status: 503 });
      if (path === '/admin/playtest/synthetic') {
        const budget = JSON.parse(options.body);
        assert.equal(budget.slots, 2);
        assert.equal(budget.bytes, 32 * 1024 ** 2);
        assert.equal(budget.metadataBytes, 4 * 1024 ** 2);
        return stage === 'capacity'
          ? new Response('', { status: 413 })
          : Response.json({ id: 'run', expires: Date.now() + 7200000 });
      }
      if (path === '/admin/playtest/synthetic/run' && options.method === 'DELETE') {
        cleanups++;
        return Response.json({ pending: true });
      }
      if (/^\/admin\/playtest\/synthetic\/[^/]+\/status$/.test(path))
        return Response.json({
          runId: path.split('/')[4],
          recordings: { pending: 0, chargedBytes: 0 },
          feedback: { pending: 0, chargedBytes: 0 },
        });
      if (path.includes('/accounts/' + config.otherAccountId))
        return new Response('', { status: 403 });
      const ok = (result) => Response.json({ success: true, result });
      if (path.includes('simulacrum-isolation')) return ok({});
      if (path.endsWith('/script-settings'))
        return ok({ observability: null, logpush: false, tail_consumers: null });
      if (path.endsWith('/settings')) {
        inspections++;
        if (inspections > 1 && stage !== 'recovery') return new Response('', { status: 503 });
        return ok({
          observability: { enabled: false, logs: { invocation_logs: false } },
          bindings: [
            {
              name: 'RECORDINGS',
              type: 'r2_bucket',
              bucket_name: worker.r2_buckets[0].bucket_name,
            },
            {
              name: 'CAPTURE',
              type: 'durable_object_namespace',
              namespace_id: 'fixed',
              class_name: 'CaptureStore',
            },
          ],
        });
      }
      if (path.endsWith('/schedules')) return ok({ schedules: [{ cron: '*/5 * * * *' }] });
      if (path.endsWith('/domains/managed')) return ok({ enabled: false });
      if (path.endsWith('/domains/custom')) return ok({ domains: [] });
      if (path.endsWith('/lifecycle')) return ok({ rules: [] });
      if (path.endsWith('/logpush/jobs')) return ok([]);
      if (path.endsWith('/deployments'))
        return ok({
          deployments: [{ versions: [{ version_id: stage === 'before' ? 'wrong' : 'initial' }] }],
        });
      throw Error('Unexpected fixture request ' + path);
    };
    await assert.rejects(
      deployRelease(root, join(root, 'config.json'), owner, { recovery: stage === 'recovery' }),
      stage === 'before'
        ? /predecessor/
        : stage === 'capacity'
          ? /Synthetic control failed 413/
          : stage === 'recovery'
            ? /Synthetic control failed 503/
            : /inspection/,
    );
    assert.equal(cleanups, stage === 'capacity' ? 0 : stage === 'recovery' ? 2 : 1);
    assert.equal(restored, ['after', 'recovery'].includes(stage));
    assert.ok(!controls.includes('/release'));
    if (stage === 'recovery') assert.deepEqual(controls.slice(0, 2), ['/check', '/recover']);
    assert.ok(!(await readdir(root)).some((name) => name.startsWith('synthetic-private-')));
  }
});

test('successful experiment evidence is durable before coordinator resolution', async (t) => {
  const { recordExperimentPasses } = await import('../scripts/playtest/release.mjs');
  const root = await mkdtemp(join(tmpdir(), 'experiment-resolution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = join(root, 'history.json');
  const failure = { id: 'failure-1', family: 'capacity', status: 'FAIL', reason: 'slow upload' };
  const receipt = {
    id: 'a'.repeat(64),
    family: 'capacity',
    status: 'PASS',
    artifact: 'b'.repeat(64),
    identity: 'c'.repeat(64),
    measuredAt: 100,
  };
  const evidence = [failure];
  await writeFile(history, JSON.stringify(evidence));
  const results = { capacity: { status: 'PASS', receipt } };
  const archive = join(
    root,
    `resolved-failure-${createHash('sha256').update(failure.id).digest('hex')}-${receipt.id}.json`,
  );
  const inspect = async (path, body) => {
    assert.equal(path, '/experiment-passed');
    assert.deepEqual(
      JSON.parse(await readFile(join(root, `experiment-pass-${receipt.id}.json`), 'utf8')),
      receipt,
    );
    assert.deepEqual(JSON.parse(await readFile(join(root, 'experiment-evidence.json'), 'utf8')), [
      receipt,
    ]);
    assert.deepEqual(JSON.parse(await readFile(archive, 'utf8')), { failure, resolvedBy: receipt });
    assert.equal(body.identity, receipt.identity);
    assert.equal(body.measuredAt, receipt.measuredAt);
    assert.deepEqual(body.failureIds, [failure.id]);
  };
  await assert.rejects(
    recordExperimentPasses(root, history, evidence, results, ['capacity'], async (...args) => {
      await inspect(...args);
      throw Error('lost acknowledgement');
    }),
    /lost acknowledgement/,
  );
  assert.deepEqual(JSON.parse(await readFile(history, 'utf8')), [failure]);
  assert.deepEqual(evidence, [failure]);
  await recordExperimentPasses(root, history, evidence, results, ['capacity'], inspect);
  assert.deepEqual(JSON.parse(await readFile(history, 'utf8')), [receipt]);
});

test('provider inspection accepts explicit disabled observability and rejects unknown or active settings', async (t) => {
  const { inspectDeployment } = await import('../scripts/playtest/verify-deployment.mjs');
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const config = {
    environment: 'staging',
    accountId: 'a'.repeat(32),
    otherAccountId: 'b'.repeat(32),
    workerName: 'workshop',
    bucketName: 'recordings',
    captureNamespaceId: 'fixed',
    isolationTargets: {
      authorization: 'disposable-probes-only',
      currentWorker: 'simulacrum-isolation-current',
      otherWorker: 'simulacrum-isolation-other',
      currentBucket: 'simulacrum-isolation-current',
      otherBucket: 'simulacrum-isolation-other',
    },
  };
  let scriptSettings = { observability: null, logpush: false, tail_consumers: null };
  globalThis.fetch = async (input) => {
    const path = new URL(input).pathname;
    const ok = (result) => Response.json({ success: true, result });
    if (path.includes(config.otherAccountId)) return new Response(null, { status: 403 });
    if (path.includes('simulacrum-isolation')) return ok({});
    if (path.endsWith('/script-settings')) return ok(scriptSettings);
    if (path.endsWith('/settings'))
      return ok({
        bindings: [
          { name: 'RECORDINGS', type: 'r2_bucket', bucket_name: 'recordings' },
          {
            name: 'CAPTURE',
            type: 'durable_object_namespace',
            namespace_id: 'fixed',
            class_name: 'CaptureStore',
          },
        ],
      });
    if (path.endsWith('/schedules')) return ok({ schedules: [{ cron: '*/5 * * * *' }] });
    if (path.endsWith('/domains/managed')) return ok({ enabled: false });
    if (path.endsWith('/domains/custom')) return ok({ domains: [] });
    if (path.endsWith('/lifecycle')) return ok({ rules: [] });
    if (path.endsWith('/logpush/jobs')) return ok([]);
    throw Error('Unexpected request ' + path);
  };
  assert.equal((await inspectDeployment(config)).loggingVerified, true);
  const disabled = {
    enabled: false,
    logs: { enabled: false, invocation_logs: false },
    traces: { enabled: false },
  };
  scriptSettings.observability = disabled;
  assert.equal((await inspectDeployment(config)).loggingVerified, true);
  for (const unsafe of [
    {},
    { observability: null },
    { observability: null, logpush: true, tail_consumers: [] },
    { observability: null, logpush: false, tail_consumers: [{ service: 'collector' }] },
    ...[
      {},
      true,
      { ...disabled, enabled: true },
      { ...disabled, logs: { enabled: true, invocation_logs: false } },
      { ...disabled, traces: { enabled: true } },
    ].map((observability) => ({ observability, logpush: false, tail_consumers: [] })),
  ]) {
    scriptSettings = unsafe;
    await assert.rejects(inspectDeployment(config), /logging/);
  }
});

test('final capture drain accepts delayed delivery but rejects stalled or incomplete completion', async () => {
  const { waitForCaptureDrain, captureBrowserTimeoutMs } = await import(
    '../scripts/playtest/release-policy.mjs'
  );
  const run = (read) => {
    let clock = 0;
    return waitForCaptureDrain({
      read: () => read(clock),
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
    });
  };
  const complete = { pending: 0, bytes: 0, saved: true };
  const late = await run((clock) =>
    clock >= 24000 ? complete : { pending: 5, bytes: 1000, saved: false },
  );
  assert.equal(late.elapsedMs, 24000);
  assert.deepEqual(late.finalOutbox, complete);
  await assert.rejects(
    run(() => ({ pending: 1, bytes: 10, saved: false })),
    /drain deadline/,
  );
  await assert.rejects(
    run(() => ({ pending: 0, bytes: 0, saved: false })),
    /drain deadline/,
  );
  await assert.rejects(
    run(() => ({ pending: 1, bytes: 0, saved: true })),
    /drain deadline/,
  );
  await assert.rejects(
    run(() => ({ pending: 0, bytes: 10, saved: true })),
    /drain deadline/,
  );
  await assert.rejects(
    run((clock) => (clock > 120000 ? complete : { pending: 1, bytes: 1, saved: false })),
    /drain deadline/,
  );
  await assert.rejects(
    run(() => ({ pending: NaN, bytes: 0, saved: true })),
    /Invalid drain/,
  );
  const { experimentReservation } = await import('../scripts/playtest/experiments.mjs');
  const budget = experimentReservation({ run: [], smokeSeconds: 60 }, null);
  assert.equal(budget.requiredMs, captureBrowserTimeoutMs(60) + 1200000);
  // Archive processing has its own finite allowance, independent of delivery.
  assert.ok(captureBrowserTimeoutMs(1800) >= (1800 + 120 + 120 + 60 + 900) * 1000);
  assert.ok(captureBrowserTimeoutMs(1800) <= 50 * 60000);
  assert.equal(captureBrowserTimeoutMs(60), 1260000);
  assert.throws(() => captureBrowserTimeoutMs(-1), /duration/);
});

test('served asset integrity checks canonical index URL and rejects wrong bytes or redirects', async () => {
  const { verifyServedAssets } = await import('../scripts/playtest/verify-deployment.mjs');
  const { createHash } = await import('node:crypto');
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const files = {
    'assets/index.html': hash('index'),
    'assets/app.js': hash('script'),
    'backend/worker.js': hash('worker'),
  };
  const paths = [];
  await verifyServedAssets(
    { files },
    'https://workshop.example',
    'session=test',
    async (url, options) => {
      paths.push(url.pathname);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.cookie, 'session=test');
      return new Response(url.pathname === '/' ? 'index' : 'script');
    },
  );
  assert.deepEqual(paths, ['/', '/app.js']);
  await assert.rejects(
    verifyServedAssets(
      { files },
      'https://workshop.example',
      'session=test',
      async () => new Response('wrong'),
    ),
    /integrity/,
  );
  await assert.rejects(
    verifyServedAssets(
      { files },
      'https://workshop.example',
      'session=test',
      async () => new Response(null, { status: 302, headers: { location: '/' } }),
    ),
    /integrity/,
  );
});

test('private export bounds parallel reads and preserves journal order on completion or failure', async (t) => {
  const { downloadCapture } = await import('../scripts/playtest/download.mjs');
  const root = await mkdtemp(join(tmpdir(), 'capture-parallel-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = 'a'.repeat(32);
  for (const corrupt of [false, true]) {
    let active = 0,
      peak = 0,
      requested = 0;
    const rows = Array.from({ length: 9 }, (_, i) => {
      const raw = JSON.stringify({ id: `e${i + 1}`, kind: 'sample', data: { seq: i + 1 } });
      const sha256 = createHash('sha256').update(raw).digest('hex');
      return {
        sessionId,
        objectKey: (i + 1).toString(16).padStart(32, '0'),
        bytes: Buffer.byteLength(raw),
        sha256,
        uploadHash: sha256,
        receipt: { sequence: i + 1 },
        raw,
      };
    });
    const directory = join(root, corrupt ? 'corrupt' : 'good');
    const result = downloadCapture({
      origin: 'https://example.invalid',
      sessionId,
      token: 'x'.repeat(32),
      directory,
      fetcher: async (url) => {
        if (url.pathname.endsWith('/snapshot'))
          return Response.json({
            cutoff: rows.length,
            session: { sessionId },
            uploads: rows.map(({ raw, ...row }) => row),
          });
        requested++;
        active++;
        peak = Math.max(peak, active);
        const row = rows.find((r) => r.objectKey === url.searchParams.get('key'));
        await new Promise((resolve) => setTimeout(resolve, 5 * (5 - (row.receipt.sequence % 4))));
        active--;
        return new Response(row.raw + (corrupt && row.receipt.sequence === 3 ? ' ' : ''));
      },
    });
    if (corrupt) {
      await assert.rejects(result, /checksum/);
      assert.equal(requested, 4, 'do not schedule further batches after integrity failure');
      await assert.rejects(readFile(join(directory, 'events.ndjson')), { code: 'ENOENT' });
    } else {
      await result;
      const journal = (await readFile(join(directory, 'events.ndjson'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        journal.map((r) => r.receipt.sequence),
        rows.map((r) => r.receipt.sequence),
      );
      for (const row of rows)
        assert.equal(
          await readFile(join(directory, `event-${row.receipt.sequence}.json`), 'utf8'),
          row.raw,
        );
    }
    assert.equal(peak, 2, 'exactly two bounded object reads overlap');
    assert.equal(active, 0, 'all started reads settle before returning');
  }
});

test('recording-only capacity cannot qualify feedback-enabled releases', async () => {
  const { assertFeedbackQualification } = await import('../scripts/playtest/release-policy.mjs');
  const legacyCapacity = {
    recordingMode: 'data',
    captureSchema: 1,
    status: 'PASS',
    feedbackEnabled: false,
    feedback: { enabled: false },
  };
  for (const vars of [{}, { FEEDBACK_ENABLED: 'true' }, { FEEDBACK_ENABLED: false }]) {
    for (const mode of [undefined, 'auto', 'full']) {
      assert.throws(
        () => assertFeedbackQualification({ vars }, { mode, profile: legacyCapacity }),
        /Feedback protocol v1 capacity is unqualified/,
      );
    }
    assert.deepEqual(assertFeedbackQualification({ vars }, { mode: 'bypass-expensive' }), {
      enabled: true,
      protocolVersion: 1,
      transport: 'standalone-envelope-v1',
      capacityQualification: 'UNQUALIFIED',
    });
  }
  for (const mode of [undefined, 'auto', 'full', 'bypass-expensive']) {
    assert.deepEqual(
      assertFeedbackQualification({ vars: { FEEDBACK_ENABLED: 'false' } }, { mode }),
      {
        enabled: false,
        protocolVersion: 1,
        transport: 'standalone-envelope-v1',
        capacityQualification: 'NOT_OFFERED',
      },
    );
  }
});
