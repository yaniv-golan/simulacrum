import {
  canonicalQuaternion,
  canonicalId,
  DomainValidationError,
  immutableClone,
} from "./primitives.js";
import { resolveComponentConfig } from "./component-resolver.js";
import { TYPES } from "./component-catalog.js";
import { isPhysicalConnectionKind } from "./connection-contracts.js";
import { decodeMechanismAuthoredComponentOrThrow } from "./mechanism-authored-components.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";
import { materialStoreContract } from "./material-resource-contracts.js";
import { portDefinition, validatePortConnection } from "./ports.js";

function connectionIdentity(connection) {
  return [
    connection.kind,
    `${connection.a}:${connection.portA || "?"}`,
    `${connection.b}:${connection.portB || "?"}`,
  ].join(":");
}

function normalizePart(part, path = ["part"]) {
  if (!part || typeof part !== "object")
    throw new DomainValidationError("INVALID_PART", "Part must be an object", {
      path,
    });
  const id = canonicalId(part.id, { path: [...path, "id"] });
  if (typeof part.type !== "string" || !part.type)
    throw new DomainValidationError(
      "INVALID_PART_TYPE",
      "Part type must be a non-empty string",
      { path: [...path, "type"] },
    );
  if (Object.hasOwn(part, "rotation"))
    throw new DomainValidationError(
      "UNSUPPORTED_EULER_ROTATION",
      "Parts require a canonical quaternion orientation",
      { path: [...path, "rotation"] },
    );
  const normalized = structuredClone({
    ...part,
    id,
    orientation: canonicalQuaternion(part.orientation, {
      path: [...path, "orientation"],
    }),
  });
  if (isMechanismComponentType(part.type)) {
    if (Object.hasOwn(part, "config"))
      throw new DomainValidationError(
        "LEGACY_MECHANISM_CONFIG_FORBIDDEN",
        "Mechanism parts must author the strict mechanism contract; config is forbidden",
        { path: [...path, "config"] },
      );
    if (!Object.hasOwn(part, "mechanism"))
      throw new DomainValidationError(
        "MISSING_MECHANISM_CONTRACT",
        "Mechanism parts require an explicit strict mechanism contract",
        { path: [...path, "mechanism"] },
      );
    const decoded = decodeMechanismAuthoredComponentOrThrow(part.mechanism);
    if (decoded.wire.componentType !== part.type)
      throw new DomainValidationError(
        "MECHANISM_COMPONENT_TYPE_MISMATCH",
        "Part type must match mechanism.componentType",
        {
          path: [...path, "mechanism", "componentType"],
          details: {
            partType: part.type,
            mechanismComponentType: decoded.wire.componentType,
          },
        },
      );
    const scale = normalized.scale || { x: 1, y: 1, z: 1 };
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1)
      throw new DomainValidationError(
        "MECHANISM_SCALE_FORBIDDEN",
        "Fixed-authored-size mechanism parts require identity scale",
        { path: [...path, "scale"] },
      );
    normalized.mechanism = structuredClone(decoded.wire);
    delete normalized.config;
  } else {
    if (Object.hasOwn(part, "mechanism"))
      throw new DomainValidationError(
        "UNEXPECTED_MECHANISM_CONTRACT",
        "Only mechanism component types may define mechanism",
        { path: [...path, "mechanism"] },
      );
    normalized.config = resolveComponentConfig(part.type, part.config || {});
    materialStoreContract(normalized, TYPES);
  }
  return normalized;
}

function normalizeConnection(
  connection,
  index,
  partIds,
  { requirePorts = true } = {},
) {
  if (!connection || typeof connection !== "object")
    throw new DomainValidationError(
      "INVALID_CONNECTION",
      "Connection must be an object",
      { path: ["connections", index] },
    );
  const a = canonicalId(connection.a, {
      path: ["connections", index, "a"],
    }),
    b = canonicalId(connection.b, {
      path: ["connections", index, "b"],
    });
  if (a === b)
    throw new DomainValidationError(
      "SELF_CONNECTION",
      "A connection cannot join a part to itself",
      { path: ["connections", index] },
    );
  if (!partIds.has(a) || !partIds.has(b))
    throw new DomainValidationError(
      "DANGLING_CONNECTION",
      "Connection endpoints must reference existing parts",
      { path: ["connections", index], details: { a, b } },
    );
  if (typeof connection.kind !== "string" || !connection.kind)
    throw new DomainValidationError(
      "INVALID_CONNECTION_KIND",
      "Connection kind must be a non-empty string",
      { path: ["connections", index, "kind"] },
    );
  if (requirePorts && (!connection.portA || !connection.portB))
    throw new DomainValidationError(
      "MISSING_ENDPOINT_PORT",
      "New connections must identify both endpoint ports",
      { path: ["connections", index] },
    );
  const normalized = {
      ...structuredClone(connection),
      a,
      b,
    },
    id = canonicalId(connection.id ?? connectionIdentity(normalized), {
      path: ["connections", index, "id"],
    });
  return { ...normalized, id };
}

