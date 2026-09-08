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
      if (path === '/admin/playtest/sessions') return Response.json([]);
      if (path.includes('/accounts/' + config.otherAccountId))
        return new Response('', { status: 403 });
      const ok = (result) => Response.json({ success: true, result });
      if (path.includes('simulacrum-isolation')) return ok({});
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
