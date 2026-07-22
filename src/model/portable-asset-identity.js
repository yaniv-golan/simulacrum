import { normalizeBlueprint } from "./blueprints.js";
import { stableStringify } from "./primitives.js";
import { decodeSubassemblyOrThrow } from "./subassemblies.js";

export const ASSET_FINGERPRINT_PATTERN = /^sim-sha256-[0-9a-f]{64}$/;

const encoder = new TextEncoder();

/** Returns the canonical current asset used by identity and share boundaries. */
export function normalizePortableAsset(kind, asset) {
  if (kind === "blueprint") return structuredClone(normalizeBlueprint(asset));
  if (kind === "subassembly")
    return structuredClone(decodeSubassemblyOrThrow(asset).wire);
  throw new Error("Unknown shared asset type");
}

function contentView(kind, asset) {
  const copy = structuredClone(asset);
  if (kind === "blueprint") {
    delete copy.name;
    delete copy.created;
    delete copy.demo;
  } else {
    delete copy.name;
    delete copy.accent;
  }
  return copy;
}

/** SHA-256 identity over normalized portable engineering semantics. */
export async function fingerprintAsset(kind, asset) {
  const normalized = normalizePortableAsset(kind, asset);
  const source = `simulacrum-asset-v1\0${kind}\0${stableStringify(
    contentView(kind, normalized),
  )}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(source));
  return `sim-sha256-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
