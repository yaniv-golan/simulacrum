import { AssemblyModel } from "./assembly-model.js";
import {
  assertBlueprintAcquisition,
  BlueprintAcquisition,
} from "./blueprint-acquisition.js";
import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { createBlueprint } from "./blueprints.js";
import { validateSubassemblyWire } from "./generated/portable-machine-wire-validators.js";
import { DomainValidationError } from "./primitives.js";
import { portDefinition, portIds } from "./ports.js";
import { validateWireInput, wireResult } from "./wire-validation.js";
import { remapControllerBindings } from "./controller-bindings.js";

export const SUBASSEMBLY_FORMAT = "simulacrum-subassembly";
export const SUBASSEMBLY_VERSION = 1;
export const LOCAL_SUBASSEMBLY_FORMAT = "simulacrum-local-subassembly-record";
export const LOCAL_SUBASSEMBLY_VERSION = 1;
export const SUBASSEMBLY_EXPOSED_PORT_ROLES = Object.freeze([
  "mount",
  "motion",
  "power",
  "signal",
  "sensor",
  "command",
  "resource",
]);

const LOCAL_ORIGIN_KINDS = new Set([
  BlueprintAcquisition.LOCAL_AUTHORING,
  BlueprintAcquisition.BUILT_IN,
  BlueprintAcquisition.FILE_IMPORT,
  BlueprintAcquisition.SHARE_IMPORT,
]);
const FINGERPRINT_PATTERN = /^sim-sha256-[0-9a-f]{64}$/;

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function connectedSelection(parts, connections) {
  if (parts.length < 2) return true;
  const selected = new Set(parts.map((part) => part.id));
  const adjacency = new Map(parts.map((part) => [part.id, []]));
  for (const connection of connections) {
    if (!selected.has(connection.a) || !selected.has(connection.b)) continue;
    adjacency.get(connection.a).push(connection.b);
    adjacency.get(connection.b).push(connection.a);
  }
  const visited = new Set();
  const queue = [parts[0].id];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...adjacency.get(id));
  }
  return visited.size === parts.length;
}

function exposedRole(definition) {
  if (definition.kind === "power") return "power";
  if (definition.kind === "resource") return "resource";
  if (definition.kind === "signal")
    return definition.direction === "source" ? "sensor" : "command";
  return /rotary|linear|gear/.test(definition.behavior) ? "motion" : "mount";
}

function internalPortUseCount(connections, partId, port) {
  return connections.filter(
    (connection) =>
      (connection.a === partId && connection.portA === port) ||
      (connection.b === partId && connection.portB === port),
  ).length;
}

/** Ports that can accept an external connection without bypassing multiplicity. */
export function availableSubassemblyPorts(assembly, selectedIds) {
  const selected = new Set(selectedIds || []),
    parts = (assembly?.parts || [])
      .filter((part) => selected.has(part.id))
      .sort((left, right) => left.id - right.id),
    connections = (assembly?.connections || []).filter(
      (connection) => selected.has(connection.a) && selected.has(connection.b),
    );
  return parts.flatMap((part) =>
    portIds(part).flatMap((port) => {
      const definition = portDefinition(part, port),
        occupied = internalPortUseCount(connections, part.id, port);
      if (definition.multiplicity === "one" && occupied) return [];
      return [
        Object.freeze({
          partId: part.id,
          port,
          label: `${part.type} #${part.id} · ${port}`,
          role: exposedRole(definition),
        }),
      ];
    }),
  );
}

