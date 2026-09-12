import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedbackExport } from '../scripts/playtest/feedback-export.mjs';
import { feedbackDigest } from '../src/application/feedback-protocol.mjs';
import { downloadFeedback } from '../scripts/playtest/download-feedback.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const envelope = {
  protocolVersion: 1,
  id: '12345678-1234-4123-8123-123456789012',
  createdAt: '2026-09-12T00:00:00.000Z',
  text: 'Exact </script> text',
  voice: { mime: 'audio/webm', base64: 'AQID', durationMs: 1000 },
  context: { value: { program: 'private text' }, capturedAt: '2026-09-12T00:00:00.000Z' },
};
async function sample() {
  const bodyText = JSON.stringify(envelope, null, 2);
  return {
    protocolVersion: 1,
    envelope,
    bodyText,
    receipt: {
      protocolVersion: 1,
      submissionId: envelope.id,
      uploadHash: await feedbackDigest(bodyText),
      receivedAt: envelope.createdAt,
      status: 'received',
    },
  };
}
test('standalone review names received feedback without inventing an unfinished recording', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedback-review-'));
  try {
    await writeFile(join(root, 'feedback.json'), JSON.stringify(await sample()));
    execFileSync(process.execPath, ['scripts/export-playtest.mjs', root]);
    const html = await readFile(join(root, 'review.html'), 'utf8');
    assert.match(html, /<h1>Workshop feedback review<\/h1>/);
    assert.match(html, /id="recording-view" hidden/);
    assert.ok(!html.includes('<script>Exact'));
    assert.ok(html.includes('\\u003c/script>'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('export preserves exact serialized receipt evidence and voice/context payload', async () => {
  const input = await sample();
  assert.deepEqual(await validateFeedbackExport(input), input);
  await assert.rejects(
    validateFeedbackExport({ ...input, bodyText: JSON.stringify(envelope) }),
    /receipt|checksum/i,
  );
  await assert.rejects(
    validateFeedbackExport({ ...input, envelope: { ...envelope, text: 'substituted' } }),
    /disagrees/i,
  );
  await assert.rejects(
    validateFeedbackExport({ ...input, receipt: { ...input.receipt, submissionId: 'wrong' } }),
    /receipt/i,
  );
});
test('session feedback export follows full pages without dropping later submissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedback-pages-'));
  const sessionId = 'a'.repeat(32),
    values = [],
    pages = [];
  for (let i = 0; i < 101; i++) {
    const value = await sample();
    value.envelope = {
      ...value.envelope,
      id: `12345678-1234-4123-8123-${String(i).padStart(12, '0')}`,
      reference: { sessionId, timeMs: i },
    };
    value.bodyText = JSON.stringify(value.envelope);
    value.receipt = {
      ...value.receipt,
      submissionId: value.envelope.id,
      uploadHash: await feedbackDigest(value.bodyText),
    };
    values.push(value);
  }
  try {
    const result = await downloadFeedback({
      origin: 'https://workshop.example',
      sessionId,
      directory: join(root, 'all'),
      token: 'x'.repeat(32),
      fetcher: async (url) => {
        if (url.pathname.endsWith('/export'))
          return new Response(
            JSON.stringify(values.find((v) => url.pathname.includes(v.envelope.id))),
          );
        pages.push(url.href);
        return new Response(
          JSON.stringify(
            values
              .filter((v) => v.envelope.id > (url.searchParams.get('after') ?? ''))
              .slice(0, 100)
              .map((v) => ({ submissionId: v.envelope.id })),
          ),
        );
      },
    });
    assert.equal(result.submissions, 101);
    assert.equal(pages.length, 2);
    assert.equal(
      JSON.parse(await readFile(join(root, 'all', 'feedback.json'), 'utf8')).length,
      101,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('authenticated downloader preserves exact bytes and checks returned identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedback-export-'));
  const value = await sample(),
    calls = [];
  const options = {
    origin: 'https://workshop.example',
    submissionId: envelope.id,
    token: 'x'.repeat(32),
    fetcher: async (url, init) => {
      calls.push([url.href, init]);
      return new Response(JSON.stringify(value));
    },
  };
  try {
    await downloadFeedback({ ...options, directory: join(root, 'good') });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'good', 'feedback.json'), 'utf8')), [
      value,
    ]);
    assert.equal(calls[0][1].headers.authorization, `Bearer ${options.token}`);
    assert.equal(calls[0][1].redirect, 'error');
    await assert.rejects(
      downloadFeedback({
        ...options,
        submissionId: '12345678-1234-4123-8123-123456789013',
        directory: join(root, 'wrong'),
      }),
      /identity/i,
    );
    await assert.rejects(
      downloadFeedback({
        ...options,
        origin: 'https://attacker@workshop.example/path',
        directory: join(root, 'origin'),
      }),
      /origin/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
