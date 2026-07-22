import { applyEditorAction } from "../model/application-state.js";

/** Owns transitions between build, connection, and simulation workspace modes. */
export function createWorkshopModeController({
  state,
  queryAll,
  simulation,
  clearExploded,
}) {
  return function setMode(mode) {
    if (mode !== "build" && (state.exploded || state.explodeAmount > 0.001))
      clearExploded();
    applyEditorAction(state.editor, { type: "set-mode", mode });
    queryAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (mode === "test" && !state.running) return simulation.start();
    if (mode !== "test" && state.running) return simulation.stop();
    return undefined;
  };
}
