import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCaptureStore } from './fixtures/capture-store-memory.mjs';
import {
  syncFeedback,
  loadSyncConfig,
  renderPlist,
  renderReadme,
  withRetry,
  SYNC_LABEL,
} from '../scripts/playtest/sync-feedback.mjs';

const endpoint = '/api/playtest/feedback/v1/submission';
const origin = 'https://workshop.example';
const token = 'sync-admin-token-with-at-least-32-characters!!';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const opus = Buffer.from('opus-bytes-for-test').toString('base64');
const envelope = (extra = {}) => ({
  protocolVersion: 1,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  text: 'The connection preview helped.',
  ...extra,
});

async function privateRoot(t) {
  const home = await mkdtemp(join(tmpdir(), 'sync-home-'));
  const root = join(home, '.simulacrum-private');
  await mkdir(root, { mode: 0o700 });
  const directory = join(root, 'feedback-sync');
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, root, directory };
}

async function harness(t) {
  const f = memoryCaptureStore(t);
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const request = new Request(url, init);
    calls.push({ method: request.method, path: new URL(request.url).pathname });
    return f.store.fetch(
      new Request(request.url, {
        method: request.method,
        headers: { 'x-invitation-generation': '1', ...Object.fromEntries(request.headers) },
        ...(request.method === 'GET' ? {} : { body: await request.text() }),
      }),
    );
  };
  const { home, directory } = await privateRoot(t);
  const run = (extra = {}) =>
    syncFeedback({
      origin,
      token,
      directory,
      fetcher,
      configPath: '/etc/sync-config.json',
      scriptHead: 'abc1234',
      ...extra,
    });
  const submit = async (e) => {
    const response = await f.request(endpoint, { method: 'POST', body: e });
    assert.equal(response.status, 201, await response.text());
    return e;
  };
  const session = async () =>
    (
      await f.request('/api/playtest/v2/session', {
        method: 'POST',
        body: { requestId: randomUUID(), metadata: { recordingMode: 'data' } },
      })
    ).json();
  const event = (sessionId, id) =>
    f.request(`/api/playtest/v2/${sessionId}/event`, {
      method: 'POST',
      body: { id, kind: 'sim-tick', payload: { id } },
    });
  return { f, calls, fetcher, directory, home, run, submit, session, event };
}

const feedbackDirs = async (directory) =>
  (await readdir(join(directory, 'feedback'))).filter((n) => !n.startsWith('.')).sort();
const dirFor = async (directory, id) =>
  join(
    directory,
    'feedback',
    (await feedbackDirs(directory)).find((n) => n.endsWith(id)),
  );

test('sync saves every listed feedback across pages with text, media and context', async (t) => {
  const h = await harness(t);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await h.submit(envelope({ text: `note ${i}` }))).id);
  const media = await h.submit(
    envelope({
      text: 'with attachments',
      voice: { mime: 'audio/webm;codecs=opus', base64: opus, durationMs: 1200 },
      image: {
        dataUrl: `data:image/png;base64,${png}`,
        scope: 'canvas',
        capturedAt: new Date().toISOString(),
      },
      context: { value: { parts: [{ id: 'p1' }] }, capturedAt: new Date().toISOString() },
    }),
  );
  const result = await h.run({ pageSize: 2 });
  assert.equal(result.exit, 0);
  assert.deepEqual(
    { listed: result.listed, saved: result.saved, failed: result.failed, gone: result.gone },
    { listed: 4, saved: 4, failed: [], gone: [] },
  );
  const listings = h.calls.filter((c) => c.path === '/admin/playtest/feedback');
  assert.equal(listings.length, 3, 'two full pages and one short page');
  const dirs = await feedbackDirs(h.directory);
  assert.equal(dirs.length, 4);
  for (const id of [...ids, media.id]) assert.ok(dirs.some((n) => n.endsWith(id)));
  assert.match(dirs[0], /^\d{8}T\d{6}\d{3}Z-[0-9a-f-]{36}$/);
  const dir = await dirFor(h.directory, media.id);
  assert.equal(await readFile(join(dir, 'text.txt'), 'utf8'), 'with attachments');
  assert.deepEqual(await readFile(join(dir, 'voice.webm')), Buffer.from(opus, 'base64'));
  assert.deepEqual(await readFile(join(dir, 'image.png')), Buffer.from(png, 'base64'));
  const context = JSON.parse(await readFile(join(dir, 'context.json'), 'utf8'));
  assert.deepEqual(context.value, { parts: [{ id: 'p1' }] });
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'references.json'), 'utf8')), []);
  const exported = JSON.parse(await readFile(join(dir, 'feedback.json'), 'utf8'));
  assert.equal(exported.length, 1);
  assert.equal(exported[0].envelope.id, media.id);
  const status = JSON.parse(await readFile(join(h.directory, 'status.json'), 'utf8'));
  assert.equal(status.exit, 0);
  assert.equal(status.scriptHead, 'abc1234');
  assert.ok(!JSON.stringify(status).includes(token));
  const readme = await readFile(join(h.directory, 'README.md'), 'utf8');
  assert.ok(readme.includes('/etc/sync-config.json'), 'README names the config path of the run');
  assert.ok(/regenerated each run/.test(readme));
});

