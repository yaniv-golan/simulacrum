import { TYPES } from "./component-catalog.js";
import {
  canonicalQuaternion,
  DomainValidationError,
  rotateVectorByQuaternion,
} from "./primitives.js";
import { portDefinition } from "./ports.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";

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

export function isPhysicalConnectionKind(kind) {
  return kind === "mechanical" || kind === "mesh";
}

/** @param {any} part @param {any} other @param {any} otherPort @param {Record<string, any>} [catalog] */
export function localAttachmentAnchor(part, other, otherPort, catalog = TYPES) {
  const otherPortFrame = geometryDescriptorForPart(other, catalog).portFrames[
    otherPort
  ];
  if (!otherPortFrame)
    throw new DomainValidationError(
      "MISSING_SPATIAL_PORT_FRAME",
      `Port ${otherPort} has no canonical spatial frame`,
    );
  const otherPortOffset = rotateVectorByQuaternion(
      otherPortFrame.framePart.positionM,
      canonicalQuaternion(other.orientation, {
        path: ["part", "orientation"],
      }),
    ),
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

function worldPointForLocalAnchor(part, anchorPart) {
  const offset = rotateVectorByQuaternion(
    anchorPart,
    canonicalQuaternion(part.orientation, { path: ["part", "orientation"] }),
  );
  return part.pos.map((value, axis) => value + offset[axis]);
}

function localAnchorForWorldPoint(part, positionWorldM) {
  const delta = positionWorldM.map((value, axis) => value - part.pos[axis]),
    [x, y, z, w] = canonicalQuaternion(part.orientation, {
      path: ["part", "orientation"],
    });
  return rotateVectorByQuaternion(delta, [-x, -y, -z, w]).map((value) =>
    Number(value.toFixed(6)),
  );
}

function canonicalPortPositionWorld(part, portId, catalog) {
  const portFrame = geometryDescriptorForPart(part, catalog).portFrames[portId];
  if (!portFrame)
    throw new DomainValidationError(
      "MISSING_SPATIAL_PORT_FRAME",
      `Port ${portId} has no canonical spatial frame`,
    );
  return worldPointForLocalAnchor(part, portFrame.framePart.positionM);
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
    return result;
  }
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
  const surfaceA =
      portDefinition(left, result.portA, catalog).behavior ===
      "structural-surface",
    surfaceB =
      portDefinition(right, result.portB, catalog).behavior ===
      "structural-surface";
  if (surfaceA && surfaceB) {
    let positionWorldM;
    if (Array.isArray(result.anchorA))
      positionWorldM = worldPointForLocalAnchor(left, result.anchorA);
    else if (Array.isArray(result.anchorB))
      positionWorldM = worldPointForLocalAnchor(right, result.anchorB);
    else {
      const positionA = canonicalPortPositionWorld(left, result.portA, catalog),
        positionB = canonicalPortPositionWorld(right, result.portB, catalog);
      positionWorldM = positionA.map(
        (value, axis) => (value + positionB[axis]) / 2,
      );
    }
    result.anchorA = localAnchorForWorldPoint(left, positionWorldM);
    result.anchorB = localAnchorForWorldPoint(right, positionWorldM);
  } else {
    if (surfaceA)
      result.anchorA = Array.isArray(result.anchorA)
        ? structuredClone(result.anchorA)
        : localAttachmentAnchor(left, right, result.portB, catalog);
    if (surfaceB)
      result.anchorB = Array.isArray(result.anchorB)
        ? structuredClone(result.anchorB)
        : localAttachmentAnchor(right, left, result.portA, catalog);
  }
  return result;
}
