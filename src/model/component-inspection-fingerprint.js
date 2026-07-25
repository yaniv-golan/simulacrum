import { canonicalControllerBindings } from "./controller-bindings.js";
import { decodeAuthoredAssemblyContentOrThrow } from "./authored-assembly-content.js";
import { DomainValidationError, stableStringify } from "./primitives.js";

export const COMPONENT_INSPECTION_FINGERPRINT_VERSION = 1;
const DOMAIN = "simulacrum-component-inspection-assembly-v1";
const encoder = new TextEncoder();

const compareCodeUnits = (left, right) =>
  left === right ? 0 : left < right ? -1 : 1;
const stableRecordId = (value) => `${typeof value}:${String(value)}`;

function canonicalContent(input) {
  const decoded = decodeAuthoredAssemblyContentOrThrow(input),
    parts = decoded.parts
      .map((part) => ({
        ...structuredClone(part),
        ...(part.controllerBindings
          ? {
              controllerBindings: canonicalControllerBindings(
                part.controllerBindings,
              ).map((binding) => structuredClone(binding)),
            }
          : {}),
      }))
      .sort((left, right) => left.id - right.id),
    connections = decoded.connections
      .map((connection) => structuredClone(connection))
      .sort(
        (left, right) =>
          compareCodeUnits(stableRecordId(left.id), stableRecordId(right.id)) ||
          left.a - right.a ||
          left.b - right.b ||
          compareCodeUnits(left.portA, right.portA) ||
          compareCodeUnits(left.portB, right.portB) ||
          compareCodeUnits(left.kind, right.kind),
      );
  return { parts, connections };
}

/** Canonical UTF-8 bytes for the public authored assembly identity contract. */
export function componentInspectionAssemblyFingerprintBytes(input) {
  return encoder.encode(
    `${DOMAIN}\0${stableStringify(canonicalContent(input))}`,
  );
}

/** SHA-256 identity over strict current authored assembly semantics. */
export async function fingerprintComponentInspectionAssembly(input) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new DomainValidationError(
      "CRYPTO_UNAVAILABLE",
      "SHA-256 is unavailable in this runtime",
    );
  const digest = await subtle.digest(
    "SHA-256",
    componentInspectionAssemblyFingerprintBytes(input),
  );
  return `sim-sha256-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
