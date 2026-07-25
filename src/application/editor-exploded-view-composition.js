import { createExplodedViewController } from "../presentation/exploded-view-controller.js";

/** Composes the presentation-only exploded-view controller. */
export function createEditorExplodedView({
  state,
  capabilities,
  scene,
  world,
  transform,
  view,
  editorPresentation,
  explodedState,
}) {
  return createExplodedViewController({
    model: {
      state: explodedState,
      running: () => state.running,
      parts: () => state.parts,
      connections: () => state.connections,
      selectedId: () => state.editor.selected,
      humanoidLayout: capabilities.humanoidLayout,
    },
    view: {
      cameraTarget: scene.cameraTarget,
      offsetCameraDistance: world.cameraController.offsetDistance,
      transform,
      query: view.query,
    },
    actions: {
      connectionValid: editorPresentation.connectionValid,
      drawConnections: editorPresentation.drawConnections,
      updateSelection: editorPresentation.updateSelection,
      updateHover: editorPresentation.selection.updateHover,
      showSelection: editorPresentation.showSelection,
      updateDriveHud: view.updateDriveHud,
      notify: view.notify,
    },
  });
}
