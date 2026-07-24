import {
  activeKeyboardFocusContext,
  focusedWidgetOwnsKeyboardEvent,
} from "../presentation/keyboard-focus-context.js";
import { installKeyboardShortcuts } from "./keyboard-shortcut-controller.js";

/** Connects the action registry to existing editor and presentation ports. */
export function installEditorKeyboardCommands({
  state,
  camera,
  editor,
  drive,
  remote,
  simulation,
  learning,
  workspace,
  actions,
  setTool,
  cancelConnection,
}) {
  return installKeyboardShortcuts({
    target: actions.keyboardTarget,
    documentTarget: actions.documentTarget,
    model: {
      running: () => state.running,
      captureIndex: () => state.capturingHotkey,
      setCaptureIndex: (index) => {
        state.capturingHotkey = index;
      },
      profile: () => state.remoteProfile,
      controls: (profile) => state.remoteControls[profile] || [],
      focusContext: () => activeKeyboardFocusContext(actions.documentTarget),
      widgetOwnsKey: (event) =>
        focusedWidgetOwnsKeyboardEvent(actions.documentTarget, event),
    },
    drive,
    remote,
    editor: {
      undo: editor.undo,
      redo: editor.redo,
      resetSimulation: simulation.reset,
      selectAll: editor.selectAll,
      duplicate: editor.duplicate,
      clear: editor.clearBuildPlate,
      remove: editor.remove,
      mirror: editor.mirror,
      cancel: cancelConnection,
      setTool,
      setMode: actions.setMode,
      toggleExploded: editor.toggleExploded,
    },
    simulation,
    camera: {
      clearTool: camera.clearCameraTool,
      navigate: camera.handleNavigationKey,
      releaseHeld: camera.releaseHeld,
    },
    openLearning: learning.open,
    toggleWorkspaceFocus: workspace.toggleFocus,
  });
}
