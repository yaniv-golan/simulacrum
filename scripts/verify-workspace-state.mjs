import assert from "node:assert/strict";
import fs from "node:fs";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import {
  createWorkspace,
  decodeWorkspace,
  decodeWorkspaceOrThrow,
} from "../src/model/workspaces.js";

const empty = JSON.parse(
  fs.readFileSync(
    "test/fixtures/strict-current-contract/workspace.spec.json",
    "utf8",
  ),
);
assert.equal(decodeWorkspace(empty).ok, true);

const blueprint = builtInDemo("gearbox").blueprint,
  computers = blueprint.parts.filter((part) => part.type === "computer"),
  maxId = Math.max(...blueprint.parts.map((part) => part.id)),
  control = blueprint.remoteProfiles.gearbox.controls.find(
    (candidate) => candidate.type === "range",
  ),
  workspace = createWorkspace({
    blueprint,
    idSeed: maxId + 1,
    selectedPartIds: [computers[0].id],
    selectedControllerId: computers[0].id,
    activeRemoteProfile: "gearbox",
    programAcquisitionByController: {
      [computers[0].id]: "BUILT_IN",
    },
    remoteControlState: {
      gearbox: { [control.id]: control.defaultValue },
    },
    controllerWindowState: {
      visible: true,
      collapsed: false,
      pinned: true,
      x: 20,
      y: 20,
      width: 360,
      height: 520,
    },
  });
assert.deepEqual(decodeWorkspaceOrThrow(workspace).wire, workspace);

function rejection(mutator, code) {
  const candidate = structuredClone(workspace);
  mutator(candidate);
  const result = decodeWorkspace(candidate);
  assert.equal(result.ok, false, `${code} workspace was accepted`);
  assert.equal(result.errors[0].code, code);
}

for (const version of [undefined, 0, 2])
  rejection((candidate) => {
    if (version === undefined) delete candidate.version;
    else candidate.version = version;
  }, "UNSUPPORTED_WORKSPACE_VERSION");
rejection(
  (candidate) => (candidate.idSeed = maxId),
  "INVALID_WORKSPACE_ID_SEED",
);
rejection(
  (candidate) => candidate.selectedPartIds.push(999),
  "STALE_WORKSPACE_SELECTION",
);
rejection((candidate) => {
  const beam = blueprint.parts.find((part) => part.type === "plate");
  candidate.selectedPartIds = [beam.id];
  candidate.selectedControllerId = beam.id;
}, "INVALID_SELECTED_CONTROLLER");
rejection(
  (candidate) => (candidate.selectedPartIds = []),
  "UNSELECTED_CONTROLLER",
);
rejection(
  (candidate) => (candidate.activeRemoteProfile = "missing"),
  "UNKNOWN_ACTIVE_REMOTE_PROFILE",
);
rejection(
  (candidate) => (candidate.programAcquisitionByController = {}),
  "INVALID_PROGRAM_ACQUISITION_MAP",
);
rejection(
  (candidate) =>
    (candidate.programAcquisitionByController[computers[0].id] = "trusted"),
  "WIRE_SCHEMA_VIOLATION",
);
rejection(
  (candidate) => (candidate.remoteControlState.ghost = {}),
  "UNKNOWN_REMOTE_STATE_PROFILE",
);
rejection(
  (candidate) => (candidate.remoteControlState.gearbox.ghost = 1),
  "UNKNOWN_REMOTE_STATE_CONTROL",
);
rejection(
  (candidate) =>
    (candidate.remoteControlState.gearbox[control.id] = control.max + 1),
  "REMOTE_STATE_OUT_OF_RANGE",
);

const cartBlueprint = builtInDemo("cart").blueprint,
  cartComputer = cartBlueprint.parts.find((part) => part.type === "computer"),
  cartToggle = cartBlueprint.remoteProfiles.cart.controls.find(
    (candidate) => candidate.type === "toggle",
  ),
  cartWorkspace = createWorkspace({
    blueprint: cartBlueprint,
    idSeed: Math.max(...cartBlueprint.parts.map((part) => part.id)) + 1,
    selectedPartIds: [cartComputer.id],
    selectedControllerId: cartComputer.id,
    activeRemoteProfile: "cart",
    programAcquisitionByController: { [cartComputer.id]: "BUILT_IN" },
    remoteControlState: { cart: { [cartToggle.id]: 1 } },
    controllerWindowState: workspace.controllerWindowState,
    extensions: { "com.example.workspace": { compact: true } },
  });
assert.equal(decodeWorkspace(cartWorkspace).ok, true);
const invalidToggle = structuredClone(cartWorkspace);
invalidToggle.remoteControlState.cart[cartToggle.id] = 0.5;
assert.equal(
  decodeWorkspace(invalidToggle).errors[0].code,
  "INVALID_TOGGLE_STATE",
);

const momentary = blueprint.remoteProfiles.gearbox.controls.find(
  (candidate) => candidate.type === "hold" || candidate.type === "pulse",
);
rejection(
  (candidate) => (candidate.remoteControlState.gearbox[momentary.id] = 1),
  "MOMENTARY_REMOTE_STATE_FORBIDDEN",
);

const portableJson = JSON.stringify(workspace.blueprint);
for (const forbidden of [
  "selectedPartIds",
  "programAcquisitionByController",
  "controllerWindowState",
  "programTrust",
])
  assert.equal(portableJson.includes(forbidden), false);

assert.throws(
  () => decodeWorkspaceOrThrow({ version: 2 }),
  (error) => error.code === "UNSUPPORTED_WORKSPACE_VERSION",
);

console.log("workspace v1 portable/local state boundary passed");
