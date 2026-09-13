/** M3b independent feedback wire contract. Shared by browser and server adapters. */
export const feedbackLimits = Object.freeze({
  textCharacters: 10000,
  voiceBytes: 2 * 1024 ** 2,
  voiceDurationMs: 60000,
  imageBytes: 512 * 1024,
  contextBytes: 256 * 1024,
  submissionBytes: 4 * 1024 ** 2,
});
export const FEEDBACK_LIMITS = feedbackLimits;
const utf8 = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const timestamp = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
function reject(message, status = 400) {
  throw Object.assign(Error(message), { status, statusCode: status });
}
function record(value, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    reject('Invalid feedback object');
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    reject('Invalid feedback fields');
}
function bound(value, limit, label) {
  if (value > limit) reject(`${label} exceeds limit`, 413);
}
function reference(value) {
  record(value, ['sessionId', 'timeMs']);
  if (
    typeof value.sessionId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.sessionId) ||
    !Number.isFinite(value.timeMs) ||
    value.timeMs < 0
  )
    reject('Invalid feedback recording reference');
}
function base64Size(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    reject('Invalid feedback base64');
  // Reject noncanonical padding bits as well as malformed alphabet/padding.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (
    (value.endsWith('==') && alphabet.indexOf(value.at(-3)) & 15) ||
    (value.endsWith('=') && !value.endsWith('==') && alphabet.indexOf(value.at(-2)) & 3)
  )
    reject('Invalid feedback base64 padding');
  return (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}
export function validateFeedbackVoice(value) {
  record(value, ['mime', 'base64', 'durationMs']);
  if (
    ![
      'audio/webm',
      'audio/webm;codecs=opus',
      'audio/ogg',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ].includes(value.mime)
  )
    reject('Unsupported feedback voice type', 415);
  bound(base64Size(value.base64), feedbackLimits.voiceBytes, 'Voice');
  if (
    !Number.isFinite(value.durationMs) ||
    value.durationMs <= 0 ||
    value.durationMs > feedbackLimits.voiceDurationMs
  )
    reject('Invalid feedback voice duration');
  return value;
}
function jsonValue(value, depth = 0) {
  if (depth > 64) reject('Feedback context too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) jsonValue(value[i], depth + 1);
    return;
  }
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    for (const v of Object.values(value)) jsonValue(v, depth + 1);
    return;
  }
  reject('Invalid feedback context JSON');
}
export function validateFeedbackEnvelope(value) {
  record(
    value,
    ['protocolVersion', 'id', 'createdAt', 'text'],
    ['voice', 'image', 'context', 'reference'],
  );
  if (
    value.protocolVersion !== 1 ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !timestamp(value.createdAt) ||
    typeof value.text !== 'string'
  )
    reject('Invalid feedback identity or text');
  bound([...value.text].length, feedbackLimits.textCharacters, 'Text');
  if (!value.text.trim() && !value.voice) reject('Feedback requires text or voice');
  if (Object.hasOwn(value, 'voice')) validateFeedbackVoice(value.voice);
  if (Object.hasOwn(value, 'reference')) reference(value.reference);
  if (Object.hasOwn(value, 'image')) {
    record(value.image, ['dataUrl', 'scope', 'capturedAt'], ['reference']);
    if (
      !['canvas', 'tab'].includes(value.image.scope) ||
      !timestamp(value.image.capturedAt) ||
      typeof value.image.dataUrl !== 'string'
    )
      reject('Invalid feedback image');
    const match = /^data:image\/(?:jpeg|png|webp);base64,(.*)$/.exec(value.image.dataUrl);
    if (!match) reject('Unsupported feedback image type', 415);
    base64Size(match[1]);
    bound(utf8.encode(value.image.dataUrl).length, feedbackLimits.imageBytes, 'Image');
    if (Object.hasOwn(value.image, 'reference')) reference(value.image.reference);
  }
  if (Object.hasOwn(value, 'context')) {
    record(value.context, ['value', 'capturedAt'], ['reference']);
    if (!timestamp(value.context.capturedAt)) reject('Invalid feedback context time');
    jsonValue(value.context.value);
    bound(
      utf8.encode(JSON.stringify(value.context.value)).length,
      feedbackLimits.contextBytes,
      'Context',
    );
    if (Object.hasOwn(value.context, 'reference')) reference(value.context.reference);
  }
  bound(utf8.encode(JSON.stringify(value)).length, feedbackLimits.submissionBytes, 'Submission');
  return value;
}
export function parseFeedbackEnvelope(bytes) {
  const raw = typeof bytes === 'string' ? utf8.encode(bytes) : bytes;
  if (!(raw instanceof Uint8Array)) reject('Invalid feedback body');
  bound(raw.byteLength, feedbackLimits.submissionBytes, 'Submission');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    reject('Invalid feedback JSON');
  }
  return validateFeedbackEnvelope(value);
}
export async function feedbackDigest(bytes) {
  const raw = typeof bytes === 'string' ? utf8.encode(bytes) : bytes;
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', raw)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function encodeFeedbackEnvelope(value) {
  const bodyText = JSON.stringify(validateFeedbackEnvelope(value));
  return { bodyText, uploadHash: await feedbackDigest(bodyText) };
}
export function validateFeedbackReceipt(receipt, expected) {
  try {
    record(receipt, ['protocolVersion', 'submissionId', 'uploadHash', 'receivedAt', 'status']);
    return (
      receipt.protocolVersion === 1 &&
      receipt.status === 'received' &&
      receipt.submissionId === expected.id &&
      receipt.uploadHash === expected.uploadHash &&
      /^[a-f0-9]{64}$/.test(receipt.uploadHash) &&
      timestamp(receipt.receivedAt)
    );
  } catch {
    return false;
  }
}
