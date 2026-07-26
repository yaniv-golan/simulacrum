import { createTransformGizmoController } from "../presentation/transform-gizmo-controller.js";
import { createTransformGizmoFeedback } from "../presentation/transform-gizmo-feedback.js";

/** Composes DOM feedback around the DOM-free gizmo transaction projection. */
export function createWorkshopTransformGizmo(ports) {
  const feedback = createTransformGizmoFeedback({
    root: ports.view.query(".gizmo-drag-readout"),
  });
  return createTransformGizmoController({
    ...ports,
    view: {
      ...ports.view,
      finishOperation: feedback.finish,
      presentOperation: feedback.present,
    },
  });
}
