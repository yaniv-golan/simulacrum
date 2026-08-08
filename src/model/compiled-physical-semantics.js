import { stableStringify } from "./primitives.js";
import { sha256Hex } from "./sha256.js";

function jsonPhysicalValue(value, path = []) {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(
        `compiled physical semantics require a finite number at ${path.join(".")}`,
      );
    return value;
  }
  if (Array.isArray(value))
    return value.map((child, index) => {
      if (child === undefined)
        throw new TypeError(
          `compiled physical semantics cannot omit array value at ${[
            ...path,
            index,
          ].join(".")}`,
        );
      return jsonPhysicalValue(child, [...path, index]);
    });
  if (
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(
      `compiled physical semantics require plain JSON values at ${path.join(".")}`,
    );
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, jsonPhysicalValue(child, [...path, key])]),
  );
}

function orderedEntityCollection(values, path) {
  return jsonPhysicalValue(values, [path]);
}

function canonicalNetworkCollections(networks) {
  if (!networks || typeof networks !== "object" || Array.isArray(networks))
    throw new TypeError("compiled physical semantics require network sets");
  return Object.fromEntries(
    Object.entries(networks).map(([kind, values]) => [
      kind,
      orderedEntityCollection(values, `networks.${kind}`),
    ]),
  );
}

/**
 * Canonical physical meaning of one compiler result. Diagnostics and summary
 * counters are excluded because they are derived read models; every authored
 * or compiled value that can change runtime physics remains in the projection.
 */
export function compiledPhysicalSemantics(compiled) {
  return jsonPhysicalValue({
    version: compiled.version,
    sourceRevision: compiled.sourceRevision,
    // The compiler emits every runtime-consumed collection in a canonical
    // order. Preserve that order here: body/constraint/network insertion is a
    // finite-solver execution parameter, not presentation-only serialization.
    parts: orderedEntityCollection(compiled.parts, "parts"),
    bodies: orderedEntityCollection(compiled.bodies, "bodies"),
    constraints: orderedEntityCollection(compiled.constraints, "constraints"),
    rigidClusters: orderedEntityCollection(
      compiled.rigidClusters,
      "rigidClusters",
    ),
    collisionExclusions: orderedEntityCollection(
      compiled.collisionExclusions,
      "collisionExclusions",
    ),
    forceElements: orderedEntityCollection(
      compiled.forceElements,
      "forceElements",
    ),
    flexibleLines: orderedEntityCollection(
      compiled.flexibleLines || [],
      "flexibleLines",
    ),
    actuators: orderedEntityCollection(compiled.actuators, "actuators"),
    contactRegions: orderedEntityCollection(
      compiled.contactRegions,
      "contactRegions",
    ),
    networks: canonicalNetworkCollections(compiled.networks),
  });
}

export function compiledPhysicalSemanticsFingerprint(compiled) {
  return `sim-sha256-${sha256Hex(
    `simulacrum-compiled-physical-semantics-v2\0${stableStringify(
      compiledPhysicalSemantics(compiled),
    )}`,
  )}`;
}
