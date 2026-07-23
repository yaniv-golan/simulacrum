import {
  BUILD_SITE_LAT_DEG,
  BUILD_SITE_LON_DEG,
  EARTH_CHUNK_SIZE_M,
  EARTH_RADIUS_M,
  earthSurfaceSample,
  FIELD_SURFACE_Y,
  globalToGeodetic,
  KARMAN_LINE_M,
  MOON_DISTANCE_M,
} from "../simulation/environment/earth.js";
import { sampleWindVelocity } from "../simulation/environment/wind-field.js";
import { WORKSHOP_TEST_SITE } from "./testing-playground-content.js";

const pondSpecs = WORKSHOP_TEST_SITE.fluidRegions.map((fluid) => ({
  id: fluid.id,
  x: fluid.shape.centerM[0],
  z: fluid.shape.centerM[1],
  rx: fluid.shape.sizeM[0] / 2,
  rz: fluid.shape.sizeM[1] / 2,
  depth: fluid.bedDepthM,
  waterY: fluid.waterHeightM,
}));

/** Stable environment constants and pure samplers exposed to debug clients. */
export const ENVIRONMENT_DEBUG_CONTRACT = Object.freeze({
  buildSiteLatDeg: BUILD_SITE_LAT_DEG,
  buildSiteLonDeg: BUILD_SITE_LON_DEG,
  chunkSizeM: EARTH_CHUNK_SIZE_M,
  earthRadiusM: EARTH_RADIUS_M,
  fieldSurfaceY: FIELD_SURFACE_Y,
  karmanLineM: KARMAN_LINE_M,
  moonDistanceM: MOON_DISTANCE_M,
  pondSpecs,
  testSite: WORKSHOP_TEST_SITE,
  globalToGeodetic,
  surfaceSample: earthSurfaceSample,
  sampleWind: sampleWindVelocity,
});
