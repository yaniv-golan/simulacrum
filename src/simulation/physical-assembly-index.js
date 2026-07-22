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
    partIds = bodies.map((body) => body.partId),
    duplicatePartId = partIds.find(
      (partId, index) => partIds.indexOf(partId) !== index,
    );
  if (duplicatePartId != null)
    throw new DomainValidationError(
      "DUPLICATE_PHYSICAL_INDEX_PART",
      `Compiled physical index contains duplicate part ${String(duplicatePartId)}`,
    );
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

function connectedComponents(partIds, edges, activeConstraintIds) {
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
      bodyPartIds = sortedUnique(members),
      partIdsWithSupports = sortedUnique([
        ...bodyPartIds,
        ...componentEdges
          .map((edge) => edge.sourcePartId)
          .filter((partId) => partId != null),
      ]);
    components.push({
      partIds: partIdsWithSupports,
      bodyPartIds,
      constraintIds: sortedUnique(constraintIds),
    });
  }
  return components.sort((left, right) =>
    compareId(left.partIds[0], right.partIds[0]),
  );
}

function sameComponent(left, right) {
  return (
    stableStringify(left.partIds) === stableStringify(right.partIds) &&
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
            (candidate) => candidate.partIds.length > component.partIds.length,
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
    detached = new Set(event.detachedPartIds || []);
  for (const edge of edges)
    if (
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
          compiledBodyIds: record.bodyPartIds.map((partId) =>
            this.#topology.bodyIdByPart.get(partId),
          ),
          // A component's stable first compiled body is its declared local
          // frame. Consumers never guess a frame from mass or component type.
          framePartId: record.bodyPartIds[0],
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
    this.#componentByPart = new Map(
      components.flatMap((component) =>
        component.supportPartIds.map((partId) => [partId, component]),
      ),
    );
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
    return this.#componentByPart.get(partId) || null;
  }
}
