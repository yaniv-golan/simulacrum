import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { resolveWireComponentConfig } from "./component-resolver.js";
import { canonicalQuaternion } from "./primitives.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";

export const BLUEPRINT_FORMAT = "simulacrum-blueprint";
export const BLUEPRINT_VERSION = 1;

function portablePart(part) {
  const result = {
    id: part.id,
    type: part.type,
    pos: [...part.pos],
    orientation: canonicalQuaternion(part.orientation, {
      path: ["part", "orientation"],
    }),
    scale: structuredClone(part.scale || { x: 1, y: 1, z: 1 }),
  };
  if (isMechanismComponentType(part.type))
    result.mechanism = structuredClone(part.mechanism);
  else result.config = resolveWireComponentConfig(part);
  for (const key of [
    "storedEnergyWh",
    "customColor",
    "rigRole",
    "rigVisualRotation",
    "scriptLanguage",
    "scriptSources",
    "controllerBindings",
    "extensions",
  ])
    if (part[key] != null) result[key] = structuredClone(part[key]);
  return result;
}

function portableConnection(connection) {
  const result = Object.fromEntries(
    ["id", "a", "b", "kind", "portA", "portB"]
      .filter((key) => connection[key] != null)
      .map((key) => [key, structuredClone(connection[key])]),
  );
  for (const key of [
    "capacity",
    "anchorA",
    "anchorB",
    "releaseCouplerPartId",
    "config",
    "extensions",
  ])
    if (connection[key] != null) result[key] = structuredClone(connection[key]);
  return result;
}

export function createBlueprint(assembly, metadata = {}) {
  const snapshot = assembly.snapshot();
  return decodeBlueprintOrThrow({
    format: BLUEPRINT_FORMAT,
    version: BLUEPRINT_VERSION,
    name: metadata.name || "Untitled machine",
    ...(metadata.created === null
      ? {}
      : { created: metadata.created || new Date().toISOString() }),
    ...(metadata.demo ? { demo: metadata.demo } : {}),
    parts: snapshot.parts.map(portablePart),
    connections: snapshot.connections.map(portableConnection),
    remoteProfiles: structuredClone(metadata.remoteProfiles || {}),
    defaultRemoteProfile: metadata.defaultRemoteProfile ?? null,
    ...(metadata.extensions && Object.keys(metadata.extensions).length
      ? { extensions: structuredClone(metadata.extensions) }
      : {}),
  }).wire;
}

export function normalizeBlueprint(input) {
  return decodeBlueprintOrThrow(input).wire;
}