/**
 * @param {any} snapshot
 * @param {{requirePorts?: boolean}} [options]
 */
function buildState(snapshot = {}, options = {}) {
  if (!snapshot || typeof snapshot !== "object")
    throw new DomainValidationError(
      "INVALID_ASSEMBLY",
      "Assembly snapshot must be an object",
    );
  if (snapshot.parts != null && !Array.isArray(snapshot.parts))
    throw new DomainValidationError(
      "INVALID_PARTS_COLLECTION",
      "Assembly parts must be an array",
      { path: ["parts"] },
    );
  if (snapshot.connections != null && !Array.isArray(snapshot.connections))
    throw new DomainValidationError(
      "INVALID_CONNECTIONS_COLLECTION",
      "Assembly connections must be an array",
      { path: ["connections"] },
    );
  const parts = new Map();
  for (const [index, candidate] of (snapshot.parts || []).entries()) {
    const part = normalizePart(candidate, ["parts", index]);
    if (parts.has(part.id))
      throw new DomainValidationError(
        "DUPLICATE_PART_ID",
        `Duplicate part ID ${part.id}`,
        { path: ["parts", index, "id"], details: { id: part.id } },
      );
    parts.set(part.id, part);
  }
  const connections = new Map(),
    partIds = new Set(parts.keys());
  for (const [index, candidate] of (snapshot.connections || []).entries()) {
    const connection = normalizeConnection(candidate, index, partIds, options);
    if (connections.has(connection.id))
      throw new DomainValidationError(
        "DUPLICATE_CONNECTION_ID",
        `Duplicate connection ID ${connection.id}`,
        {
          path: ["connections", index, "id"],
          details: { id: connection.id },
        },
      );
    connections.set(connection.id, connection);
    const source = parts.get(connection.a),
      target = parts.get(connection.b);
    if (connection.releaseCouplerPartId != null) {
      const coupler = parts.get(connection.releaseCouplerPartId);
      if (isPhysicalConnectionKind(connection.kind))
        throw new DomainValidationError(
          "BREAKAWAY_PHYSICAL_CONNECTION_FORBIDDEN",
          "Only network umbilicals may declare a release coupler",
          { path: ["connections", index, "releaseCouplerPartId"] },
        );
      if (!coupler)
        throw new DomainValidationError(
          "UNKNOWN_RELEASE_COUPLER",
          "Breakaway umbilical must reference an existing release coupler",
          { path: ["connections", index, "releaseCouplerPartId"] },
        );
      if (
        coupler.mechanism?.config?.releaseLaw?.kind !==
        "electromechanical-latch-v1"
      )
        throw new DomainValidationError(
          "INVALID_RELEASE_COUPLER_REFERENCE",
          "Breakaway umbilical reference must identify an authored release coupler",
          { path: ["connections", index, "releaseCouplerPartId"] },
        );
    }
    validatePortConnection(
      source,
      connection.portA,
      target,
      connection.portB,
      [...connections.values()].slice(0, -1),
      TYPES,
      connection,
    );
    if (portDefinition(source, connection.portA).kind !== connection.kind)
      throw new DomainValidationError(
        "CONNECTION_KIND_MISMATCH",
        "Connection kind must match its endpoint port kind",
        { path: ["connections", index, "kind"] },
      );
    if (isPhysicalConnectionKind(connection.kind) && !connection.capacity)
      throw new DomainValidationError(
        "MISSING_CONNECTION_CAPACITY",
        "Physical connections require force and torque capacity",
        { path: ["connections", index, "capacity"] },
      );
    if (!isPhysicalConnectionKind(connection.kind) && connection.capacity)
      throw new DomainValidationError(
        "NETWORK_CAPACITY_FORBIDDEN",
        "Network connections cannot carry structural capacity",
        { path: ["connections", index, "capacity"] },
      );
  }
  return { parts, connections };
}

/**
 * Pure persistent representation of a construction. Runtime render and physics
 * objects live in presentation/simulation registries keyed by these IDs.
 */
export class AssemblyModel {
  #parts = new Map();
  #connections = new Map();
  #revision = 0;
  #graphRevision = -1;
  #adjacency = new Map();

  constructor(snapshot = {}) {
    const state = buildState(snapshot);
    this.#parts = state.parts;
    this.#connections = state.connections;
  }

  get revision() {
    return this.#revision;
  }

  static fromBlueprint(data) {
    return new AssemblyModel({
      parts: data?.parts || [],
      connections: data?.connections || [],
    });
  }

  static fromRuntime(parts, connections) {
    return new AssemblyModel({ parts, connections });
  }