test('a second run on unchanged server state exports nothing and exits 0', async (t) => {
  const h = await harness(t);
  await h.submit(envelope());
  await h.submit(envelope());
  assert.equal((await h.run()).exit, 0);
  h.calls.length = 0;
  const again = await h.run();
  assert.equal(again.exit, 0);
  assert.equal(again.saved, 0);
  assert.equal(h.calls.filter((c) => c.path.endsWith('/export')).length, 0);
});

test('a new submission whose id sorts below existing ids is still picked up', async (t) => {
  const h = await harness(t);
  await h.submit(envelope({ id: 'ffffffff-0000-4000-8000-000000000001' }));
  await h.run();
  await h.submit(envelope({ id: '00000000-0000-4000-8000-000000000001' }));
  const result = await h.run();
  assert.equal(result.saved, 1);
  assert.equal((await feedbackDirs(h.directory)).length, 2);
});

test('an uppercase submission id is exported verbatim and saved once', async (t) => {
  const h = await harness(t);
  const upper = 'ABCDEF01-2345-4678-8ABC-DEF012345678';
  await h.submit(envelope({ id: upper }));
  const result = await h.run();
  assert.equal(result.saved, 1, JSON.stringify(result));
  assert.deepEqual(result.gone, []);
  const dirs = await feedbackDirs(h.directory);
  assert.ok(dirs.some((n) => n.endsWith(upper)));
  assert.equal((await h.run()).saved, 0);
});

test('an export whose receipt hash does not match is recorded as failed without a final directory', async (t) => {
  const h = await harness(t);
  const good = await h.submit(envelope());
  const bad = await h.submit(envelope());
  const tampering = async (url, init) => {
    const response = await h.fetcher(url, init);
    if (!String(url).includes(`${bad.id}/export`)) return response;
    const value = await response.json();
    value.bodyText = value.bodyText.replace('helped', 'tampered');
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await h.run({ fetcher: tampering });
  assert.equal(result.exit, 2);
  assert.equal(result.saved, 1);
  assert.deepEqual(
    result.failed.map((f) => f.id),
    [bad.id],
  );
  const dirs = await feedbackDirs(h.directory);
  assert.ok(dirs.some((n) => n.endsWith(good.id)) && !dirs.some((n) => n.endsWith(bad.id)));
  assert.ok(!existsSync(join(h.directory, 'feedback', `.tmp-${bad.id}`)));
});

test('leftover temp directories are redone and final directories are never rewritten', async (t) => {
  const h = await harness(t);
  const e = await h.submit(envelope());
  await mkdir(join(h.directory, 'feedback'), { recursive: true, mode: 0o700 });
  await mkdir(join(h.directory, 'feedback', `.tmp-${e.id}`));
  await writeFile(join(h.directory, 'feedback', `.tmp-${e.id}`, 'partial'), 'x');
  assert.equal((await h.run()).saved, 1);
  const dir = await dirFor(h.directory, e.id);
  assert.ok(!existsSync(join(dir, 'partial')));
  const before = (await stat(join(dir, 'feedback.json'))).mtimeMs;
  await writeFile(join(dir, 'marker'), 'kept');
  const again = await h.run();
  assert.equal(again.saved, 0);
  assert.equal((await stat(join(dir, 'feedback.json'))).mtimeMs, before);
  assert.ok(existsSync(join(dir, 'marker')));
});

test('referenced recordings are exported once per session and retried alone after a failure', async (t) => {
  const h = await harness(t);
  const s = await h.session();
  await h.event(s.sessionId, 'e1');
  const a = await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 0 } }));
  const b = await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 5 } }));
  let failSnapshot = true;
  const flaky = async (url, init) => {
    if (failSnapshot && String(url).includes('/snapshot'))
      return new Response('down', { status: 500 });
    return h.fetcher(url, init);
  };
  const first = await h.run({ fetcher: flaky });
  assert.equal(first.exit, 2, 'recording failure is a partial result');
  assert.equal(first.saved, 2, 'feedback itself is saved');
  for (const e of [a, b]) {
    const refs = JSON.parse(
      await readFile(join(await dirFor(h.directory, e.id), 'references.json'), 'utf8'),
    );
    assert.deepEqual(refs, [{ sessionId: s.sessionId, exported: false }]);
  }
  assert.ok(!existsSync(join(h.directory, 'recordings', s.sessionId, 'cutoff-1')));
  failSnapshot = false;
  h.calls.length = 0;
  const second = await h.run({ fetcher: flaky });
  assert.equal(second.exit, 0);
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/export')).length,
    0,
    'feedback not re-exported',
  );
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/snapshot')).length,
    1,
    'one recording export',
  );
  const cutoff = join(h.directory, 'recordings', s.sessionId, 'cutoff-1');
  assert.ok(existsSync(join(cutoff, 'session.json')));
  assert.ok(existsSync(join(cutoff, 'events.ndjson')));
  for (const e of [a, b]) {
    const refs = JSON.parse(
      await readFile(join(await dirFor(h.directory, e.id), 'references.json'), 'utf8'),
    );
    assert.deepEqual(refs, [{ sessionId: s.sessionId, exported: true }]);
  }
});

