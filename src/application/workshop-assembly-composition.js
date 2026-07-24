import { applyEditorAction } from "../model/application-state.js";
import { createWorkshopAssemblyFeatureSubsystem } from "./workshop-assembly-feature-subsystem.js";

/** Maps shell, editor, controller, and runtime ports into assembly features. */
export function createWorkshopAssemblyComposition({
  shell,
  runtime,
  model,
  definitions,
  history,
  controllers,
  presentation,
  simulation,
  identity,
  actions,
  view,
}) {
  const state = shell.state,
    editorPresentation = presentation.editor.editorPresentation;
  let assembly;

  assembly = createWorkshopAssemblyFeatureSubsystem({
    state,
    runtime,
    model,
    catalog: definitions.catalog,
    controlTemplates: definitions.controlTemplates,
    history: {
      get suspended() {
        return shell.history.suspended;
      },
      set suspended(value) {
        shell.history.suspended = value;
      },
      record: history.record,
    },
    controller: {
      stopAll: controllers.stopAll,
      stopOne: controllers.stop,
      defaultSources: shell.newControllerSources,
    },
    presentation: presentation.assemblyPresentation,
    simulation,
    identity,
    view: {
      query: shell.query,
      queryAll: shell.queryAll,
      controls: {
        query: shell.query,
        queryAll: shell.queryAll,
        openAdvanced: () => {
          state.remoteEdit = true;
          shell.query(".remote-console").classList.remove("hidden");
          assembly.controls.renderRemote();
        },
      },
      renderInspector: editorPresentation.renderInspector,
      showSelection: editorPresentation.showSelection,
      clearEffect: editorPresentation.clearEffect,
      drawConnections: editorPresentation.drawConnections,
      render: view.render,
      setMission: (title, description) => {
        shell.query("#mission-name").textContent = title;
        shell.query("#mission-desc").textContent = description;
      },
      hideDriveHud: () => shell.query(".drive-hud").classList.add("hidden"),
      notify: shell.notify,
    },
    actions: {
      connectionValid: editorPresentation.connectionValid,
      select: (ids, primary) =>
        applyEditorAction(state.editor, { type: "select", ids, id: primary }),
      setMode: actions.setMode,
      resetChallenge: actions.resetChallenge,
      assemblyReplaced: actions.assemblyReplaced,
    },
  });

  return assembly;
}
