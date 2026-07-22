import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { validateWorkspaceWire } from "./generated/portable-machine-wire-validators.js";
import { DomainValidationError } from "./primitives.js";
import { validateWireInput, wireResult } from "./wire-validation.js";

export const WORKSPACE_FORMAT = "simulacrum-workspace";
export const WORKSPACE_VERSION = 1;

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function validateWorkspaceSemantics(workspace) {
  const blueprint = decodeBlueprintOrThrow(workspace.blueprint).wire,
    partById = new Map(blueprint.parts.map((part) => [part.id, part])),
    partIds = new Set(partById.keys()),
    maxId = Math.max(-1, ...partIds);
  if (workspace.idSeed <= maxId)
    fail(
      "INVALID_WORKSPACE_ID_SEED",
      "idSeed must be greater than every part ID",
      ["idSeed"],
      { idSeed: workspace.idSeed, maxPartId: maxId },
    );
  for (const [index, id] of workspace.selectedPartIds.entries())
    if (!partIds.has(id))
      fail("STALE_WORKSPACE_SELECTION", `Selected part ${id} does not exist`, [
        "selectedPartIds",
        index,
      ]);
  if (workspace.selectedControllerId != null) {
    const controller = partById.get(workspace.selectedControllerId);
    if (!controller || controller.type !== "computer")
      fail(
        "INVALID_SELECTED_CONTROLLER",
        "selectedControllerId must identify a computer part",
        ["selectedControllerId"],
      );
    if (!workspace.selectedPartIds.includes(workspace.selectedControllerId))
      fail(
        "UNSELECTED_CONTROLLER",
        "selectedControllerId must also appear in selectedPartIds",
        ["selectedControllerId"],
      );
  }
  if (
    workspace.activeRemoteProfile != null &&
    !Object.hasOwn(blueprint.remoteProfiles, workspace.activeRemoteProfile)
  )
    fail(
      "UNKNOWN_ACTIVE_REMOTE_PROFILE",
      "activeRemoteProfile must name a portable remote profile",
      ["activeRemoteProfile"],
    );

  const computerIds = blueprint.parts
      .filter((part) => part.type === "computer")
      .map((part) => String(part.id))
      .sort(),
    acquisitionIds = Object.keys(
      workspace.programAcquisitionByController,
    ).sort();
  if (JSON.stringify(computerIds) !== JSON.stringify(acquisitionIds))
    fail(
      "INVALID_PROGRAM_ACQUISITION_MAP",
      "programAcquisitionByController keys must exactly match computer IDs",
      ["programAcquisitionByController"],
      { expected: computerIds, actual: acquisitionIds },
    );

  for (const [profileId, controlState] of Object.entries(
    workspace.remoteControlState,
  )) {
    const profile = blueprint.remoteProfiles[profileId];
    if (!profile)
      fail(
        "UNKNOWN_REMOTE_STATE_PROFILE",
        `Remote state profile ${profileId} does not exist`,
        ["remoteControlState", profileId],
      );
    const byId = new Map(
      profile.controls.map((control) => [control.id, control]),
    );
    for (const [controlId, value] of Object.entries(controlState)) {
      const control = byId.get(controlId),
        path = ["remoteControlState", profileId, controlId];
      if (!control)
        fail(
          "UNKNOWN_REMOTE_STATE_CONTROL",
          `Control ${controlId} does not exist`,
          path,
        );
      if (!["range", "toggle"].includes(control.type))
        fail(
          "MOMENTARY_REMOTE_STATE_FORBIDDEN",
          "Hold and pulse controls cannot be persisted",
          path,
        );
      if (control.type === "toggle" && ![0, 1].includes(value))
        fail("INVALID_TOGGLE_STATE", "Toggle state must be 0 or 1", path);
      if (
        control.type === "range" &&
        (value < control.min || value > control.max)
      )
        fail(
          "REMOTE_STATE_OUT_OF_RANGE",
          "Range state is outside the control bounds",
          path,
        );
    }
  }
  return { ...workspace, blueprint };
}

function decode(input) {
  const envelope = validateWireInput(input, "workspace", validateWorkspaceWire),
    workspace = validateWorkspaceSemantics(envelope.value);
  return Object.freeze({
    wire: structuredClone(workspace),
    blueprint: decodeBlueprintOrThrow(workspace.blueprint),
    envelope: Object.freeze({ bytes: envelope.bytes, nodes: envelope.nodes }),
  });
}

export function decodeWorkspace(input) {
  return wireResult(() => decode(input));
}

export function decodeWorkspaceOrThrow(input) {
  const result = decodeWorkspace(input);
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
    details: first.details,
  });
}

export function createWorkspace({
  blueprint,
  idSeed,
  selectedPartIds = [],
  selectedControllerId = null,
  activeRemoteProfile = null,
  programAcquisitionByController,
  remoteControlState = {},
  controllerWindowState,
  extensions = undefined,
}) {
  return decodeWorkspaceOrThrow({
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    blueprint,
    idSeed,
    selectedPartIds: [...selectedPartIds],
    selectedControllerId,
    activeRemoteProfile,
    programAcquisitionByController: structuredClone(
      programAcquisitionByController,
    ),
    remoteControlState: structuredClone(remoteControlState),
    controllerWindowState: structuredClone(controllerWindowState),
    ...(extensions ? { extensions: structuredClone(extensions) } : {}),
  }).wire;
}
