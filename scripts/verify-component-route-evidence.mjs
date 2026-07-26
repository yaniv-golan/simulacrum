import assert from "node:assert/strict";
import {
  ROUTE_EVIDENCE_LIMITS,
  createRouteEvidenceIndex,
  routeEvidenceByteLength,
  routeWitnessFromIndex,
} from "../src/simulation/route-evidence-index.js";
import { RouteEvidenceArchive } from "../src/simulation/route-evidence-archive.js";
import {
  stripRouteEvidenceCapabilities,
  unsupportedRouteEvidenceDescriptor,
} from "../src/simulation/telemetry.js";
import { composeConfiguredControlChainExplanation } from "../src/application/component-route-explanation.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

function graph(edgeCount, reverse = false) {
  const parts = Array.from({ length: edgeCount + 1 }, (_, id) => ({
      id,
      detached: false,
    })),
    connections = Array.from({ length: edgeCount }, (_, id) => ({
      id: `edge-${String(id).padStart(3, "0")}`,
      a: id,
      b: id + 1,
      kind: "power",
      portA: "OUT",
      portB: "IN",
      failed: false,
    }));
  return {
    graphRevision: 4,
    parts: () => (reverse ? [...parts].reverse() : parts),
    connections: () => (reverse ? [...connections].reverse() : connections),
  };
}

function edges(edgeCount, reverse = false) {
  const result = Array.from({ length: edgeCount }, (_, id) => ({
    connectionId: `edge-${String(id).padStart(3, "0")}`,
    from: { partId: id, portId: id === 0 ? "OUT" : "IN" },
    to: { partId: id + 1, portId: "IN" },
  }));
  return reverse ? result.reverse() : result;
}

const query = (target) => ({
    version: 1,
    kind: "power",
    source: { partId: 0, portId: "OUT" },
    target: { partId: target, portId: "IN" },
  }),
  index299 = createRouteEvidenceIndex({
    medium: "power",
    runGraph: graph(299),
    edges: edges(299),
    sourcePartIds: [0],
    targetPartIds: [299],
    resultFacts: { poweredPartIds: [0, 299] },
  }),
  permuted299 = createRouteEvidenceIndex({
    medium: "power",
    runGraph: graph(299, true),
    edges: edges(299, true),
    sourcePartIds: [0],
    targetPartIds: [299],
    resultFacts: { poweredPartIds: [0, 299] },
  });
assert.equal(index299.status, "available");
assert.equal(index299.indexDigest, permuted299.indexDigest);
assert.equal(index299.networkResultDigest, permuted299.networkResultDigest);
const witness299 = routeWitnessFromIndex(
  index299,
  query(299),
  index299.networkResultDigest,
);
assert.equal(witness299.status, "resolved");
assert.equal(witness299.totalHopCount, 299);
assert.equal(witness299.hops.length, 299);
assert.deepEqual(witness299.source, { partId: 0, portId: "OUT" });
assert.deepEqual(witness299.target, { partId: 299, portId: "IN" });
assert.equal(witness299.medium, "power");
assert.equal(witness299.alternativeWitnessCount, 0);
assert.equal(witness299.controllerPortSelection, null);
assert.deepEqual(witness299.cycleConnectionIds, []);
assert.deepEqual(witness299.blockingConnectionIds, []);
assert.deepEqual(witness299.truncated, {
  hops: false,
  alternatives: false,
  cycles: false,
  blockers: false,
});
assert.equal(
  routeWitnessFromIndex(index299, query(299), "sim-sha256-stale").status,
  "stale",
);

const index300 = createRouteEvidenceIndex({
    medium: "power",
    runGraph: graph(300),
    edges: edges(300),
    sourcePartIds: [0],
    targetPartIds: [300],
  }),
  witness300 = routeWitnessFromIndex(
    index300,
    query(300),
    index300.networkResultDigest,
  );
assert.equal(witness300.status, "over-limit");
assert.equal(witness300.totalHopCount, 300);
assert.deepEqual(witness300.hops, []);

const archive = new RouteEvidenceArchive(),
  identity = {
    phase: "live",
    runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
    runtimeTopologyFingerprint: index299.runtimeTopologyFingerprint,
    networkGraphRevision: index299.graphRevision,
    telemetryTick: 7,
    networkResultDigest: index299.networkResultDigest,
    finalRuntimeTopologyFingerprint: index299.runtimeTopologyFingerprint,
    finalGraphRevision: index299.graphRevision,
    consistency: "current",
    allocationTransactionId: null,
    allocationTick: null,
  },
  descriptor = archive.commit({
    telemetryTick: 7,
    slots: {
      power: { status: "available", identity, index: index299 },
      signal: { status: "unsupported" },
      resourceReachability: { status: "unsupported" },
      resourceAllocation: { status: "unsupported" },
    },
  });
assert.match(
  descriptor.token,
  /^route-evidence-v1:[0-9a-z]+:[0-9a-z]+:[0-9a-z]+$/,
);
assert.equal(
  archive.routeEvidence(descriptor.token, query(299), identity).status,
  "resolved",
);
const staleResponse = archive.routeEvidence(descriptor.token, query(299), {
  ...identity,
  telemetryTick: 8,
});
assert.equal(staleResponse.status, "stale");
assert.deepEqual(staleResponse.identity, identity);
assert.equal(staleResponse.evidenceToken, descriptor.token);
assert.deepEqual(staleResponse.hops, []);
assert.equal(
  archive.routeEvidence(
    descriptor.token,
    {
      version: 1,
      kind: "signal",
      source: { partId: 0, portId: "OUT" },
      target: { partId: 299, portId: "IN" },
    },
    identity,
  ).status,
  "unsupported",
);
assert.equal(
  archive.routeEvidence(descriptor.token, query(299), {
    ...identity,
    telemetryTick: 8,
  }).status,
  "stale",
);
assert.equal(
  archive.routeEvidence("route-evidence-v1:foreign:1:1", null, null).status,
  "unsupported",
);
assert.ok(archive.chargedBytes() <= 4 * 1024 * 1024);