test('a still-open recording is re-exported when its sequence grows and carries the derived feedback list', async (t) => {
  const h = await harness(t);
  const s = await h.session();
  await h.event(s.sessionId, 'e1');
  const a = await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 0 } }));
  assert.equal((await h.run()).exit, 0);
  const combined = JSON.parse(
    await readFile(
      join(h.directory, 'recordings', s.sessionId, 'cutoff-1', 'feedback.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    combined.map((x) => x.envelope.id),
    [a.id],
  );
  h.calls.length = 0;
  assert.equal((await h.run()).exit, 0);
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/snapshot')).length,
    0,
    'unchanged sequence: no export',
  );
  await h.event(s.sessionId, 'e2');
  const b = await h.submit(
    envelope({
      image: {
        dataUrl: `data:image/png;base64,${png}`,
        scope: 'tab',
        capturedAt: new Date().toISOString(),
        reference: { sessionId: s.sessionId, timeMs: 9 },
      },
    }),
  );
  assert.equal((await h.run()).exit, 0);
  const recordings = (await readdir(join(h.directory, 'recordings', s.sessionId)))
    .filter((n) => n.startsWith('cutoff-'))
    .sort();
  assert.deepEqual(recordings, ['cutoff-1', 'cutoff-2']);
  const latest = JSON.parse(
    await readFile(
      join(h.directory, 'recordings', s.sessionId, 'cutoff-2', 'feedback.json'),
      'utf8',
    ),
  );
  assert.deepEqual(latest.map((x) => x.envelope.id).sort(), [a.id, b.id].sort());
});

test('a corrupt local export or an expired session does not poison the run', async (t) => {
  const h = await harness(t);
  const s = await h.session();
  const s2 = await h.session();
  await h.event(s.sessionId, 'e1');
  await h.event(s2.sessionId, 'e1');
  const good = await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 0 } }));
  const late = await h.submit(envelope({ reference: { sessionId: s2.sessionId, timeMs: 0 } }));
  const flaky = async (url, init) => {
    if (String(url).includes(`/admin/playtest/${s2.sessionId}/snapshot`))
      return new Response('down', { status: 500 });
    return h.fetcher(url, init);
  };
  const first = await h.run({ fetcher: flaky });
  assert.equal(first.exit, 2, 'the s2 recording export failed; both feedback saved');
  assert.equal(first.saved, 2);
  await writeFile(join(await dirFor(h.directory, good.id), 'feedback.json'), '{"broken":true}');
  h.f.st.db.prepare("UPDATE sessions SET state='expired' WHERE id=?").run(s2.sessionId);
  const result = await h.run();
  assert.equal(result.exit, 2, JSON.stringify(result));
  assert.deepEqual(
    result.failed.map((f) => ({ id: f.id, kind: f.kind })),
    [{ id: good.id, kind: 'local' }],
    'the corrupt local export is reported, nothing else fails',
  );
  assert.deepEqual(result.gone, [{ id: s2.sessionId, kind: 'recording' }]);
  assert.ok(
    !existsSync(join(h.directory, 'recordings', s2.sessionId, 'cutoff-1')),
    'no export for a session that is no longer open',
  );
  const refs = JSON.parse(
    await readFile(join(await dirFor(h.directory, late.id), 'references.json'), 'utf8'),
  );
  assert.deepEqual(refs, [{ sessionId: s2.sessionId, exported: false }]);
  assert.ok(existsSync(join(h.directory, 'recordings', s.sessionId, 'cutoff-1', 'session.json')));
});

