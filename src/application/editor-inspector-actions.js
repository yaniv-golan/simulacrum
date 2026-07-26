import { applyEditorAction } from "../model/application-state.js";
import {
  configureAuthoredMechanism,
  configureComponentPart,
} from "./component-authoring-commands.js";

/** Adapts editor use cases to the presentation-owned Inspector action port. */
export function createEditorInspectorActions({
  state,
  catalog,
  history,
  assembly,
  view,
  actions,
  selection,
  connection,
  showSelection,
  renderInspector,
  drawConnections,
  updateSelection,
}) {
  return {
    recordHistory: history.record,
    configurePart: configureComponentPart,
    configureMechanism: configureAuthoredMechanism,
    scalePart: (part, axis, value) => {
      const previous = { ...part.scale };
      part.scale = { ...part.scale, [axis]: Number(value) };
      try {
        assembly.rebuildGeometry(part);
        return true;
      } catch (error) {
        part.scale = previous;
        actions.notify(
          `Scale rejected: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    syncAssembly: assembly.sync,
    drawConnections,
    updateSelection,
    prepareFoot: actions.prepareFoot,
    openController: actions.openController,
    beginConnection: actions.beginConnection,
    completeConnection: (partId, targetPort) => {
      const sourceId = state.editor.connectFrom;
      if (!sourceId) return false;
      const connected = connection.connect(
        sourceId,
        partId,
        "auto",
        targetPort,
      );
      if (!connected) return false;
      applyEditorAction(state.editor, { type: "cancel-connection" });
      view.query(".connection-banner")?.classList.add("hidden");
      selection.clearEffect("previewLine");
      actions.setMode("build");
      actions.notify("Physical connection created");
      actions.tutorialEvent("connected");
      return true;
    },
    connectWithRope: actions.connectWithRope,
    selectPart: (partId) => {
      actions.select(partId, [partId]);
      showSelection(state.parts.find((part) => part.id === partId) || null);
      renderInspector();
    },
    setPrimaryPart: (partId) => {
      if (!state.editor.selectedIds.has(partId)) return;
      actions.select(partId, state.editor.selectedIds);
      const primary = state.parts.find((part) => part.id === partId);
      showSelection(primary || null);
      renderInspector();
      actions.notify(
        `${catalog[primary?.type]?.name || "Component"} #${partId} is now the primary component`,
      );
      queueMicrotask(() => view.query("#primary-selection")?.focus());
    },
    selectConnection: (connectionId, partId) => {
      applyEditorAction(state.editor, {
        type: "select-connection",
        connectionId,
        partId,
      });
      showSelection(state.parts.find((part) => part.id === partId) || null);
    },
    setMode: actions.setMode,
    notify: actions.notify,
  };
}
