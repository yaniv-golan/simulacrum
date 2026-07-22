import { normalizeControllerLayouts } from "../model/controller-layouts.js";
import { installControllerWindow } from "../presentation/controller-window.js";
import { createRemotePanel } from "../presentation/remote-panel.js";
import { createDirectControlFeature } from "./direct-control-feature.js";
import { createDirectControlWorkspace } from "./direct-control-workspace.js";
import {
  durableRemoteControlState,
  nextRemoteControlId,
  remoteProfilesFromTemplates,
  runtimeControlsFromProfiles,
  syncRemoteProfileDefinitions,
} from "./remote-control-state.js";

/** Owns generic and model-specific control surfaces plus their persistence. */
export function createControlSurfaceSubsystem({
  state,
  controlTemplates,
  telemetry,
  workspace,
  view,
}) {
  let directControl,
    persistWorkspace = () => {};
  const renderDirectSurface = () => directControl?.renderSurface(),
    updateDriveHud = () => directControl?.updateHud(),
    persistDirectSurfaces = () => directControl?.persistSurfaces(),
    persistRemoteState = () => {
      state.remoteControlState = durableRemoteControlState(
        state.remoteProfiles,
        state.remoteControls,
      );
      persistWorkspace();
    },
    persistRemoteDefinitions = () => {
      syncRemoteProfileDefinitions(state);
      persistRemoteState();
    },
    { controlOnline, persistRemotes, renderRemote, sendCommand } =
      createRemotePanel({
        state,
        $: view.query,
        $$: view.queryAll,
        readControlBinding: workspace.readControlBinding,
        renderDirectSurface,
        persistRemoteDefinitions,
        persistRemoteState,
        nextControlId: nextRemoteControlId,
      });

  const templateProfiles = remoteProfilesFromTemplates(controlTemplates),
    templateRuntimeControls = runtimeControlsFromProfiles(templateProfiles);

  directControl = createDirectControlFeature({
    workspace: createDirectControlWorkspace(state, telemetry),
    view: {
      query: view.query,
      queryAll: view.queryAll,
      compact: view.compact,
      controlOnline,
      sendCommand,
      renderRemote,
    },
    persistence: {
      persistSurfaces: () => {
        state.controllerWindowState.visible = Boolean(
          state.directSurfaces[state.remoteProfile],
        );
        persistWorkspace();
      },
      persistControls: persistRemotes,
    },
    controlTemplates: templateRuntimeControls,
  });

  const persistControllerLayouts = () => {
    state.controllerLayouts = normalizeControllerLayouts(
      state.controllerLayouts,
    );
    const layout = state.controllerLayouts[state.remoteProfile];
    if (layout && state.remoteProfiles[state.remoteProfile])
      state.remoteProfiles[state.remoteProfile].design = {
        title: layout.title,
        style: layout.style,
        accent: layout.accent,
      };
    state.controllerWindowState.collapsed = Boolean(layout?.collapsed);
    persistRemoteDefinitions();
  };
  installControllerWindow({
    $: view.query,
    state,
    persistLayouts: persistControllerLayouts,
    persistVisibility: persistDirectSurfaces,
    render: renderDirectSurface,
    refreshVisibility: updateDriveHud,
    openAdvanced: view.openAdvanced,
  });

  return Object.freeze({
    directControl,
    controlOnline,
    renderDirectSurface,
    updateDriveHud,
    persistDirectSurfaces,
    persistRemotes,
    setWorkspacePersistence(callback) {
      persistWorkspace = typeof callback === "function" ? callback : () => {};
    },
    renderRemote,
    sendCommand,
  });
}
