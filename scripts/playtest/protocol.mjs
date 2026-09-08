// M3b portable capture wire contract. No storage or transport ownership.
export const PROTOCOL_VERSION = 2;
export const LIMITS = Object.freeze({
  sessionBytes: 1024 ** 3,
  sessions: 20,
  aggregateBytes: 20 * 1024 ** 3,
  metadataBytes: 8 * 1024 ** 3,
  eventBytes: 2 * 1024 ** 2,
  mediaBytes: 10 * 1024 ** 2,
  startBytes: 64 * 1024,
  uploads: 100000,
  pointerBytes: 4096,
});
export const safeId = /^[A-Za-z0-9_-]{1,80}$/;
export const mediaTypes = new Set([
  'video/webm',
  'audio/webm',
  'audio/mp4',
  'video/mp4',
  'application/octet-stream',
]);
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const json = (bytes) => {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value;
  } catch {
    throw fail(400, 'Expected a JSON object');
  }
};
export async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function uploadHash(bytes, mime = '') {
  const prefix = new TextEncoder().encode(mime),
    joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix);
  joined.set(bytes, prefix.length);
  return digest(joined);
}
export function mediaIdentity(url, type) {
  const kind = url.searchParams.get('kind'),
    clip = url.searchParams.get('clip'),
    seq = url.searchParams.get('seq');
  if (
    !['screen', 'voice'].includes(kind) ||
    !safeId.test(clip || '') ||
    !/^(0|[1-9][0-9]{0,8})$/.test(seq || '')
  )
    throw fail(400, 'Invalid media identity');
  const mime = (type || 'application/octet-stream').toLowerCase();
  if (mime.length > 200 || !mediaTypes.has(mime.split(';')[0].trim()))
    throw fail(415, 'Unsupported media type');
  return { kind, clip, seq: Number(seq), mime, file: `${kind}-${clip}-${seq}.bin` };
}
// The token is held by the caller through persistence, not merely body reading.
export function admission(maxCount = 2, maxBytes = 20 * 1024 ** 2) {
  let count = 0,
    bytes = 0;
  return {
    acquire(size) {
      if (count >= maxCount || bytes + size > maxBytes) throw fail(429, 'Storage busy');
      count++;
      bytes += size;
      let held = true;
      return () => {
        if (held) {
          held = false;
          count--;
          bytes -= size;
        }
      };
    },
    status: () => ({ count, bytes }),
  };
}
export async function readBounded(stream, limit, { idleMs = 5000, totalMs = 25000 } = {}) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(),
    chunks = [];
  let size = 0,
    timer,
    totalTimer;
  const total = new Promise((_, reject) => {
    totalTimer = setTimeout(() => reject(fail(408, 'Body deadline')), totalMs);
  });
  try {
    while (true) {
      const idle = new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(408, 'Body inactive')), idleMs);
      });
      let part;
      try {
        part = await Promise.race([reader.read(), idle, total]);
      } finally {
        clearTimeout(timer);
      }
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw fail(413, 'Request too large');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(totalTimer);
    reader.releaseLock();
  }
}
