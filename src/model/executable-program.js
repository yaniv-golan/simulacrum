import { CONTROLLER_POLICY_VERSION } from "./controller-policy.js";

export { CONTROLLER_POLICY_VERSION };

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
}

export function executableDescriptor({
  language,
  source,
  bindingManifest = [],
  policyVersion = CONTROLLER_POLICY_VERSION,
}) {
  if (!language) throw new TypeError("executable language is required");
  return canonicalValue({
    language: String(language),
    source,
    bindingManifest,
    policyVersion: String(policyVersion),
  });
}

export function canonicalExecutable(descriptor) {
  return JSON.stringify(canonicalValue(descriptor));
}

export async function executableDigest(
  descriptor,
  cryptoRef = globalThis.crypto,
) {
  if (!cryptoRef?.subtle)
    throw new Error("cryptographic digest service is unavailable");
  const bytes = new TextEncoder().encode(canonicalExecutable(descriptor));
  const digest = await cryptoRef.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