const telemetry = {
  systems: { routeEvidence: descriptor },
};
assert.deepEqual(
  stripRouteEvidenceCapabilities(telemetry).systems.routeEvidence,
  unsupportedRouteEvidenceDescriptor(descriptor),
);
archive.invalidateForCheckpointImport();
assert.equal(
  archive.routeEvidence(descriptor.token, query(299), identity).status,
  "unsupported",
);
archive.dispose();

const oneHopGraph = graph(1),
  oneHopEdge = edges(1),
  oneHopIndexes = ["power", "signal", "resource"].map((medium) =>
    createRouteEvidenceIndex({
      medium,
      runGraph: oneHopGraph,
      edges: oneHopEdge,
      sourcePartIds: [0],
      targetPartIds: [1],
      terminalPartIds: medium === "signal" ? [0] : [],
      blockerEvidence: "known",
    }),
  );
for (const [offset, index] of oneHopIndexes.entries()) {
  const kind = ["power", "signal", "resource-reachability"][offset],
    witness = routeWitnessFromIndex(
      index,
      {
        version: 1,
        kind,
        source: { partId: 0, portId: kind === "signal" ? null : "OUT" },
        target: { partId: 1, portId: "IN" },
        ...(kind === "resource-reachability"
          ? { resourceKey: "test-medium" }
          : {}),
      },
      index.networkResultDigest,
    );
  assert.equal(witness.status, "resolved");
  assert.equal(witness.totalHopCount, 1);
  assert.equal(witness.blockerEvidence, "known");
  if (kind === "signal")
    assert.equal(
      witness.controllerPortSelection,
      "network-derived-minimum-hop",
    );
}

const disconnectedIndex = createRouteEvidenceIndex({
  medium: "power",
  runGraph: graph(3),
  edges: [edges(3)[0], edges(3)[2]],
  sourcePartIds: [0],
  targetPartIds: [3],
});
assert.equal(
  routeWitnessFromIndex(
    disconnectedIndex,
    query(3),
    disconnectedIndex.networkResultDigest,
  ).status,
  "unreachable",
);
assert.equal(
  routeWitnessFromIndex(
    disconnectedIndex,
    { ...query(3), target: { partId: 99, portId: "IN" } },
    disconnectedIndex.networkResultDigest,
  ).status,
  "invalid",
);

const alternativeEdges = Array.from({ length: 18 }, (_, index) => {
    const branch = index + 1;
    return [
      {
        connectionId: `a-${String(index).padStart(2, "0")}`,
        from: { partId: 0, portId: "OUT" },
        to: { partId: branch, portId: "IN" },
      },
      {
        connectionId: `b-${String(index).padStart(2, "0")}`,
        from: { partId: branch, portId: "OUT" },
        to: { partId: 19, portId: "IN" },
      },
    ];
  }).flat(),
  alternativeIndex = createRouteEvidenceIndex({
    medium: "signal",
    runGraph: graph(19),
    edges: [...alternativeEdges].reverse(),
    sourcePartIds: [0],
    targetPartIds: [19],
    terminalPartIds: [0],
  }),
  alternativeWitness = routeWitnessFromIndex(
    alternativeIndex,
    {
      version: 1,
      kind: "signal",
      source: { partId: 0, portId: null },
      target: { partId: 19, portId: "IN" },
    },
    alternativeIndex.networkResultDigest,
  );
assert.equal(alternativeWitness.status, "resolved");
assert.equal(alternativeWitness.alternativeWitnessCount, 16);
assert.equal(alternativeWitness.truncated.alternatives, true);
assert.deepEqual(
  alternativeWitness.hops.map((hop) => hop.connectionId),
  ["a-00", "b-00"],
);
const exactAlternativeIndex = createRouteEvidenceIndex({
    medium: "signal",
    runGraph: graph(19),
    edges: alternativeEdges.slice(0, 34),
    sourcePartIds: [0],
    targetPartIds: [19],
    terminalPartIds: [0],
  }),
  exactAlternativeWitness = routeWitnessFromIndex(
    exactAlternativeIndex,
    {
      version: 1,
      kind: "signal",
      source: { partId: 0, portId: null },
      target: { partId: 19, portId: "IN" },
    },
    exactAlternativeIndex.networkResultDigest,
  );
assert.equal(exactAlternativeWitness.alternativeWitnessCount, 16);
assert.equal(exactAlternativeWitness.truncated.alternatives, false);

const terminalIndex = createRouteEvidenceIndex({
  medium: "signal",
  runGraph: graph(2),
  edges: edges(2),
  sourcePartIds: [0, 1],
  targetPartIds: [2],
  terminalPartIds: [1],
});
assert.equal(
  routeWitnessFromIndex(
    terminalIndex,
    {
      version: 1,
      kind: "signal",
      source: { partId: 0, portId: "OUT" },
      target: { partId: 2, portId: "IN" },
    },
    terminalIndex.networkResultDigest,
  ).status,
  "unreachable",
);
const targetControllerIndex = createRouteEvidenceIndex({
    medium: "signal",
    runGraph: graph(1),
    edges: oneHopEdge,
    sourcePartIds: [0],
    targetPartIds: [1],
    terminalPartIds: [1],
  }),
  targetControllerWitness = routeWitnessFromIndex(
    targetControllerIndex,
    {
      version: 1,
      kind: "signal",
      source: { partId: 0, portId: "OUT" },
      target: { partId: 1, portId: null },
    },
    targetControllerIndex.networkResultDigest,
  );
