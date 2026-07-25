import { DomainValidationError, immutableClone } from "./primitives.js";

export const COMPONENT_RELATIONSHIP_INDEX_VERSION = 1;
const compareCodeUnits = (left, right) =>
  left === right ? 0 : left < right ? -1 : 1;
const compareId = (left, right) =>
  compareCodeUnits(
    `${typeof left}:${String(left)}`,
    `${typeof right}:${String(right)}`,
  );

function connectionOrder(left, right) {
  return (
    compareId(left.connectionId, right.connectionId) ||
    compareId(left.counterpartPartId, right.counterpartPartId) ||
    compareCodeUnits(String(left.portId), String(right.portId))
  );
}

/** Immutable, bounded direct-authored relationship index. */
export class ComponentRelationshipIndex {
  #records = new Map();
  #cycleConnectionIds = [];

  constructor(snapshot = {}) {
    if (!Array.isArray(snapshot.parts) || !Array.isArray(snapshot.connections))
      throw new DomainValidationError(
        "INVALID_COMPONENT_RELATIONSHIP_INPUT",
        "Component relationships require parts and connections arrays",
      );
    const partIds = new Set(snapshot.parts.map((part) => part.id));
    for (const part of snapshot.parts)
      this.#records.set(part.id, {
        version: COMPONENT_RELATIONSHIP_INDEX_VERSION,
        partId: part.id,
        connections: [],
        controllerBindings: [],
      });
    const parent = new Map([...partIds].map((id) => [id, id]));
    const find = (id) => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(id) !== id) {
        const next = parent.get(id);
        parent.set(id, root);
        id = next;
      }
      return root;
    };
    for (const connection of [...snapshot.connections].sort((left, right) =>
      compareId(left.id, right.id),
    )) {
      if (!partIds.has(connection.a) || !partIds.has(connection.b))
        throw new DomainValidationError(
          "DANGLING_COMPONENT_RELATIONSHIP",
          "Relationship connection references an unknown part",
          { details: { connectionId: connection.id } },
        );
      const rootA = find(connection.a),
        rootB = find(connection.b);
      if (rootA === rootB) this.#cycleConnectionIds.push(connection.id);
      else parent.set(rootB, rootA);
      for (const [partId, counterpartPartId, portId, counterpartPortId] of [
        [connection.a, connection.b, connection.portA, connection.portB],
        [connection.b, connection.a, connection.portB, connection.portA],
      ])
        this.#records.get(partId).connections.push({
          connectionId: connection.id,
          kind: connection.kind,
          portId,
          counterpartPartId,
          counterpartPortId,
          status: "authored",
        });
    }
    for (const part of snapshot.parts)
      for (const binding of part.controllerBindings || []) {
        const reference = {
          controllerPartId: part.id,
          bindingId: binding.id,
          direction: binding.direction,
          endpointPartId: binding.endpointPartId,
          endpointPortId: binding.endpointPortId,
          ...(binding.reading ? { reading: binding.reading } : {}),
          ...(binding.channel ? { channel: binding.channel } : {}),
        };
        this.#records.get(part.id).controllerBindings.push(reference);
        if (this.#records.has(binding.endpointPartId))
          this.#records
            .get(binding.endpointPartId)
            .controllerBindings.push(reference);
      }
    for (const record of this.#records.values()) {
      record.connections.sort(connectionOrder);
      record.controllerBindings.sort(
        (left, right) =>
          compareId(left.controllerPartId, right.controllerPartId) ||
          compareCodeUnits(String(left.bindingId), String(right.bindingId)),
      );
    }
    this.#cycleConnectionIds.sort(compareId);
  }

  forPart(partId) {
    const record = this.#records.get(partId);
    return record ? immutableClone(record) : null;
  }

  cycleConnectionIds() {
    return immutableClone(this.#cycleConnectionIds);
  }

  snapshot() {
    return immutableClone({
      version: COMPONENT_RELATIONSHIP_INDEX_VERSION,
      parts: [...this.#records.values()].sort((left, right) =>
        compareId(left.partId, right.partId),
      ),
      cycleConnectionIds: this.#cycleConnectionIds,
    });
  }
}
