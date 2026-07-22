import {
  installLearningCenter,
  installTutorialController,
} from "../presentation/learning-center.js";
import { installWorkshopCommandController } from "../presentation/workshop-command-controller.js";
import { nextRemoteControlId } from "./remote-control-state.js";
import { BrowserDiscoveryRepository } from "./local-settings-repositories.js";

/** Composes learning, tutorial, and static workshop command use cases. */
export function installWorkshopUseCaseSubsystem({
  state,
  storage,
  keys,
  content,
  editor,
  simulation,
  demos,
  challenges,
  remote,
  environment,
  blueprints,
  controller,
  view,
  actions,
}) {
  let tutorial;
  const discoveryRepository = new BrowserDiscoveryRepository({
    storage,
    key: keys.discovery,
  });
  const learning = installLearningCenter({
      topics: content.topics,
      discoverySteps: content.discoverySteps,
      ui: state,
      persistence: {
        load: () => discoveryRepository.load(),
        setTipsEnabled: (enabled) =>
          discoveryRepository.setTipsEnabled(enabled),
        setComplete: (complete) => discoveryRepository.setComplete(complete),
      },
      actions: {
        beginTutorial: () => tutorial?.begin(),
        enterBuild: () => actions.setMode("build"),
        loadDemo: demos.load,
        openRemote: () => {
          view.show(".remote-console");
          remote.render();
        },
        openCamera: () => {
          if (view.hidden(".camera-help-card")) view.click("#camera-help");
        },
        openScript: () => view.show(".wasm-console"),
        openBlueprints: blueprints.open,
        openChallenges: () => {
          challenges.renderBrowser();
          view.show(".challenge-browser");
        },
        openDemos: () => view.show(".demo-browser"),
        openEnvironment: () => view.show(".environment-panel"),
        notify: view.notify,
      },
    }),
    { open: openLearningCenter, showFirstRun: showFirstRunDiscovery } =
      learning;

  tutorial = installTutorialController({
    model: {
      step: () => state.tutorial,
      setStep: (step) => {
        state.tutorial = step;
      },
    },
    actions: {
      clearMachine: editor.clearMachine,
      hasMachine: () => state.parts.length > 0,
      renderLibrary: editor.renderLibrary,
      loadDemo: demos.load,
      openLearning: openLearningCenter,
      showDiscovery: showFirstRunDiscovery,
      notify: view.notify,
    },
    view: { query: view.query, queryAll: view.queryAll },
  });

  installWorkshopCommandController({
    view: { query: view.query, queryAll: view.queryAll },
    catalog: { render: editor.renderLibrary },
    workshop: {
      running: () => state.running,
      setMode: actions.setMode,
      stop: simulation.stop,
      pause: simulation.pause,
      cycleSpeed: simulation.cycleSpeed,
      reset: simulation.reset,
      undo: editor.undo,
      redo: editor.redo,
      clear: editor.clearBuildPlate,
      clearSelection: editor.clearSelection,
      removeSelection: editor.removeSelection,
      duplicateSelection: editor.duplicateSelection,
      mirrorSelection: editor.mirrorSelection,
    },
    remote: {
      render: remote.render,
      setProfile: (profile) => {
        state.remoteProfile = profile;
        state.remoteEdit = false;
        remote.render();
      },
      toggleEdit: () => {
        state.remoteEdit = !state.remoteEdit;
        remote.render();
      },
      addAuxiliary: () => {
        const controls = state.remoteControls[state.remoteProfile],
          number = controls.length + 1;
        controls.push({
          id: nextRemoteControlId(state.remoteProfile, controls),
          label: `Auxiliary ${number}`,
          channel: `aux_${number}`,
          type: "range",
          min: -1,
          max: 1,
          step: 0.05,
          value: 0,
          defaultValue: 0,
          targetId: null,
          hotkey: null,
        });
        state.remoteEdit = true;
        remote.persist();
        remote.render();
      },
      toggleDirectSurface: () => {
        state.directSurfaces[state.remoteProfile] =
          !state.directSurfaces[state.remoteProfile];
        remote.persistDirectSurface();
        remote.render();
      },
    },
    environment,
    browser: {
      renderChallenges: challenges.renderBrowser,
      loadDemo: demos.load,
      resetChallenge: () => {
        state.activeChallenge = null;
        state.challengeStatus = "idle";
        state.challengeStartMode = null;
        challenges.resetRunState();
      },
      openBlueprints: blueprints.open,
    },
    script: {
      open: controller.open,
      save: controller.save,
      setLanguage: controller.setLanguage,
      compile: controller.compile,
      trust: controller.trust,
      stop: controller.stop,
      invalidate: () => {
        const active = controller.active();
        if (active) controller.invalidate(active);
      },
    },
  });

  return Object.freeze({
    learning,
    tutorial,
    openLearningCenter,
    showFirstRunDiscovery,
  });
}
