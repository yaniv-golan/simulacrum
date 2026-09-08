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
  globalThis.fetch = () => {
    throw Error('Unexpected provider request');
  };
  try {
    await assert.rejects(measureCaptureLoad({ origin: 'https://invalid', capture }), /growth/);
  } finally {
    globalThis.fetch = originalFetch;
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