  snapshot() {
    return immutableClone({
      parts: [...this.#parts.values()],
      connections: [...this.#connections.values()],
      revision: this.#revision,
    });
  }

  hasPart(id) {
    return this.#parts.has(id);
  }

  part(id) {
    const part = this.#parts.get(id);
    return part ? immutableClone(part) : null;
  }

  connection(id) {
    const connection = this.#connections.get(id);
    return connection ? immutableClone(connection) : null;
  }

  addPart(candidate) {
    const part = normalizePart(candidate, ["part"]);
    if (this.#parts.has(part.id))
      throw new DomainValidationError(
        "DUPLICATE_PART_ID",
        `Part ID ${part.id} already exists`,
        { path: ["part", "id"], details: { id: part.id } },
      );
    this.#parts.set(part.id, part);
    this.#invalidateGraph();
    return this.part(part.id);
  }

  updatePart(id, update) {
    if (!this.#parts.has(id))
      throw new DomainValidationError(
        "UNKNOWN_PART_ID",
        `Part ID ${id} does not exist`,
        { path: ["part", "id"], details: { id } },
      );
    const previous = this.#parts.get(id),
      patch =
        typeof update === "function"
          ? update(immutableClone(previous))
          : update;
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new DomainValidationError(
        "INVALID_PART_UPDATE",
        "Part update must produce an object patch",
        { path: ["part"] },
      );
    const next = normalizePart({ ...previous, ...structuredClone(patch), id }, [
      "part",
    ]);
    this.#parts.set(id, next);
    this.#invalidateGraph();
    return this.part(id);
  }

  removeParts(ids) {
    const removed = new Set(ids);
    let changed = false;
    for (const id of removed) changed = this.#parts.delete(id) || changed;
    for (const [id, connection] of this.#connections)
      if (removed.has(connection.a) || removed.has(connection.b)) {
        this.#connections.delete(id);
        changed = true;
      } else if (removed.has(connection.releaseCouplerPartId)) {
        const next = structuredClone(connection);
        delete next.releaseCouplerPartId;
        this.#connections.set(id, next);
        changed = true;
      }
    if (changed) this.#invalidateGraph();
    return changed;
  }

  addConnection(candidate) {
    const connection = normalizeConnection(
      candidate,
      this.#connections.size,
      new Set(this.#parts.keys()),
      { requirePorts: true },
    );
    if (this.#connections.has(connection.id))
      throw new DomainValidationError(
        "DUPLICATE_CONNECTION_ID",
        `Connection ID ${connection.id} already exists`,
        { path: ["connection", "id"], details: { id: connection.id } },
      );
    const source = this.#parts.get(connection.a),
      target = this.#parts.get(connection.b);
    validatePortConnection(
      source,
      connection.portA,
      target,
      connection.portB,
      [...this.#connections.values()],
      TYPES,
      connection,
    );
    if (portDefinition(source, connection.portA).kind !== connection.kind)
      throw new DomainValidationError(
        "CONNECTION_KIND_MISMATCH",
        "Connection kind must match its endpoint port kind",
        { path: ["connection", "kind"] },
      );
    this.#connections.set(connection.id, connection);
    this.#invalidateGraph();
    return this.connection(connection.id);
  }

  replace(snapshot) {
    if (!snapshot || typeof snapshot !== "object")
      throw new DomainValidationError(
        "INVALID_ASSEMBLY",
        "Assembly snapshot must be an object",
      );
    const next = buildState(snapshot);
    this.#parts = next.parts;
    this.#connections = next.connections;
    this.#invalidateGraph();
    return this.snapshot();
  }

  #invalidateGraph() {
    this.#revision++;
    this.#graphRevision = -1;
  }

  #currentAdjacency() {
    if (this.#graphRevision === this.#revision) return this.#adjacency;
    const adjacency = new Map([...this.#parts.keys()].map((id) => [id, []]));
    for (const connection of this.#connections.values()) {
      if (connection.failed) continue;
      adjacency.get(connection.a).push({ id: connection.b, connection });
      adjacency.get(connection.b).push({ id: connection.a, connection });
    }
    this.#adjacency = adjacency;
    this.#graphRevision = this.#revision;
    return adjacency;
  }

  adjacency() {
    return new Map(
      [...this.#currentAdjacency()].map(([id, edges]) => [
        id,
        immutableClone(edges),
      ]),
    );
  }

  connectedComponents(kind = null) {
    const adjacency = this.#currentAdjacency(),
      unseen = new Set(this.#parts.keys()),
      components = [];
    while (unseen.size) {
      const seed = unseen.values().next().value,
        queue = [seed],
        ids = [];
      unseen.delete(seed);
      while (queue.length) {
        const id = queue.shift();
        ids.push(id);
        for (const edge of adjacency.get(id) || []) {
          if (kind && edge.connection.kind !== kind) continue;
          if (!unseen.delete(edge.id)) continue;
          queue.push(edge.id);
        }
      }
      components.push(Object.freeze(ids));
    }
    return Object.freeze(components);
  }

  controllersFor(targetId) {
    return Object.freeze(
      (this.#currentAdjacency().get(targetId) || [])
        .filter((edge) => edge.connection.kind === "signal")
        .map((edge) => this.#parts.get(edge.id))
        .filter((part) => part?.type === "computer")
        .map((part) => immutableClone(part)),
    );
  }
}
