import { createComponentInspectorController } from "../presentation/component-inspector-controller.js";
import { createSelectionArranger } from "../presentation/selection-arranger.js";
import { createEditorConnectionFeature } from "./editor-connection-feature.js";
import { createEditorInspectorActions } from "./editor-inspector-actions.js";
import { createEditorSelectionFeature } from "./editor-selection-feature.js";
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
  commandCatalog,
  isolation,
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
      select: (...args) => {
        actions.select(...args);
        isolation.selectionChanged?.();
      },
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
      finishTransform: actions.finishTransform,
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

  inspection = composeInspection({
    state,
    assembly,
    connection,
    catalog,
    commandCatalog,
    isolation,
  });

  inspector = createComponentInspectorController({
    model: {
      parts: () => state.parts,
      connections: () => state.connections,
      selectedId: () => state.editor.selected,
      selectedEntity: () => state.editor.selectedEntity,
      primaryPartId: () => state.editor.selected,
      selectedParts: selection.selectedParts,
      connectFrom: () => state.editor.connectFrom,
      connectPort: () => state.editor.connectPort,
      running: () => state.running,
      inspection: inspection.read,
      setRouteEvidence: inspection.setRouteEvidence,
      clearRouteEvidence: inspection.clearRouteEvidence,
    },
    view: {
      query: view.query,
      queryAll: view.queryAll,
      syncSelection: view.syncSelection,
      arrangerMarkup: arranger.markup,
      bindArranger: arranger.bind,
    },
    actions: createEditorInspectorActions({
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
      disconnectConnection: assembly.disconnectConnection,
      traceComponentRoute: assembly.traceComponentRoute,
      traceConfiguredControlChain: assembly.traceConfiguredControlChain,
      showRelationshipTrace: connection.showRelationshipTrace,
      showRelationshipTraceSegments: connection.showRelationshipTraceSegments,
      clearRelationshipTrace: connection.clearRelationshipTrace,
    }),
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
    bindSelectedCommands: commandCatalog.bind,
    setSelectedCommandKeyboardRegistry: commandCatalog.setKeyboardRegistry,
    executeSelectedCommand(commandId) {
      const command = inspection
        .read()
        .commands.find((candidate) => candidate.id === commandId);
      if (!command) throw new Error(`Unknown selected command ${commandId}`);
      if (command.availability !== "available") {
        actions.notify(
          command.disabledReason || `${command.label} is unavailable`,
        );
        return false;
      }
      commandCatalog.execute(commandId);
      return true;
    },
  });
}