assert.equal(
  targetControllerWitness.controllerPortSelection,
  "network-derived-minimum-hop",
);
assert.deepEqual(targetControllerWitness.target, { partId: 1, portId: "IN" });

const cycleEdges = [
    ...oneHopEdge,
    ...Array.from({ length: 18 }, (_, index) => ({
      connectionId: `cycle-${String(index).padStart(2, "0")}`,
      from: { partId: 1, portId: "RETURN" },
      to: { partId: 0, portId: "IN" },
    })),
  ],
  boundedIndex = createRouteEvidenceIndex({
    medium: "power",
    runGraph: graph(1),
    edges: cycleEdges,
    sourcePartIds: [0],
    targetPartIds: [1],
    blockingConnectionIds: Array.from(
      { length: 18 },
      (_, index) => `blocked-${String(index).padStart(2, "0")}`,
    ),
    blockerEvidence: "known",
  }),
  boundedWitness = routeWitnessFromIndex(
    boundedIndex,
    query(1),
    boundedIndex.networkResultDigest,
  );
assert.equal(boundedWitness.cycleConnectionIds.length, 16);
assert.equal(boundedWitness.blockingConnectionIds.length, 16);
assert.equal(boundedWitness.truncated.cycles, true);
assert.equal(boundedWitness.truncated.blockers, true);
assert.equal(boundedWitness.blockerEvidence, "known");
const exactBoundIndex = createRouteEvidenceIndex({
    medium: "power",
    runGraph: graph(1),
    edges: cycleEdges.slice(0, 17),
    sourcePartIds: [0],
    targetPartIds: [1],
    blockingConnectionIds: Array.from(
      { length: 16 },
      (_, index) => `blocked-${String(index).padStart(2, "0")}`,
    ),
  }),
  exactBoundWitness = routeWitnessFromIndex(
    exactBoundIndex,
    query(1),
    exactBoundIndex.networkResultDigest,
  );
assert.equal(exactBoundWitness.cycleConnectionIds.length, 16);
assert.equal(exactBoundWitness.blockingConnectionIds.length, 16);
assert.equal(exactBoundWitness.truncated.cycles, false);
assert.equal(exactBoundWitness.truncated.blockers, false);

const resultA = createRouteEvidenceIndex({
    medium: "power",
    runGraph: oneHopGraph,
    edges: oneHopEdge,
    resultFacts: { available: true },
  }),
  resultB = createRouteEvidenceIndex({
    medium: "power",
    runGraph: oneHopGraph,
    edges: oneHopEdge,
    resultFacts: { available: false },
  });
assert.equal(
  resultA.runtimeTopologyFingerprint,
  resultB.runtimeTopologyFingerprint,
);
assert.notEqual(resultA.networkResultDigest, resultB.networkResultDigest);
assert.deepEqual(
  createRouteEvidenceIndex({
    medium: "power",
    runGraph: oneHopGraph,
    edges: oneHopEdge,
    sourcePartIds: [10, 2, 1],
  }).sourcePartIds,
  [1, 2, 10],
);

for (const invalid of [
  null,
  {},
  { ...query(1), version: 2 },
  { ...query(1), source: { partId: -1, portId: "OUT" } },
  { ...query(1), target: { partId: 1.5, portId: "IN" } },
  {
    version: 1,
    kind: "resource-reachability",
    source: { partId: 0, portId: null },
    target: { partId: 1, portId: "IN" },
    resourceKey: "fuel",
  },
  {
    version: 1,
    kind: "resource-reachability",
    source: { partId: 0, portId: "OUT" },
    target: { partId: 1, portId: null },
    resourceKey: "fuel",
  },
])
  assert.throws(
    () => routeWitnessFromIndex(oneHopIndexes[0], invalid, "digest"),
    (error) => error?.code === "INVALID_ROUTE_EVIDENCE_QUERY",
  );
assert.throws(
  () => createRouteEvidenceIndex({ medium: "mesh", runGraph: oneHopGraph }),
  (error) => error?.code === "INVALID_ROUTE_EVIDENCE_INDEX",
);
for (const invalidEdge of [
  null,
  {},
  { connectionId: "edge", from: { partId: 0, portId: "OUT" } },
  {
    connectionId: "edge",
    from: { partId: 0, portId: "" },
    to: { partId: 1, portId: "IN" },
  },
  {
    connectionId: "edge",
    from: { partId: 0, portId: "OUT" },
    to: { partId: 1, portId: "" },
  },
])
  assert.throws(
    () =>
      createRouteEvidenceIndex({
        medium: "power",
        runGraph: oneHopGraph,
        edges: [invalidEdge],
      }),
    (error) => error?.code === "INVALID_ROUTE_EVIDENCE_EDGE",
  );

function indexAtPadding(length) {
  return createRouteEvidenceIndex({
    medium: "power",
    runGraph: oneHopGraph,
    edges: oneHopEdge,
    sourcePartIds: [0],
    targetPartIds: [1],
    resultFacts: { padding: "x".repeat(length) },
  });
}
let indexPadding =
  ROUTE_EVIDENCE_LIMITS.maximumIndexBytes - indexAtPadding(0).byteLength;