test('a recording that grows during export is named by the exported cutoff', async (t) => {
  const h = await harness(t);
  const s = await h.session();
  await h.event(s.sessionId, 'e1');
  await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 0 } }));
  let grown = false;
  const racing = async (url, init) => {
    if (!grown && String(url).includes('/admin/playtest/sessions')) {
      const response = await h.fetcher(url, init);
      grown = true;
      await h.event(s.sessionId, 'e2');
      return response;
    }
    return h.fetcher(url, init);
  };
  assert.equal((await h.run({ fetcher: racing })).exit, 0);
  const cutoffs = (await readdir(join(h.directory, 'recordings', s.sessionId))).filter((n) =>
    n.startsWith('cutoff-'),
  );
  assert.deepEqual(cutoffs, ['cutoff-2'], 'directory carries the cutoff the export actually used');
  h.calls.length = 0;
  assert.equal((await h.run()).exit, 0);
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/snapshot')).length,
    0,
    'no re-export of the same data',
  );
});

test('sync issues only GET requests to admin feedback and session routes', async (t) => {
  const h = await harness(t);
  const s = await h.session();
  await h.submit(envelope({ reference: { sessionId: s.sessionId, timeMs: 0 } }));
  await h.submit(envelope());
  const seen = [];
  const spy = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    seen.push({ method, path: new URL(url).pathname });
    if (method !== 'GET') throw Error(`mutation attempted: ${method} ${url}`);
    return h.fetcher(url, init);
  };
  await assert.rejects(
    spy(`${origin}/admin/playtest/feedback/x/delete`, { method: 'POST' }),
    /mutation attempted/,
  );
  seen.length = 0;
  assert.equal((await h.run({ fetcher: spy })).exit, 0);
  assert.ok(seen.length >= 4);
  for (const call of seen) {
    assert.equal(call.method, 'GET');
    assert.match(
      call.path,
      /^\/admin\/playtest\/(feedback(\/[0-9a-f-]{36}\/export)?|sessions|[0-9a-f]{32}\/(snapshot|object))$/,
    );
  }
});

