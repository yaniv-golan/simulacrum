import { createSelectionVisibilityController } from "../presentation/selection-visibility-controller.js";

/** Composes transient selected-part visibility without authored-state access. */
export function createEditorSelectionVisibility({
  state,
  scene,
  camera,
  editorPresentation,
  view,
}) {
  return createSelectionVisibilityController({
    model: {
      parts: () => state.parts,
      selectedIds: () => state.editor.selectedIds,
    },
    scene: { wires: scene.wires },
    camera,
    actions: {
      renderInspector: editorPresentation.renderInspector,
      notify: view.notify,
      focus: (selector) => view.query(selector)?.focus(),
    },
  });
}
