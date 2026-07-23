import * as CANNON from "cannon-es";
import * as THREE from "three";
import { createEarthStreamer } from "../earth-stream.js";
import { createAtmosphericLandmarks } from "../presentation/atmospheric-landmarks.js";
import { createCameraInteractionController } from "../presentation/camera-interaction-controller.js";
import { createEnvironmentPresentation } from "../presentation/environment-presentation.js";
import {
  focusedEnvironmentObject,
  syncEnvironmentBodyObjects,
} from "../presentation/environment-body-presentation.js";
import { createEarthStreamingController } from "./earth-streaming-controller.js";
import { createEnvironmentPresentationModel } from "./environment-presentation-model.js";
import { createLocalFieldFeature } from "./local-field-feature.js";
import { BrowserEnvironmentPreferencesRepository } from "./local-settings-repositories.js";
import { standardAtmosphere } from "../simulation/environment/atmosphere.js";
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
  const preferences = new BrowserEnvironmentPreferencesRepository({
      storage,
      key: storageKeys.environmentPreferences,
    }),
    {
      root: fieldEnvironment,
      surfaceMesh: fieldSurface,
      waterNormalTexture,
      setPerformanceMode,
      updateDetailLod,
      detailLodSnapshot,
    } = createLocalFieldFeature({
      scene: scene.world,
      world: physics.world,
      renderer: scene.renderer,
      groundMaterial: physics.groundMaterial,
      terrainHeightAt: earth.terrainHeightAt,
      pondAt: earth.pondAt,
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
    environmentModel = createEnvironmentPresentationModel(state, earth.windAt),
    environment = createEnvironmentPresentation({
      model: environmentModel,
      persistence: {
        setTime: (value) => preferences.setTimeOfDay(value),
        setWind: (enabled) => preferences.setWindEnabled(enabled),
      },
      scene: {
        world: scene.world,
        renderer: scene.renderer,
        cameraTarget: scene.cameraTarget,
        machine: scene.machine,
        flightActive: () => Boolean(telemetry.flight()),
        karmanLineM: earth.karmanLineM,
        sun: scene.sun,
        hemisphere: scene.hemisphere,
        ambientFill: scene.ambientFill,
        moonLight: scene.moonLight,
        starMaterial: scene.starMaterial,
        moonMaterial: scene.moonMaterial,
        skyEnvironment: scene.skyEnvironment,
        moon: scene.moon,
        earthMaterial: scene.earthMaterial,
        atmosphereMaterial: scene.atmosphereMaterial,
        earthLimb: scene.earthLimb,
        atmosphereShell: scene.atmosphereShell,
        stars: scene.stars,
        clouds,
        meteorite: scene.meteorite,
        targetRing: scene.targetRing,
        render: scene.render,
      },
      earth: {
        coordinate: () => {
          const focus = state.running
              ? scene.machine.position
              : scene.cameraTarget,
            global = earth.localToGlobal(focus.x, focus.z);
          return earth.globalToGeodetic(global.eastM, global.northM);
        },
        chunkCount: () => streamer.chunks.size,
      },
      atmosphere: {
        densityAt: (altitude) => standardAtmosphere(altitude).density,
      },
    });
  syncEnvironmentBodies();
  environment.setTimeOfDay(state.timeOfDay, false);
  const updateEnvironment = () => {
    syncEnvironmentBodies();
    const focus = state.running ? scene.machine.position : scene.cameraTarget;
    updateDetailLod(scene.camera.position.distanceTo(focus));
    environment.update();
  };

  return Object.freeze({
    fieldEnvironment,
    fieldSurface,
    waterNormalTexture,
    setPerformanceMode,
    detailLodSnapshot,
    cameraController,
    horizonEnvironment,
    streamer,
    updateEarth: streaming.update,
    setTimeOfDay: environment.setTimeOfDay,
    setWindEnabled: environment.setWindEnabled,
    updateEnvironment,
  });
}
