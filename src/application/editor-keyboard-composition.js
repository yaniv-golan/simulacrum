import {
  activeKeyboardFocusContext,
  focusedWidgetOwnsKeyboardEvent,
} from "../presentation/keyboard-focus-context.js";
import { TYPES } from "../model/component-catalog.js";
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
  const selectedFlexiblePart = () => {
    const part = state.parts.find(
      (candidate) => candidate.id === state.editor.selected,
    );
    return TYPES[part?.type]?.flexibleLine ? part : null;
  };
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
      duplicate: () =>
        editor.presentation.editorPresentation.executeSelectedCommand(
          "selection.duplicate",
        ),
      clear: editor.clearBuildPlate,
      remove: () =>
        editor.presentation.editorPresentation.executeSelectedCommand(
          "selection.remove",
        ),
      mirror: () =>
        editor.presentation.editorPresentation.executeSelectedCommand(
          "selection.mirror-x",
        ),
      executeSelectedCommand:
        editor.presentation.editorPresentation.executeSelectedCommand,
      attachRopeEnd: (port) => {
        const part = selectedFlexiblePart();
        if (!part) return;
        editor.beginConnection(part.id, port);
        actions.setMode("wire");
      },
      detachRopeEnd: (port) => {
        const part = selectedFlexiblePart();
        if (!part) return;
        const connection = state.connections.find(
          (candidate) =>
            (candidate.a === part.id && candidate.portA === port) ||
            (candidate.b === part.id && candidate.portB === port),
        );
        if (!connection) return;
        actions.applyEditorAction(state.editor, {
          type: "select-connection",
          connectionId: connection.id,
          partId: part.id,
        });
        editor.remove();
      },
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
