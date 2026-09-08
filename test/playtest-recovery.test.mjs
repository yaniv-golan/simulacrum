import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createPlaytestServer } from '../scripts/playtest-server.mjs';

async function fixture(t, limits = {}) {
  const root = await mkdtemp(join(tmpdir(), 'playtest-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicDir = join(root, 'public'),
    dataDir = join(root, 'private');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), 'ok');
  const token = 'recovery-test-invitation-token-00000000';
  const start = async () => {
    const server = createPlaytestServer({ publicDir, dataDir, token, ...limits });
    const request = (url, { method = 'GET', headers = {}, body = '' } = {}) =>
      new Promise((resolve) => {
        const req = Readable.from(body ? [Buffer.from(body)] : []);
        Object.assign(req, { url, method, headers, socket: {} });
        const res = {
          headers: {},
          setHeader(k, v) {
            this.headers[k] = v;
          },
          writeHead(status, headers = {}) {
            this.status = status;
            Object.assign(this.headers, headers);
          },
          end(body) {
            resolve({ status: this.status, headers: this.headers, body: body && JSON.parse(body) });
          },
        };
        server.emit('request', req, res);
      });
    const login = await request(`/join?token=${token}`);
    const cookie = login.headers['set-cookie'].split(';')[0];
    return (path, body, type = 'application/json') =>
      request(path, {
        method: 'POST',
        headers: { cookie, 'content-type': type },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
  };
  let post = await start();
  const {
    body: { sessionId },
  } = await post('/api/playtest/session', {});
  return {
    dir: join(dataDir, sessionId),
    path: `/api/playtest/${sessionId}`,
    post,
    restart: start,
  };
}

test('restart reconciles unacknowledged complete and interrupted media without losing prior receipts', async (t) => {
  const f = await fixture(t);
  const accepted = { id: 'accepted', kind: 'feedback-text', data: { text: 'preserve me' } };
  const first = await f.post(`${f.path}/event`, accepted);
  assert.equal(first.status, 201);
  await writeFile(join(f.dir, 'screen-tab-0.bin'), 'complete-media');
  await writeFile(join(f.dir, 'screen-tab-1.bin'), 'interrupted');
  const post = await f.restart();
  assert.deepEqual(await post(`${f.path}/event`, accepted), { ...first, status: 200 });
  for (const [seq, bytes] of [
    [0, 'complete-media'],
    [1, 'interrupted-media-completed'],
  ]) {
    const path = `${f.path}/media?kind=screen&clip=tab&seq=${seq}`;
    const response = await post(path, bytes, 'video/webm');
    assert.equal(response.status, 201, `recover orphan ${seq}`);
    assert.equal(response.body.sequence, seq + 2);
    assert.deepEqual((await post(path, bytes, 'video/webm')).body, response.body);
    assert.equal(await readFile(join(f.dir, `screen-tab-${seq}.bin`), 'utf8'), bytes);
  }
});

test('restart preserves complete journal prefix and recovers only an unterminated tail', async (t) => {
  const f = await fixture(t);
  const event = { id: 'accepted', text: 'complete acknowledged event' };
  const accepted = await f.post(`${f.path}/event`, event);
  const journal = join(f.dir, 'events.ndjson');
  const prefix = await readFile(journal);
  await appendFile(journal, '{"receipt":');
  const post = await f.restart();
  assert.deepEqual(await readFile(journal), prefix);
  assert.deepEqual((await post(`${f.path}/event`, event)).body, accepted.body);
  assert.equal((await post(`${f.path}/event`, { id: 'next' })).body.sequence, 2);
  // A newline-terminated corrupt record could have been acknowledged: never discard it.
  await appendFile(journal, '{"receipt":\n');
  await assert.rejects(f.restart(), /JSON|journal/);
});

test('orphan recovery credits existing bytes and ignores uncommitted staging files', async (t) => {
  const f = await fixture(t, { maxSessionBytes: 1600 });
  const bytes = 'x'.repeat(900);
  await writeFile(join(f.dir, 'screen-tab-0.bin'), bytes);
  await writeFile(join(f.dir, 'screen-tab-1.bin.pending'), bytes);
  const post = await f.restart();
  const path = `${f.path}/media?kind=screen&clip=tab&seq=0`;
  const accepted = await post(path, bytes, 'video/webm');
  assert.equal(accepted.status, 201, 'one orphan is charged once');
  assert.equal((await post(path, bytes, 'video/webm')).status, 200);
  assert.equal(
    (await post(`${f.path}/media?kind=screen&clip=tab&seq=1`, bytes, 'video/webm')).status,
    413,
    'recovery does not remove the actual storage bound',
  );
  await assert.rejects(readFile(join(f.dir, 'screen-tab-1.bin.pending')), { code: 'ENOENT' });
});

test('v2 creation survives a lost response and restart without accepting legacy writes', async (t) => {
  const f = await fixture(t),
    input = { requestId: 'immutable-start', metadata: { build: 'v2-test' } };
  const created = await f.post('/api/playtest/v2/session', input);
  assert.equal(created.status, 201);
  assert.equal(created.body.protocolVersion, 2);
  const post = await f.restart();
  assert.deepEqual((await post('/api/playtest/v2/session', input)).body, created.body);
  assert.equal(
    (await post('/api/playtest/v2/session', { ...input, metadata: { build: 'changed' } })).status,
    409,
  );
  const id = created.body.sessionId;
  assert.equal((await post(`/api/playtest/${id}/event`, { id: 'legacy' })).status, 409);
  const response = await post(`/api/playtest/v2/${id}/event`, { id: 'v2' });
  assert.equal(response.status, 201);
  assert.equal(response.body.logicalKey, 'event:v2');
  assert.equal(response.body.sessionId, id);
  assert.equal(response.body.protocolVersion, 2);
});

test('v2 creation recovers partial writes and post-rename sync failures without duplicate sessions', async (t) => {
  const fs = await import('node:fs/promises'),
    { syncBuiltinESMExports } = await import('node:module'),
    { dirname } = await import('node:path');
  const api = fs.default;
  for (const fault of ['partial', 'sync']) {
    const f = await fixture(t),
      dataDir = await fs.realpath(dirname(f.dir)),
      input = { requestId: 'fault-' + fault, metadata: {} };
    const originalWrite = api.writeFile,
      originalOpen = api.open;
    let injected = false;
    api.writeFile = async (path, bytes, ...args) => {
      if (fault === 'partial' && String(path).endsWith('session.json') && !injected) {
        injected = true;
        await originalWrite(path, '{');
        throw Error('partial write');
      }
      return originalWrite(path, bytes, ...args);
    };
    api.open = async (path, ...args) => {
      const handle = await originalOpen(path, ...args);
      if (fault === 'sync' && path === dataDir && !injected) {
        injected = true;
        handle.sync = async () => {
          throw Error('sync failed');
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      assert.equal((await f.post('/api/playtest/v2/session', input)).status, 500);
    } finally {
      api.writeFile = originalWrite;
      api.open = originalOpen;
      syncBuiltinESMExports();
    }
    const retry = await f.post('/api/playtest/v2/session', input);
    assert.ok([200, 201].includes(retry.status));
    if (fault === 'partial') {
      await fs.mkdir(join(dataDir, 'c'.repeat(32)));
      await fs.writeFile(join(dataDir, 'c'.repeat(32), 'session.json'), '{');
    }
    const restarted = await f.restart();
    if (fault === 'partial')
      assert.equal(
        await fs.readFile(join(dataDir, '.incomplete-' + 'c'.repeat(32), 'session.json'), 'utf8'),
        '{',
      );
    assert.deepEqual((await restarted('/api/playtest/v2/session', input)).body, retry.body);
    assert.equal(
      (await fs.readdir(dataDir)).filter((name) => /^[a-f0-9]{32}$/.test(name)).length,
      2,
    );
  }
});
