import { assertBlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { createBlueprint } from "../model/blueprints.js";
import { builtInMechanismSubassemblies } from "../model/built-in-mechanism-subassemblies.js";
import { builtInMissionStageSubassembly } from "../model/demo-blueprints.js";
import { createSubassemblyLibrary } from "../presentation/subassembly-library.js";
import { createBuildHistoryFeature } from "./build-history-feature.js";
import { createBlueprintLoadingFeature } from "./blueprint-loading-feature.js";
import { portableRemoteProfilesFromState } from "./portable-remote-profiles.js";
import { createLazyShareExchangeFeature } from "./lazy-share-exchange-feature.js";
import { createWorkspacePersistence } from "./workspace-persistence.js";

/**
 * Owns the persistence-facing build lifecycle: serialization, loading,
 * reusable subassemblies, exchange packages, and undo/redo restoration.
 * Runtime simulation and editor presentation remain behind injected ports.
 */
export function createBuildPersistenceSubsystem({
  state,
  storage,
  keys,
  definitions,
  assembly,
  editor,
  controllers,
  history,
  identity,
  scene,
  view,
  actions,
}) {
  let blueprintExchange;

  const serializeBlueprint = (
    name = state.blueprintName || "Untitled machine",
  ) => {
    controllers.saveActive();
    // The AssemblyModel is the authored source of truth while a run is active.
    // Runtime presentation poses deliberately mutate meshes, so reading them
    // back through assembly.sync() would turn simulated deformation into
    // authored blueprint data.
    if (!state.running) assembly.sync();
    return createBlueprint(assembly.model, {
      extensions: state.blueprintExtensions,
      name,
      created: state.blueprintCreated,
      demo: state.demo,
      remoteProfiles: portableRemoteProfilesFromState(state),
      defaultRemoteProfile: state.remoteProfile || null,
    });
  };

  const subassemblyLibrary = createSubassemblyLibrary({
    state,
    catalog: definitions.catalog,
    builtIns: [
      ...builtInMechanismSubassemblies(),
      builtInMissionStageSubassembly({
        typescript: definitions.missionTsSource,
        wat: definitions.defaultWatSource,
      }),
    ],
    storage,
    storageKey: keys.subassemblies,
    $: view.query,
    $$: view.queryAll,
    selectedParts: editor.selectedParts,
    editorSnapshot: assembly.editorSnapshot,
    recordHistory: history.record,
    history: history.store,
    addPart: editor.addPart,
    atlasFootPart: editor.prepareFoot,
    getNextId: identity.get,
    setNextId: identity.set,
    afterPlacement: (made) => {
      assembly.sync();
      editor.drawConnections();
      editor.showSelection(made[0]);
      view.render();
    },
    toast: view.notify,
  });

  const blueprintLoadingFeature = createBlueprintLoadingFeature({
    state,
    storage,
    types: definitions.catalog,
    controlTemplates: definitions.controlTemplates,
    defaultWatSource: definitions.defaultWatSource,
    defaultTsSource: definitions.defaultTsSource,
    newControllerSources: controllers.defaultSources,
    componentMesh: editor.createMesh,
    atlasFootPart: editor.prepareFoot,
    machine: scene.machine,
    buildHistory: history.store,
    getIdSeq: identity.get,
    setIdSeq: identity.set,
    stopAllControllerRuntimes: controllers.stopAll,
    stopSimulation: actions.stopSimulation,
    bindScriptController: controllers.bind,
    renderScriptEditor: controllers.renderEditor,
    getBlueprintExchange: () => blueprintExchange,
    syncAssemblyModel: assembly.sync,
    drawWires: editor.drawConnections,
    showSelection: editor.showSelection,
    renderUI: view.render,
    renderRemote: view.renderRemote,
    refreshHistoryUI: history.refresh,
    captureBuildState: history.capture,
    toast: view.notify,
    applyEditorAction: actions.applyEditorAction,
  });

  /** @param {unknown} data @param {{acquisition?:string}} [options] */
  const loadBlueprint = (data, { acquisition } = {}) => {
    assertBlueprintAcquisition(acquisition);
    return blueprintLoadingFeature.loadBlueprint(data, { acquisition });
  };

  const saveWorkspace = createWorkspacePersistence({
    state,
    storage,
    workspaceKey: keys.workspace,
    getIdSeed: identity.get,
    serializeBlueprint,
  });

  blueprintExchange = createLazyShareExchangeFeature({
    notify: view.notify,
    installOptions: {
      storage,
      keys,
      state,
      serializeBlueprint,
      loadBlueprint,
      sourceCanvas: scene.sourceCanvas,
      subassemblyLibrary,
    },
  });
  blueprintExchange.importLocationHash();

  const buildHistoryFeature = createBuildHistoryFeature({
    store: state,
    history: history.store,
    parts: {
      nextId: identity.get,
      setNextId: identity.set,
      add: editor.addPart,
      stopSimulation: actions.stopSimulation,
      clear: editor.clearMachine,
      setMode: actions.setEditorMode,
      prepareAtlasFoot: editor.prepareFoot,
      select: actions.select,
      sync: () => {
        assembly.sync();
        editor.drawConnections();
      },
      showSelection: editor.showSelection,
    },
    controllers: {
      saveActive: controllers.saveActive,
      active: controllers.active,
      bind: controllers.bind,
      render: controllers.renderEditor,
    },
    view: {
      missionName: view.missionName,
      missionDescription: view.missionDescription,
      setMission: view.setMission,
      presentHistory: view.presentHistory,
      render: view.render,
      renderRemote: view.renderRemote,
      persistWorkspace: saveWorkspace,
      notify: view.notify,
    },
  });

  return Object.freeze({
    serializeBlueprint,
    saveWorkspace,
    loadBlueprint,
    blueprintLoadingFeature,
    restoreWorkspace: blueprintLoadingFeature.restoreWorkspace,
    subassemblyLibrary,
    blueprintExchange,
    buildHistoryFeature,
  });
}
