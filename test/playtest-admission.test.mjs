import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaytestServer } from '../scripts/playtest-server.mjs';

for (const size of [1024, 10 * 1024 ** 2])
  test('write admission holds bodies through paused persistence and rejects excess unread', async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'admission-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(join(root, 'public'));
    const server = createPlaytestServer({
      publicDir: join(root, 'public'),
      dataDir: join(root, 'data'),
      token: 't'.repeat(32),
    });
    let fullyRead = 0;
    const request = (url, data = '', cookie = '', method = 'POST') =>
      new Promise((resolve) => {
        const req = Readable.from(data ? [Buffer.from(data)] : []);
        req.on('end', () => fullyRead++);
        Object.assign(req, {
          url,
          method,
          headers: { cookie, 'content-type': 'audio/webm' },
          socket: {},
        });
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
    const login = await request('/join?token=' + 't'.repeat(32), '', '', 'GET');
    const cookie = login.headers['set-cookie'].split(';')[0];
    const session = (await request('/api/playtest/session', '{}', cookie)).body.sessionId;
    await new Promise((r) => setImmediate(r));
    fullyRead = 0;
    const original = fs.appendFile;
    let release, entered;
    const blocked = new Promise((r) => (release = r)),
      started = new Promise((r) => (entered = r));
    fs.appendFile = async (...args) => {
      entered();
      await blocked;
      return original(...args);
    };
    syncBuiltinESMExports();
    t.after(() => {
      release();
      fs.appendFile = original;
      syncBuiltinESMExports();
    });
    const pending = Array.from({ length: 12 }, (_, i) =>
      request(
        `/api/playtest/${session}/media?kind=voice&clip=tab&seq=${i}`,
        'x'.repeat(size),
        cookie,
      ),
    );
    await started;
    await new Promise((r) => setTimeout(r, 30));
    try {
      assert.equal(fullyRead, 2, 'only admitted bodies may be read while disk is stalled');
    } finally {
      release();
    }
    const results = await Promise.all(pending);
    assert.equal(results.filter((r) => r.status === 201).length, 2);
    assert.equal(results.filter((r) => r.status === 429).length, 10);
    assert.equal(
      (await request(`/api/playtest/${session}/media?kind=voice&clip=tab&seq=99`, 'ok', cookie))
        .status,
      201,
    );
  });

test('Node storage deadline replies once while retaining admission until persistence settles', async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'storage-deadline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, 'public'));
  const options = {
    publicDir: join(root, 'public'),
    dataDir: join(root, 'data'),
    token: 't'.repeat(32),
  };
  let server = createPlaytestServer(options);
  let replies = 0;
  const request = (url, data = '', cookie = '', method = 'POST') =>
    new Promise((resolve) => {
      const req = Readable.from(data ? [Buffer.from(data)] : []);
      Object.assign(req, {
        url,
        method,
        headers: { cookie, 'content-type': 'audio/webm' },
        socket: {},
      });
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
          replies++;
          resolve({ status: this.status, headers: this.headers, body: body && JSON.parse(body) });
        },
      };
      server.emit('request', req, res);
    });
  const login = await request('/join?token=' + 't'.repeat(32), '', '', 'GET');
  let cookie = login.headers['set-cookie'].split(';')[0];
  const created = await request('/api/playtest/session', '{}', cookie);
  assert.equal(created.status, 201, 'session setup must finish before testing a short deadline');
  const sid = created.body.sessionId;
  assert.match(sid, /^[a-f0-9]{32}$/);
  // Bootstrap uses the normal budget; only the stalled-write probe gets 25 ms.
  // Reopening also confirms the admitted session was durably published.
  server = createPlaytestServer({ ...options, persistenceResponseMs: 25 });
  const rejoin = await request('/join?token=' + 't'.repeat(32), '', '', 'GET');
  assert.equal(rejoin.status, 303);
  cookie = rejoin.headers['set-cookie'].split(';')[0];
  const original = fs.appendFile;
  const pending = Promise.withResolvers();
  fs.appendFile = async (...args) => {
    await pending.promise;
    return original(...args);
  };
  syncBuiltinESMExports();
  t.after(() => {
    pending.resolve();
    fs.appendFile = original;
    syncBuiltinESMExports();
  });
  const upload = request(`/api/playtest/${sid}/media?kind=voice&clip=stall&seq=0`, 'abc', cookie);
  const result = await Promise.race([
    upload,
    new Promise((r) => setTimeout(() => r({ status: 'no deadline' }), 300)),
  ]);
  try {
    assert.equal(result.status, 503);
    assert.equal(
      (await request(`/api/playtest/${sid}/media?kind=voice&clip=stall&seq=1`, 'abc', cookie))
        .status,
      503,
    );
    assert.equal(
      (await request('/api/playtest/config', '', cookie, 'GET')).body.storageUnavailable,
      true,
    );
  } finally {
    pending.resolve();
  }
  for (let i = 0; i < 50; i++) {
    if (!(await request('/api/playtest/config', '', cookie, 'GET')).body.storageUnavailable) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  fs.appendFile = original;
  syncBuiltinESMExports();
  const count = replies;
  assert.equal(
    (await request(`/api/playtest/${sid}/media?kind=voice&clip=stall&seq=0`, 'abc', cookie)).status,
    200,
  );
  assert.equal(replies, count + 1, 'late persistence cannot send a second response');
});

test('Node admission recovers after malformed, oversized, disconnected and failed-persistence requests', async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'admission-errors-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, 'public'));
  let server = createPlaytestServer({
    publicDir: join(root, 'public'),
    dataDir: join(root, 'data'),
    token: 't'.repeat(32),
  });
  const request = (url, data = '', cookie = '', method = 'POST', extra = {}) =>
    new Promise((resolve) => {
      const req = data instanceof Readable ? data : Readable.from(data ? [Buffer.from(data)] : []);
      Object.assign(req, {
        url,
        method,
        headers: { cookie, 'content-type': 'application/json', ...extra },
        socket: {},
      });
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
  let login = await request('/join?token=' + 't'.repeat(32), '', '', 'GET'),
    cookie = login.headers['set-cookie'].split(';')[0];
  const id = (await request('/api/playtest/session', '{}', cookie)).body.sessionId,
    path = `/api/playtest/${id}/event`;
  assert.equal((await request(path, '{', cookie)).status, 400);
  assert.equal(
    (await request(path, 'x'.repeat(2 * 1024 ** 2 + 1), cookie, 'POST', { 'content-length': '1' }))
      .status,
    413,
  );
  const disconnected = new Readable({
    read() {
      this.push('partial');
      this.destroy(Error('disconnected'));
    },
  });
  assert.ok((await request(path, disconnected, cookie)).status >= 400);
  const original = fs.appendFile;
  fs.appendFile = async () => {
    throw Error('disk failed');
  };
  syncBuiltinESMExports();
  try {
    assert.equal((await request(path, JSON.stringify({ id: 'retry' }), cookie)).status, 500);
  } finally {
    fs.appendFile = original;
    syncBuiltinESMExports();
  }
  assert.equal((await request(path, JSON.stringify({ id: 'retry' }), cookie)).status, 503);
  server = createPlaytestServer({
    publicDir: join(root, 'public'),
    dataDir: join(root, 'data'),
    token: 't'.repeat(32),
  });
  cookie = (await request('/join?token=' + 't'.repeat(32), '', '', 'GET')).headers[
    'set-cookie'
  ].split(';')[0];
  assert.equal((await request(path, JSON.stringify({ id: 'retry' }), cookie)).status, 201);
  assert.equal((await request(path, JSON.stringify({ id: 'retry' }), cookie)).status, 200);
});
