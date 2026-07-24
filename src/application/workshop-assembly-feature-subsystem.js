import { prepareArticulatedFootVisual } from "../presentation/articulated-foot-visual.js";
import { componentMesh } from "../presentation/component-mesh-factory.js";
import { createSimulationTelemetryPresenter } from "../presentation/simulation-telemetry-presenter.js";
import { createAssemblyCapabilityReader } from "./assembly-capability-reader.js";
import { createAssemblyEditorFeature } from "./assembly-editor-feature.js";
import { createAssemblyWorkspace } from "./assembly-workspace.js";
import { createControlSurfaceSubsystem } from "./control-surface-subsystem.js";
import { createTelemetrySnapshot } from "../simulation/telemetry.js";
import { remoteActionTargetPartIds } from "../model/remote-actions.js";

/** Composes assembly model access, editing, capabilities, controls, and telemetry. */
export function createWorkshopAssemblyFeatureSubsystem({
  state,
  runtime,
  model,
  catalog,
  controlTemplates,
  history,
  controller,
  simulation,
  presentation,
  identity,
  view,
  actions,
}) {
  const capabilities = createAssemblyCapabilityReader({
      assembly: {
        revision: () => model.revision,
        snapshot: () => model.snapshot(),
      },
      catalog,
      editor: {
        running: () => state.running,
        parts: () => state.parts,
        connections: () => state.connections,
      },
      runtime: { multibody: () => runtime.multibodyRuntime },
    }),
    workspace = createAssemblyWorkspace({
      model,
      catalog,
      editor: {
        parts: () => state.parts,
        connections: () => state.connections,
      },
      simulation: {
        running: () => state.running,
        telemetry: () => runtime.telemetry,
      },
      presentation: presentation.performance,
      capabilities,
    }),
    controls = createControlSurfaceSubsystem({
      state,
      controlTemplates,
      telemetry: () => runtime.telemetry,
      workspace: {
        readControlBinding: (control) => workspace.controlBinding(control),
        resolveControlTarget: (control) =>
          workspace.resolveControlTarget(control),
        isControlOnline: (control) => workspace.isControlOnline(control),
      },
      view: view.controls,
    }),
    telemetry = createSimulationTelemetryPresenter({
      model: {
        parts: () => state.parts,
        connections: () => state.connections,
        selectedId: () => state.editor.selected,
        latest: () => runtime.telemetry,
        connectionValid: actions.connectionValid,
        mobilityTargetPartIds: () => {
          const profile = state.remoteProfiles[state.remoteProfile],
            controls = state.remoteControls[state.remoteProfile] || [];
          return remoteActionTargetPartIds(profile, controls);
        },
      },
      scene: presentation.scene,
      view: {
        query: view.query,
        renderInspector: view.renderInspector,
        setLights: controls.directControl.setLights,
        updateDriveHud: controls.updateDriveHud,
        presentAerothermal: presentation.presentAerothermal,
        drawConnections: view.drawConnections,
        notify: view.notify,
      },
    }),
    editor = createAssemblyEditorFeature({
      workspace: createEditorStatePort(state),
      history,
      controllers: {
        stopAll: controller.stopAll,
        stopOne: controller.stopOne,
      },
      simulation: {
        destroyFlight: simulation.destroyFlight,
        disposeTerrain: () => {
          runtime.terrainCollisionStream?.dispose();
          runtime.terrainCollisionStream = null;
        },
        disposeMultibody: () => {
          runtime.multibodyRuntime?.dispose();
          runtime.multibodyRuntime = null;
        },
        clearRuntimeTelemetry: () => {
          runtime.telemetry = createTelemetrySnapshot({
            assembly: model.snapshot(),
          });
        },
      },
      view: {
        machine: presentation.scene.machine,
        createMesh: componentMesh,
        newControllerSources: controller.defaultSources,
        prepareFoot: prepareArticulatedFootVisual,
        resetExploded: presentation.resetExploded,
        select: actions.select,
        showSelection: view.showSelection,
        clearEffect: view.clearEffect,
        syncAssembly: workspace.sync,
        drawConnections: view.drawConnections,
        render: view.render,
        setMode: actions.setMode,
        setMission: view.setMission,
        hideDriveHud: view.hideDriveHud,
        notify: view.notify,
      },
      context: {
        resetChallenge: actions.resetChallenge,
        assemblyReplaced: actions.assemblyReplaced,
      },
      catalog,
      workspaceSnapshot: () => ({
        parts: workspace.editorSnapshot(),
        connections: structuredClone(state.connections),
      }),
      getNextId: identity.get,
      setNextId: identity.set,
    });

  return Object.freeze({
    workspace,
    capabilities,
    controls,
    telemetry,
    editor,
    createMesh: componentMesh,
    prepareFoot: prepareArticulatedFootVisual,
  });
}

function createEditorStatePort(state) {
  return {
    get parts() {
      return state.parts;
    },
    set parts(value) {
      state.parts = value;
    },
    get connections() {
      return state.connections;
    },
    set connections(value) {
      state.connections = value;
    },
    get running() {
      return state.running;
    },
    get selectedId() {
      return state.editor.selected;
    },
    get selectedIds() {
      return state.editor.selectedIds;
    },
    get selectedEntity() {
      return state.editor.selectedEntity;
    },
    get lastTransformOperation() {
      return state.editor.lastTransformOperation;
    },
    set lastTransformOperation(value) {
      state.editor.lastTransformOperation = value;
    },
    get scriptControllerId() {
      return state.scriptControllerId;
    },
    set scriptControllerId(value) {
      state.scriptControllerId = value;
    },
    get demo() {
      return state.demo;
    },
    set demo(value) {
      state.demo = value;
    },
    get activeChallenge() {
      return state.activeChallenge;
    },
    set activeChallenge(value) {
      state.activeChallenge = value;
    },
    get challengeStatus() {
      return state.challengeStatus;
    },
    set challengeStatus(value) {
      state.challengeStatus = value;
    },
    get challengeStartMode() {
      return state.challengeStartMode;
    },
    set challengeStartMode(value) {
      state.challengeStartMode = value;
    },
  };
}
