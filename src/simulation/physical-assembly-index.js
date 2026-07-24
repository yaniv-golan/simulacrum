import {
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const compareId = (left, right) =>
  stableId(left).localeCompare(stableId(right), "en");
const sortedUnique = (values) => [...new Set(values)].sort(compareId);

function identity(prefix, value) {
  return `${prefix}:${sha256Hex(stableStringify(value)).slice(0, 24)}`;
}

function compiledTopology(compiledAssembly = {}) {
  const bodies = compiledAssembly.bodies || [],
    constraints = compiledAssembly.constraints || [],
    flexibleLines = compiledAssembly.flexibleLines || [],
    partIds = bodies.map((body) => body.partId),
    duplicatePartId = partIds.find(
      (partId, index) => partIds.indexOf(partId) !== index,
    );
  if (duplicatePartId != null)
    throw new DomainValidationError(
      "DUPLICATE_PHYSICAL_INDEX_PART",
      `Compiled physical index contains duplicate part ${String(duplicatePartId)}`,
    );
  if (flexibleLines.length) {
    const bodyIdByPart = new Map(bodies.map((body) => [body.partId, body.id])),
      entities = [
        ...bodies.map((body) => ({
          id: body.id,
          sourcePartId: body.partId,
          rigidPartId: body.partId,
        })),
        ...flexibleLines.flatMap((line) =>
          line.entities.map((entity) => ({
            id: entity.id,
            sourcePartId: line.sourcePartId,
            rigidPartId: null,
          })),
        ),
      ],
      entityIds = entities.map((entity) => entity.id),
      duplicateEntityId = entityIds.find(
        (id, index) => entityIds.indexOf(id) !== index,
      );
    if (duplicateEntityId != null)
      throw new DomainValidationError(
        "DUPLICATE_PHYSICAL_ENTITY_ID",
        `Compiled physical index contains duplicate entity ${String(duplicateEntityId)}`,
      );
    const entityIdSet = new Set(entityIds),
      rigidEdges = constraints
        .filter(
          (constraint) =>
            constraint.kind !== "measurement" &&
            bodyIdByPart.has(constraint.a) &&
            bodyIdByPart.has(constraint.b),
        )
        .map((constraint) => ({
          id: constraint.id,
          a: bodyIdByPart.get(constraint.a),
          b: bodyIdByPart.get(constraint.b),
          sourcePartId: constraint.sourcePartId ?? null,
          sourceConnectionIds: sortedUnique(
            constraint.sourceConnectionIds || [],
          ),
        })),
      flexibleEdges = flexibleLines.flatMap((line) => [
        ...line.internalEdges.map((edge) => ({
          id: edge.id,
          a: edge.entityAId,
          b: edge.entityBId,
          sourcePartId: line.sourcePartId,
          sourceConnectionIds: [],
          internal: true,
        })),
        ...(line.attachments || [])
          .filter((attachment) => attachment.kind === "point-attachment-v1")
          .map((attachment) => ({
            id: attachment.id,
            a:
              attachment.endpointIndex === 0
                ? line.entities[0].id
                : line.entities.at(-1).id,
            b: attachment.targetBodyId,
            sourcePartId: line.sourcePartId,
            sourceConnectionIds: [attachment.sourceConnectionId],
          })),
      ]),
      edges = [...rigidEdges, ...flexibleEdges]
        .filter((edge) => entityIdSet.has(edge.a) && entityIdSet.has(edge.b))
        .sort((left, right) => compareId(left.id, right.id));
    return {
      partIds: sortedUnique(entityIds),
      bodyIdByPart,
      edges,
      flexible: true,
      entityById: new Map(entities.map((entity) => [entity.id, entity])),
      identity: identity("compiled-physical", {
        entities: [...entities].sort((left, right) =>
          compareId(left.id, right.id),
        ),
        edges,
      }),
    };
  }
  const partIdSet = new Set(partIds),
    edges = constraints
      .filter(
        (constraint) =>
          constraint.kind !== "measurement" &&
          partIdSet.has(constraint.a) &&
          partIdSet.has(constraint.b),
      )
      .map((constraint) => ({
        id: constraint.id,
        a: constraint.a,
        b: constraint.b,
        sourcePartId: constraint.sourcePartId ?? null,
        sourceConnectionIds: sortedUnique(constraint.sourceConnectionIds || []),
      }))
      .sort((left, right) => compareId(left.id, right.id));
  return {
    partIds: sortedUnique(partIds),
    bodyIdByPart: new Map(bodies.map((body) => [body.partId, body.id])),
    edges,
    identity: identity("compiled-physical", {
      bodies: bodies
        .map((body) => ({ id: body.id, partId: body.partId }))
        .sort((left, right) => compareId(left.partId, right.partId)),
      edges,
    }),
  };
}

function connectedComponents(
  partIds,
  edges,
  activeConstraintIds,
  topology = null,
) {
  const adjacency = new Map(partIds.map((partId) => [partId, new Set()]));
  for (const edge of edges) {
    if (!activeConstraintIds.has(edge.id)) continue;
    adjacency.get(edge.a).add(edge.b);
    adjacency.get(edge.b).add(edge.a);
  }
  const components = [],
    unvisited = new Set(partIds);
  while (unvisited.size) {
    const seed = unvisited.values().next().value,
      pending = [seed],
      members = [];
    unvisited.delete(seed);
    while (pending.length) {
      const partId = pending.pop();
      members.push(partId);
      for (const neighbor of adjacency.get(partId) || []) {
        if (!unvisited.has(neighbor)) continue;
        unvisited.delete(neighbor);
        pending.push(neighbor);
      }
    }
    const memberSet = new Set(members),
      constraintIds = edges
        .filter(
          (edge) =>
            activeConstraintIds.has(edge.id) &&
            memberSet.has(edge.a) &&
            memberSet.has(edge.b),
        )
        .map((edge) => edge.id),
      componentEdges = edges.filter((edge) => constraintIds.includes(edge.id)),
      physicalEntityIds = sortedUnique(members),
      bodyPartIds = topology?.flexible
        ? sortedUnique(
            members
              .map((id) => topology.entityById.get(id)?.rigidPartId)
              .filter((id) => id != null),
          )
        : physicalEntityIds,
      partIdsWithSupports = sortedUnique([
        ...(topology?.flexible
          ? members.map((id) => topology.entityById.get(id)?.sourcePartId)
          : bodyPartIds),
        ...componentEdges
          .map((edge) => edge.sourcePartId)
          .filter((partId) => partId != null),
      ]);
    components.push({
      partIds: partIdsWithSupports,
      bodyPartIds,
      constraintIds: sortedUnique(constraintIds),
      ...(topology?.flexible ? { physicalEntityIds } : {}),
    });
  }
  return components.sort(
    (left, right) =>
      compareId(left.partIds[0], right.partIds[0]) ||
      compareId(left.physicalEntityIds?.[0], right.physicalEntityIds?.[0]),
  );
}

function sameComponent(left, right) {
  return (
    stableStringify(left.partIds) === stableStringify(right.partIds) &&
    stableStringify(left.physicalEntityIds || []) ===
      stableStringify(right.physicalEntityIds || []) &&
    stableStringify(left.constraintIds) === stableStringify(right.constraintIds)
  );
}

function initialRecord(component) {
  return {
    ...component,
    id: identity("physical", component),
    parentIds: [],
    splitFromIds: [],
    structuralEventIds: [],
  };
}

function advanceLineage(previous, components, eventId) {
  return components.map((component) => {
    const unchanged = previous.find((candidate) =>
      sameComponent(candidate, component),
    );
    if (unchanged) return unchanged;
    const memberSet = new Set(component.partIds),
      parents = previous.filter((candidate) =>
        candidate.partIds.some((partId) => memberSet.has(partId)),
      ),
      parentIds = sortedUnique(parents.map((candidate) => candidate.id)),
      structuralEventIds = sortedUnique([
        ...parents.flatMap((candidate) => candidate.structuralEventIds),
        eventId,
      ]),
      splitFromIds = sortedUnique(
        parents
          .filter(
            (candidate) =>
              (candidate.physicalEntityIds?.length ||
                candidate.partIds.length) >
              (component.physicalEntityIds?.length || component.partIds.length),
          )
          .map((candidate) => candidate.id),
      );
    return {
      ...component,
      id: identity("physical", {
        ...component,
        parentIds,
        structuralEventIds,
      }),
      parentIds,
      splitFromIds,
      structuralEventIds,
    };
  });
}

function deactivateForEvent(active, edges, event) {
  const failed = new Set(event.failedConnectionIds || []),
    failedInternal = new Set(event.failedInternalEdgeIds || []),
    detached = new Set(event.detachedPartIds || []);
  for (const edge of edges)
    if (
      failedInternal.has(edge.id) ||
      edge.sourceConnectionIds.some((id) => failed.has(id)) ||
      (edge.sourcePartId != null && detached.has(edge.sourcePartId))
    )
      active.delete(edge.id);
}

function currentConstraintIds(edges, constraintEntries = []) {
  const entryById = new Map(
    constraintEntries.map((entry) => [entry.descriptor?.id, entry]),
  );
  return new Set(
    edges
      .filter((edge) => entryById.get(edge.id)?.active !== false)
      .map((edge) => edge.id),
  );
}

/**
 * Canonical transient identity for every physical component in one run.
 * Identity depends only on compiled bodies/constraints and structural events;
 * it contains no vehicle, mission, demo, rendering, or controller semantics.
 */
export class PhysicalAssemblyIndex {
  #topology;
  #graphRevision = null;
  #topologyRevision = null;
  #snapshot = null;
  #componentByPart = new Map();

  constructor(compiledAssembly) {
    this.#topology = compiledTopology(compiledAssembly);
  }

  /**
   * @param {{
   *   runGraph?:{graphRevision:number,events:()=>Array<object>},
   *   constraintEntries?:Array<{descriptor?:{id:unknown},active?:boolean}>,
   *   topologyRevision?:number,
   * }} options
   */
  refresh({ runGraph, constraintEntries = [], topologyRevision = 0 } = {}) {
    if (!runGraph)
      throw new DomainValidationError(
        "PHYSICAL_INDEX_RUN_GRAPH_REQUIRED",
        "PhysicalAssemblyIndex requires the authoritative run graph",
      );
    const graphRevision = Number(runGraph.graphRevision),
      currentTopologyRevision = Number(topologyRevision);
    if (
      this.#snapshot &&
      graphRevision === this.#graphRevision &&
      currentTopologyRevision === this.#topologyRevision
    )
      return this.#snapshot;

    const currentActive = currentConstraintIds(
        this.#topology.edges,
        constraintEntries,
      ),
      activeKey = sortedUnique(currentActive);

    const replayActive = new Set(this.#topology.edges.map((edge) => edge.id));
    let records = connectedComponents(
      this.#topology.partIds,
      this.#topology.edges,
      replayActive,
      this.#topology,
    ).map(initialRecord);
    for (const event of runGraph.events()) {
      const before = stableStringify(sortedUnique(replayActive));
      deactivateForEvent(replayActive, this.#topology.edges, event);
      if (before === stableStringify(sortedUnique(replayActive))) continue;
      records = advanceLineage(
        records,
        connectedComponents(
          this.#topology.partIds,
          this.#topology.edges,
          replayActive,
          this.#topology,
        ),
        `structural:${Number(event.graphRevision)}`,
      );
    }
    if (
      stableStringify(sortedUnique(replayActive)) !== stableStringify(activeKey)
    )
      records = advanceLineage(
        records,
        connectedComponents(
          this.#topology.partIds,
          this.#topology.edges,
          currentActive,
          this.#topology,
        ),
        `topology:${Number(topologyRevision)}`,
      );

    const edgeById = new Map(
        this.#topology.edges.map((edge) => [edge.id, edge]),
      ),
      components = records.map((record) => {
        const edges = record.constraintIds.map((id) => edgeById.get(id));
        return deepFreeze({
          id: record.id,
          partIds: record.partIds,
          bodyPartIds: record.bodyPartIds,
          compiledBodyIds: this.#topology.flexible
            ? record.physicalEntityIds
            : record.bodyPartIds.map((partId) =>
                this.#topology.bodyIdByPart.get(partId),
              ),
          ...(this.#topology.flexible
            ? { physicalEntityIds: record.physicalEntityIds }
            : {}),
          // A component's stable first compiled body is its declared local
          // frame. Consumers never guess a frame from mass or component type.
          framePartId: record.bodyPartIds[0] ?? null,
          constraintIds: record.constraintIds,
          sourceConnectionIds: sortedUnique(
            edges.flatMap((edge) => edge.sourceConnectionIds),
          ),
          supportPartIds: record.partIds,
          lineage: {
            parentIds: record.parentIds,
            splitFromIds: record.splitFromIds,
            structuralEventIds: record.structuralEventIds,
          },
        });
      });
    const componentsByPart = new Map();
    for (const component of components)
      for (const partId of component.supportPartIds) {
        const records = componentsByPart.get(partId) || [];
        records.push(component);
        componentsByPart.set(partId, records);
      }
    this.#componentByPart = componentsByPart;
    this.#snapshot = deepFreeze({
      schemaVersion: 1,
      compiledIdentity: this.#topology.identity,
      graphRevision,
      topologyRevision: currentTopologyRevision,
      components,
    });
    this.#graphRevision = graphRevision;
    this.#topologyRevision = currentTopologyRevision;
    return this.#snapshot;
  }

  snapshot() {
    if (!this.#snapshot)
      throw new DomainValidationError(
        "PHYSICAL_INDEX_NOT_INITIALIZED",
        "PhysicalAssemblyIndex must refresh before it can publish a snapshot",
      );
    return this.#snapshot;
  }

  componentForPart(partId) {
    const components = this.#componentByPart.get(partId) || [];
    return components.length === 1 ? components[0] : null;
  }

  componentsForPart(partId) {
    return Object.freeze([...(this.#componentByPart.get(partId) || [])]);
  }
}
