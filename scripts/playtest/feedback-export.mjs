import { constants, existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFeedbackEnvelope,
  feedbackDigest,
  validateFeedbackReceipt,
} from '../../src/application/feedback-protocol.mjs';

export async function validateFeedbackExport(value) {
  if (value?.protocolVersion !== 1 || typeof value.bodyText !== 'string')
    throw Error('Invalid feedback export');
  const envelope = parseFeedbackEnvelope(value.bodyText);
  if (JSON.stringify(envelope) !== JSON.stringify(value.envelope))
    throw Error('Feedback envelope disagrees with raw evidence');
  const uploadHash = await feedbackDigest(value.bodyText);
  if (!validateFeedbackReceipt(value.receipt, { id: envelope.id, uploadHash }))
    throw Error('Feedback receipt checksum or identity mismatch');
  return { protocolVersion: 1, envelope, bodyText: value.bodyText, receipt: value.receipt };
}
export async function readFeedbackExports(directory) {
  const target = join(directory, 'feedback.json');
  if (!existsSync(target)) return [];
  const info = lstatSync(target);
  if (!info.isFile() || info.size > 128 * 1024 ** 2)
    throw Error('Invalid or oversized feedback export file');
  const value = JSON.parse(
    readFileSync(target, { encoding: 'utf8', flag: constants.O_RDONLY | constants.O_NOFOLLOW }),
  );
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length > 1000) throw Error('Feedback export count exceeds limit');
  const result = [],
    identities = new Set();
  for (const entry of entries) {
    const validated = await validateFeedbackExport(entry);
    if (identities.has(validated.envelope.id)) throw Error('Duplicate feedback export identity');
    identities.add(validated.envelope.id);
    result.push(validated);
  }
  return result;
}
