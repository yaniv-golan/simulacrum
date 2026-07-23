import { applyEditorAction } from "../model/application-state.js";
import { createAerothermalVisuals } from "../presentation/aerothermal-visuals.js";
import {
  BUILD_SITE_LAT_DEG,
  BUILD_SITE_LON_DEG,
  coordinateHash,
  EARTH_CHUNK_SIZE_M,
  earthSurfaceSample,
  EARTH_SEA_LEVEL_Y,
  FIELD_SURFACE_Y,
  generatedPoolAt,
  globalToGeodetic,
  KARMAN_LINE_M,
  LAND_POLYGONS,
} from "../simulation/environment/earth.js";
import { sampleWindVelocity } from "../simulation/environment/wind-field.js";
import { createWorkshopEditorPresentationSubsystem } from "./workshop-editor-presentation-subsystem.js";
import { createWorkshopStageFoundation } from "./workshop-stage-foundation.js";

/** Owns engine-backed stage construction and editor/world presentation ports. */
export function createWorkshopEditorStageComposition({
  shell,
  catalog,
  keys,
  runtime,
  controller,
  history,
  assembly,
  actions,
  view,
}) {
  const state = shell.state,
    stage = createWorkshopStageFoundation({
      stage: shell.query("#stage"),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        pixelRatio: devicePixelRatio,
      },
      landPolygons: LAND_POLYGONS,
      karmanLineM: KARMAN_LINE_M,
    }),
    windAt = (position, elapsedSeconds = state.elapsed) =>
      sampleWindVelocity(position, {
        enabled: state.windEnabled,
        elapsedSeconds,
      }),
    aerothermal = createAerothermalVisuals({ parts: () => state.parts });

  const editor = createWorkshopEditorPresentationSubsystem({
      state,
      catalog,
      storage: shell.storage,
      keys,
      scene: createEditorScenePort(stage),
      physics: { world: stage.world, groundMaterial: stage.groundMaterial },
      earth: {
        terrainHeightAt: stage.earth.terrainHeightAt,
        pondAt: stage.earth.pondAt,
        pondSpecs: stage.earth.pondSpecs(),
        testSite: stage.earth.testSite,
        localTerrainBounds: stage.earth.localTerrainBounds,
        surfaceSampleAt: stage.earth.surfaceSampleAt,
        fieldSurfaceY: FIELD_SURFACE_Y,
        chunkSize: EARTH_CHUNK_SIZE_M,
        seaLevelY: EARTH_SEA_LEVEL_Y,
        surfaceSample: earthSurfaceSample,
        coordinateHash,
        generatedPoolAt,
        environmentBodyRegistry: stage.environmentBodyRegistry,
        nearSpaceBodyId: stage.nearSpaceBodyId,
        karmanLineM: KARMAN_LINE_M,
        localToGlobal: stage.earth.localToGlobal,
        globalToGeodetic,
        rebuildEnvironment: stage.earth.rebuild,
        windAt,
      },
      history: {
        suspended: () => shell.history.suspended,
        capture: history.capture,
        record: history.record,
      },
      assembly,
      view: {
        query: shell.query,
        queryAll: shell.queryAll,
        syncSelection: shell.chrome.syncSelection,
        positionSelectionLabel: shell.chrome.positionSelectionLabel,
        refreshEngineering: view.refreshEngineering,
        updateDriveHud: view.updateDriveHud,
        render: view.render,
        notify: shell.notify,
      },
      actions: {
        select: (id, ids) =>
          applyEditorAction(state.editor, { type: "select", id, ids }),
        cancelConnection: () =>
          applyEditorAction(state.editor, { type: "cancel-connection" }),
        prepareFoot: actions.prepareFoot,
        openController: controller.open,
        beginConnection: (partId, port) =>
          applyEditorAction(state.editor, {
            type: "begin-connection",
            partId,
            port,
          }),
        setMode: actions.setMode,
        tutorialEvent: actions.tutorialEvent,
        setCameraTool: (tool) =>
          applyEditorAction(state.editor, { type: "set-camera-tool", tool }),
      },
      telemetry: {
        flight: () => runtime.telemetry.systems?.flight || null,
        environmentBodies: () =>
          runtime.telemetry.systems?.environmentBodies || null,
        sensors: () => runtime.telemetry.systems?.sensors || null,
      },
      capabilities: { humanoidLayout: actions.humanoidLayout },
    }),
    world = editor.world;

  return Object.freeze({
    stage,
    editor,
    aerothermal,
    environment: Object.freeze({
      karmanLineM: KARMAN_LINE_M,
      latitude: BUILD_SITE_LAT_DEG,
      longitude: BUILD_SITE_LON_DEG,
      windAt,
      setTime: world.setTimeOfDay,
      setWind: world.setWindEnabled,
    }),
    assemblyPresentation: Object.freeze({
      performance: {
        normalPixelRatio: stage.normalPixelRatio,
        pixelRatio: () => stage.renderer.getPixelRatio(),
        setPixelRatio: (ratio) => stage.renderer.setPixelRatio(ratio),
        setPerformanceMode: (reduced) => world.setPerformanceMode(reduced),
        setEnvironmentVisible: (visible) => {
          world.horizonEnvironment.visible = visible;
          world.streamer.group.visible = visible;
        },
        syncBatch: (parts, enabled) =>
          stage.largeAssemblyBatcher.sync(parts, { enabled }),
      },
      scene: {
        world: stage.scene,
        machine: stage.machine,
        wires: stage.wires,
        effects: stage.effects,
        cameraTarget: stage.cameraTarget,
      },
      presentAerothermal: (telemetry) => aerothermal.present(telemetry),
      resetExploded: editor.exploded.reset,
    }),
  });
}

function createEditorScenePort(stage) {
  return {
    world: stage.scene,
    camera: stage.camera,
    renderer: stage.renderer,
    machine: stage.machine,
    floor: stage.floor,
    cameraTarget: stage.cameraTarget,
    meteorite: stage.meteorite,
    wires: stage.wires,
    effects: stage.effects,
    sun: stage.sun,
    hemisphere: stage.hemisphere,
    ambientFill: stage.ambientFill,
    moonLight: stage.moonLight,
    starMaterial: stage.starMaterial,
    moonMaterial: stage.moonMaterial,
    skyEnvironment: stage.root,
    moon: stage.moon,
    earthMaterial: stage.earthMaterial,
    atmosphereMaterial: stage.atmosphereMaterial,
    earthLimb: stage.earthLimb,
    atmosphereShell: stage.atmosphereShell,
    stars: stage.stars,
    targetRing: stage.targetRing,
    render: () => stage.renderer.render(stage.scene, stage.camera),
  };
}
