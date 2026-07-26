import {
  deepFreeze,
  DomainValidationError,
  immutableClone,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";

export const ROUTE_EVIDENCE_LIMITS = Object.freeze({
  maximumHops: 299,
  maximumAlternatives: 16,
  maximumCycles: 16,
  maximumBlockers: 16,
  maximumIndexBytes: 512 * 1024,
  maximumResponseBytes: 96 * 1024,
  maximumCompositeBytes: 192 * 1024,
  maximumArchiveBytes: 4 * 1024 * 1024,
});

const encoder = new TextEncoder(),
  compareCodeUnits = (left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  stableId = (value) => `${typeof value}:${String(value)}`,
  compareId = (left, right) =>
    typeof left === "number" && typeof right === "number"
      ? left - right
      : compareCodeUnits(stableId(left), stableId(right));

function fingerprint(domain, value) {
  return `sim-sha256-${sha256Hex(`${domain}\0${stableStringify(value)}`)}`;
}

export function routeEvidenceByteLength(value) {
  return encoder.encode(stableStringify(value)).byteLength;
}

function endpointOrder(left, right) {
  return (
    compareId(left.partId, right.partId) ||
    compareCodeUnits(String(left.portId), String(right.portId))
  );
}

function edgeOrder(left, right) {
  return (
    compareCodeUnits(String(left.connectionId), String(right.connectionId)) ||
    endpointOrder(left.from, right.from) ||
    endpointOrder(left.to, right.to)
  );
}

function canonicalEdge(edge) {
  if (
    !edge ||
    edge.connectionId == null ||
    edge.from?.partId == null ||
    !edge.from?.portId ||
    edge.to?.partId == null ||
    !edge.to?.portId
  )
    throw new DomainValidationError(
      "INVALID_ROUTE_EVIDENCE_EDGE",
      "Route evidence edges require a connection and exact endpoint ports",
    );
  return {
    connectionId: String(edge.connectionId),
    from: {
      partId: edge.from.partId,
      portId: String(edge.from.portId),
    },
    to: { partId: edge.to.partId, portId: String(edge.to.portId) },
  };
}

function topologyRecord(runGraph) {
  return {
    parts: runGraph
      .parts()
      .map((part) => ({ id: part.id, detached: Boolean(part.detached) }))
      .sort((left, right) => compareId(left.id, right.id)),
    connections: runGraph
      .connections()
      .map((connection) => ({
        id: connection.id,
        a: connection.a,
        b: connection.b,
        kind: connection.kind,
        portA: connection.portA ?? null,
        portB: connection.portB ?? null,
        failed: Boolean(connection.failed),
      }))
      .sort((left, right) => compareId(left.id, right.id)),
  };
}

export function fingerprintRuntimeTopology(runGraph) {
  return fingerprint(
    "simulacrum-runtime-topology-v1",
    topologyRecord(runGraph),
  );
}

function cycleConnectionIds(edges) {
  const parent = new Map(),
    find = (id) => {
      if (!parent.has(id)) parent.set(id, id);
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(id) !== id) {
        const next = parent.get(id);
        parent.set(id, root);
        id = next;
      }
      return root;
    },
    cycles = [];
  const unique = new Map();
  for (const edge of edges) {
    if (!unique.has(edge.connectionId)) unique.set(edge.connectionId, edge);
  }
  for (const edge of [...unique.values()].sort(edgeOrder)) {
    const left = find(stableId(edge.from.partId)),
      right = find(stableId(edge.to.partId));
    if (left === right) cycles.push(edge.connectionId);
    else parent.set(right, left);
  }
  return [...new Set(cycles)].sort(compareCodeUnits);
}

function canonicalPartIds(values = []) {
  return [...new Set(values)].sort(compareId);
}

function boundedIds(values, maximum) {
  const canonical = [...new Set(values.map(String))].sort(compareCodeUnits);
  return {
    values: canonical.slice(0, maximum),
    truncated: canonical.length > maximum,
  };
}

function chargedIndex(value) {
  let byteLength = 0,
    charged;
  do {
    charged = { ...value, byteLength };
    byteLength = routeEvidenceByteLength(charged);
  } while (charged.byteLength !== byteLength);
  return { ...value, byteLength };
}

/**
 * Creates one immutable owner-level path index. The caller owns edge validity;
 * this helper owns only deterministic traversal, identity, and bounds.
 * @param {{medium?:string,runGraph?:any,graphRevision?:number,edges?:any[],sourcePartIds?:any[],targetPartIds?:any[],terminalPartIds?:any[],blockingConnectionIds?:string[],blockerEvidence?:"known"|"unknown",resultFacts?:Record<string,any>}} [options]
 */
export function createRouteEvidenceIndex({
  medium,
  runGraph,
  graphRevision = runGraph?.graphRevision,
  edges = [],
  sourcePartIds = [],
  targetPartIds = [],
  terminalPartIds = [],
  blockingConnectionIds = [],
  blockerEvidence = "unknown",
  resultFacts = {},
} = {}) {
  if (
    !runGraph ||
    !["power", "signal", "resource"].includes(medium) ||
    !["known", "unknown"].includes(blockerEvidence)
  )
    throw new DomainValidationError(
      "INVALID_ROUTE_EVIDENCE_INDEX",
      "Route evidence indexes require a medium and authoritative run graph",
    );
  const canonicalEdges = edges.map(canonicalEdge).sort(edgeOrder),
    topologyFingerprint = fingerprintRuntimeTopology(runGraph),
    canonical = {
      version: 1,
      kind: "network-route-index-v1",
      medium,
      graphRevision,
      runtimeTopologyFingerprint: topologyFingerprint,
      edges: canonicalEdges,
      sourcePartIds: canonicalPartIds(sourcePartIds),
      targetPartIds: canonicalPartIds(targetPartIds),
      terminalPartIds: canonicalPartIds(terminalPartIds),
      cycleConnectionIds: cycleConnectionIds(canonicalEdges),
      blockingConnectionIds: [
        ...new Set(blockingConnectionIds.map(String)),
      ].sort(compareCodeUnits),
      blockerEvidence,
      resultFacts: structuredClone(resultFacts),
    },
    networkResultDigest = fingerprint(
      "simulacrum-network-result-v1",
      canonical,
    ),
    withDigest = {
      ...canonical,
      networkResultDigest,
      indexDigest: fingerprint("simulacrum-route-evidence-index-v1", canonical),
    },
    available = chargedIndex({ ...withDigest, status: "available" });
  if (available.byteLength > ROUTE_EVIDENCE_LIMITS.maximumIndexBytes)
    return deepFreeze({
      version: 1,
      kind: "network-route-index-v1",
      medium,
      status: "over-limit",
      graphRevision,
      runtimeTopologyFingerprint: topologyFingerprint,
      networkResultDigest,
      indexDigest: null,
      byteLength: available.byteLength,
    });
  return deepFreeze(available);
}

function queryMedium(kind) {
  if (kind === "power" || kind === "signal") return kind;
  if (kind === "resource-reachability" || kind === "resource-allocation")
    return "resource";
  return null;
}

function validEndpoint(endpoint, { allowNullPort = false } = {}) {
  return Boolean(
    endpoint &&
    Number.isSafeInteger(endpoint.partId) &&
    endpoint.partId >= 0 &&
    ((allowNullPort && endpoint.portId === null) ||
      (typeof endpoint.portId === "string" && endpoint.portId.length > 0)),
  );
}

export function validateRouteEvidenceQuery(input) {
  if (!input || input.version !== 1 || !queryMedium(input.kind))
    throw new DomainValidationError(
      "INVALID_ROUTE_EVIDENCE_QUERY",
      "Route evidence query must use the supported version and kind",
    );
  if (input.kind === "resource-allocation") {
    if (
      typeof input.allocationId !== "string" ||
      !input.allocationId ||
      !Number.isSafeInteger(input.storePartId) ||
      input.storePartId < 0 ||
      !Number.isSafeInteger(input.consumerPartId) ||
      input.consumerPartId < 0 ||
      typeof input.resourceKey !== "string" ||
      !input.resourceKey
    )
      throw new DomainValidationError(
        "INVALID_ROUTE_EVIDENCE_QUERY",
        "Resource allocation query requires allocation, store, consumer, and resource identity",
      );
    return immutableClone(input);
  }
  const allowNullPort = input.kind !== "resource-reachability";
  if (
    !validEndpoint(input.source, { allowNullPort }) ||
    !validEndpoint(input.target, { allowNullPort }) ||
    (input.kind === "resource-reachability" &&
      (typeof input.resourceKey !== "string" || !input.resourceKey))
  )
    throw new DomainValidationError(
      "INVALID_ROUTE_EVIDENCE_QUERY",
      "Route evidence query requires valid source and target endpoint selectors",
    );
  return immutableClone(input);
}

function endpointExists(index, endpoint) {
  return index.edges.some(
    (edge) =>
      (edge.from.partId === endpoint.partId &&
        (endpoint.portId === null || edge.from.portId === endpoint.portId)) ||
      (edge.to.partId === endpoint.partId &&
        (endpoint.portId === null || edge.to.portId === endpoint.portId)),
  );
}

function baseWitness(index, query, status) {
  const blockers = boundedIds(
    index.blockingConnectionIds || [],
    ROUTE_EVIDENCE_LIMITS.maximumBlockers,
  );
  return {
    version: 1,
    kind: "network-route-witness-v1",
    medium: index.medium,
    status,
    runtimeTopologyFingerprint: index.runtimeTopologyFingerprint,
    networkGraphRevision: index.graphRevision,
    networkResultDigest: index.networkResultDigest,
    indexDigest: index.indexDigest,
    source: query.source || null,
    target: query.target || null,
    resourceKey: query.resourceKey || null,
    allocation: null,
    controllerPortSelection: null,
    hops: [],
    alternativeWitnessCount: 0,
    cycleConnectionIds: [],
    blockingConnectionIds: blockers.values,
    blockerEvidence: index.blockerEvidence || "unknown",
    totalHopCount: null,
    truncated: {
      hops: false,
      alternatives: false,
      cycles: false,
      blockers: blockers.truncated,
    },
  };
}

function boundedCycles(index) {
  return {
    values: index.cycleConnectionIds.slice(
      0,
      ROUTE_EVIDENCE_LIMITS.maximumCycles,
    ),
    truncated:
      index.cycleConnectionIds.length > ROUTE_EVIDENCE_LIMITS.maximumCycles,
  };
}

function materialize(index, query) {
  const cycles = boundedCycles(index),
    base = baseWitness(index, query, "unreachable");
  base.cycleConnectionIds = cycles.values;
  base.truncated.cycles = cycles.truncated;
  if (
    !endpointExists(index, query.source) ||
    !endpointExists(index, query.target) ||
    (index.sourcePartIds.length &&
      !index.sourcePartIds.includes(query.source.partId)) ||
    (index.targetPartIds.length &&
      !index.targetPartIds.includes(query.target.partId))
  )
    return { ...base, status: "invalid" };

  const outgoing = new Map();
  for (const edge of index.edges) {
    if (!outgoing.has(edge.from.partId)) outgoing.set(edge.from.partId, []);
    outgoing.get(edge.from.partId).push(edge);
  }
  const queue = [{ partId: query.source.partId, depth: 0 }],
    visitedDepth = new Map([[query.source.partId, 0]]),
    predecessor = new Map(),
    shortestPathCounts = new Map([[query.source.partId, 1]]),
    terminalPartIds = new Set(index.terminalPartIds),
    targetCandidates = [];
  let cursor = 0,
    targetDepth = null;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (targetDepth !== null && current.depth >= targetDepth) continue;
    if (
      current.depth > 0 &&
      terminalPartIds.has(current.partId) &&
      current.partId !== query.target.partId
    )
      continue;
    for (const edge of outgoing.get(current.partId) || []) {
      if (
        current.depth === 0 &&
        query.source.portId !== null &&
        edge.from.portId !== query.source.portId
      )
        continue;
      const nextDepth = current.depth + 1,
        reachesTarget =
          edge.to.partId === query.target.partId &&
          (query.target.portId === null ||
            edge.to.portId === query.target.portId);
      if (reachesTarget) {
        targetDepth ??= nextDepth;
        if (nextDepth === targetDepth)
          targetCandidates.push({ previousPartId: current.partId, edge });
      }
      const knownDepth = visitedDepth.get(edge.to.partId);
      if (knownDepth == null || nextDepth < knownDepth) {
        visitedDepth.set(edge.to.partId, nextDepth);
        shortestPathCounts.set(
          edge.to.partId,
          shortestPathCounts.get(current.partId) || 1,
        );
        predecessor.set(edge.to.partId, {
          previousPartId: current.partId,
          edge,
        });
        queue.push({ partId: edge.to.partId, depth: nextDepth });
      } else if (nextDepth === knownDepth)
        shortestPathCounts.set(
          edge.to.partId,
          Math.min(
            ROUTE_EVIDENCE_LIMITS.maximumAlternatives + 2,
            (shortestPathCounts.get(edge.to.partId) || 0) +
              (shortestPathCounts.get(current.partId) || 1),
          ),
        );
    }
  }
  if (targetDepth === null) return base;
  targetCandidates.sort((left, right) => edgeOrder(left.edge, right.edge));
  const chosen = targetCandidates[0],
    hops = [chosen.edge];
  let partId = chosen.previousPartId;
  while (partId !== query.source.partId) {
    const record = predecessor.get(partId);
    if (!record) return base;
    hops.push(record.edge);
    partId = record.previousPartId;
  }
  hops.reverse();
  if (hops.length > ROUTE_EVIDENCE_LIMITS.maximumHops)
    return {
      ...base,
      status: "over-limit",
      totalHopCount: hops.length,
      truncated: { ...base.truncated, hops: true },
    };
  const shortestPathCount = targetCandidates.reduce(
      (sum, candidate) =>
        Math.min(
          ROUTE_EVIDENCE_LIMITS.maximumAlternatives + 2,
          sum + (shortestPathCounts.get(candidate.previousPartId) || 1),
        ),
      0,
    ),
    alternatives = Math.max(0, shortestPathCount - 1),
    controllerPortSelection =
      index.medium === "signal" &&
      ((query.source.portId === null &&
        terminalPartIds.has(query.source.partId)) ||
        (query.target.portId === null &&
          terminalPartIds.has(query.target.partId)))
        ? "network-derived-minimum-hop"
        : null,
    response = {
      ...base,
      status: "resolved",
      source: hops[0]?.from || query.source,
      target: hops.at(-1)?.to || query.target,
      controllerPortSelection,
      hops,
      totalHopCount: hops.length,
      alternativeWitnessCount: Math.min(
        alternatives,
        ROUTE_EVIDENCE_LIMITS.maximumAlternatives,
      ),
      truncated: {
        ...base.truncated,
        alternatives: alternatives > ROUTE_EVIDENCE_LIMITS.maximumAlternatives,
      },
    };
  if (
    routeEvidenceByteLength(response) >
    ROUTE_EVIDENCE_LIMITS.maximumResponseBytes
  )
    return {
      ...base,
      status: "over-limit",
      totalHopCount: hops.length,
      truncated: { ...base.truncated, hops: true },
    };
  return response;
}

