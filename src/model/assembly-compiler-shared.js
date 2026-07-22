import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { portDefinition } from "./ports.js";
import { componentPorts } from "./component-contracts.js";
import { canonicalQuaternion, rotateVectorByQuaternion } from "./primitives.js";

export const PHYSICAL_CONNECTION_KINDS = new Set(["mechanical", "mesh"]);
export const COORDINATE_CONSTRAINT_KINDS = new Set([
  "revolute",
  "linear-guide",
  "linear-actuator",
]);

export const cloneCompiledValue = (value) => structuredClone(value);

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
  return compiledVector(
    geometryDescriptorForPart(part, catalog).renderDetailAnchors.axis,
    [1, 0, 0],
  );
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

export function worldPortFrame(part, descriptor, structuralAnchor = null) {
  const localFrame = descriptor.localFramePart || {
      positionM: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    },
    orientation = orientationFor(part),
    positionOffset = rotateVectorByQuaternion(
      compiledVector(structuralAnchor || localFrame.positionM),
      orientation,
    ),
    localAxis = rotateVectorByQuaternion([0, 0, 1], localFrame.orientation);
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

export function constraintId(kind, source) {
  return `${kind}:${source.id ?? `${source.a}:${source.b}`}`;
}
