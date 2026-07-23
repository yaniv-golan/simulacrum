import { createEarthEnvironmentModel } from "../simulation/environment/earth.js";
import { WORKSHOP_TEST_SITE } from "./testing-playground-content.js";

/** Adapts the immutable site and relocatable Earth model to stage query ports. */
export function createTestingPlaygroundEnvironment() {
  let model = createEarthEnvironmentModel({
    testSiteDefinition: WORKSHOP_TEST_SITE,
  });
  const [centerX, centerZ] = WORKSHOP_TEST_SITE.footprint.centerM,
    [width, depth] = WORKSHOP_TEST_SITE.footprint.sizeM;
  return Object.freeze({
    localToGlobal: (x, z) => model.localToGlobalSurface(x, z),
    pondAt: (x, z, margin = 1) => model.pondAt(x, z, margin),
    pondSpecs: () => model.pondSpecs,
    terrainHeightAt: (x, z) => model.terrainHeightAt(x, z),
    surfaceHeightAt: (x, z) => model.surfaceHeightAt(x, z),
    surfaceSampleAt: (x, z) => model.surfaceSampleAt(x, z),
    testSite: WORKSHOP_TEST_SITE,
    localTerrainBounds: Object.freeze({
      minX: centerX - width / 2,
      maxX: centerX + width / 2,
      minZ: centerZ - depth / 2,
      maxZ: centerZ + depth / 2,
    }),
    rebuild(east, north) {
      model = createEarthEnvironmentModel({
        originEastM: east,
        originNorthM: north,
        testSiteDefinition: WORKSHOP_TEST_SITE,
      });
    },
  });
}
