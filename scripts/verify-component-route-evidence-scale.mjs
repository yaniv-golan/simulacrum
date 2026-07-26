import assert from "node:assert/strict";
import {
  ROUTE_EVIDENCE_LIMITS,
  createRouteEvidenceIndex,
  routeEvidenceByteLength,
  routeWitnessFromIndex,
} from "../src/simulation/route-evidence-index.js";

const edgeCount = 299,
  parts = Array.from({ length: edgeCount + 1 }, (_, id) => ({
    id,
    detached: false,
  })),
  connections = Array.from({ length: edgeCount }, (_, id) => ({
    id: `scale-${String(id).padStart(3, "0")}`,
    a: id,
    b: id + 1,
    kind: "power",
    portA: "OUT",
    portB: "IN",
    failed: false,
  })),
  runGraph = {
    graphRevision: 0,
    parts: () => parts,
    connections: () => connections,
  },
  index = createRouteEvidenceIndex({
    medium: "power",
    runGraph,
    edges: connections.map((connection) => ({
      connectionId: connection.id,
      from: { partId: connection.a, portId: "OUT" },
      to: { partId: connection.b, portId: "IN" },
    })),
    sourcePartIds: [0],
    targetPartIds: [edgeCount],
  }),
  query = {
    version: 1,
    kind: "power",
    source: { partId: 0, portId: "OUT" },
    target: { partId: edgeCount, portId: "IN" },
  };

for (let warmup = 0; warmup < 20; warmup++)
  routeWitnessFromIndex(index, query, index.networkResultDigest);
const samples = [];
for (let sample = 0; sample < 101; sample++) {
  const started = performance.now(),
    witness = routeWitnessFromIndex(index, query, index.networkResultDigest);
  samples.push(performance.now() - started);
  assert.equal(witness.totalHopCount, edgeCount);
  assert.ok(
    routeEvidenceByteLength(witness) <=
      ROUTE_EVIDENCE_LIMITS.maximumResponseBytes,
  );
}
assert.ok(
  routeEvidenceByteLength(index) <= ROUTE_EVIDENCE_LIMITS.maximumIndexBytes,
);
assert.equal(ROUTE_EVIDENCE_LIMITS.maximumCompositeBytes, 192 * 1024);
assert.equal(ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes, 4 * 1024 * 1024);
const p95 = [...samples].sort((left, right) => left - right)[95];
console.log(
  `component route scale passed (101 samples, ${p95.toFixed(3)} ms diagnostic p95, deterministic byte budgets)`,
);
