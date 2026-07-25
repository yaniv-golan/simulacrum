import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { resolveWireComponentConfig } from "./component-resolver.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";
import {
  canonicalQuaternion,
  DomainValidationError,
  immutableClone,
} from "./primitives.js";

export const AUTHORED_ASSEMBLY_CONTENT_VERSION = 1;

const TOP_LEVEL_FIELDS = new Set(["parts", "connections", "revision"]);
const PART_FIELDS = new Set([
  "id",
  "type",
  "pos",
  "orientation",
  "scale",
  "config",
  "mechanism",
  "storedEnergyWh",
  "customColor",
  "rigRole",
  "rigVisualRotation",
  "scriptLanguage",
  "scriptSources",
  "controllerBindings",
  "extensions",
]);
const CONNECTION_FIELDS = new Set([
  "id",
  "a",
  "b",
  "kind",
  "portA",
  "portB",
  "capacity",
  "anchorA",
  "anchorB",
  "releaseCouplerPartId",
  "config",
  "extensions",
]);

function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainValidationError(
      "INVALID_AUTHORED_CONTENT_RECORD",
      "Authored assembly content records must be objects",
      { path },
    );
}

function assertKnownFields(value, allowed, path) {
  assertRecord(value, path);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown)
    throw new DomainValidationError(
      "UNSUPPORTED_AUTHORED_CONTENT_FIELD",
      `Unsupported authored assembly content field ${unknown}`,
      { path: [...path, unknown], details: { field: unknown } },
    );
}

/** Projects one part into the current portable authored field allowlist. */
export function projectPortableAuthoredPart(part) {
  assertRecord(part, ["part"]);
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

/** Projects one connection into the current portable authored field allowlist. */
export function projectPortableAuthoredConnection(connection) {
  assertRecord(connection, ["connection"]);
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

/**
 * Decodes the strict in-memory authored-content value used by inspection and
 * fingerprints. This is not a persisted compatibility format.
 */
export function decodeAuthoredAssemblyContentOrThrow(input) {
  assertKnownFields(input, TOP_LEVEL_FIELDS, []);
  if (!Array.isArray(input.parts) || !Array.isArray(input.connections))
    throw new DomainValidationError(
      "INVALID_AUTHORED_ASSEMBLY_CONTENT",
      "Authored assembly content requires parts and connections arrays",
    );
  if (
    input.revision != null &&
    (!Number.isSafeInteger(input.revision) || input.revision < 0)
  )
    throw new DomainValidationError(
      "INVALID_AUTHORED_CONTENT_REVISION",
      "Authored assembly revision must be a non-negative safe integer",
      { path: ["revision"] },
    );
  input.parts.forEach((part, index) => {
    assertKnownFields(part, PART_FIELDS, ["parts", index]);
    const hasConfig = Object.hasOwn(part, "config");
    const hasMechanism = Object.hasOwn(part, "mechanism");
    if (hasConfig === hasMechanism)
      throw new DomainValidationError(
        "INVALID_AUTHORED_COMPONENT_CONFIGURATION",
        "Authored parts require exactly one of config or mechanism",
        { path: ["parts", index] },
      );
  });
  input.connections.forEach((connection, index) =>
    assertKnownFields(connection, CONNECTION_FIELDS, ["connections", index]),
  );
  const decoded = decodeBlueprintOrThrow({
    format: "simulacrum-blueprint",
    version: 1,
    name: "Authored assembly content",
    parts: input.parts.map(projectPortableAuthoredPart),
    connections: input.connections.map(projectPortableAuthoredConnection),
    remoteProfiles: {},
    defaultRemoteProfile: null,
  });
  return immutableClone({
    parts: decoded.wire.parts,
    connections: decoded.wire.connections,
  });
}