test('config rejects in-repo directories, non-HTTPS origins and permissive file modes', async (t) => {
  const { home, root } = await privateRoot(t);
  const repo = await mkdtemp(join(tmpdir(), 'sync-repo-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(join(repo, '.git'));
  const write = async (name, value, mode = 0o600) => {
    const path = join(root, name);
    await writeFile(path, JSON.stringify(value), { mode });
    await chmod(path, mode);
    return path;
  };
  const ok = { origin, adminToken: token, directory: join(root, 'feedback-sync') };
  assert.equal(
    (await loadSyncConfig(await write('ok.json', ok), { home })).directory,
    ok.directory,
  );
  const inside = join(repo, '.playtest-private', 'feedback-sync');
  assert.equal(
    (await loadSyncConfig(await write('inside.json', { ...ok, directory: inside }), { home }))
      .directory,
    inside,
  );
  await assert.rejects(
    loadSyncConfig(await write('repo.json', { ...ok, directory: join(repo, 'data') }), { home }),
    /private directory/,
  );
  await assert.rejects(
    loadSyncConfig(await write('http.json', { ...ok, origin: 'http://workshop.example' }), {
      home,
    }),
    /HTTPS/,
  );
  await assert.rejects(
    loadSyncConfig(await write('slash.json', { ...ok, origin: `${origin}/` }), { home }),
    /origin/,
  );
  await assert.rejects(loadSyncConfig(await write('mode.json', ok, 0o644), { home }), /mode/);
  await assert.rejects(
    loadSyncConfig(await write('short.json', { ...ok, adminToken: 'short' }), { home }),
    /token/,
  );
});

test('withRetry retries transport errors and 503, treats 410 as gone, 403 as auth failure, other errors terminal', async (t) => {
  const responses = [];
  const fake = async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const retrying = withRetry(fake, { delayMs: 0 });
  responses.push(
    Object.assign(Error('reset'), { cause: { code: 'ECONNRESET' } }),
    new Response('ok'),
  );
  assert.equal(await (await retrying(`${origin}/a`)).text(), 'ok');
  responses.push(
    new Response('busy', { status: 503, headers: { 'retry-after': '0' } }),
    new Response('ok2'),
  );
  assert.equal(await (await retrying(`${origin}/b`)).text(), 'ok2');
  responses.push(new Response('gone', { status: 410 }));
  await assert.rejects(retrying(`${origin}/c`), (e) => e.code === 'GONE' && e.status === 410);
  responses.push(new Response('nope', { status: 403 }));
  await assert.rejects(retrying(`${origin}/d`), (e) => e.code === 'AUTH');
  responses.push(new Response('bad', { status: 500 }));
  const terminal = await retrying(`${origin}/e`);
  assert.equal(
    terminal.status,
    500,
    'non-transient HTTP errors are returned for the caller to classify',
  );
  responses.push(...Array.from({ length: 4 }, () => new Response('busy', { status: 503 })));
  const exhausted = await retrying(`${origin}/f`);
  assert.equal(exhausted.status, 503, 'attempts are bounded');
});

test('withRetry backs off exponentially without retry-after, honours a capped retry-after and keeps the caller signal', async (t) => {
  const waits = [];
  const sleep = async (ms) => void waits.push(ms);
  const seen = [];
  const responses = [];
  const fake = async (url, init) => {
    seen.push(init.signal);
    return responses.shift();
  };
  const retrying = withRetry(fake, { delayMs: 250, sleep });
  responses.push(...Array.from({ length: 4 }, () => new Response('busy', { status: 503 })));
  await retrying(`${origin}/a`);
  assert.deepEqual(waits, [250, 500, 1000], 'no retry-after header means exponential backoff');
  waits.length = 0;
  responses.push(
    new Response('busy', { status: 429, headers: { 'retry-after': '3600' } }),
    new Response('ok'),
  );
  await retrying(`${origin}/b`);
  assert.deepEqual(waits, [30000], 'retry-after is honoured but capped at 30 s');
  const caller = new AbortController();
  seen.length = 0;
  responses.push(new Response('ok'));
  await retrying(`${origin}/c`, { signal: caller.signal });
  caller.abort();
  assert.ok(seen[0].aborted, 'the request signal follows the caller signal');
  responses.push(new Response('busy', { status: 503 }));
  await assert.rejects(retrying(`${origin}/d`, { signal: caller.signal }), /abort/i);
});

test('a feedback that disappears between listing and export counts as gone, not failed', async (t) => {
  const h = await harness(t);
  const e = await h.submit(envelope());
  const vanishing = async (url, init) => {
    if (String(url).includes(`${e.id}/export`)) return new Response('gone', { status: 410 });
    return h.fetcher(url, init);
  };
  const result = await h.run({ fetcher: vanishing });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.gone, [{ id: e.id, kind: 'feedback' }]);
  assert.deepEqual(result.failed, []);
  assert.equal((await feedbackDirs(h.directory)).length, 0);
});

test('malformed listing rows and an oversized page size fail the run instead of touching disk', async (t) => {
  const h = await harness(t);
  await h.submit(envelope());
  const malformed = async (url, init) => {
    if (String(url).includes('/admin/playtest/feedback?'))
      return new Response(
        JSON.stringify([
          {
            submissionId: randomUUID(),
            receivedAt: '../escape',
            bytes: 1,
            status: 'received',
            references: [],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    return h.fetcher(url, init);
  };
  const result = await h.run({ fetcher: malformed });
  assert.equal(result.exit, 1);
  assert.match(result.error, /listing row/);
  assert.equal((await feedbackDirs(h.directory)).length, 0);
  const oversized = await h.run({ pageSize: 5000 });
  assert.equal(oversized.exit, 1);
  assert.match(oversized.error, /pageSize/);
});

test('an auth failure aborts the run with exit 1', async (t) => {
  const h = await harness(t);
  await h.submit(envelope());
  const denied = async () => new Response('forbidden', { status: 403 });
  const result = await h.run({ fetcher: denied });
  assert.equal(result.exit, 1);
  assert.match(result.error, /auth/i);
});

test('a concurrent run exits 3 while the lock is fresh and takes over a stale lock', async (t) => {
  const h = await harness(t);
  await h.submit(envelope());
  await mkdir(h.directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(h.directory, 'sync.lock'),
    JSON.stringify({ pid: 1, startedAt: new Date().toISOString() }),
  );
  const blocked = await h.run();
  assert.equal(blocked.exit, 3);
  assert.equal((await feedbackDirs(h.directory).catch(() => [])).length, 0);
  await writeFile(
    join(h.directory, 'sync.lock'),
    JSON.stringify({ pid: 4194303, startedAt: new Date(Date.now() - 7 * 3600000).toISOString() }),
  );
  const taken = await h.run();
  assert.equal(taken.exit, 0);
  assert.equal(taken.saved, 1);
  assert.ok(!existsSync(join(h.directory, 'sync.lock')), 'lock released after the run');
  await writeFile(
    join(h.directory, 'sync.lock'),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date(Date.now() - 7 * 3600000).toISOString(),
    }),
  );
  assert.equal((await h.run()).exit, 3, 'a stale lock held by a live process is not taken over');
});

test('three references across two sessions and voice-only feedback are saved', async (t) => {
  const h = await harness(t);
  const s1 = await h.session();
  const s2 = await h.session();
  await h.event(s1.sessionId, 'e1');
  await h.event(s2.sessionId, 'e1');
  const now = new Date().toISOString();
  const e = await h.submit(
    envelope({
      text: '',
      voice: { mime: 'audio/ogg;codecs=opus', base64: opus, durationMs: 800 },
      reference: { sessionId: s1.sessionId, timeMs: 0 },
      image: {
        dataUrl: `data:image/webp;base64,${png}`,
        scope: 'tab',
        capturedAt: now,
        reference: { sessionId: s2.sessionId, timeMs: 1 },
      },
      context: {
        value: { a: 1 },
        capturedAt: now,
        reference: { sessionId: s1.sessionId, timeMs: 2 },
      },
    }),
  );
  assert.equal((await h.run()).exit, 0);
  const dir = await dirFor(h.directory, e.id);
  assert.equal(await readFile(join(dir, 'text.txt'), 'utf8'), '');
  assert.ok(existsSync(join(dir, 'voice.ogg')));
  assert.ok(existsSync(join(dir, 'image.webp')));
  const refs = JSON.parse(await readFile(join(dir, 'references.json'), 'utf8'));
  assert.deepEqual(
    refs.sort((x, y) => x.sessionId.localeCompare(y.sessionId)),
    [s1.sessionId, s2.sessionId].sort().map((sessionId) => ({ sessionId, exported: true })),
  );
  for (const s of [s1, s2])
    assert.ok(existsSync(join(h.directory, 'recordings', s.sessionId, 'cutoff-1', 'session.json')));
});

test('plist and README carry absolute paths, the node binary and the stop command, never the token', async (t) => {
  const { home, root, directory } = await privateRoot(t);
  const configPath = join(root, 'feedback-sync.json');
  const config = { origin, adminToken: token, directory };
  const plist = renderPlist({
    configPath,
    config,
    execPath: '/opt/node/bin/node',
    script: '/srv/checkout/scripts/playtest/sync-feedback.mjs',
  });
  assert.ok(plist.includes(`<string>${SYNC_LABEL}</string>`));
  assert.ok(plist.includes('<string>/opt/node/bin/node</string>'));
  assert.ok(plist.includes(`<string>${configPath}</string>`));
  assert.ok(
    plist.includes('<key>StartInterval</key>') && plist.includes('<integer>3600</integer>'),
  );
  assert.ok(plist.includes(join(directory, 'launchd.log')));
  assert.ok(!plist.includes(token) && !plist.includes('EnvironmentVariables'));
  const readme = renderReadme({
    configPath,
    config,
    script: '/srv/checkout/scripts/playtest/sync-feedback.mjs',
  });
  assert.ok(readme.includes(`launchctl bootout gui/$(id -u)/${SYNC_LABEL}`));
  assert.ok(readme.includes(directory) && readme.includes(configPath));
  assert.ok(/never delet/i.test(readme));
  assert.ok(!readme.includes(token));
  assert.ok(/regenerated each run/.test(readme));
  assert.ok(home);
});
