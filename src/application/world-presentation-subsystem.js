import * as CANNON from "cannon-es";
import * as THREE from "three";
import { createEarthStreamer } from "../earth-stream.js";
import { createAtmosphericLandmarks } from "../presentation/atmospheric-landmarks.js";
import { createCameraInteractionController } from "../presentation/camera-interaction-controller.js";
import {
  focusedEnvironmentObject,
  syncEnvironmentBodyObjects,
} from "../presentation/environment-body-presentation.js";
import { createEarthStreamingController } from "./earth-streaming-controller.js";
import { createLocalFieldFeature } from "./local-field-feature.js";
import { createWorldEnvironmentFeature } from "./world-environment-feature.js";
/** Composes visible world, camera, Earth streaming, and environment controls. */
export function createWorldPresentationSubsystem({
  state,
  storage,
  storageKeys,
  scene,
  physics,
  earth,
  assembly,
  telemetry,
  editor,
  view,
}) {
  const bodyObjects = new Map([[earth.nearSpaceBodyId, scene.meteorite]]),
    environmentBodySnapshot = () =>
      telemetry.environmentBodies?.() ||
      earth.environmentBodyRegistry.snapshot({
        origin: {
          x: state.earthOriginEastM,
          y: 0,
          z: state.earthOriginNorthM,
        },
      }),
    syncEnvironmentBodies = () =>
      syncEnvironmentBodyObjects(environmentBodySnapshot(), bodyObjects);
  const {
      root: fieldEnvironment,
      surfaceMesh: fieldSurface,
      waterNormalTexture,
      setPerformanceMode,
      updateDetailLod,
      detailLodSnapshot,
      materialLibrarySnapshot,
    } = createLocalFieldFeature({
      scene: scene.world,
      world: physics.world,
      renderer: scene.renderer,
      groundMaterial: physics.groundMaterial,
      terrainHeightAt: earth.terrainHeightAt,
      pondSpecs: earth.pondSpecs,
      fieldSurfaceY: earth.fieldSurfaceY,
      testSite: earth.testSite,
    }),
    cameraController = createCameraInteractionController({
      scene: {
        camera: scene.camera,
        element: scene.renderer.domElement,
        machine: scene.machine,
        floor: scene.floor,
        fieldSurface,
        target: scene.cameraTarget,
      },
      assembly: {
        parts: assembly.parts,
        selectedId: assembly.selectedId,
        selectedIds: assembly.selectedIds,
        running: () => state.running,
        focusedEnvironmentObject: () =>
          focusedEnvironmentObject({
            sensorTelemetry: telemetry.sensors?.(),
            objectByBodyId: bodyObjects,
          }),
        partName: assembly.partName,
      },
      editor: {
        tool: () => state.editor.cameraTool,
        setTool: editor.setCameraTool,
      },
      view,
    }),
    { root: horizonEnvironment, clouds } = createAtmosphericLandmarks({
      scene: scene.world,
      fieldSurfaceY: earth.fieldSurfaceY,
    }),
    streamer = createEarthStreamer({
      THREE,
      CANNON,
      scene: scene.world,
      world: physics.world,
      groundMaterial: physics.groundMaterial,
      chunkSize: earth.chunkSize,
      seaLevelY: earth.seaLevelY,
      surfaceSample: earth.surfaceSample,
      coordinateHash: earth.coordinateHash,
      generatedPoolAt: earth.generatedPoolAt,
      localTerrainBounds: earth.localTerrainBounds,
      streamRadius: 3,
      collisionRadius: 1,
    });
  cameraController.bindControls();

  const streaming = createEarthStreamingController({
      streamer,
      origin: {
        east: () => state.earthOriginEastM,
        north: () => state.earthOriginNorthM,
        move: (east, north) => {
          state.earthOriginEastM += east;
          state.earthOriginNorthM += north;
        },
      },
      focus: () =>
        state.running ? scene.machine.position : scene.cameraTarget,
      roots: () => [
        scene.floor,
        fieldEnvironment,
        horizonEnvironment,
        scene.machine,
        scene.wires,
        scene.effects,
      ],
      landmark: scene.meteorite.position,
      physicsBodies: () => physics.world.bodies,
      detachedParts: () =>
        assembly.parts().filter((part) => part.mesh.parent === scene.world),
      camera: {
        target: scene.cameraTarget,
        shift: cameraController.shiftSmoothedTarget,
      },
      chunkSize: earth.chunkSize,
      rebuildEnvironment: earth.rebuildEnvironment,
    }),
    worldEnvironment = createWorldEnvironmentFeature({
      state,
      storage,
      storageKeys,
      scene,
      earth,
      telemetry,
      streamer,
      clouds,
      cameraController,
      field: {
        updateDetailLod,
        detailLodSnapshot,
        materialLibrarySnapshot,
      },
    });
  syncEnvironmentBodies();
  const updateEnvironment = () => {
    syncEnvironmentBodies();
    const focus = state.running ? scene.machine.position : scene.cameraTarget;
    updateDetailLod(scene.camera.position.distanceTo(focus));
    worldEnvironment.update();
  };

  return Object.freeze({
    fieldEnvironment,
    fieldSurface,
    waterNormalTexture,
    setPerformanceMode,
    detailLodSnapshot,
    applyCapturePreset: worldEnvironment.applyCapturePreset,
    cameraController,
    horizonEnvironment,
    streamer,
    updateEarth: streaming.update,
    setTimeOfDay: worldEnvironment.setTimeOfDay,
    setWindEnabled: worldEnvironment.setWindEnabled,
    updateEnvironment,
  });
}