function validateExposedPorts(parts, connections, exposedPorts) {
  const partById = new Map(parts.map((part) => [part.id, part])),
    ids = new Set(),
    endpoints = new Set();
  for (const [index, exposed] of exposedPorts.entries()) {
    if (ids.has(exposed.id))
      fail("DUPLICATE_EXPOSED_PORT_ID", "Exposed port IDs must be unique", [
        "exposedPorts",
        index,
        "id",
      ]);
    ids.add(exposed.id);
    const part = partById.get(exposed.partId);
    if (!part)
      fail(
        "UNKNOWN_EXPOSED_PORT_PART",
        "Exposed port references a missing part",
        ["exposedPorts", index, "partId"],
      );
    let definition;
    try {
      definition = portDefinition(part, exposed.port);
    } catch (error) {
      fail(
        "UNKNOWN_EXPOSED_PORT",
        "Exposed port is not declared by its part",
        ["exposedPorts", index, "port"],
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    const endpoint = `${exposed.partId}:${exposed.port}`;
    if (endpoints.has(endpoint))
      fail(
        "DUPLICATE_EXPOSED_ENDPOINT",
        "A part port may be exposed only once",
        ["exposedPorts", index],
      );
    endpoints.add(endpoint);
    if (
      definition.multiplicity === "one" &&
      internalPortUseCount(connections, exposed.partId, exposed.port)
    )
      fail(
        "OCCUPIED_EXPOSED_PORT",
        "A single-use port connected inside the subassembly cannot also be exposed",
        ["exposedPorts", index, "port"],
      );
  }
}

function decode(input) {
  const envelope = validateWireInput(
    input,
    "subassembly",
    validateSubassemblyWire,
  );
  const wire = envelope.value;
  if (wire.name !== wire.name.trim())
    fail("INVALID_SUBASSEMBLY_NAME", "Subassembly name must be trimmed", [
      "name",
    ]);
  const blueprint = decodeBlueprintOrThrow({
    format: "simulacrum-blueprint",
    version: 1,
    name: wire.name,
    parts: wire.parts,
    connections: wire.connections,
    remoteProfiles: {},
    defaultRemoteProfile: null,
  }).wire;
  if (!connectedSelection(blueprint.parts, blueprint.connections))
    fail(
      "DISCONNECTED_SUBASSEMBLY",
      "Reusable subassembly must contain one connected assembly",
      ["connections"],
    );
  validateExposedPorts(
    blueprint.parts,
    blueprint.connections,
    wire.exposedPorts,
  );
  return Object.freeze({
    wire: Object.freeze({
      ...wire,
      parts: blueprint.parts,
      connections: blueprint.connections,
    }),
    envelope: Object.freeze({ bytes: envelope.bytes, nodes: envelope.nodes }),
  });
}

export function decodeSubassembly(input) {
  return wireResult(() => decode(input));
}

export function decodeSubassemblyOrThrow(input) {
  const result = decodeSubassembly(input);
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
    details: first.details,
  });
}

function normalizeSubassembly(input) {
  return structuredClone(decodeSubassemblyOrThrow(input).wire);
}

