import {
  createWorkshopUiPresenter,
  createWorkshopUiView,
} from "../presentation/workspace-chrome.js";
import { installEngineeringOverlays } from "../presentation/engineering-overlays.js";

/**
 * Owns workshop-wide UI projection and engineering-overlay presentation.
 * Feature callbacks are lazy because persistence and challenge composition are
 * installed after the editor and assembly presentation ports they consume.
 */
export function createWorkshopUiComposition({
  shell,
  state,
  catalog,
  stage,
  assembly,
  editor,
  features,
}) {
  const engineering = installEngineeringOverlays({
      machine: stage.machine,
      effects: stage.effects,
      catalogElement: shell.query(".catalog"),
      componentCatalog: catalog,
      getSnapshot: () => ({
        parts: assembly.workspace.editorSnapshot(),
        connections: structuredClone(state.connections),
      }),
      getParts: () => state.parts,
      onOpen: () => shell.chrome.setPrimaryPanel("catalog"),
    }),
    presenter = createWorkshopUiPresenter({
      model: {
        parts: () => state.parts,
        connections: () => state.connections,
        running: () => state.running,
        starting: () => state.simulationStarting,
        paused: () => state.simulationPaused,
        timeScale: () => state.timeScale,
      },
      view: createWorkshopUiView({
        query: shell.query,
        library: (category) =>
          features.persistence()?.subassemblyLibrary.render(category),
        inspector: editor.editorPresentation.renderInspector,
        driveHud: assembly.controls.directControl.updateHud,
        history: () => features.persistence()?.buildHistoryFeature.refresh(),
        challenge: () => features.run()?.challengePanel.renderHud(),
        engineering: {
          setRunning: (running) => engineering.setRunning(running),
          refresh: () => engineering.refresh(),
        },
      }),
    });

  return Object.freeze({
    engineering,
    render: () => presenter.render(),
  });
}
