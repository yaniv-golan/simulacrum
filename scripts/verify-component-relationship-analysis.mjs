import { assert } from "./lib/assert.mjs";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { ComponentRelationshipIndex } from "../src/model/component-relationships.js";
import { createComponentInspectionCarrierBlueprint } from "./lib/component-inspection-carrier-fixture.mjs";
import { createRawRelationshipStressFixture } from "./lib/component-inspection-fixtures.mjs";

const assembly = decodeBlueprintOrThrow(
    createComponentInspectionCarrierBlueprint(),
  ).assembly,
  index = new ComponentRelationshipIndex(assembly),
  motorId = assembly.parts.find(({ type }) => type === "motor").id,
  computerId = assembly.parts.find(({ type }) => type === "computer").id,
  motor = index.forPart(motorId),
  computer = index.forPart(computerId);

assert.ok(motor.connections.length > 0);
assert.deepEqual(
  motor.connections.map(({ connectionId }) => connectionId),
  [...motor.connections]
    .map(({ connectionId }) => connectionId)
    .sort((left, right) => left.localeCompare(right, "en")),
);
assert.ok(
  motor.controllerBindings.some(
    ({ bindingId, controllerPartId }) =>
      bindingId === "inspection.motor" && controllerPartId === computerId,
  ),
  "endpoint did not receive its direct controller-binding reference",
);
assert.equal(computer.controllerBindings.length, 2);
assert.equal(index.forPart(999), null);
assert.ok(Object.isFrozen(index.snapshot()));

const raw = createRawRelationshipStressFixture(),
  stress = new ComponentRelationshipIndex(raw.snapshot).snapshot();
assert.equal(stress.parts.length, 300);
assert.equal(
  stress.parts.reduce((sum, part) => sum + part.connections.length, 0),
  6_000,
);
assert.ok(stress.cycleConnectionIds.length > 0);
assert.throws(
  () =>
    new ComponentRelationshipIndex({
      parts: [{ id: 1 }],
      connections: [
        { id: "dangling", a: 1, b: 2, kind: "signal", portA: "A", portB: "B" },
      ],
    }),
  (error) => error.code === "DANGLING_COMPONENT_RELATIONSHIP",
);

console.log("component direct relationship analysis passed");
