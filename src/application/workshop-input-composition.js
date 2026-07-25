import { applyEditorAction } from "../model/application-state.js";
import { installKeyboardCommandSurface } from "../presentation/keyboard-command-surface.js";
import { installEditorInputSubsystem } from "./editor-input-subsystem.js";
import { validateWorkshopShortcut } from "./keyboard-action-registry.js";

/** Connects pointer/keyboard commands to editor, simulation, and remote facades. */
export function installWorkshopInputComposition({
  target,
  shell,
  catalog,
  stage,
  editor,
  assembly,
  persistence,
  playback,
  actions,
}) {
  const presentation = editor.editorPresentation,
    assemblyEditor = assembly.editor,
    direct = assembly.controls.directControl,
    history = persistence.buildHistoryFeature;
  const input = installEditorInputSubsystem({
    state: shell.state,
    target: stage.renderer.domElement,
    camera: editor.world.cameraController,
    scene: { camera: stage.camera, effects: stage.effects },
    transform: editor.transform,
    catalog,
    model: {
      transformDragging: editor.transformGizmo.dragging,
    },
    editor: {
      selectPart: presentation.selectPart,
      selectedParts: presentation.selectedParts,
      placeSubassembly: (...args) =>
        persistence.subassemblyLibrary.place(...args),
      addPart: assemblyEditor.add,
      updateSelection: presentation.updateSelection,
      drawConnections: presentation.drawConnections,
      syncAssembly: assembly.workspace.sync,
      showSelection: presentation.showSelection,
      showHover: presentation.showHover,
      clearEffect: presentation.clearEffect,
      presentation: editor,
      undo: history.undo,
      redo: history.redo,
      selectAll: assemblyEditor.selectAll,
      duplicate: assemblyEditor.duplicate,
      clearBuildPlate: assemblyEditor.clearBuildPlate,
      remove: assemblyEditor.removeSelection,
      mirror: assemblyEditor.mirror,
      toggleExploded: editor.exploded.toggle,
      beginConnection: editor.beginConnection,
    },
    history: { record: history.record },
    drive: {
      setInput: direct.setDriveInput,
      toggleLights: direct.toggleLights,
      supports: direct.supportsAction,
      releaseAll: direct.releaseHeldInputs,
    },
    remote: {
      send: assembly.controls.sendCommand,
      render: assembly.controls.renderRemote,
      persist: assembly.controls.persistRemotes,
      notify: shell.notify,
      releaseAll: assembly.controls.releaseHeldInputs,
    },
    simulation: {
      reset: actions.resetSimulation,
      togglePause: playback.togglePause,
      cycleSpeed: playback.cycleSpeed,
      step: playback.step,
    },
    learning: { open: actions.openLearningCenter },
    workspace: { toggleFocus: () => shell.chrome.toggleFocus() },
    view: {
      query: shell.query,
      queryAll: shell.queryAll,
      render: actions.render,
      notify: shell.notify,
    },
    actions: {
      applyEditorAction,
      setMode: actions.setMode,
      tutorialEvent: actions.tutorialEvent,
      keyboardTarget: target,
      documentTarget: document,
    },
  });
  assemblyEditor.configureDuplicatePlacement({
    intent: () => ({
      camera: editor.world.cameraController.duplicatePlacementIntent(),
      hoveredFace: input.duplicatePlacementHover(),
    }),
    committed: () => input.setTool("move"),
  });
  installKeyboardCommandSurface({
    registry: input.keyboard.actionRegistry,
    activeContext: () => (shell.state.running ? "operation" : "workshop"),
    validateBinding: (event, actionId, slot) =>
      validateWorkshopShortcut({
        event,
        actionId,
        slot,
        registry: input.keyboard.actionRegistry,
      }),
  });
  return input;
}
