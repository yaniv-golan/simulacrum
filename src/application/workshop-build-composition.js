import { applyEditorAction } from "../model/application-state.js";
import { createBuildPersistenceSubsystem } from "./build-persistence-subsystem.js";

/** Maps completed workshop features into the persistent build lifecycle. */
export function createWorkshopBuildComposition({
  shell,
  definitions,
  assembly,
  editor,
  controllers,
  stage,
  history,
  identity,
  actions,
  view,
}) {
  const state = shell.state,
    presentation = editor.editorPresentation,
    controlSurface = assembly.controls;

  return createBuildPersistenceSubsystem({
    state,
    storage: shell.storage,
    keys: definitions.keys,
    definitions: {
      catalog: definitions.catalog,
      controlTemplates: definitions.controlTemplates,
      defaultWatSource: definitions.defaultWatSource,
      defaultTsSource: definitions.defaultTsSource,
      missionTsSource: definitions.missionTsSource,
    },
    assembly: {
      model: assembly.workspace.model,
      sync: assembly.workspace.sync,
      editorSnapshot: assembly.workspace.editorSnapshot,
    },
    editor: {
      selectedParts: presentation.selectedParts,
      addPart: assembly.editor.add,
      clearMachine: assembly.editor.clear,
      createMesh: assembly.createMesh,
      prepareFoot: assembly.prepareFoot,
      showSelection: presentation.showSelection,
      drawConnections: presentation.drawConnections,
    },
    controllers: {
      saveActive: controllers.save,
      active: controllers.activeController,
      bind: controllers.bind,
      renderEditor: controllers.render,
      stopAll: controllers.stopAll,
      defaultSources: shell.newControllerSources,
    },
    history: {
      store: shell.history,
      capture: history.capture,
      record: history.record,
      refresh: history.refresh,
    },
    identity,
    scene: {
      machine: stage.machine,
      sourceCanvas: () => stage.renderer.domElement,
    },
    view: {
      query: shell.query,
      queryAll: shell.queryAll,
      render: view.render,
      renderRemote: controlSurface.renderRemote,
      persistRemotes: controlSurface.persistRemotes,
      missionName: () => shell.query("#mission-name")?.textContent,
      missionDescription: () => shell.query("#mission-desc")?.textContent,
      setMission: (name, description) => {
        shell.query("#mission-name").textContent = name;
        shell.query("#mission-desc").textContent = description;
      },
      presentHistory: presentHistory(shell.query),
      notify: shell.notify,
    },
    actions: {
      stopSimulation: actions.stopSimulation,
      applyEditorAction,
      setEditorMode: (mode) =>
        applyEditorAction(state.editor, { type: "set-mode", mode }),
      select: (ids, id) =>
        applyEditorAction(state.editor, { type: "select", ids, id }),
    },
  });
}

function presentHistory(query) {
  return ({ canUndo, canRedo, undoLabel, redoLabel }) => {
    const undo = query("#undo-tool"),
      redo = query("#redo-tool");
    if (!undo || !redo) return;
    undo.disabled = !canUndo;
    redo.disabled = !canRedo;
    undo.title = undoLabel
      ? `Undo ${undoLabel} (Ctrl/Cmd+Z)`
      : "Nothing to undo";
    redo.title = redoLabel
      ? `Redo ${redoLabel} (Ctrl/Cmd+Shift+Z)`
      : "Nothing to redo";
  };
}