for (let attempt = 0; attempt < 8; attempt++) {
  const candidate = indexAtPadding(indexPadding);
  indexPadding +=
    ROUTE_EVIDENCE_LIMITS.maximumIndexBytes - candidate.byteLength;
}
const exactIndex = indexAtPadding(indexPadding),
  oversizedIndex = indexAtPadding(indexPadding + 1);
assert.equal(exactIndex.status, "available");
assert.equal(exactIndex.byteLength, ROUTE_EVIDENCE_LIMITS.maximumIndexBytes);
assert.equal(oversizedIndex.status, "over-limit");
assert.equal(
  oversizedIndex.byteLength,
  ROUTE_EVIDENCE_LIMITS.maximumIndexBytes + 1,
);

function responseAtPadding(length) {
  const connectionId = `edge-${"x".repeat(length)}`,
    index = createRouteEvidenceIndex({
      medium: "power",
      runGraph: {
        graphRevision: 1,
        parts: () => [{ id: 0 }, { id: 1 }],
        connections: () => [
          {
            id: connectionId,
            a: 0,
            b: 1,
            kind: "power",
            portA: "OUT",
            portB: "IN",
          },
        ],
      },
      edges: [
        {
          connectionId,
          from: { partId: 0, portId: "OUT" },
          to: { partId: 1, portId: "IN" },
        },
      ],
      sourcePartIds: [0],
      targetPartIds: [1],
    });
  return routeWitnessFromIndex(index, query(1), index.networkResultDigest);
}
let responsePadding =
  ROUTE_EVIDENCE_LIMITS.maximumResponseBytes -
  routeEvidenceByteLength(responseAtPadding(0));
for (let attempt = 0; attempt < 4; attempt++) {
  const candidate = responseAtPadding(responsePadding);
  responsePadding +=
    ROUTE_EVIDENCE_LIMITS.maximumResponseBytes -
    routeEvidenceByteLength(candidate);
}
const exactResponse = responseAtPadding(responsePadding),
  oversizedResponse = responseAtPadding(responsePadding + 1);
assert.equal(exactResponse.status, "resolved");
assert.equal(
  routeEvidenceByteLength(exactResponse),
  ROUTE_EVIDENCE_LIMITS.maximumResponseBytes,
);
assert.equal(oversizedResponse.status, "over-limit");
assert.deepEqual(oversizedResponse.hops, []);
assert.equal(oversizedResponse.truncated.hops, true);
assert.equal(oversizedResponse.totalHopCount, 1);

function compositeAtPadding(length) {
  return composeConfiguredControlChainExplanation({
    inputBinding: { id: "input", padding: "x".repeat(length) },
    outputBinding: { id: "output" },
    inputWitness: { ...witness299, identity: { phase: "authored" } },
    outputWitness: { ...witness299, identity: { phase: "authored" } },
  });
}
let compositePadding =
  ROUTE_EVIDENCE_LIMITS.maximumCompositeBytes -
  routeEvidenceByteLength(compositeAtPadding(0));
for (let attempt = 0; attempt < 4; attempt++) {
  const candidate = compositeAtPadding(compositePadding);
  compositePadding +=
    ROUTE_EVIDENCE_LIMITS.maximumCompositeBytes -
    routeEvidenceByteLength(candidate);
}
const exactComposite = compositeAtPadding(compositePadding),
  oversizedComposite = compositeAtPadding(compositePadding + 1);
assert.equal(exactComposite.status, "resolved");
assert.equal(
  routeEvidenceByteLength(exactComposite),
  ROUTE_EVIDENCE_LIMITS.maximumCompositeBytes,
);
assert.equal(oversizedComposite.status, "over-limit");
assert.equal(oversizedComposite.input.witness, null);

const sharedAuthoredIdentity = {
    phase: "authored",
    assemblyRevision: 8,
    assemblyFingerprint: `sim-sha256-${"2".repeat(64)}`,
    networkResultDigest: "signal-result",
  },
  partialComposite = composeConfiguredControlChainExplanation({
    inputBinding: { id: "pilot.drive", direction: "input" },
    outputBinding: { id: "motor.throttle", direction: "output" },
    inputWitness: {
      status: "resolved",
      identity: sharedAuthoredIdentity,
      hops: [{ connectionId: "sig-in" }],
    },
    outputWitness: {
      status: "unreachable",
      identity: sharedAuthoredIdentity,
      hops: [],
    },
  });
assert.equal(partialComposite.status, "partial");
assert.equal(partialComposite.input.availability, "available");
assert.equal(partialComposite.output.availability, "unreachable");
assert.equal(partialComposite.continuousOverlay, false);
assert.equal(
  partialComposite.controllerBoundary.programCausality,
  "not-evaluated",
);
assert.equal(
  composeConfiguredControlChainExplanation({
    inputBinding: { id: "pilot.drive", direction: "input" },
    outputBinding: { id: "motor.throttle", direction: "output" },
    inputWitness: {
      status: "resolved",
      identity: sharedAuthoredIdentity,
      hops: [{ connectionId: "sig-in" }],
    },
    outputWitness: {
      status: "resolved",
      identity: { ...sharedAuthoredIdentity, assemblyRevision: 9 },
      hops: [{ connectionId: "sig-out" }],
    },
  }).status,
  "stale",
);

const lifecycleArchive = new RouteEvidenceArchive(),
  firstDescriptor = lifecycleArchive.commit({
    telemetryTick: 1,
    slots: {
      power: { status: "available", identity, index: index299 },
    },
  }),
  firstCharge = lifecycleArchive.chargedBytes(),
  secondDescriptor = lifecycleArchive.commit({
    telemetryTick: 2,
    slots: {
      power: {
        status: "available",
        identity: { ...identity, telemetryTick: 2 },
        index: index299,
      },
    },
  });
