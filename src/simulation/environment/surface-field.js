import { testSiteShapeWeight } from "../../model/test-site-shapes.js";

/** Compiles the canonical test-site definition into deterministic world queries. */
export function createSurfaceField(definition) {
  const [footprintX, footprintZ] = definition.footprint.centerM,
    [footprintWidth, footprintDepth] = definition.footprint.sizeM,
    contains = (x, z) =>
      Math.abs(x - footprintX) <= footprintWidth / 2 &&
      Math.abs(z - footprintZ) <= footprintDepth / 2,
    fluidAt = (x, z, margin = 1) => {
      for (const fluid of definition.fluidRegions) {
        const expanded = {
            ...fluid.shape,
            sizeM: fluid.shape.sizeM.map((size) => size * margin),
          },
          weight = testSiteShapeWeight(expanded, x, z);
        if (!weight) continue;
        return Object.freeze({
          id: fluid.id,
          districtId: fluid.districtId,
          x: fluid.shape.centerM[0],
          z: fluid.shape.centerM[1],
          rx: fluid.shape.sizeM[0] / 2,
          rz: fluid.shape.sizeM[1] / 2,
          depth: fluid.bedDepthM * weight,
          waterY: fluid.waterHeightM,
          densityKgPerM3: fluid.densityKgPerM3,
          normalizedRadius: 1 - Math.sqrt(weight),
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
        const weight = testSiteShapeWeight(feature.shape, x, z);
        if (!weight) continue;
        heightM += feature.amplitudeM * weight;
        featureIds.push(feature.id);
        districtId ||= feature.districtId;
      }
      for (const region of definition.surfaceRegions)
        if (testSiteShapeWeight(region.shape, x, z)) {
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
