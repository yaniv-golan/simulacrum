import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeCorpus, readCorpus } from '../scripts/playtest/corpus.mjs';
import { feedbackRate } from '../scripts/playtest/feedback-common.mjs';
import * as load from '../scripts/playtest/load.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const envelope = {
  protocolVersion: 1,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  createdAt: '2026-09-12T00:00:00.000Z',
  text: 'Measured synthetic feedback',
  voice: { mime: 'audio/webm;codecs=opus', base64: 'AQID', durationMs: 1000 },
  reference: { sessionId: 'a'.repeat(32), timeMs: 1000 },
  context: {
    value: { mode: 'workshop' },
    capturedAt: '2026-09-12T00:00:00.000Z',
    reference: { sessionId: 'a'.repeat(32), timeMs: 900 },
  },
};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'feedback-load-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'observed.json');
  await writeFile(file, JSON.stringify(envelope, null, 2));
  const capture = {
    recordingMode: 'data',
    captureSchema: 1,
    captureSeconds: 60,
    mediaFiles: [],
    screenBytes: 0,
    voiceBytes: 0,
    maximumVoiceChunkBytes: 0,
    eventSamples: [{ id: 'input', kind: 'input' }],
    finalOutbox: { bytes: 0, pending: 0 },
    browserVersion: 'test',
    source: { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) },
    build: 'app-test',
    syntheticRun: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    feedbackFiles: [file],
  };
  return { root, file, capture };
}
test('synthetic corpus preserves feedback envelopes separately from capture media and detects corruption', async (t) => {
  const { root, file, capture } = await fixture(t);
  const record = await writeCorpus(join(root, 'corpus'), capture);
  assert.equal(record.schema, 4, 'legacy corpus readers must not silently ignore feedback');
  assert.equal(record.feedback?.protocolVersion, 1);
  assert.equal(record.feedback.transport, 'standalone-envelope-v1');
  assert.equal(record.feedback.samples[0].sha256, digest(await readFile(file)));
  const restored = await readCorpus(join(root, 'corpus'), record.id);
  assert.equal(restored.mediaFiles.length, 0);
  assert.equal(restored.feedbackFiles.length, 1);
  assert.deepEqual(await readFile(restored.feedbackFiles[0]), await readFile(file));
  await writeFile(restored.feedbackFiles[0], JSON.stringify({ ...envelope, text: 'tampered' }));
  await assert.rejects(readCorpus(join(root, 'corpus'), record.id), /feedback.*integrity/i);
});
test('feedback corpus rejects invalid envelopes instead of accepting them as media', async (t) => {
  const { root, file, capture } = await fixture(t);
  await writeFile(file, JSON.stringify({ ...envelope, protocolVersion: 2 }));
  await assert.rejects(writeCorpus(join(root, 'bad'), capture), /feedback/i);
});

test('feedback load retries the exact v1 envelope, rebinds references, and rejects malformed receipts', async () => {
  const calls = [],
    stats = { requests: 0, retries: 0, timeouts: 0 };
  let clock = 0;
  const delivery = {
    sample: Buffer.from(JSON.stringify(envelope)),
    sessionId: 'b'.repeat(32),
    deadline: 10000,
    stats,
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    send: async (path, bytes, mime) => {
      calls.push({ path, bytes: Buffer.from(bytes), mime });
      const body = JSON.parse(bytes);
      if (calls.length === 1) return new Response('', { status: 429 });
      return Response.json({
        protocolVersion: 1,
        submissionId: body.id,
        uploadHash: digest(bytes),
        status: 'received',
        receivedAt: '2026-09-12T00:00:00.000Z',
      });
    },
  };
  const result = await load.uploadFeedbackSample(delivery);
  assert.equal(calls[0].path, '/api/playtest/feedback/v1/submission');
  assert.equal(calls[0].mime, 'application/json');
  assert.deepEqual(calls[0], calls[1]);
  const body = JSON.parse(calls[0].bytes);
  assert.notEqual(body.id, envelope.id);
  assert.equal(body.reference.sessionId, delivery.sessionId);
  assert.equal(body.context.reference.sessionId, delivery.sessionId);
  assert.equal(body.voice.base64, envelope.voice.base64);
  assert.equal(result.bytes, calls[0].bytes.length);
  await assert.rejects(
    load.uploadFeedbackSample({
      ...delivery,
      send: async (_path, bytes) =>
        Response.json({
          protocolVersion: 1,
          submissionId: JSON.parse(bytes).id,
          uploadHash: digest(bytes),
          status: 'received',
          receivedAt: 'invalid',
        }),
    }),
    /receipt/,
  );
  await assert.rejects(
    load.uploadFeedbackSample({
      ...delivery,
      send: async (_path, bytes) =>
        Response.json({
          protocolVersion: 2,
          submissionId: JSON.parse(bytes).id,
          uploadHash: digest(bytes),
          status: 'received',
          receivedAt: '2026-09-12T00:00:00.000Z',
        }),
    }),
    /receipt/,
  );
});

test('feedback scheduling preserves sparse observed rates instead of rounding every tick up', () => {
  assert.equal(load.feedbackLoadRate({ captureSeconds: 60 }, 1), 0.05);
  assert.equal(load.feedbackLoadRate({ captureSeconds: 60 }, 0), 0);
  assert.equal(load.feedbackLoadRate({ captureSeconds: 12 }, 5), 1.25);
  assert.equal(
    load.feedbackLoadRate(
      {
        feedback: { cases: [{ samples: 1 }, { samples: 3 }] },
        cases: [{ captureSeconds: 60 }, { captureSeconds: 30 }],
      },
      4,
    ),
    0.3,
  );
});

test('feedback cumulative schedule preserves totals and stays within healthy admission', () => {
  for (const rate of [0, 0.05, 0.3, 1.25]) {
    let total = 0;
    for (let slot = 0; slot < 800; slot++) {
      const count = load.feedbackScheduled(rate, slot + 1) - load.feedbackScheduled(rate, slot);
      assert.ok(Number.isInteger(count) && count >= 0);
      total += count;
      assert.ok(Math.abs(total - rate * (slot + 1)) < 1 + 1e-10);
    }
    assert.equal(total, Math.floor(800 * rate));
  }
  const originalNow = Date.now;
  let clock = 0;
  Date.now = () => clock;
  try {
    const admission = feedbackRate();
    let accepted = 0;
    for (let tick = 0; tick < 40; tick++) {
      clock = tick * 3000;
      for (let client = 0; client < 20; client++) {
        const slot = tick * 20 + client;
        const count = load.feedbackScheduled(0.05, slot + 1) - load.feedbackScheduled(0.05, slot);
        for (let n = 0; n < count; n++) {
          admission();
          accepted++;
        }
      }
    }
    assert.equal(accepted, 40, 'one message per minute from twenty clients for two minutes');
  } finally {
    Date.now = originalNow;
  }
});