assert.ok(lifecycleArchive.chargedBytes() < firstCharge * 2);
assert.equal(
  lifecycleArchive.routeEvidence(firstDescriptor.token, query(299), identity)
    .status,
  "resolved",
);
assert.equal(
  lifecycleArchive.routeEvidence(secondDescriptor.token, query(299), {
    ...identity,
    telemetryTick: 2,
  }).status,
  "resolved",
);
assert.throws(
  () =>
    lifecycleArchive.routeEvidence(secondDescriptor.token, null, {
      ...identity,
      telemetryTick: 2,
    }),
  (error) => error?.code === "INVALID_ROUTE_EVIDENCE_QUERY",
);
assert.throws(
  () => lifecycleArchive.routeEvidence(secondDescriptor.token, query(299), {}),
  (error) => error?.code === "INVALID_ROUTE_EVIDENCE_IDENTITY",
);
lifecycleArchive.invalidateForCheckpointImport();
assert.equal(
  lifecycleArchive.routeEvidence(secondDescriptor.token, query(299), {
    ...identity,
    telemetryTick: 2,
  }).status,
  "unsupported",
);
const postImportDescriptor = lifecycleArchive.commit({
  telemetryTick: 3,
  slots: {
    power: {
      status: "available",
      identity: { ...identity, telemetryTick: 3 },
      index: index299,
    },
  },
});
assert.notEqual(
  postImportDescriptor.token.split(":")[2],
  secondDescriptor.token.split(":")[2],
);
assert.equal(
  lifecycleArchive.routeEvidence(postImportDescriptor.token, query(299), {
    ...identity,
    telemetryTick: 3,
  }).status,
  "resolved",
);
lifecycleArchive.dispose();
assert.equal(lifecycleArchive.chargedBytes(), 0);
const closedDescriptor = lifecycleArchive.commit({
  telemetryTick: 4,
  slots: {
    power: {
      status: "available",
      identity: { ...identity, telemetryTick: 4 },
      index: index299,
    },
  },
});
assert.equal(closedDescriptor.token, null);
assert.equal(closedDescriptor.slots.power.status, "unsupported");
assert.deepEqual(closedDescriptor.slots.power.identity, {
  ...identity,
  telemetryTick: 4,
});
assert.equal(
  lifecycleArchive.routeEvidence(postImportDescriptor.token, query(299), {
    ...identity,
    telemetryTick: 3,
  }).status,
  "unsupported",
);

const paddedArchiveIndex = (paddingLength) =>
    Object.freeze({
      ...index299,
      networkResultDigest: `sim-sha256-${"a".repeat(64)}`,
      indexDigest: `sim-sha256-${"b".repeat(64)}`,
      resultFacts: { padding: "x".repeat(paddingLength) },
    }),
  archiveProbe = new RouteEvidenceArchive(),
  archiveProbeIndex = paddedArchiveIndex(0),
  archiveProbeDescriptor = archiveProbe.commit({
    telemetryTick: 1,
    slots: {
      power: { status: "available", identity, index: archiveProbeIndex },
    },
  }),
  archiveOverhead =
    archiveProbe.chargedBytes() - routeEvidenceByteLength(archiveProbeIndex);
assert.ok(archiveProbeDescriptor.token);
archiveProbe.dispose();
let archivePadding =
    ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes -
    archiveOverhead -
    routeEvidenceByteLength(archiveProbeIndex),
  exactArchive = null,
  exactArchiveDescriptor = null;
for (let attempt = 0; attempt < 5; attempt++) {
  exactArchive?.dispose();
  exactArchive = new RouteEvidenceArchive();
  exactArchiveDescriptor = exactArchive.commit({
    telemetryTick: 1,
    slots: {
      power: {
        status: "available",
        identity,
        index: paddedArchiveIndex(archivePadding),
      },
    },
  });
  const charge = exactArchive.chargedBytes();
  if (charge === ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes) break;
  assert.ok(charge > 0, "archive boundary estimate overshot the budget");
  archivePadding += ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes - charge;
}
assert.equal(
  exactArchive.chargedBytes(),
  ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes,
);
assert.ok(exactArchiveDescriptor.token);
exactArchive.dispose();
const oversizedArchive = new RouteEvidenceArchive(),
  oversizedArchiveDescriptor = oversizedArchive.commit({
    telemetryTick: 1,
    slots: {
      power: {
        status: "available",
        identity,
        index: paddedArchiveIndex(archivePadding + 1),
      },
    },
  });
assert.equal(oversizedArchiveDescriptor.token, null);
assert.equal(oversizedArchiveDescriptor.slots.power.status, "over-limit");
assert.equal(oversizedArchive.chargedBytes(), 0);
oversizedArchive.dispose();

const rollbackArchive = new RouteEvidenceArchive(),
  rollbackDescriptor = rollbackArchive.commit({
    telemetryTick: 1,
    slots: { power: { status: "available", identity, index: index299 } },
  }),
  rollbackCharge = rollbackArchive.chargedBytes(),
  rejectedDescriptor = rollbackArchive.commit({
    telemetryTick: 2,
    slots: {
      power: {
        status: "available",
        identity: { ...identity, telemetryTick: 2 },
        index: paddedArchiveIndex(archivePadding + 1),
      },
    },
  });
assert.equal(rejectedDescriptor.token, null);
assert.equal(rollbackArchive.chargedBytes(), rollbackCharge);
assert.equal(
  rollbackArchive.routeEvidence(rollbackDescriptor.token, query(299), identity)
    .status,
  "resolved",
);
rollbackArchive.dispose();

