import { assert } from "./lib/assert.mjs";
import { AssemblyModel } from "../src/model/assembly-model.js";
import {
  decodeAuthoredAssemblyContentOrThrow,
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "../src/model/authored-assembly-content.js";
import {
  componentInspectionAssemblyFingerprintBytes,
  fingerprintComponentInspectionAssembly,
} from "../src/model/component-inspection-fingerprint.js";
import { ComponentRelationshipIndex } from "../src/model/component-relationships.js";
import { analyzeComponentPreflight } from "../src/model/component-preflight.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { createAssemblyWorkspace } from "../src/application/assembly-workspace.js";
import * as Core from "../src/core/index.js";

for (const publicExport of [
  "decodeAuthoredAssemblyContentOrThrow",
  "projectPortableAuthoredPart",
  "projectPortableAuthoredConnection",
  "componentInspectionAssemblyFingerprintBytes",
  "fingerprintComponentInspectionAssembly",
  "ComponentRelationshipIndex",
  "analyzeComponentPreflight",
])
  assert.equal(
    typeof Core[publicExport],
    "function",
    `${publicExport} is missing from the reusable Core facade`,
  );
for (const privateExport of [
  "createComponentInspectionFeature",
  "createSelectedContextCommandCatalog",
  "projectCurrentComponentObservation",
])
  assert.equal(
    privateExport in Core,
    false,
    `${privateExport} crossed the application-private/Core boundary`,
  );

const fixture = () => ({
  revision: 9,
  parts: [
    {
      id: 1,
      type: "battery",
      pos: [0, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      config: componentDefaults("battery"),
      storedEnergyWh: 100,
      extensions: { "example.test": { nested: ["kept", 1] } },
    },
    {
      id: 2,
      type: "motor",
      pos: [1, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      config: componentDefaults("motor"),
      rigVisualRotation: [0.1, 0.2, 0.3],
    },
  ],
  connections: [
    {
      id: "a-power",
      a: 1,
      b: 2,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
      extensions: { "example.link": { label: "motor feed" } },
    },
  ],
});

const original = fixture(),
  decoded = decodeAuthoredAssemblyContentOrThrow(original);
assert.deepEqual(decoded.parts[0].extensions, original.parts[0].extensions);
assert.deepEqual(
  decoded.connections[0].extensions,
  original.connections[0].extensions,
);
assert.deepEqual(
  projectPortableAuthoredPart(original.parts[0]),
  decoded.parts[0],
);
assert.deepEqual(
  projectPortableAuthoredConnection(original.connections[0]),
  decoded.connections[0],
);

assert.throws(
  () =>
    decodeAuthoredAssemblyContentOrThrow({
      ...original,
      parts: [
        { ...original.parts[0], uiOnly: true },
        ...original.parts.slice(1),
      ],
    }),
  (error) => error.code === "UNSUPPORTED_AUTHORED_CONTENT_FIELD",
);
assert.throws(
  () => decodeAuthoredAssemblyContentOrThrow({ ...original, selected: 1 }),
  (error) => error.code === "UNSUPPORTED_AUTHORED_CONTENT_FIELD",
);
assert.throws(
  () =>
    decodeAuthoredAssemblyContentOrThrow({
      ...original,
      parts: original.parts.map((part) =>
        part.id === 1 ? { ...part, orientation: [0, 0, 0, -1] } : part,
      ),
    }),
  (error) => error.code === "NONCANONICAL_QUATERNION",
);
assert.throws(
  () =>
    decodeAuthoredAssemblyContentOrThrow({
      ...original,
      parts: original.parts.map((part) =>
        part.id === 1 ? { ...part, pos: [Number.NaN, 1, 0] } : part,
      ),
    }),
  (error) => error.code === "INVALID_FINITE_NUMBER",
);
assert.deepEqual(
  decodeAuthoredAssemblyContentOrThrow({
    ...original,
    parts: original.parts.map((part) => ({ ...part, customColor: null })),
  }),
  decoded,
  "null optional fields did not normalize to absence",
);

const fingerprint = await fingerprintComponentInspectionAssembly(original),
  permuted = {
    revision: 1_000,
    parts: [...original.parts].reverse(),
    connections: [...original.connections].reverse(),
  };
assert.match(fingerprint, /^sim-sha256-[0-9a-f]{64}$/);
assert.equal(
  await fingerprintComponentInspectionAssembly(permuted),
  fingerprint,
  "part/connection order or revision changed authored identity",
);
assert.notEqual(
  await fingerprintComponentInspectionAssembly({
    ...original,
    parts: original.parts.map((part) =>
      part.id === 2 ? { ...part, pos: [1.25, 1, 0] } : part,
    ),
  }),
  fingerprint,
  "authored content change did not change identity",
);
assert.deepEqual(
  componentInspectionAssemblyFingerprintBytes(original),
  componentInspectionAssemblyFingerprintBytes(permuted),
);

const relationships = new ComponentRelationshipIndex(original),
  battery = relationships.forPart(1);
assert.deepEqual(
  battery.connections.map((entry) => entry.connectionId),
  ["a-power"],
);
assert.equal(battery.connections[0].counterpartPartId, 2);
assert.deepEqual(relationships.cycleConnectionIds(), []);
const mutated = relationships.forPart(1);
assert.throws(() => {
  mutated.connections.length = 0;
}, TypeError);
assert.equal(relationships.forPart(1).connections.length, 1);

const cyclicRelationships = new ComponentRelationshipIndex({
  parts: [{ id: 1 }, { id: 2 }, { id: 3 }],
  connections: [
    { id: "a", a: 1, b: 2, kind: "signal", portA: "A", portB: "B" },
    { id: "b", a: 2, b: 3, kind: "signal", portA: "A", portB: "B" },
    { id: "c", a: 3, b: 1, kind: "signal", portA: "A", portB: "B" },
  ],
});
assert.deepEqual(cyclicRelationships.cycleConnectionIds(), ["c"]);

assert.equal(
  analyzeComponentPreflight(original, {
    selectedPartIds: [1],
    relationshipIndex: relationships,
  }).status,
  "passed",
);
assert.equal(
  analyzeComponentPreflight(original, { selectedPartIds: [] }).status,
  "not-checked",
);
assert.equal(
  analyzeComponentPreflight(original, { selectedPartIds: [999] }).status,
  "blocked",
);

const mesh = (part) => ({
    quaternion: {
      x: part.orientation[0],
      y: part.orientation[1],
      z: part.orientation[2],
      w: part.orientation[3],
    },
    scale: { ...part.scale },
    traverse() {},
  }),
  editorParts = original.parts.map((part) => ({
    ...structuredClone(part),
    mesh: mesh(part),
  })),
  model = new AssemblyModel(),
  workspace = createAssemblyWorkspace({
    model,
    catalog: {},
    editor: {
      parts: () => editorParts,
      connections: () =>
        original.connections.map((connection) => ({
          ...structuredClone(connection),
          stress: 12,
          failed: false,
        })),
    },
    simulation: { running: () => false, telemetry: () => ({}) },
    presentation: {
      normalPixelRatio: 1,
      pixelRatio: () => 1,
      setPixelRatio() {},
      setPerformanceMode() {},
      setEnvironmentVisible() {},
      syncBatch() {},
    },
    capabilities: { commandChannels: () => [] },
  });
workspace.sync();
assert.deepEqual(
  workspace.editorSnapshot()[0].extensions,
  original.parts[0].extensions,
);
assert.deepEqual(
  model.snapshot().connections[0].extensions,
  original.connections[0].extensions,
);
assert.equal(model.snapshot().connections[0].stress, undefined);
assert.equal(model.snapshot().connections[0].failed, undefined);

console.log(
  "component inspection authored, relationship, and preflight contracts passed",
);