function materializeAllocation(index, query) {
  const allocation = index.resultFacts?.allocations?.find(
      (entry) => entry.allocationId === query.allocationId,
    ),
    debit = allocation?.storeDebits?.find(
      (entry) => entry.storePartId === query.storePartId,
    ),
    source = index.edges.find(
      (edge) => edge.from.partId === query.storePartId,
    )?.from,
    target = index.edges.find(
      (edge) => edge.to.partId === query.consumerPartId,
    )?.to;
  if (
    !allocation ||
    !debit ||
    allocation.consumerPartId !== query.consumerPartId ||
    allocation.mediumId !== query.resourceKey ||
    !source ||
    !target
  )
    return baseWitness(index, query, "invalid");
  const witness = materialize(index, {
    version: 1,
    kind: "resource-reachability",
    source,
    target,
    resourceKey: query.resourceKey,
  });
  return {
    ...witness,
    resourceKey: query.resourceKey,
    allocation: {
      allocationId: query.allocationId,
      storePartId: query.storePartId,
      consumerPartId: query.consumerPartId,
      massKg: debit.massKg,
      unit: "kg",
    },
  };
}

export function routeWitnessFromIndex(
  index,
  input,
  expectedNetworkResultDigest,
) {
  const query = validateRouteEvidenceQuery(input);
  if (!index || index.status === "unsupported")
    return immutableClone({
      ...baseWitness(
        index || {
          medium: queryMedium(query.kind),
          runtimeTopologyFingerprint: null,
          graphRevision: null,
          networkResultDigest: null,
          indexDigest: null,
        },
        query,
        "unsupported",
      ),
    });
  if (index.status === "over-limit")
    return immutableClone({ ...baseWitness(index, query, "over-limit") });
  if (
    typeof expectedNetworkResultDigest !== "string" ||
    expectedNetworkResultDigest !== index.networkResultDigest
  )
    return immutableClone({ ...baseWitness(index, query, "stale") });
  if (queryMedium(query.kind) !== index.medium)
    return immutableClone({ ...baseWitness(index, query, "invalid") });
  return immutableClone(
    query.kind === "resource-allocation"
      ? materializeAllocation(index, query)
      : materialize(index, query),
  );
}
