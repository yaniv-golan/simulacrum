import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  feedbackLimits,
  validateFeedbackEnvelope,
  encodeFeedbackEnvelope,
  validateFeedbackReceipt,
  parseFeedbackEnvelope,
} from '../src/application/feedback-protocol.mjs';
const envelope = () => ({
  protocolVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-09-12T12:00:00.000Z',
  text: 'It worked!',
});
test('feedback protocol binds exact UTF8 payload and strict complete receipt', async () => {
  const value = envelope(),
    encoded = await encodeFeedbackEnvelope(value);
  assert.deepEqual(parseFeedbackEnvelope(encoded.bodyText), value);
  assert.equal(encoded.uploadHash, createHash('sha256').update(encoded.bodyText).digest('hex'));
  const receipt = {
    protocolVersion: 1,
    submissionId: value.id,
    uploadHash: encoded.uploadHash,
    receivedAt: value.createdAt,
    status: 'received',
  };
  assert.equal(
    validateFeedbackReceipt(receipt, { id: value.id, uploadHash: encoded.uploadHash }),
    true,
  );
  for (const wrong of [
    { ...receipt, status: 'pending' },
    { ...receipt, uploadHash: 'a'.repeat(64) },
    { ...receipt, extra: true },
    { ...receipt, receivedAt: 'today' },
  ])
    assert.equal(
      validateFeedbackReceipt(wrong, { id: value.id, uploadHash: encoded.uploadHash }),
      false,
    );
});
test('feedback admission rejects unknown fields malformed media and bounds while permitting optional voice', () => {
  const valid = envelope();
  assert.equal(validateFeedbackEnvelope(valid), valid);
  for (const patch of [
    { text: '' },
    { text: '😀'.repeat(10001) },
    { voice: { mime: 'audio/webm', base64: '%%%%', durationMs: 2 } },
    { context: { value: { n: NaN }, capturedAt: valid.createdAt } },
    {
      image: {
        dataUrl: 'data:text/html;base64,AAAA',
        scope: 'canvas',
        capturedAt: valid.createdAt,
      },
    },
    { reference: { sessionId: 'x', timeMs: 1 } },
    { hidden: true },
  ])
    assert.throws(() => validateFeedbackEnvelope({ ...valid, ...patch }));
  assert.doesNotThrow(() => validateFeedbackEnvelope({ ...valid, text: '😀'.repeat(10000) }));
  assert.doesNotThrow(() =>
    validateFeedbackEnvelope({
      ...valid,
      text: '',
      voice: { mime: 'audio/webm', base64: 'AAAA', durationMs: 100 },
    }),
  );
  assert.throws(() =>
    validateFeedbackEnvelope({
      ...valid,
      voice: {
        mime: 'audio/webm',
        base64: Buffer.alloc(feedbackLimits.voiceBytes + 1).toString('base64'),
        durationMs: 100,
      },
    }),
  );
  assert.throws(() => parseFeedbackEnvelope(' '.repeat(feedbackLimits.submissionBytes + 1)));
});