const laterArchive = new RouteEvidenceArchive(),
  laterDescriptor = laterArchive.commit({
    telemetryTick: 1,
    slots: { power: { status: "available", identity, index: index299 } },
  });
assert.notEqual(
  laterDescriptor.token.split(":")[1],
  descriptor.token.split(":")[1],
);
laterArchive.dispose();

for (const invalidTick of [undefined, -1, 0.5])
  assert.throws(
    () => new RouteEvidenceArchive().commit({ telemetryTick: invalidTick }),
    (error) => error?.code === "INVALID_ROUTE_EVIDENCE_COMMIT",
  );
const unavailableArchive = new RouteEvidenceArchive(),
  unavailableDescriptor = unavailableArchive.commit({
    telemetryTick: 0,
    slots: {
      power: { status: "unsupported", identity },
      signal: { status: "over-limit", identity },
      resourceReachability: {
        status: "superseded-in-frame",
        identity,
      },
      resourceAllocation: { status: "not-a-status", identity },
    },
  });
assert.equal(unavailableDescriptor.token, null);
assert.deepEqual(Object.keys(unavailableDescriptor.slots), [
  "power",
  "signal",
  "resourceReachability",
  "resourceAllocation",
]);
assert.equal(unavailableDescriptor.slots.power.status, "unsupported");
assert.equal(unavailableDescriptor.slots.signal.status, "over-limit");
assert.equal(
  unavailableDescriptor.slots.resourceReachability.status,
  "superseded-in-frame",
);
assert.equal(
  unavailableDescriptor.slots.resourceAllocation.status,
  "unsupported",
);
unavailableArchive.dispose();

const mixedSlotArchive = new RouteEvidenceArchive(),
  mixedSlotDescriptor = mixedSlotArchive.commit({
    telemetryTick: 4,
    slots: {
      power: { status: "available", identity, index: index299 },
      signal: { status: "unsupported", identity },
      resourceReachability: { status: "over-limit", identity },
    },
  });
const unavailableSignalResponse = mixedSlotArchive.routeEvidence(
  mixedSlotDescriptor.token,
  {
    version: 1,
    kind: "signal",
    source: { partId: 0, portId: "OUT" },
    target: { partId: 1, portId: "IN" },
  },
  identity,
);
assert.equal(unavailableSignalResponse.status, "unsupported");
assert.deepEqual(unavailableSignalResponse.source, {
  partId: 0,
  portId: "OUT",
});
assert.deepEqual(unavailableSignalResponse.target, {
  partId: 1,
  portId: "IN",
});
assert.equal(unavailableSignalResponse.resourceKey, null);
assert.equal(
  unavailableSignalResponse.evidenceToken,
  mixedSlotDescriptor.token,
);
assert.deepEqual(unavailableSignalResponse.identity, identity);
assert.deepEqual(unavailableSignalResponse.truncated, {
  hops: false,
  alternatives: false,
  cycles: false,
  blockers: false,
});
assert.equal(
  mixedSlotArchive.routeEvidence(
    mixedSlotDescriptor.token,
    {
      version: 1,
      kind: "resource-reachability",
      source: { partId: 0, portId: "OUT" },
      target: { partId: 1, portId: "IN" },
      resourceKey: "test-medium",
    },
    identity,
  ).status,
  "over-limit",
);
for (const invalidIdentity of [
  null,
  {},
  { ...identity, phase: "authored" },
  { ...identity, runConfigurationFingerprint: 1 },
  { ...identity, networkResultDigest: 1 },
  { ...identity, telemetryTick: -1 },
  { ...identity, telemetryTick: 1.5 },
])
  assert.throws(
    () =>
      mixedSlotArchive.routeEvidence(
        mixedSlotDescriptor.token,
        query(299),
        invalidIdentity,
      ),
    (error) => error?.code === "INVALID_ROUTE_EVIDENCE_IDENTITY",
  );
for (const foreignToken of [
  "",
  "route-evidence-v1:UPPER:1:1",
  `prefix-${mixedSlotDescriptor.token}`,
  `${mixedSlotDescriptor.token}-suffix`,
  "route-evidence-v1:0:0:0",
  `${mixedSlotDescriptor.token.split(":").slice(0, 3).join(":")}:zzzz`,
])
  assert.equal(
    mixedSlotArchive.routeEvidence(foreignToken, query(299), identity).status,
    "unsupported",
  );
mixedSlotArchive.dispose();

const missingIndexArchive = new RouteEvidenceArchive(),
  missingIndexDescriptor = missingIndexArchive.commit({
    telemetryTick: 0,
    slots: { power: { status: "available", identity } },
  });
assert.equal(missingIndexDescriptor.token, null);
assert.equal(missingIndexDescriptor.slots.power.status, "unsupported");
missingIndexArchive.dispose();

let multiDigitGenerationArchive;
for (let index = 0; index < 40; index++)
  multiDigitGenerationArchive = new RouteEvidenceArchive();
const multiDigitGenerationDescriptor = multiDigitGenerationArchive.commit({
  telemetryTick: 0,
  slots: { power: { status: "available", identity, index: index299 } },
});
assert.ok(multiDigitGenerationDescriptor.token.split(":")[1].length > 1);
assert.equal(
  multiDigitGenerationArchive.routeEvidence(
    multiDigitGenerationDescriptor.token,
    query(299),
    identity,
  ).status,
  "resolved",
);
multiDigitGenerationArchive.dispose();

const multiDigitEpochArchive = new RouteEvidenceArchive();
for (let index = 0; index < 40; index++)
  multiDigitEpochArchive.invalidateForCheckpointImport();
