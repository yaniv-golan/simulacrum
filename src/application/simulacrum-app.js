import { AssemblyModel } from "../model/assembly-model.js";
import { TYPES } from "../model/component-catalog.js";
import { DEFAULT_VISUAL_PROGRAM } from "../model/visual-logic.js";
import {
  CHALLENGES,
  CONTROLLER_CHANNELS,
  CONTROL_TEMPLATES,
  DEFAULT_TS_SOURCE,
  DEFAULT_WAT_SOURCE,
  DISCOVERY_STEPS,
  DRONE_TS_SOURCE,
  LEARN_TOPICS,
  MISSION_TS_SOURCE,
} from "./content.js";
import { applyEditorAction } from "../model/application-state.js";
import { STORAGE_KEYS } from "./workshop-state.js";
import {
  createWorkshopBuildComposition,
  createWorkshopAssemblyComposition,
  createWorkshopShellSubsystem,
  installWorkshopRuntimeComposition,
  installWorkshopInputComposition,
  createWorkshopRunComposition,
  createWorkshopControllerComposition,
  createSimulationRuntimeState,
  createWorkshopEditorStageComposition,
  createWorkshopExperienceComposition,
  createWorkshopUiComposition,
  createWorkshopModeController,
  connectSelectedWithRope as connectRope,
} from "./editor-features.js";
import "../style.css";
let directControlFeature = null,
  buildHistoryFeature,
  assemblyWorkspace = null,
  simulationWorkshop,
  assemblyFeatureSubsystem,
  idSeq = 1,
  uiComposition,
  experienceComposition;
const renderUI = () => uiComposition?.render(),
  ropeBridge = {};
const shell = createWorkshopShellSubsystem({
    root: document.querySelector("#app"),
    definitions: {
      controlTemplates: CONTROL_TEMPLATES,
      defaultWatSource: DEFAULT_WAT_SOURCE,
      defaultTsSource: DEFAULT_TS_SOURCE,
      defaultVisualProgram: DEFAULT_VISUAL_PROGRAM,
    },
    onLayoutChange: () =>
      requestAnimationFrame(() => directControlFeature?.renderSurface()),
  }),
  { queryAll: $$, state } = shell;
const partHasPower = (part) => assemblyWorkspace?.powered(part) || false;
const simulationRuntime = createSimulationRuntimeState(),
  controllerSubsystem = createWorkshopControllerComposition({
    shell,
    runtime: simulationRuntime,
    definitions: { channels: CONTROLLER_CHANNELS },
    power: { isPowered: partHasPower },
    environment: {
      sampleWind: (position, time) =>
        editorStageComposition.environment.windAt(position, time),
    },
    view: { render: renderUI },
  });
const buildHistoryState = (snapshot) =>
    snapshot === undefined
      ? buildHistoryFeature.capture()
      : buildHistoryFeature.restore(snapshot),
  refreshHistoryUI = () => buildHistoryFeature.refresh(),
  recordHistory = (label, snapshot = null) =>
    buildHistoryFeature.record(label, snapshot);
const assemblyModel = new AssemblyModel(),
  startSimulation = (preserveBaseline = false) =>
    simulationWorkshop.start(preserveBaseline),
  stopSimulation = () => simulationWorkshop.stop(),
  resetSimulation = () => simulationWorkshop.reset(),
  destroyComponentFlightPhysics = () =>
    simulationWorkshop?.destroyFlightPhysics();
const syncAssemblyModel = () => assemblyWorkspace.sync(),
  currentConnections = () =>
    assemblyWorkspace?.currentConnections() || state.connections,
  currentPart = (id) =>
    assemblyWorkspace?.currentPart(id) ||
    state.parts.find((part) => part.id === id) ||
    null;
const setExplodedView = (...args) =>
    editorStageComposition.editor.exploded.set(...args),
  tutorialEvent = (event) => experienceComposition?.tutorial.accept(event),
  isHumanoidLayoutForPresentation = () =>
    assemblyCapabilities.hasHumanoidLayout(),
  updateDriveHUD = () => directControlFeature?.updateHud(),
  setMode = createWorkshopModeController({
    state,
    queryAll: $$,
    simulation: { start: startSimulation, stop: stopSimulation },
    clearExploded: () => setExplodedView(false, true),
  });
const editorStageComposition = createWorkshopEditorStageComposition({
    shell,
    catalog: TYPES,
    keys: STORAGE_KEYS,
    runtime: simulationRuntime,
    controller: { open: controllerSubsystem.open },
    history: { capture: buildHistoryState, record: recordHistory },
    assembly: {
      sync: syncAssemblyModel,
      currentConnections,
      currentPart,
      powered: partHasPower,
    },
    actions: {
      prepareFoot: (part) => atlasFootPart(part),
      setMode,
      tutorialEvent,
      humanoidLayout: isHumanoidLayoutForPresentation,
      connectWithRope: connectRope(ropeBridge),
    },
    view: {
      refreshEngineering: () => uiComposition?.engineering.refresh(),
      updateDriveHud: updateDriveHUD,
      render: renderUI,
    },
  }),
  stageFoundation = editorStageComposition.stage,
  editorPresentationComposition = editorStageComposition.editor,
  aerothermalVisuals = editorStageComposition.aerothermal;
