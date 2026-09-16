import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createPlaytestServer } from '../scripts/playtest-server.mjs';
import { memoryCaptureStore } from './fixtures/capture-store-memory.mjs';
import worker from '../scripts/playtest/worker.mjs';
const endpoint = '/api/playtest/feedback/v1/submission';
const adminToken = 'feedback-admin-token-with-at-least-32-characters';
const invite = 'feedback-invite-token-with-at-least-32-characters';
const envelope = (extra = {}) => ({
  protocolVersion: 1,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  text: 'The connection preview helped.',
  ...extra,
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(t, adapter, limits = {}) {
  if (adapter === 'cloud') return memoryCaptureStore(t, limits);
  const root = await mkdtemp(join(tmpdir(), 'feedback-backend-')),
    publicDir = join(root, 'public'),
    dataDir = join(root, 'private');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), 'workshop');
  let server, base, cookie;
  async function start() {
    server = createPlaytestServer({ publicDir, dataDir, token: invite, adminToken, ...limits });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base + '/join?token=' + invite, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie').split(';')[0];
  }
  await start();
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  return {
    dataDir,
    oversized() {
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          base + endpoint,
          {
            method: 'POST',
            headers: {
              cookie,
              'content-type': 'application/json',
              'content-length': 4 * 1024 ** 2 + 1,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
    },
    async restart() {
      await new Promise((r) => server.close(r));
      await start();
    },
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      return fetch(base + path, {
        method,
        headers: {
          cookie,
          ...(path.startsWith('/admin/') ? { authorization: 'Bearer ' + adminToken } : {}),
          'content-type': 'application/json',
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
    },
    cleanup: async () => {},
  };
}
for (const adapter of ['node', 'cloud']) {
  test(`${adapter}: immutable feedback is standalone, durable, private, exportable and deletable`, async (t) => {
    const f = await fixture(t, adapter),
      e = envelope(),
      body = JSON.stringify(e, null, 1);
    const first = await f.request(endpoint, { method: 'POST', body });
    assert.equal(first.status, 201, await first.clone().text());
    const receipt = await first.json();
    assert.deepEqual(receipt, {
      protocolVersion: 1,
      submissionId: e.id,
      uploadHash: hash(body),
      receivedAt: receipt.receivedAt,
      status: 'received',
    });
    assert.equal((await f.request(endpoint, { method: 'GET' })).status, 404);
    await f.restart();
    assert.deepEqual(await (await f.request(endpoint, { method: 'POST', body })).json(), receipt);
    assert.equal(
      (await f.request(endpoint, { method: 'POST', body: { ...e, text: 'different' } })).status,
      409,
    );
    const exported = await (await f.request(`/admin/playtest/feedback/${e.id}/export`)).json();
    assert.deepEqual(exported, { protocolVersion: 1, envelope: e, bodyText: body, receipt });
    const list = await (await f.request('/admin/playtest/feedback')).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].submissionId, e.id);
    assert.equal(
      (await f.request(`/admin/playtest/feedback/${e.id}/delete`, { method: 'POST', body: {} }))
        .status,
      202,
    );
    await f.cleanup();
    assert.equal((await f.request(endpoint, { method: 'POST', body })).status, 410);
    assert.equal((await f.request(`/admin/playtest/feedback/${e.id}/export`)).status, 410);
  });
  test(`${adapter}: schema, reference and dedicated storage limits reject without a receipt`, async (t) => {
    const f = await fixture(t, adapter, { feedbackStorageBytes: 9000 });
    for (const invalid of [
      envelope({ text: '' }),
      envelope({ surprise: true }),
      envelope({ reference: { sessionId: '0'.repeat(32), timeMs: 0 } }),
      envelope({ voice: { mime: 'text/html', base64: 'YQ==', durationMs: 1 } }),
    ]) {
      assert.ok(
        [400, 404, 415].includes(
          (await f.request(endpoint, { method: 'POST', body: invalid })).status,
        ),
      );
    }
    const e = envelope({ text: 'x'.repeat(4900) });
    assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 413);
    assert.equal((await f.request(endpoint, { method: 'POST', body: envelope() })).status, 201);
    assert.equal(
      adapter === 'node'
        ? await f.oversized()
        : (await f.request(endpoint, { method: 'POST', body: ' '.repeat(4 * 1024 ** 2 + 1) }))
            .status,
      413,
    );
  });
  test(`${adapter}: recording and per-attachment references remain exportable after session-end`, async (t) => {
    const f = await fixture(t, adapter);
    const start = await (
      await f.request('/api/playtest/v2/session', {
        method: 'POST',
        body: { requestId: 'reference', metadata: { recordingMode: 'data' } },
      })
    ).json();
    await f.request(`/api/playtest/v2/${start.sessionId}/event`, {
      method: 'POST',
      body: { id: 'ended', kind: 'session-end' },
    });
    const e = envelope({
      context: {
        value: { parts: [] },
        capturedAt: new Date().toISOString(),
        reference: { sessionId: start.sessionId, timeMs: 30 },
      },
    });
    assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 201);
    const rows = await (
      await f.request('/admin/playtest/feedback?sessionId=' + start.sessionId)
    ).json();
    assert.equal(rows[0].submissionId, e.id);
  });
}
test('node: capability and admin separation preserve invitation/origin boundaries', async (t) => {
  const f = await fixture(t, 'node');
  assert.deepEqual((await (await f.request('/api/playtest/config')).json()).feedback, {
    enabled: true,
    protocolVersion: 1,
  });
  assert.equal(
    (await f.request('/admin/playtest/feedback', { headers: { authorization: '' } })).status,
    403,
  );
  assert.equal(
    (await f.request(endpoint, { method: 'POST', body: envelope(), headers: { cookie: '' } }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: envelope(),
        headers: { origin: 'https://evil.invalid' },
      })
    ).status,
    403,
  );
});
test('cloud: partial object publication retries, generation and synthetic scopes are enforced', async (t) => {
  const f = await fixture(t, 'cloud'),
    e = envelope(),
    put = f.r2.put.bind(f.r2);
  let failOnce = true;
  f.r2.put = async (...args) => {
    const object = await put(...args);
    if (failOnce) {
      failOnce = false;
      throw Error('receipt lost after object publication');
    }
    return object;
  };
  assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 500);
  await f.restart();
  assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 201);
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: e,
        headers: { 'x-invitation-generation': '2' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: envelope(),
        headers: { 'x-synthetic-run': randomUUID() },
      })
    ).status,
    413,
  );
  const session = await (
    await f.request('/api/playtest/v2/session', {
      method: 'POST',
      body: { requestId: 'human', metadata: {} },
    })
  ).json();
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: envelope({ reference: { sessionId: session.sessionId, timeMs: 0 } }),
        headers: { 'x-synthetic-run': randomUUID() },
      })
    ).status,
    403,
  );
});
test('cloud worker: feedback capability is explicit and admin data stays private', async () => {
  const env = {
    ALLOWED_ORIGIN: 'https://test.invalid',
    ADMIN_TOKEN: adminToken,
    CAPTURE: { idFromName: () => 1, get: () => ({ fetch: () => new Response('{}') }) },
    INVITATION_GENERATION: '1',
  };
  const config = await worker.fetch(new Request('https://test.invalid/api/playtest/config'), env);
  assert.equal((await config.json()).feedback?.enabled, false);
  assert.equal(
    (await worker.fetch(new Request('https://test.invalid/admin/playtest/feedback'), env)).status,
    403,
  );
});
test('cloud: export list has stable pagination without losing linked feedback', async (t) => {
  const f = await fixture(t, 'cloud');
  const ids = [];
  for (let n = 0; n < 3; n++) {
    const e = envelope();
    ids.push(e.id);
    assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 201);
  }
  ids.sort();
  const first = await (await f.request('/admin/playtest/feedback?limit=2')).json();
  assert.deepEqual(
    first.map((x) => x.submissionId),
    ids.slice(0, 2),
  );
  const rest = await (await f.request('/admin/playtest/feedback?limit=2&after=' + ids[1])).json();
  assert.deepEqual(
    rest.map((x) => x.submissionId),
    ids.slice(2),
  );
});
test('cloud: delete fences an in-flight feedback object and synthetic cleanup reclaims feedback', async (t) => {
  const f = await fixture(t, 'cloud'),
    e = envelope(),
    put = f.r2.put.bind(f.r2);
  let entered, release;
  const arrived = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  f.r2.put = async (...args) => {
    if (args[2]?.onlyIf) {
      entered();
      await gate;
    }
    return put(...args);
  };
  const sending = f.request(endpoint, { method: 'POST', body: e });
  await arrived;
  assert.equal(
    (await f.request(`/admin/playtest/feedback/${e.id}/delete`, { method: 'POST', body: {} }))
      .status,
    202,
  );
  await f.cleanup();
  release();
  assert.equal((await sending).status, 410);
  for (const value of f.r2.values.values()) assert.equal(value.bytes.length, 0);
  f.r2.put = put;
  const run = await (
    await f.request('/admin/playtest/synthetic', {
      method: 'POST',
      body: { slots: 1, bytes: 20000 },
    })
  ).json();
  const synthetic = envelope();
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: synthetic,
        headers: { 'x-synthetic-run': run.id },
      })
    ).status,
    201,
  );
  await f.request(`/admin/playtest/synthetic/${run.id}/drain`, { method: 'POST', body: {} });
  await f.cleanup();
  assert.equal((await f.request(`/admin/playtest/feedback/${synthetic.id}/export`)).status, 410);
  assert.equal(f.st.db.prepare('SELECT bytes FROM synthetic WHERE id=?').get(run.id).bytes, 20000);
});
test('node: root sync failure withholds receipt and retry recovers the same publication', async (t) => {
  const f = await fixture(t, 'node'),
    e = envelope(),
    fs = (await import('node:fs/promises')).default,
    { syncBuiltinESMExports } = await import('node:module'),
    original = fs.open;
  const privateRoot = await fs.realpath(f.dataDir);
  let injected = false;
  fs.open = async (path, ...args) => {
    const handle = await original(path, ...args);
    if (path === privateRoot && !injected) {
      injected = true;
      handle.sync = async () => {
        throw Error('root sync failure');
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 500);
    assert.equal(injected, true);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
  await f.restart();
  const response = await f.request(endpoint, { method: 'POST', body: e });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).submissionId, e.id);
});
test('cloud: deleting a referenced recording also cleans its attached standalone feedback', async (t) => {
  const f = await fixture(t, 'cloud');
  const session = await (
    await f.request('/api/playtest/v2/session', {
      method: 'POST',
      body: { requestId: 'delete-ref', metadata: {} },
    })
  ).json();
  const e = envelope({ reference: { sessionId: session.sessionId, timeMs: 0 } });
  assert.equal((await f.request(endpoint, { method: 'POST', body: e })).status, 201);
  await f.request(`/admin/playtest/${session.sessionId}/delete`, { method: 'POST', body: {} });
  await f.cleanup();
  assert.equal((await f.request(`/admin/playtest/feedback/${e.id}/export`)).status, 410);
});
test('synthetic cleanup waits for failed feedback fences after recordings disappear and preserves other runs', async (t) => {
  const { cleanupSynthetic } = await import('../scripts/playtest/verify-deployment.mjs');
  const f = await fixture(t, 'cloud');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const run = await (
    await f.request('/admin/playtest/synthetic', {
      method: 'POST',
      body: { slots: 1, bytes: 30000 },
    })
  ).json();
  const other = await (
    await f.request('/admin/playtest/synthetic', {
      method: 'POST',
      body: { slots: 1, bytes: 30000 },
    })
  ).json();
  const session = await (
    await f.request('/api/playtest/v2/session', {
      method: 'POST',
      headers: { 'x-synthetic-run': run.id },
      body: { requestId: 'cleanup-case', metadata: {} },
    })
  ).json();
  assert.ok(session.sessionId);
  const e = envelope(),
    preserved = envelope();
  assert.equal(
    (await f.request(endpoint, { method: 'POST', body: e, headers: { 'x-synthetic-run': run.id } }))
      .status,
    201,
  );
  assert.equal(
    (
      await f.request(endpoint, {
        method: 'POST',
        body: preserved,
        headers: { 'x-synthetic-run': other.id },
      })
    ).status,
    201,
  );
  const objectKey = f.st.db
    .prepare('SELECT objectKey FROM feedback WHERE id=?')
    .get(e.id).objectKey;
  const put = f.r2.put.bind(f.r2);
  let failures = 0;
  f.r2.put = async (key, body, options) => {
    if (key === objectKey && options?.customMetadata?.deleted === '1' && !failures++) {
      throw Error('temporary feedback fence failure');
    }
    return put(key, body, options);
  };
  const oldToken = process.env.PLAYTEST_ADMIN_TOKEN;
  process.env.PLAYTEST_ADMIN_TOKEN = adminToken;
  t.after(() => {
    if (oldToken === undefined) delete process.env.PLAYTEST_ADMIN_TOKEN;
    else process.env.PLAYTEST_ADMIN_TOKEN = oldToken;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer ' + adminToken);
    const path = new URL(url).pathname;
    const result = await f.request(path, { method: options.method, body: options.body });
    if (path.endsWith('/drain')) await f.cleanup();
    if (path.endsWith('/reconcile')) {
      now += 31000;
      await f.cleanup();
    }
    return result;
  });
  await cleanupSynthetic('https://test.invalid', run.id, { preserveReservation: true });
  assert.ok(failures >= 1, 'fault injection actually rejected feedback deletion');
  const remaining = f.st.db
    .prepare("SELECT COUNT(*) AS n FROM feedback WHERE synthetic=? AND state!='deleted'")
    .get(run.id).n;
  assert.equal(
    remaining,
    0,
    'cleanup cannot report success while feedback remains charged after a failed fence',
  );
  assert.equal(f.st.db.prepare('SELECT bytes FROM synthetic WHERE id=?').get(run.id).bytes, 30000);
  const status = await (await f.request(`/admin/playtest/synthetic/${run.id}/status`)).json();
  assert.deepEqual(status, {
    runId: run.id,
    recordings: { pending: 0, chargedBytes: 0 },
    feedback: { pending: 0, chargedBytes: 0 },
  });
  assert.equal(
    (await f.request(`/admin/playtest/feedback/${preserved.id}/export`)).status,
    200,
    'unrelated run evidence survives',
  );
});
