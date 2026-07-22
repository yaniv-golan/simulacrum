import { createWorkspace } from "../model/workspaces.js";
import { durableRemoteControlState } from "./remote-control-state.js";

/**
 * Owns serialization of editor-only state around a portable blueprint.
 * Keeping this boundary separate prevents build composition from learning the
 * workspace wire shape or leaking transient remote activation into storage.
 */
export function createWorkspacePersistence({
  state,
  storage,
  workspaceKey,
  getIdSeed,
  serializeBlueprint,
}) {
  return function saveWorkspace() {
    const blueprint = serializeBlueprint();
    const selectedPartIds = [...state.editor.selectedIds].filter((id) =>
      state.parts.some((part) => part.id === id),
    );
    const selectedControllerId =
      selectedPartIds.includes(state.scriptControllerId) &&
      state.parts.some(
        (part) =>
          part.id === state.scriptControllerId && part.type === "computer",
      )
        ? state.scriptControllerId
        : null;

    state.remoteControlState = durableRemoteControlState(
      state.remoteProfiles,
      state.remoteControls,
    );
    const workspace = createWorkspace({
      blueprint,
      idSeed: getIdSeed(),
      selectedPartIds,
      selectedControllerId,
      activeRemoteProfile: state.remoteProfile || null,
      programAcquisitionByController: Object.fromEntries(
        state.parts
          .filter((part) => part.type === "computer")
          .map((part) => [part.id, part.programAcquisition]),
      ),
      remoteControlState: state.remoteControlState,
      controllerWindowState: state.controllerWindowState,
    });
    storage.commitBatch([
      { key: workspaceKey, encoding: "json", value: workspace },
    ]);
    return workspace;
  };
}
