import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateBlueprintWire,
  validateSubassemblyWire,
  validateWorkspaceWire,
} from "../src/model/generated/portable-machine-wire-validators.js";
import {
  validateProofWire,
  validateSharePackageWire,
} from "../src/model/generated/share-wire-validators.js";
import { decodeBlueprint } from "../src/model/blueprint-decoder.js";
import { validateWireInput, wireResult } from "../src/model/wire-validation.js";
import { WIRE_LIMITS } from "../src/model/wire-limits.js";
import { TYPES } from "../src/model/component-catalog.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import {
  assertResolvedComponentConfig,
  componentConfigKeys,
  componentConfigSchema,
  componentPartUnionSchema,
} from "../src/model/component-wire-contract.js";
import { isMechanismComponentType } from "../src/model/mechanism-component-definitions.js";

const read = (name) =>
  JSON.parse(
    fs.readFileSync(
      `test/fixtures/strict-current-contract/${name}.spec.json`,
      "utf8",
    ),
  );
const fixtures = [
  ["blueprint", read("blueprint"), validateBlueprintWire],
  ["workspace", read("workspace"), validateWorkspaceWire],
  ["subassembly", read("subassembly"), validateSubassemblyWire],
  ["share-package", read("share-package"), validateSharePackageWire],
  ["proof", read("proof"), validateProofWire],
];

for (const [kind, fixture, validator] of fixtures) {
  assert.equal(
    validator(fixture),
    true,
    `${kind} specification fixture is invalid`,
  );
  const envelope = validateWireInput(fixture, kind, validator);
  assert(envelope.bytes > 0 && envelope.nodes > 0);
  assert.deepEqual(envelope.value, fixture);
}

const basePartSchema = {
  type: "object",
  required: ["id", "type", "config"],
  properties: {
    id: { type: "integer" },
    type: {},
    config: {},
    scriptLanguage: {},
    scriptSources: {},
    storedEnergyWh: {},
  },
  additionalProperties: false,
};
const partUnion = componentPartUnionSchema(basePartSchema);
assert.equal(partUnion.oneOf.length, Object.keys(TYPES).length);
for (const type of Object.keys(TYPES)) {
  const defaults = componentDefaults(type),
    keys = Object.keys(defaults).sort(),
    schema = componentConfigSchema(type),
    variant = partUnion.oneOf.find(
      (candidate) => candidate.properties.type.const === type,
    );
  assert.deepEqual(componentConfigKeys(type), keys);
  assert.deepEqual(schema.required, keys);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => [
        key,
        property.default,
      ]),
    ),
    defaults,
  );
  if (isMechanismComponentType(type)) {
    assert.equal(variant.required.includes("config"), false);
    assert.equal(variant.required.includes("mechanism"), true);
    assert.equal(Object.hasOwn(variant.properties, "config"), false);
    assert.equal(Object.hasOwn(variant.properties, "mechanism"), true);
  } else {
    assert.deepEqual(variant.properties.config, schema);
    assert.doesNotThrow(() => assertResolvedComponentConfig(type, defaults));
    if (keys.length)
      assert.throws(() => assertResolvedComponentConfig(type, {}), /exactly/);
  }
  assert.equal(variant.required.includes("scriptSources"), type === "computer");
  assert.equal(variant.required.includes("storedEnergyWh"), type === "battery");
}
assert.deepEqual(componentConfigKeys("missing"), []);
assert.deepEqual(componentConfigSchema("missing").required, []);

const extensible = read("blueprint");
extensible.extensions = { "com.example.machine": { enabled: true } };
extensible.parts[0].extensions = { "com.example.part": { note: "part" } };
extensible.connections[0].extensions = {
  "com.example.connection": { value: 2 },
};
extensible.remoteProfiles.operator.extensions = {
  "com.example.profile": { layout: 1 },
};
extensible.remoteProfiles.operator.controls.push({
  id: "switch",
  label: "Switch",
  channel: "switch",
  type: "toggle",
  targetId: null,
  defaultValue: 0,
  hotkey: null,
  extensions: { "com.example.control": { color: "green" } },
});
assert.equal(decodeBlueprint(extensible).ok, true);

