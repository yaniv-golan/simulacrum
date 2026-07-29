import { buildPresentationDebugReadModel } from "../presentation/presentation-debug-read-model.js";

/** Adapts shell and editor state to the runtime's read-only debug view. */
export function createWorkshopRuntimeDebugView({ shell, input, editor }) {
  return Object.freeze({
    learningOpen: () =>
      !shell.query(".learn-center").classList.contains("hidden"),
    coachOpen: () =>
      !shell.query(".discovery-coach").classList.contains("hidden"),
    directVisible: () =>
      !shell.query(".drive-hud").classList.contains("hidden"),
    controllerStatus: () => shell.query("#wasm-status")?.textContent || null,
    mission: () => shell.query("#mission-name").textContent,
    presentation: () =>
      buildPresentationDebugReadModel({
        state: shell.state,
        keyboard: input.keyboard.snapshot,
        selectionVisibility: editor.selectionVisibility.snapshot,
      }),
  });
}
