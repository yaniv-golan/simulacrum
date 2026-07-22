import { createMarqueeCommitHandler } from "../presentation/marquee-selector.js";
import { installWorkshopPointerController } from "../presentation/workshop-pointer-controller.js";
import { installKeyboardShortcuts } from "./keyboard-shortcut-controller.js";
import {
  bindExactPlacementForm,
  createPendingPlacementCommand,
} from "./pending-placement-command.js";
/** Owns pointer, keyboard, and toolbar translation into editor actions. */
export function installEditorInputSubsystem({
  state,
  target,
  camera,
  scene,
  transform,
  catalog,
  model,
  editor,
  history,
  drive,
  remote,
  simulation,
  learning,
  workspace,
  view,
  actions,
}) {
  const setTool = (tool) => {
      if (
        (tool === "move" || tool === "rotate") &&
        (state.exploded || state.explodeAmount > 0.001)
      ) {
        view.notify("Collapse Exploded View before editing transforms");
        return;
      }
      camera.clearCameraTool();
      actions.applyEditorAction(state.editor, { type: "set-tool", tool });
      view
        .queryAll(".tool-group button")
        .forEach((button) =>
          button.classList.toggle("active", button.id === `${tool}-tool`),
        );
      editor.showSelection(
        state.parts.find((part) => part.id === state.editor.selected),
      );
    },
    placePending = createPendingPlacementCommand({
      state,
      catalog,
      editor,
      actions,
      view,
      setTool,
    }),
    cancelConnection = () => {
      const returnTool = state.editor.placing?.returnTool;
      actions.applyEditorAction(state.editor, { type: "cancel-connection" });
      actions.applyEditorAction(state.editor, {
        type: "finish-placement",
        returnTool: returnTool || state.editor.tool,
      });
      view.query(".placement-help").classList.add("hidden");
      view.query(".connection-banner").classList.add("hidden");
      editor.clearEffect("previewLine");
      editor.clearEffect("hoverBox");
      actions.setMode("build");
      if (returnTool) setTool(returnTool);
      view.render();
    },
    pointer = installWorkshopPointerController({
      target,
      camera,
      scene,
      transform,
      model: {
        running: () => state.running,
        transformDragging: model.transformDragging,
        parts: () => state.parts,
        selectedId: () => state.editor.selected,
        selectedIds: () => state.editor.selectedIds,
        tool: () => state.editor.tool,
        cameraTool: () => state.editor.cameraTool,
        connectFrom: () => state.editor.connectFrom,
        placing: () => state.editor.placing,
      },
      editor: {
        preserveGroupSelection: (id, ids) => {
          actions.applyEditorAction(state.editor, {
            type: "select",
            ids,
            id,
          });
          editor.showSelection(state.parts.find((part) => part.id === id));
          editor.renderInspector();
        },
        selectPart: editor.selectPart,
        selectedParts: editor.selectedParts,
        commitMarquee: createMarqueeCommitHandler({
          state,
          showSelection: editor.showSelection,
          renderInspector: editor.renderInspector,
          toast: view.notify,
        }),
        placePending,
      },
      history,
      view: {
        query: view.query,
        updateSelection: editor.updateSelection,
        drawConnections: editor.drawConnections,
        syncAssembly: editor.syncAssembly,
        showSelection: editor.showSelection,
        showHover: editor.showHover,
        clearEffect: editor.clearEffect,
        notify: view.notify,
      },
    });
  bindExactPlacementForm({
    view,
    state,
    applyEditorAction: actions.applyEditorAction,
    placePending,
    cancelPlacement: cancelConnection,
  });

  installKeyboardShortcuts({
    target: actions.keyboardTarget,
    model: {
      running: () => state.running,
      captureIndex: () => state.capturingHotkey,
      setCaptureIndex: (index) => {
        state.capturingHotkey = index;
      },
      profile: () => state.remoteProfile,
      controls: (profile) => state.remoteControls[profile] || [],
      activeElementTag: view.activeElementTag,
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
      toggleExploded: editor.toggleExploded,
    },
    simulation,
    camera: {
      clearTool: camera.clearCameraTool,
      navigate: camera.handleNavigationKey,
      releaseSpace: camera.releaseSpace,
    },
    openLearning: learning.open,
    toggleWorkspaceFocus: workspace.toggleFocus,
  });

  view.query("#cancel-connect").onclick = cancelConnection;
  view.query("#select-tool").onclick = () => setTool("select");
  view.query("#move-tool").onclick = () => setTool("move");
  view.query("#rotate-tool").onclick = () => setTool("rotate");
  view.query("#explode-view").onclick = editor.toggleExploded;

  return Object.freeze({ ...pointer, cancelConnection, placePending, setTool });
}
