import { createExplodedViewController } from "../presentation/exploded-view-controller.js";
import { createTransformGizmoController } from "../presentation/transform-gizmo-controller.js";
import { createEditorPresentationSubsystem } from "./editor-presentation-subsystem.js";
import { createWorldPresentationSubsystem } from "./world-presentation-subsystem.js";

/** Composes editor visuals, transforms, world interaction, and exploded view. */
export function createWorkshopEditorPresentationSubsystem({
  state,
  catalog,
  storage,
  keys,
  scene,
  physics,
  earth,
  assembly,
  history,
  telemetry,
  capabilities,
  view,
  actions,
}) {
  let editorPresentation;
  const transformGizmo = createTransformGizmoController({
      camera: scene.camera,
      element: scene.renderer.domElement,
      scene: scene.world,
      machine: scene.machine,
      model: {
        parts: () => state.parts,
        selectedId: () => state.editor.selected,
        selectedIds: () => state.editor.selectedIds,
      },
      actions: {
        syncAssembly: assembly.sync,
        recordHistory: history.record,
      },
      view: {
        showSelection: (part) => editorPresentation?.showSelection(part),
        updateSelection: () => editorPresentation?.updateSelection(),
        drawConnections: () => editorPresentation?.drawConnections(),
        refreshEngineering: view.refreshEngineering,
      },
    }),
    { transform, groupPivot } = transformGizmo;

  editorPresentation = createEditorPresentationSubsystem({
    state,
    catalog,
    history: {
      suspended: history.suspended,
      capture: history.capture,
      record: history.record,
    },
    scene: {
      effects: scene.effects,
      transform,
      groupPivot,
      wires: scene.wires,
    },
    assembly: {
      sync: assembly.sync,
      snapshot: assembly.snapshot,
      revision: assembly.revision,
      evidenceRevision: assembly.evidenceRevision,
      currentConnections: assembly.currentConnections,
      currentPart: assembly.currentPart,
      powered: assembly.powered,
    },
    view: {
      query: view.query,
      queryAll: view.queryAll,
      syncSelection: view.syncSelection,
      positionSelectionLabel: view.positionSelectionLabel,
    },
    actions: {
      select: actions.select,
      cancelConnection: actions.cancelConnection,
      recordHistory: history.record,
      prepareFoot: actions.prepareFoot,
      openController: actions.openController,
      beginConnection: actions.beginConnection,
      connectWithRope: actions.connectWithRope,
      setMode: actions.setMode,
      render: view.render,
      tutorialEvent: actions.tutorialEvent,
      notify: view.notify,
    },
  });

  const world = createWorldPresentationSubsystem({
      state,
      storage,
      storageKeys: keys,
      scene,
      physics,
      earth,
      assembly: {
        parts: () => state.parts,
        selectedId: () => state.editor.selected,
        partName: (type) => catalog[type]?.name || type,
      },
      telemetry,
      editor: { setCameraTool: actions.setCameraTool },
      view: { query: view.query, notify: view.notify },
    }),
    exploded = createExplodedViewController({
      model: {
        state: createExplodedStatePort(state),
        running: () => state.running,
        parts: () => state.parts,
        connections: () => state.connections,
        selectedId: () => state.editor.selected,
        humanoidLayout: capabilities.humanoidLayout,
      },
      view: {
        cameraTarget: scene.cameraTarget,
        offsetCameraDistance: world.cameraController.offsetDistance,
        transform,
        query: view.query,
      },
      actions: {
        connectionValid: editorPresentation.connectionValid,
        drawConnections: editorPresentation.drawConnections,
        updateSelection: editorPresentation.updateSelection,
        updateHover: editorPresentation.selection.updateHover,
        showSelection: editorPresentation.showSelection,
        updateDriveHud: view.updateDriveHud,
        notify: view.notify,
      },
    });

  return Object.freeze({
    transformGizmo,
    transform,
    groupPivot,
    editorPresentation,
    beginConnection: actions.beginConnection,
    world,
    exploded,
  });
}

function createExplodedStatePort(state) {
  return {
    get exploded() {
      return state.exploded;
    },
    set exploded(value) {
      state.exploded = value;
    },
    get amount() {
      return state.explodeAmount;
    },
    set amount(value) {
      state.explodeAmount = value;
    },
    get cameraLift() {
      return state.explodeCameraLift;
    },
    set cameraLift(value) {
      state.explodeCameraLift = value;
    },
    get framingLift() {
      return state.explodeFramingLift;
    },
    set framingLift(value) {
      state.explodeFramingLift = value;
    },
    get distanceLift() {
      return state.explodeDistanceLift;
    },
    set distanceLift(value) {
      state.explodeDistanceLift = value;
    },
  };
}
