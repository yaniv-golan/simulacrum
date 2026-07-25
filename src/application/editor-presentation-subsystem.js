import { createComponentInspectorController } from "../presentation/component-inspector-controller.js";
import { createSelectionArranger } from "../presentation/selection-arranger.js";
import { createEditorConnectionFeature } from "./editor-connection-feature.js";
import { createEditorSelectionFeature } from "./editor-selection-feature.js";
import { applyEditorAction } from "../model/application-state.js";
import {
  configureAuthoredMechanism,
  configureComponentPart,
} from "./component-authoring-commands.js";
import { createEditorComponentInspection as composeInspection } from "./editor-component-inspection-composition.js";
/** Composes editor selection, connection, arrangement, and Inspector ownership. */
export function createEditorPresentationSubsystem({
  state,
  catalog,
  history,
  scene,
  assembly,
  view,
  actions,
}) {
  let selection, connection, arranger, inspector, inspection;

  const showSelection = (part) => selection.showSelection(part),
    renderInspector = () => inspector.render(),
    drawConnections = () => connection.draw(),
    updateSelection = () => selection.update();
  selection = createEditorSelectionFeature({
    workspace: {
      parts: () => state.parts,
      selectedId: () => state.editor.selected,
      selectedIds: () => state.editor.selectedIds,
      tool: () => state.editor.tool,
      connectFrom: () => state.editor.connectFrom,
      exploded: () => state.exploded,
      explodeAmount: () => state.explodeAmount,
      select: actions.select,
      cancelConnection: actions.cancelConnection,
    },
    scene: {
      effects: scene.effects,
      transform: scene.transform,
      groupPivot: scene.groupPivot,
    },
    view: {
      query: view.query,
      partName: (type) => catalog[type]?.name || type,
      positionLabel: view.positionSelectionLabel,
    },
    actions: {
      connect: (...args) => connection.connect(...args),
      setMode: actions.setMode,
      renderInspector,
      tutorialEvent: actions.tutorialEvent,
      notify: actions.notify,
    },
  });
  connection = createEditorConnectionFeature({
    workspace: {
      parts: () => state.parts,
      connections: () => state.connections,
      replaceConnections: (connections) => {
        state.connections = connections;
      },
      connectFrom: () => state.editor.connectFrom,
      connectPort: () => state.editor.connectPort,
      selectedId: () => state.editor.selected,
      exploded: () => state.exploded,
      explodeAmount: () => state.explodeAmount,
    },
    history,
    view: {
      wires: scene.wires,
      showSelection,
      syncAssembly: assembly.sync,
      render: actions.render,
      notify: actions.notify,
    },
  });

  arranger = createSelectionArranger({
    state,
    $$: view.queryAll,
    selectedParts: selection.selectedParts,
    recordHistory: history.record,
    syncAssembly: assembly.sync,
    drawWires: drawConnections,
    updateSelectionVisuals: updateSelection,
    showSelection,
    renderInspector,
    toast: actions.notify,
  });

  inspection = composeInspection({ state, assembly, connection, catalog });

  inspector = createComponentInspectorController({
    model: {
      parts: () => state.parts,
      connections: () => state.connections,
      selectedId: () => state.editor.selected,
      selectedEntity: () => state.editor.selectedEntity,
      selectedParts: selection.selectedParts,
      connectFrom: () => state.editor.connectFrom,
      connectPort: () => state.editor.connectPort,
      running: () => state.running,
      inspection: inspection.read,
    },
    view: {
      query: view.query,
      queryAll: view.queryAll,
      syncSelection: view.syncSelection,
      arrangerMarkup: arranger.markup,
      bindArranger: arranger.bind,
    },
    actions: {
      recordHistory: history.record,
      configurePart: configureComponentPart,
      configureMechanism: configureAuthoredMechanism,
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
    },
  });

  return Object.freeze({
    selection,
    connection,
    arranger,
    inspector,
    clearEffect: selection.clearEffect,
    selectedParts: selection.selectedParts,
    updateSelection,
    showSelection,
    showHover: selection.showHover,
    selectPart: selection.select,
    connect: connection.connect,
    connectionValid: connection.valid,
    drawConnections,
    isMechanicallyAnchored: connection.isMechanicallyAnchored,
    renderInspector,
    inspection: inspection.read,
  });
}
