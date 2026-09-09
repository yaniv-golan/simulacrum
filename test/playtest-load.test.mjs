import test from 'node:test';
import assert from 'node:assert/strict';
import { retryUpload } from '../scripts/playtest/load.mjs';
test('load keeps the exact event request through throttling and checks receipt identity', async () => {
  const calls = [],
    stats = { requests: 0, retries: 0, timeouts: 0 };
  let clock = 0;
  const body = new Uint8Array([1, 2, 3]);
  const receipt = { protocolVersion: 2, sessionId: 's', logicalKey: 'event:e', uploadHash: 'hash' };
  const result = await retryUpload({
    path: '/event',
    bytes: body,
    mime: 'application/json',
    expected: receipt,
    deadline: 10000,
    stats,
    now: () => clock,
    wait: async (ms) => (clock += ms),
    send: async (p, b) => {
      calls.push([p, Array.from(b)]);
      return calls.length === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json(receipt);
    },
  });
  assert.deepEqual(result, receipt);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(stats.retries, 1);
  assert.ok(clock >= 2000);
  await assert.rejects(
    retryUpload({
      path: '/event',
      bytes: body,
      mime: 'application/json',
      expected: receipt,
      deadline: 10000,
      stats,
      now: () => clock,
      wait: async () => {},
      send: async () => Response.json({ ...receipt, logicalKey: 'wrong' }),
    }),
    /receipt/,
  );
});

