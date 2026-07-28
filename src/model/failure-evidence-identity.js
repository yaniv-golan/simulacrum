import { stableStringify } from "./primitives.js";
import { sha256Hex } from "./sha256.js";

export function failureEvidencePolicyFingerprint(policy) {
  return `sim-sha256-${sha256Hex(
    `simulacrum-failure-evidence-policy-v1\0${stableStringify(policy)}`,
  )}`;
}

export function failureEvidenceManifestDigest(input) {
  const view = structuredClone(input);
  delete view.manifestDigest;
  return sha256Hex(
    `simulacrum-failure-evidence-manifest-v2\0${stableStringify(view)}`,
  );
}

export function fingerprintEvidenceDeployment(deployment) {
  return `sim-sha256-${sha256Hex(stableStringify(deployment))}`;
}
