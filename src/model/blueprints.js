import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import {
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "./authored-assembly-content.js";

export const BLUEPRINT_FORMAT = "simulacrum-blueprint";
export const BLUEPRINT_VERSION = 1;

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
    parts: snapshot.parts.map(projectPortableAuthoredPart),
    connections: snapshot.connections.map(projectPortableAuthoredConnection),
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
