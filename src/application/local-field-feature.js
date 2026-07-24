import * as THREE from "three";
import { mesh } from "../presentation/mesh-primitives.js";
import {
  createTestSiteSurfacePresentation,
  createTestSiteTerrainGeometry,
} from "../presentation/test-site-surface-presentation.js";
import { createTestSiteMaterialLibrary } from "../presentation/test-site-material-library.js";
import { createTestSiteWaterPresentation } from "../presentation/test-site-water-presentation.js";
import { createTestSiteVegetationPresentation } from "../presentation/test-site-vegetation-presentation.js";
import { createTestSiteFixtureFeature } from "./test-site-fixture-feature.js";

/** Composes the authored field's visual surface and matching static colliders. */
export function createLocalFieldFeature({
  scene,
  world,
  renderer,
  groundMaterial,
  terrainHeightAt,
  pondSpecs,
  fieldSurfaceY,
  testSite,
}) {
  let surfaceMesh;
  const environment = new THREE.Group();
  environment.name = "fieldEnvironment";
  scene.add(environment);
  const materialLibrary = createTestSiteMaterialLibrary({ renderer }),
    { surfaceMaterial, applyMaterialProfile } = materialLibrary,
    barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x694426,
      roughness: 0.96,
    }),
    woodCutMaterial = new THREE.MeshStandardMaterial({
      color: 0xb88a52,
      roughness: 0.91,
    }),
    concreteMaterial = new THREE.MeshStandardMaterial({
      color: 0x777b73,
      roughness: 0.9,
    }),
    lowGripMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9cacc,
      roughness: 0.3,
    }),
    columnMaterial = new THREE.MeshStandardMaterial({
      color: 0x43565a,
      roughness: 0.52,
      metalness: 0.34,
    }),
    warningMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6812b,
      roughness: 0.72,
      side: THREE.DoubleSide,
    });
  const leafMaterials = [0x315b35, 0x3f703e, 0x527d43].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
  );
  const [fieldCenterX, fieldCenterZ] = testSite.footprint.centerM;
  const fieldGeometry = createTestSiteTerrainGeometry({
    testSite,
    terrainHeightAt,
    baseHeightM: fieldSurfaceY,
  });
  applyMaterialProfile(fieldGeometry, "short-grass");
  const field = mesh(
    fieldGeometry,
    surfaceMaterial,
    [fieldCenterX, fieldSurfaceY, fieldCenterZ],
    [-Math.PI / 2, 0, 0],
    environment,
  );
  field.castShadow = false;
  field.receiveShadow = true;
  surfaceMesh = field;
  const performanceFieldGeometry = createTestSiteTerrainGeometry({
    testSite,
    terrainHeightAt,
    baseHeightM: fieldSurfaceY,
    targetElementSizeM: 10,
  });
  applyMaterialProfile(performanceFieldGeometry, "short-grass");
  const performanceField = mesh(
    performanceFieldGeometry,
    surfaceMaterial,
    [fieldCenterX, fieldSurfaceY, fieldCenterZ],
    [-Math.PI / 2, 0, 0],
    environment,
  );
  performanceField.name = "performanceFieldSurface";
  performanceField.castShadow = false;
  performanceField.receiveShadow = true;
  performanceField.visible = false;
  const surfaceRegions = createTestSiteSurfacePresentation({
    parent: environment,
    testSite,
    terrainHeightAt,
    surfaceMaterial,
    applyMaterialProfile,
  });
  const waterPresentation = createTestSiteWaterPresentation({
    parent: environment,
    pondSpecs,
    terrainHeightAt,
    surfaceMaterial,
    applyMaterialProfile,
  });

  // Physical fixtures stay recognizable at every presentation LOD. Only
  // decorative scatter is expendable when distance or assembly size needs the
  // render budget; colliders, terrain, soils, water, and landmarks remain.
  const fixtureEnvironment = new THREE.Group();
  fixtureEnvironment.name = "testSiteFixtureEnvironment";
  environment.add(fixtureEnvironment);

  createTestSiteFixtureFeature({
    parent: fixtureEnvironment,
    world,
    groundMaterial,
    testSite,
    terrainHeightAt,
    materials: {
      bark: barkMaterial,
      woodCut: woodCutMaterial,
      leaves: leafMaterials,
      stone: concreteMaterial,
      signPost: columnMaterial,
      signFace: lowGripMaterial,
      warning: warningMaterial,
    },
  });
  const fixtureDetailVisuals = [],
    fixtureShadowVisuals = [];
  fixtureEnvironment.traverse((object) => {
    if (
      object.name.startsWith("fixture-tree-crowns:") ||
      object.name === "fixture-tree-conifer-crowns"
    )
      fixtureDetailVisuals.push(object);
    if (object.castShadow) fixtureShadowVisuals.push(object);
  });
  const vegetation = createTestSiteVegetationPresentation({
    parent: environment,
    testSite,
    terrainHeightAt,
  });

  let performanceMode = false;
  const updateDetailLod = (distanceM) => {
    vegetation.updateDetailLod(distanceM);
    waterPresentation.updateDetailLod(distanceM);
    surfaceRegions.updateDetailLod(distanceM);
  };

  return {
    root: environment,
    detailRoot: vegetation.root,
    fixtureRoot: fixtureEnvironment,
    surfaceMesh,
    waterNormalTexture: waterPresentation.normalTexture,
    updateDetailLod,
    detailLodSnapshot: () => {
      const vegetationSnapshot = vegetation.snapshot();
      return {
        level: vegetationSnapshot.level,
        grassBladesVisible: vegetationSnapshot.grassBladesVisible,
        shrubsVisible: vegetationSnapshot.shrubsVisible,
        fixtureVisualsVisible: fixtureEnvironment.visible,
        surfaceRegionsVisible: surfaceRegions.visible,
        surfaces: surfaceRegions.snapshot(),
        water: waterPresentation.snapshot(),
      };
    },
    materialLibrarySnapshot: materialLibrary.snapshot,
    setPerformanceMode(enabled) {
      performanceMode = Boolean(enabled);
      field.visible = !enabled;
      performanceField.visible = performanceMode;
      vegetation.setPerformanceMode(performanceMode);
      surfaceRegions.setPerformanceMode(performanceMode);
      waterPresentation.setPerformanceMode(performanceMode);
      for (const detail of fixtureDetailVisuals)
        detail.visible = !performanceMode;
      for (const fixtureVisual of fixtureShadowVisuals)
        fixtureVisual.castShadow = !performanceMode;
    },
  };
}