const multiDigitEpochDescriptor = multiDigitEpochArchive.commit({
  telemetryTick: 0,
  slots: { power: { status: "available", identity, index: index299 } },
});
assert.ok(multiDigitEpochDescriptor.token.split(":")[2].length > 1);
assert.equal(
  multiDigitEpochArchive.routeEvidence(
    multiDigitEpochDescriptor.token,
    query(299),
    identity,
  ).status,
  "resolved",
);
multiDigitEpochArchive.dispose();

const multiDigitSlotArchive = new RouteEvidenceArchive();
let multiDigitDescriptor;
for (let tick = 0; tick < 40; tick++)
  multiDigitDescriptor = multiDigitSlotArchive.commit({
    telemetryTick: tick,
    slots: {
      power: {
        status: "available",
        identity: { ...identity, telemetryTick: tick },
        index: index299,
      },
    },
  });
assert.ok(multiDigitDescriptor.token.split(":").at(-1).length > 1);
assert.equal(
  multiDigitSlotArchive.routeEvidence(multiDigitDescriptor.token, query(299), {
    ...identity,
    telemetryTick: 39,
  }).status,
  "resolved",
);
multiDigitSlotArchive.dispose();

const evictionIndex = (suffix) =>
    Object.freeze({
      ...index299,
      networkResultDigest: `sim-sha256-${suffix.repeat(64)}`,
      indexDigest: `sim-sha256-${suffix.repeat(64)}`,
      resultFacts: { padding: "x".repeat(1_500_000) },
    }),
  evictionArchive = new RouteEvidenceArchive(),
  evictionIndexes = [
    evictionIndex("1"),
    evictionIndex("2"),
    evictionIndex("3"),
  ],
  evictionIdentities = evictionIndexes.map((index, offset) => ({
    ...identity,
    telemetryTick: offset + 1,
    networkResultDigest: index.networkResultDigest,
  })),
  evictionDescriptors = evictionIndexes.slice(0, 2).map((index, offset) =>
    evictionArchive.commit({
      telemetryTick: offset + 1,
      slots: {
        power: {
          status: "available",
          identity: evictionIdentities[offset],
          index,
        },
      },
    }),
  );
assert.equal(
  evictionArchive.routeEvidence(
    evictionDescriptors[0].token,
    query(299),
    evictionIdentities[0],
  ).status,
  "resolved",
);
evictionDescriptors.push(
  evictionArchive.commit({
    telemetryTick: 3,
    slots: {
      power: {
        status: "available",
        identity: evictionIdentities[2],
        index: evictionIndexes[2],
      },
    },
  }),
);
assert.equal(
  evictionArchive.routeEvidence(
    evictionDescriptors[0].token,
    query(299),
    evictionIdentities[0],
  ).status,
  "unsupported",
  "lookup refreshed the historical eviction order",
);
assert.equal(
  evictionArchive.routeEvidence(
    evictionDescriptors[1].token,
    query(299),
    evictionIdentities[1],
  ).status,
  "resolved",
);
evictionArchive.dispose();

for (const invalidAllocationQuery of [
  {
    version: 1,
    kind: "resource-allocation",
    allocationId: "",
    storePartId: 0,
    consumerPartId: 1,
    resourceKey: "fuel",
  },
  {
    version: 1,
    kind: "resource-allocation",
    allocationId: "allocation",
    storePartId: -1,
    consumerPartId: 1,
    resourceKey: "fuel",
  },
  {
    version: 1,
    kind: "resource-allocation",
    allocationId: "allocation",
    storePartId: 0,
    consumerPartId: 1.5,
    resourceKey: "fuel",
  },
  {
    version: 1,
    kind: "resource-allocation",
    allocationId: "allocation",
    storePartId: 0,
    consumerPartId: 1,
    resourceKey: "",
  },
])
  assert.throws(
    () => routeWitnessFromIndex(oneHopIndexes[2], invalidAllocationQuery, "x"),
    (error) => error?.code === "INVALID_ROUTE_EVIDENCE_QUERY",
  );
const allocationIndex = createRouteEvidenceIndex({
    medium: "resource",
    runGraph: oneHopGraph,
    edges: oneHopEdge,
    sourcePartIds: [0],
    targetPartIds: [1],
    resultFacts: {
      transactionId: "material-allocation-v2:0:7:4",
      tick: 7,
      allocations: [
        {
          allocationId: "allocation-1",
          consumerPartId: 1,
          mediumId: "fuel",
          storeDebits: [{ storePartId: 0, massKg: 2 }],
        },
      ],
    },
  }),
  allocationEvidenceQuery = {
    version: 1,
    kind: "resource-allocation",
    allocationId: "allocation-1",
    storePartId: 0,
    consumerPartId: 1,
    resourceKey: "fuel",
  };
assert.equal(
  routeWitnessFromIndex(
    allocationIndex,
    allocationEvidenceQuery,
    allocationIndex.networkResultDigest,
  ).allocation.massKg,
  2,
);
const allocationWitness = routeWitnessFromIndex(
  allocationIndex,
  allocationEvidenceQuery,
  allocationIndex.networkResultDigest,
);
assert.deepEqual(allocationWitness.source, { partId: 0, portId: "OUT" });
assert.deepEqual(allocationWitness.target, { partId: 1, portId: "IN" });
assert.deepEqual(allocationWitness.allocation, {
  allocationId: "allocation-1",
  storePartId: 0,
  consumerPartId: 1,
  massKg: 2,
  unit: "kg",
});
for (const patch of [
  { allocationId: "missing" },
  { storePartId: 2 },
  { consumerPartId: 2 },
  { resourceKey: "oxidizer" },
])
  assert.equal(
    routeWitnessFromIndex(
      allocationIndex,
      { ...allocationEvidenceQuery, ...patch },
      allocationIndex.networkResultDigest,
    ).status,
    "invalid",
  );
