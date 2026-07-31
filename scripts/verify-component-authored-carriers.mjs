import { assert } from "./lib/assert.mjs";
import { AssemblyModel } from "../src/model/assembly-model.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { createBlueprint } from "../src/model/blueprints.js";
import { fingerprintComponentInspectionAssembly } from "../src/model/component-inspection-fingerprint.js";
import {
  createSharePackage,
  decodeSharePackageOrThrow,
} from "../src/model/share-packages.js";
import {
  createSubassemblyTemplate,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";
import {
  createWorkspace,
  decodeWorkspaceOrThrow,
} from "../src/model/workspaces.js";
import { createComponentInspectionCarrierBlueprint } from "./lib/component-inspection-carrier-fixture.mjs";

const source = createComponentInspectionCarrierBlueprint(),
  decoded = decodeBlueprintOrThrow(source),
  authored = decoded.assembly,
  controllerId = decoded.wire.parts.find(({ type }) => type === "computer").id,
  sourceFingerprint = await fingerprintComponentInspectionAssembly(authored),
  model = AssemblyModel.fromBlueprint(authored),
  recreated = createBlueprint(model, { name: source.name, created: null });

const bindingPermutation = structuredClone(authored);
bindingPermutation.parts
  .find(({ type }) => type === "computer")
  .controllerBindings.reverse();
assert.equal(
  await fingerprintComponentInspectionAssembly(bindingPermutation),
  sourceFingerprint,
  "binding array order changed canonical authored identity",
);
const extensionArrayPermutation = structuredClone(authored);
extensionArrayPermutation.parts
  .find(({ type }) => type === "plate")
  .extensions["example.part"].labels.reverse();
assert.notEqual(
  await fingerprintComponentInspectionAssembly(extensionArrayPermutation),
  sourceFingerprint,
  "non-binding extension array order was incorrectly discarded",
);

assert.equal(
  await fingerprintComponentInspectionAssembly(
    decodeBlueprintOrThrow(recreated).assembly,
  ),
  sourceFingerprint,
  "blueprint creation changed portable authored content",
);
assert.deepEqual(recreated.parts, decoded.wire.parts);
assert.deepEqual(recreated.connections, decoded.wire.connections);

const workspace = createWorkspace({
    blueprint: decoded.wire,
    idSeed: Math.max(...decoded.wire.parts.map(({ id }) => id)) + 1,
    selectedPartIds: [controllerId],
    selectedControllerId: controllerId,
    activeRemoteProfile: decoded.wire.defaultRemoteProfile,
    programAcquisitionByController: { [controllerId]: "BUILT_IN" },
    remoteControlState: Object.fromEntries(
      Object.entries(decoded.wire.remoteProfiles).map(([id, profile]) => [
        id,
        Object.fromEntries(
          profile.controls
            .filter(({ type }) => !["hold", "pulse"].includes(type))
            .map((control) => [control.id, control.defaultValue]),
        ),
      ]),
    ),
    controllerWindowState: {
      visible: false,
      collapsed: false,
      pinned: false,
      x: 24,
      y: 24,
      width: 360,
      height: 520,
    },
  }),
  restoredWorkspace = decodeWorkspaceOrThrow(workspace);
assert.equal(
  await fingerprintComponentInspectionAssembly(
    decodeBlueprintOrThrow(restoredWorkspace.wire.blueprint).assembly,
  ),
  sourceFingerprint,
  "workspace save/load changed authored content",
);

const allIds = authored.parts.map(({ id }) => id),
  subassembly = createSubassemblyTemplate(authored, allIds, {
    name: "Inspection carrier",
  }),
  instance = instantiateSubassembly(subassembly, {
    position: [10, 2, -4],
    nextId: 100,
  }),
  instanceMotorId = instance.parts.find(({ type }) => type === "motor").id,
  instanceSensorId = instance.parts.find(({ type }) => type === "sensor").id;
assert.deepEqual(
  instance.parts.find(({ type }) => type === "plate").extensions,
  source.parts.find(({ type }) => type === "plate").extensions,
);
assert.deepEqual(
  instance.parts.find(({ type }) => type === "axle").rigVisualRotation,
  source.parts.find(({ type }) => type === "axle").rigVisualRotation,
);
assert.deepEqual(
  instance.connections.find(({ kind }) => kind === "mechanical").extensions,
  source.connections.find(({ kind }) => kind === "mechanical").extensions,
);
assert.deepEqual(
  instance.parts.find(({ type }) => type === "computer").controllerBindings,
  [
    {
      id: "inspection.motor",
      direction: "output",
      endpointPartId: instanceMotorId,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
    {
      id: "inspection.sensor",
      direction: "input",
      endpointPartId: instanceSensorId,
      endpointPortId: "SIGNAL",
      reading: "rotation_rpm",
    },
  ],
  "My Parts placement did not perform only the declared ID remap",
);

const shared = await createSharePackage({
    kind: "blueprint",
    asset: decoded.wire,
    metadata: { title: source.name },
  }),
  imported = await decodeSharePackageOrThrow(shared);
assert.equal(
  await fingerprintComponentInspectionAssembly(
    decodeBlueprintOrThrow(imported.item.asset).assembly,
  ),
  sourceFingerprint,
  "share/import exchange changed authored content",
);

const detached = structuredClone(instance.parts[0].extensions);
detached["example.part"].labels.push("mutated");
assert.equal(
  source.parts[0].extensions["example.part"].labels.includes("mutated"),
  false,
  "carrier output aliases source extension data",
);

console.log("component inspection authored-field carrier matrix passed");
