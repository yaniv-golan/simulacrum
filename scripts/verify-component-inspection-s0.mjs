import fs from "node:fs";
import { assert } from "./lib/assert.mjs";
import {
  COMPONENT_INSPECTION_S0_SCENARIOS,
  COMPONENT_INSPECTION_S0_TASKS,
  createMaximumShippingInspectionFixture,
  createRawRelationshipStressFixture,
  fixtureDigest,
} from "./lib/component-inspection-fixtures.mjs";

const baseline = JSON.parse(
    fs.readFileSync(
      new URL(
        "./baselines/component-inspection-s0-fixtures.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  raw = createRawRelationshipStressFixture(),
  shipping = createMaximumShippingInspectionFixture(),
  existingUi = JSON.parse(
    fs.readFileSync(
      new URL(
        "./baselines/component-inspection-s0-existing-ui.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

assert.equal(COMPONENT_INSPECTION_S0_SCENARIOS.length, 15);
assert.equal(COMPONENT_INSPECTION_S0_TASKS.length, 10);
assert.equal(existingUi.classification, "existing-ui-baseline");
assert.deepEqual(
  existingUi.tasks.map(({ id }) => id),
  COMPONENT_INSPECTION_S0_TASKS,
);
assert.deepEqual(
  existingUi.viewports.map(({ width, height }) => ({ width, height })),
  [
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  ],
);
assert.equal(raw.snapshot.parts.length, 300);
assert.equal(raw.snapshot.connections.length, 3_000);
assert.equal(shipping.parts.length, 300);
assert.equal(shipping.connections.length, 3_000);
assert.deepEqual(baseline, {
  version: 1,
  scenarioIds: COMPONENT_INSPECTION_S0_SCENARIOS,
  taskIds: COMPONENT_INSPECTION_S0_TASKS,
  rawRelationshipInputSha256: fixtureDigest(raw),
  maximumShippingInputSha256: fixtureDigest(shipping),
});

console.log("component inspection S0 fixture and acceptance inputs passed");
