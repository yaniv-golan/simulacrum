import { WORKSHOP_AXIS_PRESENTATION } from "./workshop-axis-presentation.js";

/** Projects one gizmo transaction into bounded visible and assistive feedback. */
export function createTransformGizmoFeedback({ root }) {
  const title = root?.querySelector("b"),
    values = root?.querySelector("span:not(.assistive-commit)"),
    assistive = root?.querySelector(".assistive-commit");
  function present(operation) {
    const axis = WORKSHOP_AXIS_PRESENTATION.find(
      (candidate) => candidate.id === operation.axis?.toLowerCase(),
    );
    if (
      !root ||
      !axis ||
      operation.mode !== "translate" ||
      !operation.active ||
      !operation.pivot ||
      !operation.delta
    ) {
      root?.classList.add("hidden");
      return;
    }
    const current = operation.pivot[axis.index],
      delta = operation.delta[axis.index];
    title.textContent = `${axis.letter} · ${axis.meaning}`;
    values.textContent = `${current.toFixed(2)} m · Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} m`;
    root.dataset.axis = axis.id;
    root.classList.remove("hidden");
  }
  function finish(operation, changed) {
    root?.classList.add("hidden");
    if (!changed || !assistive) return;
    const axis = WORKSHOP_AXIS_PRESENTATION.find(
      (candidate) => candidate.id === operation.axis?.toLowerCase(),
    );
    if (axis && operation.delta)
      assistive.textContent = `${axis.letter} movement committed, ${operation.delta[axis.index].toFixed(2)} metres`;
  }
  return Object.freeze({ finish, present });
}