function rejected(candidate, code) {
  const result = decodeBlueprint(candidate);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, code);
}

const badNamespace = structuredClone(extensible);
badNamespace.extensions = { invalid: {} };
rejected(badNamespace, "WIRE_SCHEMA_VIOLATION");

const tooDeep = structuredClone(extensible);
let cursor = {};
tooDeep.extensions = { "com.example.deep": cursor };
for (let index = 0; index < 10; index++) cursor = cursor.child = {};
rejected(tooDeep, "EXTENSION_DEPTH_LIMIT");

const tooMany = structuredClone(extensible);
tooMany.extensions = {
  "com.example.nodes": Array.from({ length: 257 }, (_, index) => index),
};
rejected(tooMany, "EXTENSION_NODE_LIMIT");

const tooLarge = structuredClone(extensible);
tooLarge.extensions = { "com.example.large": "x".repeat(17 * 1024) };
rejected(tooLarge, "EXTENSION_BYTE_LIMIT");

const nonFinite = structuredClone(extensible);
nonFinite.parts[0].pos[0] = Number.POSITIVE_INFINITY;
rejected(nonFinite, "INVALID_FINITE_NUMBER");

assert.throws(
  () => validateWireInput("{", "blueprint", validateBlueprintWire),
  (error) => error.code === "INVALID_WIRE_JSON",
);
assert.throws(
  () => validateWireInput([], "blueprint", validateBlueprintWire),
  (error) => error.code === "INVALID_WIRE_DOCUMENT",
);
assert.throws(
  () =>
    validateWireInput(
      { ...read("blueprint"), format: "other" },
      "blueprint",
      validateBlueprintWire,
    ),
  (error) => error.code === "UNSUPPORTED_WIRE_FORMAT",
);
const cyclic = read("blueprint");
cyclic.cycle = cyclic;
assert.throws(
  () => validateWireInput(cyclic, "blueprint", validateBlueprintWire),
  (error) => error.code === "CYCLIC_WIRE_VALUE",
);
const deep = read("blueprint");
let deepCursor = (deep.unrecognized = {});
for (let index = 0; index <= WIRE_LIMITS.maxDepth; index++)
  deepCursor = deepCursor.child = {};
assert.throws(
  () => validateWireInput(deep, "blueprint", validateBlueprintWire),
  (error) => error.code === "WIRE_DEPTH_LIMIT",
);
const manyNodes = read("blueprint");
manyNodes.unrecognized = Array.from(
  { length: WIRE_LIMITS.maxNodes + 1 },
  () => null,
);
assert.throws(
  () => validateWireInput(manyNodes, "blueprint", validateBlueprintWire),
  (error) => error.code === "WIRE_NODE_LIMIT",
);
const tooManyBytes = read("blueprint");
tooManyBytes.name = "x".repeat(WIRE_LIMITS.blueprintBytes + 1);
assert.throws(
  () => validateWireInput(tooManyBytes, "blueprint", validateBlueprintWire),
  (error) => error.code === "WIRE_BYTE_LIMIT",
);
const unstringifiable = read("blueprint");
unstringifiable.toJSON = () => {
  throw new Error("cannot serialize");
};
assert.throws(
  () => validateWireInput(unstringifiable, "blueprint", validateBlueprintWire),
  (error) => error.code === "INVALID_WIRE_JSON",
);
const rejectingValidator = () => false;
rejectingValidator.errors = [
  {
    instancePath: "/parts/0/custom~1field",
    keyword: "additionalProperties",
    params: { additionalProperty: "unexpected" },
    message: "is forbidden",
  },
];
assert.throws(
  () => validateWireInput(read("blueprint"), "blueprint", rejectingValidator),
  (error) =>
    error.code === "WIRE_SCHEMA_VIOLATION" &&
    error.path.at(-1) === "unexpected" &&
    error.path.includes("custom/field"),
);
assert.equal(
  wireResult(() => {
    throw new Error("unexpected boundary failure");
  }).errors[0].code,
  "WIRE_DECODE_FAILED",
);
assert.throws(
  () => validateWireInput(extensible, "unknown", validateBlueprintWire),
  /Unknown wire contract/,
);

console.log(
  "five existing portable wire schemas and bounded extensions passed",
);