test('capture qualification rejects sustained growth and missing evidence but permits bounded bursts', async () => {
  const { assertCaptureBacklog, measureCaptureLoad } = await import('../scripts/playtest/load.mjs');
  const capture = {
    recordingMode: 'video',
    captureSchema: 1,
    captureSeconds: 1800,
    finalOutbox: { bytes: 0, pending: 0 },
    outboxSamples: Array.from({ length: 600 }, (_, i) => ({
      at: (i + 1) * 3000,
      bytes: i * 100000,
      pending: i,
    })),
  };
  assert.throws(() => assertCaptureBacklog(capture), /growth/);
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PLAYTEST_ADMIN_TOKEN;
  process.env.PLAYTEST_ADMIN_TOKEN = 'synthetic-test-token-'.repeat(4);
  globalThis.fetch = () => {
    throw Error('Unexpected provider request');
  };
  try {
    await assert.rejects(
      measureCaptureLoad({
        origin: 'https://invalid',
        capture: { ...capture, mediaFiles: ['sample'], eventSamples: [{}], screenBytes: 60000 },
      }),
      /Unexpected provider request/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PLAYTEST_ADMIN_TOKEN;
    else process.env.PLAYTEST_ADMIN_TOKEN = originalToken;
  }
  assert.throws(() => assertCaptureBacklog({ ...capture, outboxSamples: [] }), /samples/);
  const bounded = {
    ...capture,
    outboxSamples: capture.outboxSamples.map((s, i) => ({
      ...s,
      bytes: i % 100 < 10 ? 2000000 : 0,
      pending: 0,
    })),
  };
  assert.doesNotThrow(() => assertCaptureBacklog(bounded));
  assert.throws(
    () => assertCaptureBacklog({ ...bounded, finalOutbox: { bytes: 1, pending: 1 } }),
    /drain/,
  );
});

test('short capture supplies capacity workload without claiming endurance', async () => {
  const { assertCaptureWorkload, assertCaptureBacklog } = await import(
    '../scripts/playtest/load.mjs'
  );
  const capture = {
    recordingMode: 'video',
    captureSchema: 1,
    captureSeconds: 60,
    screenBytes: 60000,
    maximumScreenChunkBytes: 3000,
    maximumEventBytes: 10,
    mediaFiles: ['sample'],
    eventSamples: [{ id: 'e' }],
    finalOutbox: { pending: 0, bytes: 0 },
  };
  const bounds = {
    maxMediaBytesPerSecond: 2000,
    maxEventsPerSecond: 2,
    maxChunkBytes: 4000,
    maxEventBytes: 1000,
  };
  assert.equal(assertCaptureWorkload(capture, bounds).mediaBytesPerSecond, 1000);
  assert.throws(() => assertCaptureBacklog(capture, 60), /duration/);
  for (const patch of [
    { screenBytes: Infinity },
    { screenBytes: 6000000 },
    { maximumScreenChunkBytes: 5000 },
    { finalOutbox: { pending: 1, bytes: 1 } },
  ])
    assert.throws(() => assertCaptureWorkload({ ...capture, ...patch }, bounds));
  const endurance = {
    ...capture,
    recordingMode: 'video',
    captureSchema: 1,
    captureSeconds: 360,
    outboxSamples: Array.from({ length: 120 }, (_, i) => ({ at: (i + 1) * 3000, bytes: 0 })),
  };
  assert.doesNotThrow(() => assertCaptureBacklog(endurance, 360));
  assert.throws(
    () =>
      assertCaptureBacklog(
        { ...endurance, outboxSamples: endurance.outboxSamples.slice(0, 100) },
        360,
      ),
    /Complete|Incomplete/,
  );
});

test('active driving evidence rejects gravity-only motion and changed body inventory', async () => {
  const { assertDrivenMotion } = await import('../scripts/playtest/load.mjs');
  const start = { tick: 0, physics: [{ id: 'chassis', position: [0, 1, 0] }] };
  assert.throws(
    () =>
      assertDrivenMotion(start, { tick: 120, physics: [{ id: 'chassis', position: [0, 0, 0] }] }),
    /horizontal/,
  );
  assert.doesNotThrow(() =>
    assertDrivenMotion(start, { tick: 120, physics: [{ id: 'chassis', position: [1, 1, 0] }] }),
  );
  assert.throws(() => assertDrivenMotion(start, { tick: 120, physics: [] }), /identity/);
  assert.throws(
    () => assertDrivenMotion(start, { tick: 0, physics: [{ id: 'chassis', position: [1, 1, 0] }] }),
    /simulation/,
  );
});

async function capacityModeWitness(t, recordingMode) {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { measureCaptureLoad } = await import('../scripts/playtest/load.mjs');
  const root = await mkdtemp(join(tmpdir(), 'load-envelope-'));
  const file = join(root, 'sample');
  await writeFile(file, '12345');
  const previous = globalThis.fetch;
  const token = process.env.PLAYTEST_ADMIN_TOKEN;
  process.env.PLAYTEST_ADMIN_TOKEN = 't'.repeat(64);
  const deliveries = [];
  let sessions = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname === '/admin/playtest/sessions') return Response.json([]);
    if (u.pathname.includes('/admin/')) return Response.json({ ok: true, token: 'synthetic' });
    if (u.pathname === '/join')
      return new Response('', { status: 303, headers: { 'set-cookie': 'auth=synthetic' } });
    if (u.pathname.endsWith('/session')) return Response.json({ sessionId: `s${sessions++}` });
    const bytes = Buffer.from(await new Response(options.body).arrayBuffer());
    const sessionId = u.pathname.split('/')[4];
    const media = u.pathname.endsWith('/media');
    const key = media
      ? `media:${u.searchParams.get('kind')}:${u.searchParams.get('clip')}:${u.searchParams.get('seq')}`
      : `event:${JSON.parse(bytes).id}`;
    deliveries.push({ key, bytes: bytes.length, sessionId });
    return Response.json({
      protocolVersion: 2,
      sessionId,
      logicalKey: key,
      uploadHash: createHash('sha256')
        .update(media ? options.headers['content-type'] : '')
        .update(bytes)
        .digest('hex'),
    });
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    let done = false;
    const pending = measureCaptureLoad({
      origin: 'https://synthetic.test',
      seconds: 3,
      reservation: { id: 'r' },
      capture: {
        recordingMode,
        captureSchema: 1,
        captureSeconds: 60,
        mediaFiles: recordingMode === 'video' ? [file] : [],
        maximumMediaFile: file,
        eventSamples: [{ kind: 'input' }],
        maximumEvent: { kind: 'input', data: 'x'.repeat(1000) },
        screenBytes: recordingMode === 'video' ? 5 : 0,
        finalOutbox: { bytes: 0, pending: 0 },
        envelope: { mediaCopiesPerTick: 2, eventsPerTick: 2 },
      },
    }).finally(() => {
      done = true;
    });
    pending.catch(() => {});
    // Advance only the test clock; production still uses the real timed network path.
    for (let i = 0; i < 2000 && !done; i++) {
      t.mock.timers.tick(100);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const result = await pending;
    assert.equal(deliveries.filter((d) => d.key.startsWith('event:') && d.bytes > 1000).length, 20);
    assert.equal(result.scheduled, recordingMode === 'video' ? 100 : 40);
    assert.equal(result.completed, result.scheduled);
    assert.equal(result.mediaPerTick, recordingMode === 'video' ? 3 : 0);
    assert.equal(
      deliveries.filter((d) => d.key.startsWith('media:screen:load:')).length,
      recordingMode === 'video' ? 60 : 0,
    );
    if (recordingMode === 'data') {
      assert.equal(deliveries.filter((d) => d.key.startsWith('media:voice:maximum:')).length, 2);
      assert.equal(deliveries.filter((d) => d.key.startsWith('media:screen:')).length, 0);
    }
    assert.equal(new Set(deliveries.map((d) => `${d.sessionId}/${d.key}`)).size, deliveries.length);
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = previous;
    if (token === undefined) delete process.env.PLAYTEST_ADMIN_TOKEN;
    else process.env.PLAYTEST_ADMIN_TOKEN = token;
    await rm(root, { recursive: true, force: true });
  }
}
test('capacity sends retained samples and envelope stress with distinct acknowledged keys', (t) =>
  capacityModeWitness(t, 'video'));
test('data capacity covers wire events and admitted voice without screen media', (t) =>
  capacityModeWitness(t, 'data'));
