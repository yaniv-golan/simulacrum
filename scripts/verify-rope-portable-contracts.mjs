import assert from "node:assert/strict";
import { AssemblyModel } from "../src/model/assembly-model.js";
import { decodeBlueprint } from "../src/model/blueprint-decoder.js";
import { createBlueprint } from "../src/model/blueprints.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import {
  createSharePackage,
  decodeSharePackage,
  fingerprintAsset,
} from "../src/model/share-packages.js";
import {
  createSubassemblyTemplate,
  decodeSubassembly,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";

const part = (id, type, pos) => ({
  id,
  type,
  pos,
  orientation: [0, 0, 0, 1],
  scale: { x: 1, y: 1, z: 1 },
  config: componentDefaults(type),
});
const connection = (id, endpoint, plateId, anchorB) => ({
  id,
  a: 3,
  b: plateId,
  kind: "mechanical",
  portA: endpoint,
  portB: "TOP",
  anchorB,
  capacity: { ultimateForceN: 20_000, ultimateTorqueNm: 4_000 },
});
const source = {
  format: "simulacrum-blueprint",
  version: 1,
  name: "Portable Rope rig",
  created: "2026-07-24T00:00:00.000Z",
  parts: [
    part(1, "plate", [-0.45, 2.91, 0.2]),
    part(2, "plate", [0.35, -1.09, -0.25]),
    part(3, "rope", [0, 1, 0]),
  ],
  connections: [
    connection("rope-a", "END_A", 1, [0.45, 0.09, -0.2]),
    connection("rope-b", "END_B", 2, [-0.35, 0.09, 0.25]),
  ],
  remoteProfiles: {},
  defaultRemoteProfile: null,
};

const model = AssemblyModel.fromBlueprint(source),
  blueprint = createBlueprint(model, {
    name: source.name,
    created: source.created,
  });
assert.deepEqual(
  blueprint,
  source,
  "strict Rope blueprint changed on round trip",
);

const originalFingerprint = await fingerprintAsset("blueprint", blueprint),
  retuned = structuredClone(blueprint);
retuned.parts.find((candidate) => candidate.type === "rope").config.diameterM +=
  0.005;
assert.notEqual(
  await fingerprintAsset("blueprint", retuned),
  originalFingerprint,
  "Rope physical intent was omitted from engineering identity",
);

const shared = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: { title: "Portable Rope rig", tags: ["rope", "rigging"] },
  }),
  decodedShare = await decodeSharePackage(JSON.stringify(shared));
assert.equal(decodedShare.ok, true);
assert.deepEqual(decodedShare.item.asset, blueprint);

const freeRope = createSubassemblyTemplate(model.snapshot(), [3], {
    name: "Cut Rope",
  }),
  oneEndedRope = createSubassemblyTemplate(model.snapshot(), [1, 3], {
    name: "Rope and anchor",
  });
assert.equal(decodeSubassembly(freeRope).ok, true);
assert.equal(decodeSubassembly(oneEndedRope).ok, true);
assert.equal(freeRope.connections.length, 0);
assert.equal(oneEndedRope.connections.length, 1);
assert.equal(oneEndedRope.connections[0].portA, "END_A");
assert.equal(oneEndedRope.connections[0].portB, "TOP");
const instantiated = instantiateSubassembly(oneEndedRope, {
  position: [10, 0, 0],
  nextId: 100,
});
assert.equal(instantiated.parts.length, 2);
assert.equal(instantiated.connections.length, 1);
assert.deepEqual(instantiated.connections[0].anchorB, [0.45, 0.09, -0.2]);

const unknownMaterial = structuredClone(blueprint);
unknownMaterial.parts.find(
  (candidate) => candidate.type === "rope",
).config.materialKey = "mystery-fiber";
assert.equal(decodeBlueprint(unknownMaterial).ok, false);

const unknownField = structuredClone(blueprint);
unknownField.parts.find((candidate) => candidate.type === "rope").config.coils =
  3;
assert.equal(decodeBlueprint(unknownField).ok, false);

console.log(
  "Rope blueprint, share, fingerprint, free-end, and one-end portability passed",
);
