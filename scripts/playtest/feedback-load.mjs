// Observed synthetic feedback envelopes, kept separate from capture-v2 media.
import { lstat, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  feedbackLimits,
  parseFeedbackEnvelope,
  validateFeedbackEnvelope,
} from '../../src/application/feedback-protocol.mjs';
export const feedbackWorkloadIdentity = Object.freeze({
  protocolVersion: 1,
  transport: 'standalone-envelope-v1',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function readFeedbackSamples(files) {
  if (!Array.isArray(files) || !files.length || files.length > 32)
    throw Error('Feedback sample count outside bounds');
  const samples = [];
  let total = 0;
  for (const file of files) {
    const stat = await lstat(file);
    total += stat.size;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !stat.size ||
      stat.size > feedbackLimits.submissionBytes ||
      total > 24 * 1024 ** 2
    )
      throw Error('Feedback sample file outside bounds');
    const bytes = await readFile(file);
    if (bytes.length !== stat.size) throw Error('Feedback sample changed during read');
    parseFeedbackEnvelope(bytes);
    samples.push({ bytes, sha256: digest(bytes) });
  }
  return samples;
}
export function feedbackLoadRequest(
  sample,
  { sessionId, id = randomUUID(), createdAt = new Date().toISOString() } = {},
) {
  const envelope = structuredClone(parseFeedbackEnvelope(sample));
  envelope.id = id;
  envelope.createdAt = createdAt;
  // Never replay a reference to the original specimen's recording. Preserve only
  // the attachment/reference shapes, bound to the newly admitted synthetic session.
  for (const part of [envelope, envelope.image, envelope.context]) {
    if (!part) continue;
    if (part.reference) part.reference = { sessionId, timeMs: 0 };
    if (part.capturedAt) part.capturedAt = createdAt;
  }
  validateFeedbackEnvelope(envelope);
  const bytes = Buffer.from(JSON.stringify(envelope));
  parseFeedbackEnvelope(bytes);
  return {
    path: '/api/playtest/feedback/v1/submission',
    bytes,
    mime: 'application/json',
    expected: {
      protocolVersion: 1,
      submissionId: id,
      uploadHash: digest(bytes),
      status: 'received',
    },
  };
}
