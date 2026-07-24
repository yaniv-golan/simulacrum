import {
  testSiteShapeLocalPoint,
  testSiteShapeSignedDistance,
  testSiteShapeWeight,
} from "./test-site-shapes.js";

/** Frozen CP0 choice: coarsest grid meeting the measured v2 terrain probes. */
export const TEST_SITE_TERRAIN_ELEMENT_SIZE_M = 2;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
};

/** Returns the authoritative planar footprint for every terrain-feature kind. */
export function testSiteHeightFeatureShape(feature) {
  if (feature.kind === "mound") return feature.footprint;
  if (feature.kind === "corridor-profile") return feature.centerline;
  const totalRunM =
    feature.kind === "grade-ramp"
      ? feature.runM + feature.crestLengthM + feature.transitionLengthM
      : feature.runM;
  return Object.freeze({
    kind: "rectangle",
    centerM: feature.centerM,
    sizeM: [
      feature.widthM + feature.edgeBlendM * 2,
      totalRunM + feature.edgeBlendM * 2,
    ],
    rotationRad: feature.headingRad,
  });
}

function lateralWeight(distanceM, halfWidthM, edgeBlendM) {
  if (distanceM <= halfWidthM) return 1;
  if (!edgeBlendM) return 0;
  return 1 - smoothstep((distanceM - halfWidthM) / edgeBlendM);
}

function gradeRampOffset(feature, x, z) {
  const shape = testSiteHeightFeatureShape(feature),
    point = testSiteShapeLocalPoint(shape, x, z),
    totalRunM = feature.runM + feature.crestLengthM + feature.transitionLengthM,
    alongM = point.z + totalRunM / 2,
    acrossWeight = lateralWeight(
      Math.abs(point.x),
      feature.widthM / 2,
      feature.edgeBlendM,
    );
  if (
    !acrossWeight ||
    alongM < -feature.edgeBlendM ||
    alongM > totalRunM + feature.edgeBlendM
  )
    return 0;
  const endWeight =
    alongM < 0
      ? smoothstep((alongM + feature.edgeBlendM) / feature.edgeBlendM)
      : alongM > totalRunM
        ? 1 - smoothstep((alongM - totalRunM) / feature.edgeBlendM)
        : 1;
  let elevationM;
  if (alongM <= 0) elevationM = 0;
  else if (alongM < feature.runM)
    elevationM = feature.riseM * (alongM / feature.runM);
  else if (alongM <= feature.runM + feature.crestLengthM)
    elevationM = feature.riseM;
  else
    elevationM =
      feature.riseM *
      (1 -
        smoothstep(
          (alongM - feature.runM - feature.crestLengthM) /
            feature.transitionLengthM,
        ));
  return elevationM * acrossWeight * endWeight;
}

function interpolateProfile(points, distanceM) {
  if (distanceM < points[0][0] || distanceM > points.at(-1)[0]) return 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1],
      end = points[index];
    if (distanceM > end[0]) continue;
    const amount = (distanceM - start[0]) / (end[0] - start[0]);
    return start[1] + (end[1] - start[1]) * amount;
  }
  return points.at(-1)[1];
}

function corridorProfileOffset(feature, x, z) {
  const signedDistanceM = testSiteShapeSignedDistance(feature.centerline, x, z);
  if (signedDistanceM > 0) return 0;
  return interpolateProfile(
    feature.transverseProfileM,
    signedDistanceM + feature.centerline.widthM / 2,
  );
}

function rippleTrainOffset(feature, x, z) {
  const shape = testSiteHeightFeatureShape(feature),
    point = testSiteShapeLocalPoint(shape, x, z),
    alongDistanceM = Math.abs(point.z),
    acrossDistanceM = Math.abs(point.x),
    weight =
      lateralWeight(alongDistanceM, feature.runM / 2, feature.edgeBlendM) *
      lateralWeight(acrossDistanceM, feature.widthM / 2, feature.edgeBlendM);
  if (!weight) return 0;
  return (
    Math.sin(
      ((point.z + feature.runM / 2) / feature.wavelengthM) * Math.PI * 2 +
        feature.phaseRad,
    ) *
    feature.amplitudeM *
    weight
  );
}

/** Canonical additive/cut elevation contributed by one strict feature. */
export function testSiteHeightFeatureOffset(feature, x, z) {
  if (feature.kind === "mound")
    return feature.elevationM * testSiteShapeWeight(feature.footprint, x, z);
  if (feature.kind === "grade-ramp") return gradeRampOffset(feature, x, z);
  if (feature.kind === "corridor-profile")
    return corridorProfileOffset(feature, x, z);
  if (feature.kind === "ripple-train") return rippleTrainOffset(feature, x, z);
  return 0;
}

/** Used only to classify map/debug presentation; physics uses the full profile. */
export function testSiteHeightFeatureExtrema(feature) {
  if (feature.kind === "mound")
    return {
      minimumM: Math.min(0, feature.elevationM),
      maximumM: Math.max(0, feature.elevationM),
    };
  if (feature.kind === "grade-ramp")
    return {
      minimumM: Math.min(0, feature.riseM),
      maximumM: Math.max(0, feature.riseM),
    };
  if (feature.kind === "corridor-profile") {
    const elevations = feature.transverseProfileM.map((point) => point[1]);
    return {
      minimumM: Math.min(0, ...elevations),
      maximumM: Math.max(0, ...elevations),
    };
  }
  return {
    minimumM: -Math.abs(feature.amplitudeM),
    maximumM: Math.abs(feature.amplitudeM),
  };
}
