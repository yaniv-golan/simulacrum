import {
  testSiteShapeBounds,
  testSiteShapeContains,
  testSiteShapeSignedDistance,
} from "../../model/test-site-shapes.js";
import { testSiteHeightFeatureOffset } from "../../model/test-site-terrain.js";

/** Compiles the canonical test-site definition into deterministic world queries. */
export function createSurfaceField(definition) {
  const [footprintX, footprintZ] = definition.footprint.centerM,
    [footprintWidth, footprintDepth] = definition.footprint.sizeM,
    contains = (x, z) =>
      Math.abs(x - footprintX) <= footprintWidth / 2 &&
      Math.abs(z - footprintZ) <= footprintDepth / 2,
    fluidAt = (x, z, margin = 1) => {
      for (const fluid of definition.fluidRegions) {
        const bounds = testSiteShapeBounds(fluid.shape),
          referenceRadius =
            Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2,
          marginM = Math.max(0, margin - 1) * referenceRadius;
        if (!testSiteShapeContains(fluid.shape, x, z, marginM)) continue;
        const distanceM = testSiteShapeSignedDistance(fluid.shape, x, z),
          inwardDistanceM = Math.max(0, -distanceM),
          profile = fluid.depthProfile,
          profileRangeM = profile.fullDepthDistanceM - profile.shoreShelfM,
          profileAmount = Math.max(
            0,
            Math.min(
              1,
              (inwardDistanceM - profile.shoreShelfM) / profileRangeM,
            ),
          ),
          smoothAmount = profileAmount ** 2 * (3 - 2 * profileAmount),
          depth =
            distanceM > 0
              ? 0
              : profile.shoreDepthM +
                (profile.maximumDepthM - profile.shoreDepthM) * smoothAmount,
          centerX = fluid.shape.centerM[0],
          centerZ = fluid.shape.centerM[1],
          radiusX = (bounds.maxX - bounds.minX) / 2,
          radiusZ = (bounds.maxZ - bounds.minZ) / 2;
        return Object.freeze({
          id: fluid.id,
          districtId: fluid.districtId,
          shape: fluid.shape,
          x: centerX,
          z: centerZ,
          rx: radiusX,
          rz: radiusZ,
          depth,
          waterY: fluid.waterHeightM,
          densityKgPerM3: fluid.densityKgPerM3,
          normalizedRadius: Math.max(
            0,
            Math.min(1, 1 - inwardDistanceM / profile.fullDepthDistanceM),
          ),
        });
      }
      return null;
    },
    sample = ({ x, z }) => {
      let heightM = definition.baseTerrain.heightM,
        materialKey = definition.baseTerrain.materialKey,
        districtId = null,
        surfaceRegionId = null;
      const featureIds = [];
      for (const feature of definition.heightFeatures) {
        const offsetM = testSiteHeightFeatureOffset(feature, x, z);
        if (!offsetM) continue;
        heightM += offsetM;
        featureIds.push(feature.id);
        districtId ||= feature.districtId;
      }
      for (const region of definition.surfaceRegions)
        if (testSiteShapeContains(region.shape, x, z)) {
          materialKey = region.materialKey;
          districtId = region.districtId;
          surfaceRegionId = region.id;
          break;
        }
      const fluid = fluidAt(x, z);
      if (fluid) {
        heightM = Math.min(heightM, fluid.waterY - fluid.depth);
        materialKey = definition.fluidRegions.find(
          ({ id }) => id === fluid.id,
        ).materialKey;
        districtId = fluid.districtId;
        featureIds.push(`${fluid.id}:bed`);
      }
      return Object.freeze({
        siteId: definition.id,
        inside: contains(x, z),
        heightM,
        materialKey,
        districtId,
        surfaceRegionId,
        featureIds: Object.freeze(featureIds),
        fluid,
      });
    };
  return Object.freeze({ definition, contains, fluidAt, sample });
}
