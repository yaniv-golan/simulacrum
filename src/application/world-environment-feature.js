import { createEnvironmentPresentation } from "../presentation/environment-presentation.js";
import {
  applyTestSiteShadowProfile,
  testSiteCapturePreset,
} from "../presentation/test-site-capture.js";
import { standardAtmosphere } from "../simulation/environment/atmosphere.js";
import { createEnvironmentPresentationModel } from "./environment-presentation-model.js";
import { BrowserEnvironmentPreferencesRepository } from "./local-settings-repositories.js";

/** Owns world lighting/time composition and the exact test-site capture port. */
export function createWorldEnvironmentFeature({
  state,
  storage,
  storageKeys,
  scene,
  earth,
  telemetry,
  streamer,
  clouds,
  cameraController,
  field,
}) {
  const preferences = new BrowserEnvironmentPreferencesRepository({
      storage,
      key: storageKeys.environmentPreferences,
    }),
    environment = createEnvironmentPresentation({
      model: createEnvironmentPresentationModel(state, earth.windAt),
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
        reflectionEnvironment: scene.reflectionEnvironment,
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
  environment.setTimeOfDay(state.timeOfDay, false);
  let shadowProfile = applyTestSiteShadowProfile(
    scene.sun,
    cameraController.snapshot().renderedDistance,
  );

  function update() {
    shadowProfile = applyTestSiteShadowProfile(
      scene.sun,
      cameraController.snapshot().renderedDistance,
      shadowProfile.id,
    );
    environment.update();
  }

  function applyCapturePreset(request) {
    const id = typeof request === "string" ? request : request.id,
      preset = testSiteCapturePreset(id);
    if (
      typeof request === "object" &&
      (Number.isFinite(request.solarTime) ||
        (request.usePresetSolarTime && Number.isFinite(preset.solarTime)))
    )
      environment.setTimeOfDay(
        Number.isFinite(request.solarTime)
          ? request.solarTime
          : preset.solarTime,
        false,
      );
    const camera = cameraController.applyPreset(preset);
    field.updateDetailLod(camera.renderedDistance);
    shadowProfile = applyTestSiteShadowProfile(
      scene.sun,
      camera.renderedDistance,
      shadowProfile.id,
    );
    environment.update();
    scene.render();
    return Object.freeze({
      siteId: earth.testSite.id,
      solarTime: state.timeOfDay,
      camera,
      presentationLod: {
        ...field.detailLodSnapshot(),
        materialLibrary: field.materialLibrarySnapshot(),
        shadow: shadowProfile,
      },
    });
  }

  return Object.freeze({
    applyCapturePreset,
    setTimeOfDay: environment.setTimeOfDay,
    setWindEnabled: environment.setWindEnabled,
    update,
  });
}
