import * as THREE from "three";
import { createChallengePanel } from "../presentation/challenge-panel.js";
import { analyzeMissionDesign } from "../presentation/aerothermal-visuals.js";
import { installFailureLab } from "../presentation/failure-lab.js";
import {
  beginChallengeRun,
  createChallengeMachineView,
  createChallengePanelView,
} from "./challenge-state-adapter.js";
import { createSimulationPlaybackController } from "./simulation-playback-controller.js";
import { createWorkshopSimulationSubsystem } from "./workshop-simulation-subsystem.js";
import { createRunMechanismLab } from "./mechanism-lab-feature.js";
import { createTestCourseRecordFeature } from "./test-course-records.js";
import { createWorkshopRunPresentationPort } from "./workshop-run-presentation-port.js";

/** Owns one run session: challenges, playback, failure, controllers, and physics. */
export function createWorkshopRunComposition({
  shell,
  runtime,
  catalog,
  definitions,
  stage,
  assembly,
  persistence,
  controllers,
  editor,
  aerothermal,
  actions,
  environment,
}) {
  const state = shell.state,
    history = persistence.buildHistoryFeature,
    presentation = editor.editorPresentation,
    direct = assembly.controls.directControl;
  let simulation, failure, mechanismLab;

  const machineView = () => {
      const live = state.running ? runtime.telemetry?.run : null;
      return createChallengeMachineView(
        live?.parts?.length ? live.parts : state.parts,
        live?.connections?.length ? live.connections : state.connections,
        catalog,
        state.remoteProfiles,
      );
    },
    challengePanel = createChallengePanel({
      challenges: definitions.challenges,
      getView: () =>
        createChallengePanelView(state, simulation?.demo.snapshot() || null),
      onStart: (id, startMode) => simulation.startChallenge(id, startMode),
      onRetry: () => simulation.retryChallenge(),
    }),
    testCourseRecords = createTestCourseRecordFeature({
      state,
      storage: shell.storage,
      keys: definitions.storageKeys,
      testSite: stage.earth.testSite,
      getRunIdentity: () => runtime.runIdentity,
      getMachine: machineView,
      getParts: () => state.parts,
      notify: shell.notify,
    }),
    playback = createSimulationPlaybackController({
      state,
      getSession: () => runtime.session,
      onTelemetry: (telemetry, completedDt, { forceRecord, present }) => {
        runtime.telemetry = telemetry;
        simulation?.updateChallenge(completedDt, telemetry);
        testCourseRecords.ingest(telemetry);
        failure?.record(telemetry, { force: forceRecord });
        mechanismLab?.recordTelemetry(telemetry);
        if (!present) return;
        assembly.telemetry.presentSensorReadout();
        assembly.telemetry.present(telemetry);
        if (state.editor.selected) presentation.renderInspector();
      },
      render: actions.render,
      notify: shell.notify,
    });

  failure = installFailureLab({
    effectsParent: stage.effects,
    catalog,
    getLiveTelemetry: () => runtime.telemetry,
    isRunning: () => state.running,
    isPaused: () => state.simulationPaused,
    setPaused: (paused) => {
      state.simulationPaused = paused;
      actions.render();
    },
    stepLive: playback.step,
    presentTelemetry: assembly.telemetry.present,
    resetSimulation: () => simulation.reset(),
    notify: shell.notify,
  });

  mechanismLab = createRunMechanismLab({
    runtime,
    assembly,
    catalog,
    persistence,
    state,
    playback,
    getSimulation: () => simulation,
    presentation,
    actions,
    notify: shell.notify,
  });

  const tools = controllers.installTools({
      simulation: {
        step: playback.step,
        toggle: () =>
          state.running ? simulation.stop() : actions.setMode("test"),
      },
      assembly: {
        parts: () => state.parts,
        connections: () => state.connections,
      },
      notify: shell.notify,
    }),
    missionDesign = () =>
      analyzeMissionDesign({
        parts: state.parts.map((part) => ({
          id: part.id,
          type: part.type,
          mesh: part.mesh,
        })),
        connections: state.connections,
        connectionValid: presentation.connectionValid,
      });

  simulation = createWorkshopSimulationSubsystem({
    state,
    runtime,
    definitions: {
      ...definitions,
      machineView,
      beginRun: () =>
        beginChallengeRun(state, definitions.challenges, machineView()),
    },
    history: {
      get suspended() {
        return shell.history.suspended;
      },
      set suspended(value) {
        shell.history.suspended = value;
      },
      record: history.record,
      capture: history.capture,
      restore: history.restore,
      refresh: history.refresh,
    },
    builder: {
      loadBlueprint: persistence.loadBlueprint,
      selectPart: presentation.selectPart,
      clearMachine: assembly.editor.clear,
      enterBuildMode: () => actions.setMode("build"),
      addPart: assembly.editor.add,
      syncAssembly: assembly.workspace.sync,
    },
    controllers: {
      stop: controllers.stop,
      ensureControls: direct.ensureControls,
      bind: controllers.bind,
      compile: controllers.compile,
      stopAll: controllers.stopAll,
      isPowered: assembly.workspace.powered,
      resetSensors: () => controllers.sensorBank.reset(),
      captureSensors: controllers.captureSensors,
      tick: controllers.tick,
      readCommandCandidates: controllers.readCommandCandidates,
      telemetry: controllers.telemetry,
    },
    view: {
      setMission: (name, description) => {
        shell.query("#mission-name").textContent = name;
        shell.query("#mission-desc").textContent = description;
      },
      render: actions.render,
      renderRemote: assembly.controls.renderRemote,
      updateDriveHud: direct.updateHud,
      renderChallengeHud: challengePanel.renderHud,
      closeRemote: () => shell.query(".remote-console").classList.add("hidden"),
      openRemote: () =>
        shell.query(".remote-console").classList.remove("hidden"),
      closeChallengeBrowser: () =>
        shell.query(".challenge-browser").classList.add("hidden"),
      dismissNotice: shell.notify.dismiss,
      notify: shell.notify,
    },
    persistence: { storage: shell.storage, keys: definitions.storageKeys },
    assembly: {
      captureBuild: history.capture,
      restoreBuild: history.restore,
      sync: assembly.workspace.sync,
      snapshot: () => assembly.workspace.model.snapshot(),
      serialize: persistence.serializeBlueprint,
      missionDesign,
      connectionValid: presentation.connectionValid,
    },
    physics: {
      world: stage.world,
      worldAdapter: stage.worldAdapter,
      catalog,
      debrisMaterial: stage.debrisMaterial,
      materialForKey: stage.materialForKey,
      groundMaterial: stage.groundMaterial,
      groundBody: stage.groundBody,
      fieldBody: stage.fieldBody,
      surfaceHeightAt: stage.earth.surfaceHeightAt,
      surfaceSampleAt: stage.earth.surfaceSampleAt,
      terrainHeightAt: stage.earth.terrainHeightAt,
      pondAt: stage.earth.pondAt,
      testSite: stage.earth.testSite,
      testingPlaygroundDeployment: () => state.testDeployment,
      testCourseSelection: () =>
        state.activeTestRouteId ? { routeId: state.activeTestRouteId } : null,
      terrainSize: stage.terrainSize,
      environmentBodyRegistry: stage.environmentBodyRegistry,
      environmentOrigin: () => ({
        x: state.earthOriginEastM,
        y: 0,
        z: state.earthOriginNorthM,
      }),
      ...environment,
      windAt: ({ x, y, z }, elapsedSeconds = state.elapsed) => {
        const velocity = environment.windAt(
          new THREE.Vector3(x, y, z),
          elapsedSeconds,
        );
        return { x: velocity.x, y: velocity.y, z: velocity.z };
      },
      materialForPart: (part) =>
        ["footL", "footR"].includes(part?.rigRole)
          ? stage.footMaterial
          : stage.debrisMaterial,
    },
    presentation: createWorkshopRunPresentationPort({
      shell,
      state,
      runtime,
      stage,
      assembly,
      editor,
      aerothermal,
      failure,
      direct,
      testCourseRecords,
      actions,
    }),
  });

  return Object.freeze({
    simulation,
    demo: simulation.demo,
    playback,
    failure,
    challengePanel,
    tools,
    mechanismLab,
    testCourseRecords,
    runIdentity: () => runtime.runIdentity,
  });
}
