import * as THREE from "three";

export const TEST_SITE_CAPTURE_PRESETS = Object.freeze({
  "reference-overview": Object.freeze({
    id: "reference-overview",
    positionM: Object.freeze([-338, 410, -382]),
    targetM: Object.freeze([-2, 3, 10]),
    fovDeg: 35,
    solarTime: 12,
  }),
  "rover-chase": Object.freeze({
    id: "rover-chase",
    positionM: Object.freeze([34, 8.5, -112]),
    targetM: Object.freeze([76, 0.5, -85]),
    fovDeg: 43,
    solarTime: 10.25,
  }),
  "surface-ground": Object.freeze({
    id: "surface-ground",
    positionM: Object.freeze([44, 1.65, -102]),
    targetM: Object.freeze([109, -0.2, -64]),
    fovDeg: 48,
    solarTime: 10.25,
  }),
  "terrain-ground": Object.freeze({
    id: "terrain-ground",
    positionM: Object.freeze([26, 8.5, 62]),
    targetM: Object.freeze([128, 3.5, 108]),
    fovDeg: 45,
    solarTime: 9.75,
  }),
  "water-ground": Object.freeze({
    id: "water-ground",
    positionM: Object.freeze([-104, 5.5, -144]),
    targetM: Object.freeze([-26, -0.7, -108]),
    fovDeg: 46,
    solarTime: 10.75,
  }),
  "airfield-chase": Object.freeze({
    id: "airfield-chase",
    positionM: Object.freeze([-150, 10, 119]),
    targetM: Object.freeze([-52, 0.1, 154]),
    fovDeg: 43,
    solarTime: 9.75,
  }),
});

export function testSiteCapturePreset(id) {
  const preset = TEST_SITE_CAPTURE_PRESETS[id];
  if (!preset) throw new RangeError(`Unknown test-site capture preset ${id}`);
  return preset;
}

/** Keeps one shadow allocation while fitting it to the current camera scale. */
export function applyTestSiteShadowProfile(
  sun,
  cameraDistanceM,
  currentProfileId = null,
) {
  const profileId =
      currentProfileId === "contact" && cameraDistanceM < 72
        ? "contact"
        : currentProfileId === "overview" && cameraDistanceM > 165
          ? "overview"
          : currentProfileId === "district" && cameraDistanceM < 58
            ? "contact"
            : currentProfileId === "district" && cameraDistanceM > 195
              ? "overview"
              : cameraDistanceM > 180
                ? "overview"
                : cameraDistanceM > 65
                  ? "district"
                  : "contact",
    profile =
      profileId === "overview"
        ? { id: "overview", extentM: 305, nearM: 1, farM: 900, radius: 1 }
        : profileId === "district"
          ? { id: "district", extentM: 145, nearM: 1, farM: 480, radius: 1.5 }
          : { id: "contact", extentM: 48, nearM: 0.5, farM: 220, radius: 2.5 },
    shadowCamera = sun.shadow.camera;
  Object.assign(shadowCamera, {
    left: -profile.extentM,
    right: profile.extentM,
    top: profile.extentM,
    bottom: -profile.extentM,
    near: profile.nearM,
    far: profile.farM,
  });
  sun.shadow.radius = profile.radius;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.035;
  shadowCamera.updateProjectionMatrix();
  return Object.freeze({ ...profile, mapSizePx: sun.shadow.mapSize.x });
}

export function capturePose(preset) {
  return {
    id: preset.id,
    position: new THREE.Vector3(...preset.positionM),
    target: new THREE.Vector3(...preset.targetM),
    fovDeg: preset.fovDeg,
    solarTime: preset.solarTime,
  };
}
