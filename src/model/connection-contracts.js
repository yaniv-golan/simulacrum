import { TYPES } from "./component-catalog.js";
import {
  canonicalQuaternion,
  DomainValidationError,
  rotateVectorByQuaternion,
} from "./primitives.js";
import { portDefinition } from "./ports.js";

export const CONNECTION_CAPACITIES = Object.freeze({
  standard: Object.freeze({
    ultimateForceN: 24_000,
    ultimateTorqueNm: 6_000,
  }),
  gear: Object.freeze({
    ultimateForceN: 12_000,
    ultimateTorqueNm: 2_400,
  }),
  reinforced: Object.freeze({
    ultimateForceN: 48_000,
    ultimateTorqueNm: 14_000,
  }),
});

export const DEFAULT_RESOURCE_TRANSPORTS = Object.freeze({
  "material-resource": Object.freeze({ kind: "finite-allocation-v1" }),
  "compressible-gas": Object.freeze({
    kind: "compressible-gas-v1",
    effectiveOrificeAreaM2: 0.00002,
    dischargeCoefficient: 0.72,
    lineVolumePolicy: Object.freeze({ kind: "zero-storage-line-v1" }),
    maximumAbsolutePressurePa: 1_000_000,
  }),
});

export function isPhysicalConnectionKind(kind) {
  return kind === "mechanical" || kind === "mesh";
}

/** @param {any} part @param {any} other @param {any} otherPort @param {Record<string, any>} [catalog] */
export function localAttachmentAnchor(part, other, otherPort, catalog = TYPES) {
  const otherPortFrame = portDefinition(
      other,
      otherPort,
      catalog,
    ).localFramePart,
    otherPortOffset = otherPortFrame
      ? rotateVectorByQuaternion(
          otherPortFrame.positionM,
          canonicalQuaternion(other.orientation, {
            path: ["part", "orientation"],
          }),
        )
      : [0, 0, 0],
    otherPortWorld = other.pos.map(
      (value, axis) => value + otherPortOffset[axis],
    ),
    delta = otherPortWorld.map((value, axis) => value - part.pos[axis]),
    [x, y, z, w] = canonicalQuaternion(part.orientation, {
      path: ["part", "orientation"],
    });
  return rotateVectorByQuaternion(delta, [-x, -y, -z, w]).map((value) =>
    Number(value.toFixed(6)),
  );
}

/**
 * Adds the persistent physical contract shared by every authoring producer.
 *
 * @param {any} connection
 * @param {any} left
 * @param {any} right
 * @param {{capacity?: any, catalog?: Record<string, any>}} [options]
 */
export function completeConnectionContract(
  connection,
  left,
  right,
  { capacity = null, catalog = TYPES } = {},
) {
  const result = structuredClone(connection),
    physical = isPhysicalConnectionKind(result.kind);
  if (!physical) {
    if (capacity || result.capacity)
      throw new DomainValidationError(
        "NETWORK_CAPACITY_FORBIDDEN",
        `${result.kind} network connections cannot carry joint capacity`,
      );
    delete result.capacity;
    delete result.anchorA;
    delete result.anchorB;
    if (result.kind === "resource" && result.transport == null) {
      const leftBehavior = portDefinition(left, result.portA, catalog).behavior,
        rightBehavior = portDefinition(right, result.portB, catalog).behavior;
      if (
        leftBehavior !== rightBehavior ||
        !DEFAULT_RESOURCE_TRANSPORTS[leftBehavior]
      )
        throw new DomainValidationError(
          "UNSUPPORTED_RESOURCE_TRANSPORT",
          "Resource endpoints require one supported shared transport behavior",
        );
      result.transport = structuredClone(
        DEFAULT_RESOURCE_TRANSPORTS[leftBehavior],
      );
    }
    if (result.kind !== "resource" && result.transport != null)
      throw new DomainValidationError(
        "RESOURCE_TRANSPORT_FORBIDDEN",
        "Only resource connections may declare transport",
      );
    return result;
  }
  if (result.transport != null)
    throw new DomainValidationError(
      "RESOURCE_TRANSPORT_FORBIDDEN",
      "Physical connections may not declare resource transport",
    );
  const resolvedCapacity = capacity || result.capacity;
  if (
    !resolvedCapacity ||
    !Number.isFinite(resolvedCapacity.ultimateForceN) ||
    resolvedCapacity.ultimateForceN <= 0 ||
    !Number.isFinite(resolvedCapacity.ultimateTorqueNm) ||
    resolvedCapacity.ultimateTorqueNm <= 0
  )
    throw new DomainValidationError(
      "INVALID_CONNECTION_CAPACITY",
      "Physical connections require finite positive force and torque capacity",
    );
  result.capacity = structuredClone(resolvedCapacity);
  if (
    portDefinition(left, result.portA, catalog).behavior ===
    "structural-surface"
  )
    result.anchorA = Array.isArray(result.anchorA)
      ? structuredClone(result.anchorA)
      : localAttachmentAnchor(left, right, result.portB, catalog);
  if (
    portDefinition(right, result.portB, catalog).behavior ===
    "structural-surface"
  )
    result.anchorB = Array.isArray(result.anchorB)
      ? structuredClone(result.anchorB)
      : localAttachmentAnchor(right, left, result.portA, catalog);
  return result;
}