assemblyFeatureSubsystem = createWorkshopAssemblyComposition({
  shell,
  runtime: simulationRuntime,
  model: assemblyModel,
  definitions: { catalog: TYPES, controlTemplates: CONTROL_TEMPLATES },
  history: {
    capture: buildHistoryState,
    restore: buildHistoryState,
    record: recordHistory,
  },
  controllers: controllerSubsystem,
  presentation: editorStageComposition,
  simulation: { destroyFlight: destroyComponentFlightPhysics },
  identity: {
    get: () => idSeq,
    set: (value) => {
      idSeq = value;
    },
  },
  actions: {
    setMode,
    resetChallenge: () => runComposition?.demo.resetRunState(),
    assemblyReplaced: () =>
      buildPersistenceSubsystem?.blueprintExchange.assemblyReplaced(),
  },
  view: { render: renderUI },
});
const {
  workspace: resolvedAssemblyWorkspace,
  capabilities: assemblyCapabilities,
  controls: resolvedControlSurfaceSubsystem,
  prepareFoot: atlasFootPart,
} = assemblyFeatureSubsystem;
assemblyWorkspace = resolvedAssemblyWorkspace;
ropeBridge.editor = assemblyFeatureSubsystem.editor;
directControlFeature = resolvedControlSurfaceSubsystem.directControl;
uiComposition = createWorkshopUiComposition({
  shell,
  state,
  catalog: TYPES,
  stage: stageFoundation,
  assembly: assemblyFeatureSubsystem,
  editor: editorPresentationComposition,
  features: {
    persistence: () => buildPersistenceSubsystem,
    run: () => runComposition,
  },
});
const buildPersistenceSubsystem = createWorkshopBuildComposition({
  shell,
  definitions: {
    keys: STORAGE_KEYS,
    catalog: TYPES,
    controlTemplates: CONTROL_TEMPLATES,
    defaultWatSource: DEFAULT_WAT_SOURCE,
    defaultTsSource: DEFAULT_TS_SOURCE,
    missionTsSource: MISSION_TS_SOURCE,
  },
  assembly: assemblyFeatureSubsystem,
  editor: editorPresentationComposition,
  controllers: controllerSubsystem,
  stage: stageFoundation,
  history: {
    capture: buildHistoryState,
    record: recordHistory,
    refresh: refreshHistoryUI,
  },
  identity: {
    get: () => idSeq,
    set: (value) => {
      idSeq = value;
    },
  },
  actions: { stopSimulation },
  view: { render: renderUI },
});
buildHistoryFeature = buildPersistenceSubsystem.buildHistoryFeature;
resolvedControlSurfaceSubsystem.setWorkspacePersistence(
  buildPersistenceSubsystem.saveWorkspace,
);
const runComposition = createWorkshopRunComposition({
  shell,
  runtime: simulationRuntime,
  catalog: TYPES,
  definitions: {
    challenges: CHALLENGES,
    controlTemplates: CONTROL_TEMPLATES,
    demoSources: {
      wat: DEFAULT_WAT_SOURCE,
      typescript: MISSION_TS_SOURCE,
      droneTypescript: DRONE_TS_SOURCE,
    },
    storageKeys: STORAGE_KEYS,
  },
  stage: stageFoundation,
  assembly: assemblyFeatureSubsystem,
  persistence: buildPersistenceSubsystem,
  controllers: controllerSubsystem,
  editor: editorPresentationComposition,
  aerothermal: aerothermalVisuals,
  actions: {
    render: renderUI,
    setMode,
    tutorialEvent,
    applyEditorAction,
  },
  environment: {
    karmanLineM: editorStageComposition.environment.karmanLineM,
    latitude: editorStageComposition.environment.latitude,
    longitude: editorStageComposition.environment.longitude,
    windAt: editorStageComposition.environment.windAt,
  },
});
simulationWorkshop = runComposition.simulation;
buildPersistenceSubsystem.restoreWorkspace();
const editorInputComposition = installWorkshopInputComposition({
  target: window,
  shell,
  catalog: TYPES,
  stage: stageFoundation,
  editor: editorPresentationComposition,
  assembly: assemblyFeatureSubsystem,
  persistence: buildPersistenceSubsystem,
  playback: runComposition.playback,
  actions: {
    resetSimulation,
    openLearningCenter: () => experienceComposition.openLearningCenter(),
    render: renderUI,
    setMode,
    tutorialEvent,
  },
});
experienceComposition = createWorkshopExperienceComposition({
  shell,
  stage: stageFoundation,
  keys: STORAGE_KEYS,
  content: { topics: LEARN_TOPICS, discoverySteps: DISCOVERY_STEPS },
  editor: editorPresentationComposition,
  assembly: assemblyFeatureSubsystem,
  persistence: buildPersistenceSubsystem,
  run: runComposition,
  controllers: controllerSubsystem,
  environment: {
    setTime: editorStageComposition.environment.setTime,
    setWind: editorStageComposition.environment.setWind,
  },
  actions: { render: renderUI, setMode },
});
installWorkshopRuntimeComposition({
  target: window,
  shell,
  model: assemblyModel,
  runtime: simulationRuntime,
  stage: stageFoundation,
  editor: editorPresentationComposition,
  input: editorInputComposition,
  engineering: uiComposition.engineering,
  exchange: buildPersistenceSubsystem.blueprintExchange,
  failure: runComposition.failure,
  mechanismLab: runComposition.mechanismLab,
  challenge: runComposition.demo,
  learningTopicCount: LEARN_TOPICS.length,
  assembly: assemblyFeatureSubsystem,
  controllers: controllerSubsystem,
  playback: runComposition.playback,
  testingPlayground: experienceComposition.testingPlayground,
  view: { renderUi: renderUI },
  environment: {},
});
