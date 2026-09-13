// M3b: bounded standalone submission transport; capture events remain separate.
import { fail } from './protocol.mjs';
export const feedbackEndpoint = '/api/playtest/feedback/v1/submission';
export const feedbackId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const feedbackReferences = (value) =>
  [value.reference, value.image?.reference, value.context?.reference].filter(Boolean);
export const feedbackBudget = (value = 128 * 1024 ** 2) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw Error('Invalid feedback storage budget');
  return n;
};
// A single bounded bucket per server, in addition to existing body/storage admission.
export function feedbackRate() {
  let tokens = 60,
    at = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(60, tokens + (now - at) / 1000);
    at = now;
    if (tokens < 1) throw fail(429, 'Feedback rate limit; retry later');
    tokens--;
  };
}
export function feedbackReceipt(id, uploadHash) {
  return {
    protocolVersion: 1,
    submissionId: id,
    uploadHash,
    receivedAt: new Date().toISOString(),
    status: 'received',
  };
}
export function feedbackPage(url) {
  const after = url.searchParams.get('after') || '',
    limit = Number(url.searchParams.get('limit') || 100),
    sessionId = url.searchParams.get('sessionId') || null;
  if (
    (after && !feedbackId.test(after)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    (sessionId && !/^[a-f0-9]{32}$/.test(sessionId))
  )
    throw fail(400, 'Invalid feedback list cursor');
  return { after, limit, sessionId };
}