export function createSubassemblyTemplate(
  assembly,
  selectedIds,
  {
    name = "Reusable assembly",
    accent = "#70e0c4",
    origin = null,
    extensions = undefined,
    exposedPorts = null,
  } = {},
) {
  const title = String(name || "Reusable assembly")
    .trim()
    .slice(0, 80)
    .trim();
  const model = AssemblyModel.fromRuntime(
    assembly?.parts || [],
    assembly?.connections || [],
  );
  const canonical = createBlueprint(model, {
    name: title || "Reusable assembly",
    created: null,
  });
  const selected = new Set(selectedIds || []);
  const parts = canonical.parts.filter((part) => selected.has(part.id));
  const internalConnections = canonical.connections.filter(
    (connection) => selected.has(connection.a) && selected.has(connection.b),
  );
  if (!parts.length) throw new Error("Select at least one component to save");
  if (!connectedSelection(parts, internalConnections))
    throw new Error(
      "A reusable subassembly must be one connected selection. Connect the selected components or save them separately.",
    );

  const fallbackAnchor = parts
    .reduce(
      (sum, part) => sum.map((value, axis) => value + part.pos[axis]),
      [0, 0, 0],
    )
    .map((value) => value / parts.length);
  const anchor =
    Array.isArray(origin) && origin.length === 3
      ? origin.map(Number)
      : fallbackAnchor;
  if (!anchor.every(Number.isFinite))
    throw new Error("Reusable subassembly origin must be a finite position");
  const idMap = new Map(parts.map((part, index) => [part.id, index + 1]));
  const normalizedParts = parts.map((part, index) => ({
    ...structuredClone(part),
    id: index + 1,
    pos: part.pos.map((value, axis) => value - anchor[axis]),
    ...(part.type === "computer"
      ? {
          controllerBindings: remapControllerBindings(
            part.controllerBindings || [],
            idMap,
          ),
        }
      : {}),
  }));
  const normalizedConnections = internalConnections.map(
    (connection, index) => ({
      ...structuredClone(connection),
      id: `connection-${index + 1}`,
      a: idMap.get(connection.a),
      b: idMap.get(connection.b),
      ...(connection.releaseCouplerPartId == null
        ? {}
        : {
            releaseCouplerPartId: idMap.get(connection.releaseCouplerPartId),
          }),
    }),
  );
  const authoredExposed = exposedPorts
      ? exposedPorts.map((exposed) => ({
          ...structuredClone(exposed),
          partId: idMap.get(exposed.partId),
        }))
      : availableSubassemblyPorts(
          { parts: normalizedParts, connections: normalizedConnections },
          normalizedParts.map((part) => part.id),
        ),
    normalizedExposedPorts = authoredExposed.map((exposed, index) => ({
      id: `exposed-${index + 1}`,
      label: String(exposed.label).trim().slice(0, 80),
      role: exposed.role,
      partId: exposed.partId,
      port: exposed.port,
    }));
  return normalizeSubassembly({
    format: SUBASSEMBLY_FORMAT,
    version: SUBASSEMBLY_VERSION,
    name: title || "Reusable assembly",
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#70e0c4",
    parts: normalizedParts,
    connections: normalizedConnections,
    exposedPorts: normalizedExposedPorts,
    ...(extensions ? { extensions: structuredClone(extensions) } : {}),
  });
}

function assertIsoTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`${field} must be a canonical ISO timestamp`);
  return value;
}

function normalizeLocalOrigin(origin) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin))
    throw new Error("Subassembly origin must be an object");
  const keys = Object.keys(origin).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["kind", "sourceFingerprint"]))
    throw new Error("Subassembly origin has unknown or missing fields");
  if (!LOCAL_ORIGIN_KINDS.has(origin.kind))
    throw new Error("Unknown subassembly origin kind");
  const sourceFingerprint = origin.sourceFingerprint;
  if (
    sourceFingerprint !== null &&
    !FINGERPRINT_PATTERN.test(sourceFingerprint)
  )
    throw new Error("Subassembly source fingerprint is invalid");
  if (
    [
      BlueprintAcquisition.LOCAL_AUTHORING,
      BlueprintAcquisition.BUILT_IN,
    ].includes(origin.kind) &&
    sourceFingerprint !== null
  )
    throw new Error(
      "Locally authored and built-in assets have no source fingerprint",
    );
  if (
    [
      BlueprintAcquisition.FILE_IMPORT,
      BlueprintAcquisition.SHARE_IMPORT,
    ].includes(origin.kind) &&
    sourceFingerprint === null
  )
    throw new Error("Imported assets require their source fingerprint");
  return Object.freeze({ kind: origin.kind, sourceFingerprint });
}

