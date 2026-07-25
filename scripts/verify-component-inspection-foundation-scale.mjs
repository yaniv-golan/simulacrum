import { assert } from "./lib/assert.mjs";
import { createComponentInspectionFeature } from "../src/application/component-inspection-feature.js";
import {
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "../src/model/authored-assembly-content.js";
import { ComponentRelationshipIndex } from "../src/model/component-relationships.js";
import { analyzeComponentPreflight } from "../src/model/component-preflight.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { fingerprintComponentInspectionAssembly } from "../src/model/component-inspection-fingerprint.js";
import { TYPES } from "../src/model/component-catalog.js";
import {
  createMaximumShippingInspectionFixture,
  createRawRelationshipStressFixture,
} from "./lib/component-inspection-fixtures.mjs";

const percentile = (values, ratio) =>
  [...values].sort((left, right) => left - right)[
    Math.ceil(values.length * ratio) - 1
  ];

const raw = createRawRelationshipStressFixture(),
  coldSamples = [];
let latestIndex;
for (let index = 0; index < 121; index++) {
  const started = performance.now();
  latestIndex = new ComponentRelationshipIndex(raw.snapshot);
  analyzeComponentPreflight(raw.snapshot, {
    selectedPartIds: [1],
    catalog: raw.catalog,
    relationshipIndex: latestIndex,
  });
  const elapsed = performance.now() - started;
  if (index >= 20) coldSamples.push(elapsed);
}
assert.equal(latestIndex.snapshot().parts.length, 300);
assert.equal(
  latestIndex
    .snapshot()
    .parts.reduce((sum, part) => sum + part.connections.length, 0),
  6_000,
);
assert.ok(
  percentile(coldSamples, 0.95) <= 16,
  `relationship rebuild p95 ${percentile(coldSamples, 0.95).toFixed(3)}ms exceeded 16ms`,
);

const shippingWire = createMaximumShippingInspectionFixture(),
  shipping = decodeBlueprintOrThrow(shippingWire).assembly,
  selected = new Set([1]);
assert.deepEqual(
  shipping.parts,
  shippingWire.parts.map(projectPortableAuthoredPart),
);
assert.deepEqual(
  shipping.connections,
  shippingWire.connections.map(projectPortableAuthoredConnection),
);
let primary = 1,
  revision = 1,
  snapshotCalls = 0;
const feature = createComponentInspectionFeature({
  assembly: {
    snapshot: () => {
      snapshotCalls++;
      return shipping;
    },
    revision: () => revision,
  },
  selection: {
    selectedPartIds: () => selected,
    primaryPartId: () => primary,
  },
  runtime: {
    running: () => false,
    evidenceRevision: () => 1,
    currentPart: () => null,
    powered: () => false,
    connectionValidity: () => true,
  },
  catalog: TYPES,
});
feature.read();
const selectionSamples = [];
for (let index = 0; index < 121; index++) {
  selected.clear();
  primary = (index % 200) + 1;
  selected.add(primary);
  const started = performance.now();
  const result = feature.read();
  const elapsed = performance.now() - started;
  if (index >= 20) selectionSamples.push(elapsed);
  assert.equal(result.selection.primaryPartId, primary);
}
assert.equal(snapshotCalls, 1, "selection changes rebuilt authored state");
revision = 2;
feature.read();
assert.equal(
  snapshotCalls,
  2,
  "authored revision did not invalidate the cache",
);
feature.read();
assert.equal(snapshotCalls, 2, "stable revision rebuilt authored state");
assert.ok(
  percentile(selectionSamples, 0.95) <= 4,
  `selection-only projection p95 ${percentile(selectionSamples, 0.95).toFixed(3)}ms exceeded 4ms`,
);
assert.match(
  await fingerprintComponentInspectionAssembly({ ...shipping, revision: 99 }),
  /^sim-sha256-[0-9a-f]{64}$/,
);

console.log(
  `component inspection foundation scale passed: rebuild p95 ${percentile(coldSamples, 0.95).toFixed(3)}ms, selection p95 ${percentile(selectionSamples, 0.95).toFixed(3)}ms`,
);
