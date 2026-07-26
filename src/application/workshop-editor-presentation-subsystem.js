import { createTransformGizmoController } from "../presentation/transform-gizmo-controller.js";
import { createEditorExplodedView } from "./editor-exploded-view-composition.js";
import { createEditorPresentationSubsystem } from "./editor-presentation-subsystem.js";
import { createEditorSelectionVisibility } from "./editor-selection-visibility-composition.js";
import { createWorldPresentationSubsystem } from "./world-presentation-subsystem.js";
import { createSelectedContextCommandCatalog } from "./component-action-catalog.js";

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
  const visibility = { current: null },
    commandCatalog = createSelectedContextCommandCatalog(),
    transformGizmo = createTransformGizmoController({
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
    assembly,
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
    commandCatalog,
    isolation: {
      active: () => visibility.current?.active() || false,
      selectionChanged: () => visibility.current?.selectionChanged(),
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
        selectedIds: () => state.editor.selectedIds,
        partName: (type) => catalog[type]?.name || type,
      },
      telemetry,
      editor: { setCameraTool: actions.setCameraTool },
      view: { query: view.query, notify: view.notify },
    }),
    selectionVisibility = createEditorSelectionVisibility({
      state,
      scene,
      camera: world.cameraController,
      editorPresentation,
      view,
    }),
    exploded = createEditorExplodedView({
      state,
      capabilities,
      scene,
      world,
      transform,
      view,
      editorPresentation,
      explodedState: createExplodedStatePort(state),
    });
  visibility.current = selectionVisibility;

  return Object.freeze({
    transformGizmo,
    transform,
    groupPivot,
    editorPresentation,
    beginConnection: actions.beginConnection,
    world,
    exploded,
    selectionVisibility,
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
