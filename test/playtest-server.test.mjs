import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaytestServer } from '../scripts/playtest-server.mjs';

async function fixture(t, limits = {}) {
  const root = await mkdtemp(join(tmpdir(), 'playtest-server-'));
  const publicDir = join(root, 'dist');
  const dataDir = join(root, 'private');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), 'workshop');
  await writeFile(join(root, 'secret.txt'), 'private secret');
  await symlink(join(root, 'secret.txt'), join(publicDir, 'leak.txt'));
  let server = createPlaytestServer({
    publicDir,
    dataDir,
    token: 'test-invite-token-at-least-32-characters',
    ...limits,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/join?token=test-invite-token-at-least-32-characters`, {
    redirect: 'manual',
  });
  let cookie = login.headers.get('set-cookie').split(';')[0];
  const request = (path, options = {}) =>
    fetch(base + path, { ...options, headers: { cookie, ...options.headers } });
  const post = (path, body) =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const restart = async () => {
    await new Promise((resolve) => server.close(resolve));
    server = createPlaytestServer({
      publicDir,
      dataDir,
      token: 'test-invite-token-at-least-32-characters',
      ...limits,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/join?token=test-invite-token-at-least-32-characters`, {
      redirect: 'manual',
    });
    cookie = response.headers.get('set-cookie').split(';')[0];
  };
  return { root, dataDir, base, request, post, login, restart };
}

test('invitation protects static files, config and writes; root cannot leak files', async (t) => {
  const f = await fixture(t);
  for (const path of ['/', '/api/playtest/config', '/api/playtest/session'])
    assert.equal((await fetch(f.base + path)).status, 401);
  assert.equal(f.login.status, 303);
  assert.match(f.login.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  assert.equal(await (await f.request('/')).text(), 'workshop');
  const config = await (await f.request('/api/playtest/config')).json();
  assert.equal(config.enabled, true);
  assert.equal(config.limits.eventBytes, 2 * 1024 * 1024);
  for (const path of [
    '/leak.txt',
    '/%2e%2e%2fsecret.txt',
    '/.git/config',
    '/private/',
    '/src/main.js',
  ])
    assert.equal((await f.request(path)).status, 404, path);
  assert.equal((await f.post('/api/playtest/session', {})).status, 201);
  assert.equal(
    (
      await f.request('/api/playtest/session', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: '{}',
      })
    ).status,
    403,
  );
});

test('receipt sequence, retry deduplication and private media bytes are preserved', async (t) => {
  const f = await fixture(t, { optionalVideo: true });
  const { sessionId } = await (
    await f.post('/api/playtest/session', {
      consent: true,
      recordingMode: 'video',
      captureSchema: 1,
    })
  ).json();
  const path = `/api/playtest/${sessionId}`;
  const first = await f.post(path + '/event', { id: 'event-1', type: 'start', time: 12 });
  assert.equal(first.status, 201);
  const receipt = await first.json();
  assert.deepEqual(
    await (await f.post(path + '/event', { id: 'event-1', type: 'start', time: 12 })).json(),
    receipt,
  );
  assert.equal((await f.post(path + '/event', { id: 'event-1', type: 'changed' })).status, 409);
  assert.equal((await f.post(path + '/event', { type: 'missing-id' })).status, 400);
  const media = () =>
    f.request(path + '/media?kind=screen&clip=clip-1&seq=0', {
      method: 'POST',
      headers: { 'content-type': 'video/webm;codecs=vp9' },
      body: 'binary-video',
    });
  assert.equal((await media()).status, 201);
  assert.equal((await media()).status, 200);
  assert.equal(
    (
      await f.request(path + '/media?kind=screen&clip=../../escape&seq=0', {
        method: 'POST',
        body: 'x',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(path + '/media?kind=screen&clip=c&seq=1', {
        method: 'POST',
        headers: { 'content-type': 'text/html' },
        body: 'x',
      })
    ).status,
    415,
  );
  assert.equal((await f.request(path + '/events.ndjson')).status, 404);
  const lines = (await readFile(join(f.dataDir, sessionId, 'events.ndjson'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    lines.map((x) => x.receipt.sequence),
    [1, 2],
  );
  assert.equal(lines[0].event.type, 'start');
  assert.equal(lines[1].media.mime, 'video/webm;codecs=vp9');
  assert.equal(
    await readFile(join(f.dataDir, sessionId, lines[1].media.file), 'utf8'),
    'binary-video',
  );
});

test('request, session count and storage budgets reject excess writes', async (t) => {
  const f = await fixture(t, { maxRequestBytes: 1024, maxSessionBytes: 1600, maxSessions: 1 });
  const { sessionId } = await (await f.post('/api/playtest/session', {})).json();
  assert.equal((await f.post('/api/playtest/session', {})).status, 429);
  assert.equal(
    (await f.post(`/api/playtest/${sessionId}/event`, { id: 'big', text: 'x'.repeat(1100) }))
      .status,
    413,
  );
  const media = (seq) =>
    f.request(`/api/playtest/${sessionId}/media?kind=voice&clip=c&seq=${seq}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: 'x'.repeat(900),
    });
  assert.equal((await media(0)).status, 201);
  assert.equal((await media(1)).status, 413);
  assert.equal(
    (await readdir(join(f.dataDir, sessionId))).filter((x) => x.endsWith('.bin')).length,
    1,
  );
});

test('restart restores upload deduplication, receipt ordering and storage budget', async (t) => {
  const f = await fixture(t);
  const { sessionId } = await (await f.post('/api/playtest/session', {})).json();
  const eventPath = `/api/playtest/${sessionId}/event`;
  const event = { id: 'feedback', screenshot: 'x'.repeat(100_000) };
  const first = await f.post(eventPath, event);
  assert.equal(first.status, 201);
  const receipt = await first.json();
  await f.restart();
  assert.deepEqual(await (await f.post(eventPath, event)).json(), receipt);
  assert.equal((await f.post(eventPath, { ...event, screenshot: 'changed' })).status, 409);
  const next = await f.post(eventPath, { id: 'after-restart', type: 'stop' });
  assert.equal((await next.json()).sequence, 2);
});

test('data mode blocks screen uploads across restart and video requires explicit server opt in', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.post('/api/playtest/v2/session', {
        requestId: 'video',
        metadata: { recordingMode: 'video', captureSchema: 1 },
      })
    ).status,
    403,
  );
  const { sessionId } = await (
    await f.post('/api/playtest/v2/session', {
      requestId: 'data',
      metadata: { recordingMode: 'data', captureSchema: 1 },
    })
  ).json();
  const upload = () =>
    f.request(`/api/playtest/v2/${sessionId}/media?kind=screen&clip=tab&seq=0`, {
      method: 'POST',
      headers: { 'content-type': 'video/webm' },
      body: 'video',
    });
  assert.equal((await upload()).status, 403);
  await f.restart();
  assert.equal((await upload()).status, 403);
  const voice = await f.request(
    `/api/playtest/v2/${sessionId}/media?kind=voice&clip=comment&seq=0`,
    { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: 'voice' },
  );
  assert.equal(voice.status, 201);
});