assert.equal(
  routeWitnessFromIndex(null, query(1), "digest").status,
  "unsupported",
);
assert.deepEqual(routeWitnessFromIndex(null, query(1), "digest"), {
  version: 1,
  kind: "network-route-witness-v1",
  medium: "power",
  status: "unsupported",
  runtimeTopologyFingerprint: null,
  networkGraphRevision: null,
  networkResultDigest: null,
  indexDigest: null,
  source: { partId: 0, portId: "OUT" },
  target: { partId: 1, portId: "IN" },
  resourceKey: null,
  allocation: null,
  controllerPortSelection: null,
  hops: [],
  alternativeWitnessCount: 0,
  cycleConnectionIds: [],
  blockingConnectionIds: [],
  blockerEvidence: "unknown",
  totalHopCount: null,
  truncated: {
    hops: false,
    alternatives: false,
    cycles: false,
    blockers: false,
  },
});
assert.equal(
  routeWitnessFromIndex(
    { ...oneHopIndexes[0], status: "unsupported" },
    query(1),
    oneHopIndexes[0].networkResultDigest,
  ).status,
  "unsupported",
);
assert.equal(
  routeWitnessFromIndex(
    oneHopIndexes[0],
    { ...query(1), kind: "signal" },
    oneHopIndexes[0].networkResultDigest,
  ).status,
  "invalid",
);
assert.equal(
  routeWitnessFromIndex(oneHopIndexes[0], query(1), null).status,
  "stale",
);
assert.throws(
  () =>
    createRouteEvidenceIndex({
      medium: "power",
      runGraph: oneHopGraph,
      blockerEvidence: "maybe",
    }),
  (error) => error?.code === "INVALID_ROUTE_EVIDENCE_INDEX",
);

function telemetryContext({
  runIdentity = { runConfigurationFingerprint: `sim-sha256-${"c".repeat(64)}` },
  finalGraph = oneHopGraph,
  powerIndex = oneHopIndexes[0],
  signalIndex = oneHopIndexes[1],
  resourceIndex = oneHopIndexes[2],
  allocationIndex: allocation = null,
} = {}) {
  const runGraph = {
    ...finalGraph,
    revision: finalGraph.revision || 0,
    startSnapshot: () => ({
      parts: finalGraph.parts(),
      connections: finalGraph.connections(),
    }),
  };
  return {
    runGraph,
    time: 7 / 120,
    clock: { tick: 7 },
    services: {
      runIdentity,
      captureTelemetry: (context) => context.telemetry,
    },
    powerNetwork: {
      telemetry: () => ({ available: true }),
      evidenceIndex: () => powerIndex,
    },
    signalNetwork: {
      telemetry: () => ({ available: true }),
      evidenceIndex: () => signalIndex,
    },
    materialResourceNetwork: {
      evidenceIndex: () => resourceIndex,
      allocationEvidenceIndex: () => allocation,
    },
    commandBus: { entries: () => ({ accepted: [], rejected: [] }) },
    commandCapabilities: new Set(["drive", "lights"]),
    routeEvidenceArchive: new RouteEvidenceArchive(),
    telemetry: {},
  };
}
const telemetrySystem = new TelemetrySystem(),
  currentContext = telemetryContext({ allocationIndex });
telemetrySystem.step(currentContext);
assert.equal(
  currentContext.telemetry.systems.routeEvidence.token !== null,
  true,
);
assert.equal(
  currentContext.telemetry.systems.routeEvidence.slots.power.status,
  "available",
);
assert.equal(
  currentContext.telemetry.systems.routeEvidence.slots.resourceAllocation
    .identity.allocationTransactionId,
  "material-allocation-v2:0:7:4",
);
assert.equal(
  currentContext.telemetry.systems.routeEvidence.slots.resourceAllocation
    .identity.allocationTick,
  7,
);
assert.deepEqual(currentContext.telemetry.systems.commands.capabilities, [
  "drive",
  "lights",
]);
currentContext.routeEvidenceArchive.dispose();

const unsupportedContext = telemetryContext({ runIdentity: null });
telemetrySystem.step(unsupportedContext);
assert.equal(unsupportedContext.telemetry.systems.routeEvidence.token, null);
assert.equal(
  unsupportedContext.telemetry.systems.routeEvidence.slots.power.status,
  "unsupported",
);
unsupportedContext.routeEvidenceArchive.dispose();

const changedFinalGraph = graph(1);
changedFinalGraph.graphRevision = 5;
const supersededContext = telemetryContext({ finalGraph: changedFinalGraph });
telemetrySystem.step(supersededContext);
assert.equal(
  supersededContext.telemetry.systems.routeEvidence.slots.power.status,
  "superseded-in-frame",
);
assert.equal(supersededContext.telemetry.systems.routeEvidence.token, null);
supersededContext.routeEvidenceArchive.dispose();

const overLimitContext = telemetryContext({ powerIndex: oversizedIndex });
telemetrySystem.step(overLimitContext);
assert.equal(
  overLimitContext.telemetry.systems.routeEvidence.slots.power.status,
  "over-limit",
);
overLimitContext.routeEvidenceArchive.dispose();

console.log(
  "component route evidence passed (one/299/300-hop bounds, alternatives, cycles/blockers, exact byte limits, opaque archive lifecycle)",
);
