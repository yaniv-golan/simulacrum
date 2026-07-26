import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createComponentInspectionFeature } from "../src/application/component-inspection-feature.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { analyzeComponentPreflight } from "../src/model/component-preflight.js";
import { ComponentRelationshipIndex } from "../src/model/component-relationships.js";
import { captureWorkspaceIdentity } from "./lib/workspace-identity.mjs";
import {
  createMaximumShippingInspectionFixture,
  createRawRelationshipStressFixture,
  fixtureDigest,
} from "./lib/component-inspection-fixtures.mjs";
import {
  createRouteEvidenceIndex,
  routeEvidenceByteLength,
  routeWitnessFromIndex,
} from "../src/simulation/route-evidence-index.js";
import { sha256Hex } from "../src/model/sha256.js";
import { stableStringify } from "../src/model/primitives.js";

const root = path.resolve(import.meta.dirname, ".."),
  valueArgument = (name) =>
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3),
  profile = valueArgument("profile"),
  output = path.resolve(
    root,
    valueArgument("output") ||
      `artifacts/component-inspection-performance-${profile || "foundation"}-current.json`,
  ),
  allowDirty = process.argv.includes("--allow-dirty"),
  candidate = valueArgument("candidate") || null;

if (!["foundation", "routes"].includes(profile))
  throw new Error(
    "Component inspection capture requires --profile=foundation|routes",
  );
if (!allowDirty && !/^[0-9a-f]{40}$/.test(candidate || ""))
  throw new Error("Authoritative capture requires --candidate=<40-hex commit>");

const percentile = (values, ratio) =>
    [...values].sort((left, right) => left - right)[
      Math.ceil(values.length * ratio) - 1
    ],
  warmupRuns = 20,
  measuredRuns = 101,
  rawFixture = createRawRelationshipStressFixture(),
  shippingWire = createMaximumShippingInspectionFixture(),
  identity = await captureWorkspaceIdentity(root, ["node_modules"]),
  authoritative = !allowDirty && !identity.dirty && identity.head === candidate;

if (!allowDirty && identity.head !== candidate)
  throw new Error(
    `Candidate ${candidate} does not match HEAD ${identity.head}`,
  );
if (!allowDirty && identity.dirty)
  throw new Error("Authoritative capture requires a clean worktree");

const rebuildMs = [];
for (let index = 0; index < warmupRuns + measuredRuns; index++) {
  const started = performance.now(),
    relationships = new ComponentRelationshipIndex(rawFixture.snapshot);
  analyzeComponentPreflight(rawFixture.snapshot, {
    selectedPartIds: [1],
    catalog: rawFixture.catalog,
    relationshipIndex: relationships,
  });
  const elapsed = performance.now() - started;
  if (index >= warmupRuns) rebuildMs.push(elapsed);
}

const shipping = decodeBlueprintOrThrow(shippingWire).assembly,
  selected = new Set([1]);
let primary = 1;
const feature = createComponentInspectionFeature({
  assembly: { snapshot: () => shipping, revision: () => 1 },
  selection: {
    selectedPartIds: () => selected,
    primaryPartId: () => primary,
  },
  runtime: {
    running: () => false,
    evidenceRevision: () => 1,
    currentPart: () => null,
    currentConnection: () => null,
    powered: () => false,
    connectionValidity: () => null,
  },
  catalog: TYPES,
});
feature.read();
const selectionProjectionMs = [];
for (let index = 0; index < warmupRuns + measuredRuns; index++) {
  selected.clear();
  primary = (index % 200) + 1;
  selected.add(primary);
  const started = performance.now();
  feature.read();
  const elapsed = performance.now() - started;
  if (index >= warmupRuns) selectionProjectionMs.push(elapsed);
}

const routeFixture = (() => {
    const edgeCount = 299,
      parts = Array.from({ length: edgeCount + 1 }, (_, id) => ({
        id,
        detached: false,
      })),
      connections = Array.from({ length: edgeCount }, (_, id) => ({
        id: `route-${String(id).padStart(3, "0")}`,
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
      edges = connections.map((connection) => ({
        connectionId: connection.id,
        from: { partId: connection.a, portId: "OUT" },
        to: { partId: connection.b, portId: "IN" },
      })),
      index = createRouteEvidenceIndex({
        medium: "power",
        runGraph,
        edges,
        sourcePartIds: [0],
        targetPartIds: [edgeCount],
      }),
      query = {
        version: 1,
        kind: "power",
        source: { partId: 0, portId: "OUT" },
        target: { partId: edgeCount, portId: "IN" },
      };
    return { edgeCount, index, query };
  })(),
  routeMaterializationMs = [];
if (profile === "routes")
  for (let index = 0; index < warmupRuns + measuredRuns; index++) {
    const started = performance.now(),
      witness = routeWitnessFromIndex(
        routeFixture.index,
        routeFixture.query,
        routeFixture.index.networkResultDigest,
      ),
      elapsed = performance.now() - started;
    if (witness.status !== "resolved" || witness.totalHopCount !== 299)
      throw new Error("Routes performance fixture did not resolve 299 hops");
    if (index >= warmupRuns) routeMaterializationMs.push(elapsed);
  }

const result = {
  schemaVersion: 1,
  profile,
  release: "0.1.0",
  authoritative,
  capturedAt: new Date().toISOString(),
  source: identity,
  measurementHarness: identity,
  fixtures: {
    rawRelationship: {
      digest: fixtureDigest(rawFixture),
      parts: rawFixture.snapshot.parts.length,
      connections: rawFixture.snapshot.connections.length,
    },
    maximumShipping: {
      digest: fixtureDigest(shippingWire),
      parts: shipping.parts.length,
      connections: shipping.connections.length,
    },
    ...(profile === "routes"
      ? {
          routeChain: {
            digest: sha256Hex(
              stableStringify({
                edgeCount: routeFixture.edgeCount,
                indexDigest: routeFixture.index.indexDigest,
              }),
            ),
            hops: routeFixture.edgeCount,
          },
        }
      : {}),
  },
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    headless: true,
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    warmupRuns,
    measuredRuns,
  },
  raw: {
    rebuildMs,
    selectionProjectionMs,
    ...(profile === "routes" ? { routeMaterializationMs } : {}),
  },
  summary: {
    relationshipPreflightRebuildP95Ms: percentile(rebuildMs, 0.95),
    selectionProjectionP95Ms: percentile(selectionProjectionMs, 0.95),
    ...(profile === "routes"
      ? {
          routeMaterializationP95Ms: percentile(routeMaterializationMs, 0.95),
          routeIndexBytes: routeEvidenceByteLength(routeFixture.index),
          routeResponseBytes: routeEvidenceByteLength(
            routeWitnessFromIndex(
              routeFixture.index,
              routeFixture.query,
              routeFixture.index.networkResultDigest,
            ),
          ),
        }
      : {}),
  },
  errors: [],
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({ output, authoritative, summary: result.summary }, null, 2),
);
