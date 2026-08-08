import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { portAxisPart } from "./component-geometry-contract.js";
import { portDefinition } from "./ports.js";
import { componentPorts } from "./component-contracts.js";
import {
  canonicalQuaternion,
  detachPlainData,
  rotateVectorByQuaternion,
  scopedIdentity,
} from "./primitives.js";
export { worldPortFrame } from "./connection-frame-invariants.js";

export const PHYSICAL_CONNECTION_KINDS = new Set(["mechanical", "mesh"]);
export const COORDINATE_CONSTRAINT_KINDS = new Set([
  "revolute",
  "linear-guide",
  "linear-actuator",
]);

export const cloneCompiledValue = (value) =>
  detachPlainData(value, {
    code: "INVALID_ASSEMBLY_PLAIN_DATA",
    finiteNumbers: true,
    message:
      "Assembly input must be accessor-free, acyclic, plain persisted data",
    path: ["assembly"],
  });

export function compiledVector(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map((index) =>
    Number.isFinite(source[index]) ? source[index] : fallback[index],
  );
}

export function endpointPort(connection, endpoint) {
  return endpoint === "a" ? connection.portA : connection.portB;
}

export function compiledPortDefinition(part, portId, catalog) {
  return portDefinition(part, portId, /** @type {any} */ (catalog));
}

export function axisFor(part, catalog) {
  if (Array.isArray(part.config?.axis)) return compiledVector(part.config.axis);
  const geometry = geometryDescriptorForPart(part, catalog),
    firstFrame = Object.entries(geometry.portFrames).find(
      ([portId]) => geometry.portClasses[portId] !== "network-only",
    )?.[1];
  return firstFrame ? portAxisPart(firstFrame) : [1, 0, 0];
}

export function isAxialForceElement(part) {
  const config = part?.mechanism?.config;
  return Boolean(
    config?.endpointPortA &&
    config?.endpointPortB &&
    config?.massModel &&
    (config.elasticLaw ||
      config.dampingLaw ||
      config.commandLaw ||
      config.releaseLaw),
  );
}

function endpointBehaviors(part, catalog) {
  return new Set(
    componentPorts(part, catalog).map((descriptor) => descriptor.behavior),
  );
}

export function isLinkageEndpoint(part, portId, catalog) {
  const ports = componentPorts(part, catalog),
    ids = new Set(ports.map((descriptor) => descriptor.id));
  return ids.has("PIVOT") && ids.has("LINK") && portId === "LINK";
}

export function isPivotEndpoint(part, portId, catalog) {
  const ports = componentPorts(part, catalog),
    ids = new Set(ports.map((descriptor) => descriptor.id));
  return ids.has("PIVOT") && ids.has("LINK") && portId === "PIVOT";
}

export function requiresRotarySupport(part, catalog) {
  const behaviors = endpointBehaviors(part, catalog);
  return (
    (behaviors.has("rotary-coupling") || behaviors.has("gear")) &&
    !behaviors.has("fixed") &&
    !behaviors.has("structural-surface") &&
    !behaviors.has("revolute-support")
  );
}

export function orientationFor(part) {
  return canonicalQuaternion(part.orientation, {
    path: ["parts", part.id, "orientation"],
  });
}

/**
 * Projects an internal mechanism-coordinate frame into world space. This is
 * deliberately separate from component port geometry: mechanism frames own a
 * constraint coordinate, never an attachment location.
 */
export function worldMechanismFrame(part, framePart) {
  const orientation = orientationFor(part),
    positionOffset = rotateVectorByQuaternion(
      compiledVector(framePart.positionM),
      orientation,
    ),
    localAxis = rotateVectorByQuaternion(
      [0, 0, 1],
      canonicalQuaternion(framePart.orientation),
    );
  return {
    positionWorld: compiledVector(part.pos).map(
      (value, axis) => value + positionOffset[axis],
    ),
    axisWorld: rotateVectorByQuaternion(localAxis, orientation),
  };
}

export function worldPoint(part, positionPartM) {
  const offset = rotateVectorByQuaternion(
    compiledVector(positionPartM),
    orientationFor(part),
  );
  return compiledVector(part.pos).map((value, axis) => value + offset[axis]);
}

export function constraintId(kind, source, { typedStrings = false } = {}) {
  return scopedIdentity(kind, source.id ?? `${source.a}:${source.b}`, {
    typedStrings,
  });
}
