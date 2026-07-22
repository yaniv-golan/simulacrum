import { MAX_SHARE_BYTES } from "./share-packages.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const MAX_SHARE_LINK_CHARACTERS = 60_000;

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64ToBytes(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/"),
    padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4),
    binary = atob(padded),
    bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readBounded(stream, maximumBytes) {
  const reader = stream.getReader(),
    chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("Shared design exceeds the 2 MB safety limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function gzip(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return readBounded(stream, MAX_SHARE_BYTES);
}

async function gunzipBounded(bytes) {
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot open compressed share links");
  return readBounded(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    MAX_SHARE_BYTES,
  );
}

export function portableShareCopy(value) {
  const copy = structuredClone(value);
  if (copy.metadata) copy.metadata.thumbnail = "";
  return copy;
}

export async function encodeSharePayload(value) {
  const raw = encoder.encode(JSON.stringify(portableShareCopy(value)));
  if (raw.byteLength > MAX_SHARE_BYTES)
    throw new Error("Shared design exceeds the 2 MB safety limit");
  const compressed = await gzip(raw),
    method = compressed && compressed.length < raw.length ? "gz" : "raw",
    bytes = method === "gz" ? compressed : raw,
    encoded = `${method}.${bytesToBase64(bytes)}`;
  if (encoded.length > MAX_SHARE_LINK_CHARACTERS)
    throw new Error(
      "This design is too large for a link; download its file instead",
    );
  return encoded;
}

export async function decodeSharePayload(value) {
  const source = String(value || "");
  if (source.length > MAX_SHARE_LINK_CHARACTERS)
    throw new Error("Invalid or oversized Simulacrum share link");
  const [method, payload] = source.split(".", 2);
  if (!payload || !["gz", "raw"].includes(method))
    throw new Error("Invalid Simulacrum share link");
  let bytes;
  try {
    bytes = base64ToBytes(payload);
  } catch {
    throw new Error("Invalid Simulacrum share link");
  }
  if (method === "raw" && bytes.byteLength > MAX_SHARE_BYTES)
    throw new Error("Shared design exceeds the 2 MB safety limit");
  if (method === "gz") bytes = await gunzipBounded(bytes);
  return JSON.parse(decoder.decode(bytes));
}

export async function readShareUrl(value) {
  const match = String(value || "").match(/[#&]share=([^&]+)/);
  if (!match) throw new Error("No Simulacrum package found in this link");
  return decodeSharePayload(match[1]);
}

export async function parseSharedText(value) {
  const source = String(value || "").trim();
  if (!source) throw new Error("Paste a current package or share link first");
  return source.includes("#share=") ? readShareUrl(source) : JSON.parse(source);
}