function normalizeAcquisitionMap(asset, input) {
  const computerIds = asset.parts
      .filter((part) => part.type === "computer")
      .map((part) => String(part.id))
      .sort(),
    keys = Object.keys(input || {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(computerIds))
    throw new Error(
      "programAcquisitionByController keys must exactly match computer IDs",
    );
  return Object.freeze(
    Object.fromEntries(
      computerIds.map((id) => [id, assertBlueprintAcquisition(input[id])]),
    ),
  );
}

/**
 * @param {unknown} input
 * @param {{
 *   origin?:{kind:"LOCAL_AUTHORING"|"BUILT_IN"|"FILE_IMPORT"|"SHARE_IMPORT",sourceFingerprint:string|null},
 *   programAcquisitionByController?:Record<string,string>|null,
 *   createdAt?:string, updatedAt?:string,
 * }} [options]
 */
export function createLocalSubassemblyRecord(
  input,
  {
    origin = {
      kind: BlueprintAcquisition.LOCAL_AUTHORING,
      sourceFingerprint: null,
    },
    programAcquisitionByController = null,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
  } = {},
) {
  const asset = normalizeSubassembly(input),
    normalizedOrigin = normalizeLocalOrigin(origin),
    acquisition =
      programAcquisitionByController ||
      Object.fromEntries(
        asset.parts
          .filter((part) => part.type === "computer")
          .map((part) => [String(part.id), normalizedOrigin.kind]),
      );
  assertIsoTimestamp(createdAt, "createdAt");
  assertIsoTimestamp(updatedAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new Error("updatedAt cannot precede createdAt");
  return Object.freeze({
    format: LOCAL_SUBASSEMBLY_FORMAT,
    version: LOCAL_SUBASSEMBLY_VERSION,
    asset,
    programAcquisitionByController: normalizeAcquisitionMap(asset, acquisition),
    origin: normalizedOrigin,
    createdAt,
    updatedAt,
  });
}

export function decodeLocalSubassemblyLibrary(items = []) {
  const records = [];
  const diagnostics = [];
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    try {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Local subassembly record must be an object");
      const keys = Object.keys(item).sort();
      if (
        JSON.stringify(keys) !==
        JSON.stringify([
          "asset",
          "createdAt",
          "format",
          "origin",
          "programAcquisitionByController",
          "updatedAt",
          "version",
        ])
      )
        throw new Error(
          "Local subassembly record has unknown or missing fields",
        );
      if (
        item.format !== LOCAL_SUBASSEMBLY_FORMAT ||
        item.version !== LOCAL_SUBASSEMBLY_VERSION
      )
        throw new Error("Unsupported local subassembly record version");
      const record = createLocalSubassemblyRecord(item.asset, {
        origin: item.origin,
        programAcquisitionByController: item.programAcquisitionByController,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
      records.push(record);
    } catch (error) {
      diagnostics.push(
        Object.freeze({
          index,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function instantiateSubassembly(
  template,
  { position = [0, 0, 0], nextId = 1 } = {},
) {
  const normalized = normalizeSubassembly(template);
  const target = position.map(Number);
  if (target.length !== 3 || !target.every(Number.isFinite))
    throw new Error("Subassembly placement requires a finite position");
  const idMap = new Map();
  for (const part of normalized.parts) idMap.set(part.id, nextId++);
  const parts = normalized.parts.map((part) => {
    const id = idMap.get(part.id);
    return {
      ...structuredClone(part),
      id,
      pos: part.pos.map((value, axis) => value + target[axis]),
      ...(part.type === "computer"
        ? {
            controllerBindings: remapControllerBindings(
              part.controllerBindings || [],
              idMap,
            ),
          }
        : {}),
    };
  });
  const instanceKey = parts[0].id;
  const connections = normalized.connections.map((connection, index) => ({
    ...structuredClone(connection),
    id: `subassembly-${instanceKey}-${index + 1}`,
    a: idMap.get(connection.a),
    b: idMap.get(connection.b),
    ...(connection.releaseCouplerPartId == null
      ? {}
      : {
          releaseCouplerPartId: idMap.get(connection.releaseCouplerPartId),
        }),
  }));
  const exposedPorts = normalized.exposedPorts.map((exposed) => ({
    ...structuredClone(exposed),
    partId: idMap.get(exposed.partId),
  }));
  return {
    parts,
    connections,
    exposedPorts,
    idMap: Object.fromEntries(idMap),
    nextId,
  };
}
