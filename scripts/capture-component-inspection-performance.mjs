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

const root = path.resolve(import.meta.dirname, ".."),
  valueArgument = (name) =>
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3),
  profile = valueArgument("profile"),
  output = path.resolve(
    root,
    valueArgument("output") ||
      "artifacts/component-inspection-performance-foundation-current.json",
  ),
  allowDirty = process.argv.includes("--allow-dirty"),
  candidate = valueArgument("candidate") || null;

if (profile !== "foundation")
  throw new Error("S1 capture requires --profile=foundation");
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
  raw: { rebuildMs, selectionProjectionMs },
  summary: {
    relationshipPreflightRebuildP95Ms: percentile(rebuildMs, 0.95),
    selectionProjectionP95Ms: percentile(selectionProjectionMs, 0.95),
  },
  errors: [],
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({ output, authoritative, summary: result.summary }, null, 2),
);
