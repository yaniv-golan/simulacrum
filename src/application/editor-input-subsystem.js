import { createMarqueeCommitHandler } from "../presentation/marquee-selector.js";
import { installWorkshopPointerController } from "../presentation/workshop-pointer-controller.js";
import { installEditorKeyboardCommands } from "./editor-keyboard-composition.js";
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
  const selectedContext = editor.presentation.editorPresentation,
    editSelected = (action) => () => {
      editor.presentation.selectionVisibility.showAll({ silent: true });
      action();
    };
  selectedContext.bindSelectedCommands({
    "selection.duplicate": editSelected(editor.duplicate),
    "selection.mirror-x": editSelected(editor.mirror),
    "selection.remove": editSelected(editor.remove),
    "selection.frame": camera.frameSelection,
    "selection.isolate": editor.presentation.selectionVisibility.isolate,
    "selection.show-all": editor.presentation.selectionVisibility.showAll,
  });
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
          selectedContext.renderInspector();
        },
        selectPart: editor.selectPart,
        selectedParts: editor.selectedParts,
        commitMarquee: createMarqueeCommitHandler({
          state,
          showSelection: editor.showSelection,
          renderInspector: selectedContext.renderInspector,
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

  const keyboard = installEditorKeyboardCommands({
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
  });
  selectedContext.setSelectedCommandKeyboardRegistry(keyboard.actionRegistry);
  selectedContext.renderInspector();

  view.query("#cancel-connect").onclick = cancelConnection;
  view.query("#select-tool").onclick = () => setTool("select");
  view.query("#move-tool").onclick = () => setTool("move");
  view.query("#rotate-tool").onclick = () => setTool("rotate");
  view.query("#explode-view").onclick = editor.toggleExploded;

  return Object.freeze({
    ...pointer,
    cancelConnection,
    keyboard,
    placePending,
    setTool,
  });
}
