import { assert } from "./lib/assert.mjs";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { analyzeComponentPreflight } from "../src/model/component-preflight.js";
import { createComponentInspectionCarrierBlueprint } from "./lib/component-inspection-carrier-fixture.mjs";

const assembly = decodeBlueprintOrThrow(
    createComponentInspectionCarrierBlueprint(),
  ).assembly,
  controllerId = assembly.parts.find(({ type }) => type === "computer").id;
assert.deepEqual(analyzeComponentPreflight(assembly).status, "not-checked");
const passed = analyzeComponentPreflight(assembly, {
  selectedPartIds: [controllerId],
});
assert.equal(passed.status, "passed");
assert.deepEqual(passed.diagnostics, []);
assert.equal(
  passed.checks.find(({ id }) => id === "runtime-outcome").status,
  "not-checked",
  "authored preflight claimed a runtime result",
);

const invalid = structuredClone(assembly);
invalid.parts
  .find(({ id }) => id === controllerId)
  .controllerBindings.push({
    id: "invalid.endpoint",
    direction: "output",
    endpointPartId: 404,
    endpointPortId: "CONTROL",
    channel: "throttle",
  });
const blocked = analyzeComponentPreflight(invalid, {
  selectedPartIds: [controllerId],
});
assert.equal(blocked.status, "blocked");
assert.ok(
  blocked.diagnostics.some(
    ({ code, partId }) =>
      code === "MISSING_CONTROLLER_ENDPOINT" && partId === controllerId,
  ),
);
const unknown = analyzeComponentPreflight(assembly, {
  selectedPartIds: [404, 405],
});
assert.equal(unknown.status, "blocked");
assert.deepEqual(
  unknown.diagnostics.map(({ code, partId }) => ({ code, partId })),
  [
    { code: "UNKNOWN_SELECTED_COMPONENT", partId: 404 },
    { code: "UNKNOWN_SELECTED_COMPONENT", partId: 405 },
  ],
  "preflight diagnostics are not deterministically ordered",
);
assert.ok(Object.isFrozen(blocked));
assert.ok(Object.isFrozen(blocked.diagnostics));

console.log("component authored-only preflight passed");
