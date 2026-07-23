import { applyEditorAction } from "../model/application-state.js";
import { installLocalDataSettings } from "../presentation/local-data-settings.js";
import { createTestingPlaygroundComposition } from "./testing-playground-composition.js";
import { installWorkshopUseCaseSubsystem } from "./workshop-use-case-subsystem.js";

/** Maps feature facades into learning, tutorial, and workshop command use cases. */
export function createWorkshopExperienceComposition({
  shell,
  stage,
  keys,
  content,
  editor,
  assembly,
  persistence,
  run,
  controllers,
  environment,
  actions,
}) {
  const state = shell.state,
    presentation = editor.editorPresentation,
    history = persistence.buildHistoryFeature,
    controls = assembly.controls,
    trust = run.tools.trust;
  const testingPlayground = createTestingPlaygroundComposition({
    shell,
    stage,
    assembly,
    persistence,
    editor,
    run,
    actions,
  });
  const experience = installWorkshopUseCaseSubsystem({
    state,
    storage: shell.storage,
    keys,
    content,
    editor: {
      clearMachine: assembly.editor.clear,
      clearBuildPlate: assembly.editor.clearBuildPlate,
      clearSelection: () => {
        applyEditorAction(state.editor, { type: "select", id: null });
        presentation.showSelection(null);
        presentation.renderInspector();
      },
      renderLibrary: (category) =>
        persistence.subassemblyLibrary.render(category),
      undo: history.undo,
      redo: history.redo,
      removeSelection: assembly.editor.removeSelection,
      duplicateSelection: assembly.editor.duplicate,
      mirrorSelection: assembly.editor.mirror,
    },
    simulation: {
      stop: run.simulation.stop,
      pause: run.playback.togglePause,
      cycleSpeed: run.playback.cycleSpeed,
      reset: run.simulation.reset,
    },
    demos: { load: run.simulation.loadDemo },
    challenges: {
      renderBrowser: run.challengePanel.renderBrowser,
      resetRunState: run.demo.resetRunState,
    },
    remote: {
      render: controls.renderRemote,
      persist: controls.persistRemotes,
      persistDirectSurface: controls.directControl.persistSurfaces,
    },
    environment,
    blueprints: { open: persistence.blueprintExchange.open },
    controller: {
      open: controllers.open,
      save: controllers.save,
      setLanguage: controllers.setLanguage,
      compile: controllers.compile,
      trust: trust.enable,
      stop: controllers.stop,
      active: controllers.activeController,
      invalidate: trust.invalidate,
    },
    view: {
      query: shell.query,
      queryAll: shell.queryAll,
      show: (selector) => shell.query(selector).classList.remove("hidden"),
      hidden: (selector) => shell.query(selector).classList.contains("hidden"),
      click: (selector) => shell.query(selector).click(),
      notify: shell.notify,
    },
    actions,
  });
  installLocalDataSettings({
    query: shell.query,
    reset: () => shell.storage.resetNamespace(),
    notify: shell.notify,
  });
  return Object.freeze({ ...experience, testingPlayground });
}
