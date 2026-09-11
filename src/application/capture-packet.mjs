import { gzipSync, Gunzip } from 'fflate';
// Application payload encoding, not HTTP Content-Encoding: receipts hash these exact bytes.
const maximum = 2 * 1024 ** 2;
const utf8 = new TextEncoder();
const headers = new Map(
  [1, 6].map((level) => [level, gzipSync(new Uint8Array(), { level, mtime: 0 }).subarray(0, 10)]),
);
const reject = () => {
  throw Error('Invalid compressed capture packet');
};
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function packCapturePacket(packet) {
  const plain = utf8.encode(JSON.stringify(packet));
  if (plain.length > maximum) reject();
  if (plain.length < 4096) return packet;
  const payload = gzipSync(plain, { level: 6, mtime: 0 });
  const compressed = {
    id: packet.id,
    kind: 'capture-batch',
    data: {
      schema: 1,
      encoding: 'gzip-base64',
      uncompressedBytes: plain.length,
      payload: base64(payload),
    },
  };
  return utf8.encode(JSON.stringify(compressed)).length <= plain.length * 0.85
    ? compressed
    : packet;
}
export function unpackCapturePacket(packet) {
  if (packet?.data?.encoding === undefined) return packet;
  const data = packet.data;
  if (
    packet.kind !== 'capture-batch' ||
    data.schema !== 1 ||
    data.encoding !== 'gzip-base64' ||
    Object.keys(data).sort().join(',') !== 'encoding,payload,schema,uncompressedBytes' ||
    !Number.isSafeInteger(data.uncompressedBytes) ||
    data.uncompressedBytes < 1 ||
    data.uncompressedBytes > maximum ||
    typeof data.payload !== 'string' ||
    data.payload.length > maximum ||
    data.payload.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.payload)
  )
    reject();
  const input = Uint8Array.from(atob(data.payload), (c) => c.charCodeAt(0));
  const level = input[8] === 4 ? 1 : 6;
  const header = headers.get(level);
  if (base64(input) !== data.payload || input.length < 18 || header.some((b, i) => b !== input[i]))
    reject();
  const chunks = [];
  let size = 0,
    ended = false;
  const decoder = new Gunzip((chunk, final) => {
    size += chunk.length;
    if (size > data.uncompressedBytes) reject();
    chunks.push(chunk);
    ended ||= final;
  });
  decoder.onmember = reject;
  // Bound each inflate step as well as total retained output. Never inflate a whole hostile blob.
  for (let offset = 0; offset < input.length; offset += 128)
    decoder.push(input.subarray(offset, offset + 128), offset + 128 >= input.length);
  if (!ended || size !== data.uncompressedBytes) reject();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  // Pin the encoding to canonical level-6 gzip, validating trailer, checksum and trailing bytes.
  const canonical = gzipSync(bytes, { level, mtime: 0 });
  if (canonical.length !== input.length || canonical.some((b, i) => b !== input[i])) reject();
  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    decoded.kind !== 'capture-batch' ||
    decoded.data?.schema !== 1 ||
    decoded.data.encoding !== undefined ||
    !Array.isArray(decoded.data.events) ||
    decoded.data.events.length < 1 ||
    decoded.data.events.length > 128
  )
    reject();
  // The outer id owns transport deduplication; capacity probes may assign a fresh key.
  return { ...decoded, id: packet.id };
}
