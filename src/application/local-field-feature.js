import * as THREE from "three";
import { mesh } from "../presentation/mesh-primitives.js";
import {
  createTestSiteSurfacePresentation,
  createTestSiteTerrainGeometry,
} from "../presentation/test-site-surface-presentation.js";
import { createTestSiteFixtureFeature } from "./test-site-fixture-feature.js";

/** Composes the authored field's visual surface and matching static colliders. */
export function createLocalFieldFeature({
  scene,
  world,
  renderer,
  groundMaterial,
  terrainHeightAt,
  pondAt,
  pondSpecs,
  fieldSurfaceY,
  testSite,
}) {
  let waterNormalTextureRef, surfaceMesh;
  const environment = new THREE.Group();
  environment.name = "fieldEnvironment";
  scene.add(environment);
  function terrainTexture(base, flecks, seedValue, streaks = false) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = base;
    context.fillRect(0, 0, 256, 256);
    let textureSeed = seedValue;
    const textureRandom = () => {
      textureSeed = (textureSeed * 1664525 + 1013904223) >>> 0;
      return textureSeed / 4294967296;
    };
    for (let i = 0; i < 1800; i++) {
      context.globalAlpha = 0.08 + textureRandom() * 0.25;
      context.fillStyle = flecks[Math.floor(textureRandom() * flecks.length)];
      const x = textureRandom() * 256,
        y = textureRandom() * 256,
        width = 0.5 + textureRandom() * (streaks ? 7 : 3),
        height = 0.5 + textureRandom() * (streaks ? 1.8 : 3);
      context.beginPath();
      context.ellipse(
        x,
        y,
        width,
        height,
        textureRandom() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(24, 24);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }
  const grassTexture = terrainTexture(
      "#526b3e",
      ["#78915a", "#344d2f", "#9a8855", "#c0ad76"],
      87031,
      true,
    ),
    soilTexture = terrainTexture(
      "#715238",
      ["#9c7650", "#443123", "#b18a62", "#5c432d"],
      66103,
    ),
    wetSoilTexture = terrainTexture(
      "#3d3a2d",
      ["#665844", "#24271f", "#78694d"],
      77213,
    ),
    asphaltTexture = terrainTexture(
      "#303637",
      ["#4a5050", "#202526", "#69706f"],
      48131,
      true,
    ),
    concreteTexture = terrainTexture(
      "#777e7a",
      ["#9ca29d", "#5e6662", "#b8b7aa"],
      44031,
      true,
    ),
    gravelTexture = terrainTexture(
      "#74736d",
      ["#a09d91", "#4b4b47", "#c1b8a2", "#626966"],
      31415,
    ),
    sandTexture = terrainTexture(
      "#c2a66f",
      ["#e0ca94", "#9d8153", "#d3b77a"],
      27183,
      true,
    ),
    polymerTexture = terrainTexture(
      "#c5d5d8",
      ["#eff8f8", "#8fa8ad", "#b1c5c9"],
      16180,
      true,
    ),
    waterNormalCanvas = document.createElement("canvas");
  waterNormalCanvas.width = waterNormalCanvas.height = 256;
  const waterNormalContext = waterNormalCanvas.getContext("2d"),
    waterNormalImage = waterNormalContext.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const waveX =
          Math.cos(x * 0.17 + y * 0.035) * 0.42 +
          Math.cos(x * 0.061 - y * 0.13) * 0.25,
        waveY =
          Math.sin(y * 0.145 + x * 0.028) * 0.42 +
          Math.sin(y * 0.052 - x * 0.11) * 0.25,
        index = (y * 256 + x) * 4;
      waterNormalImage.data[index] = 128 + waveX * 95;
      waterNormalImage.data[index + 1] = 128 + waveY * 95;
      waterNormalImage.data[index + 2] = 224;
      waterNormalImage.data[index + 3] = 255;
    }
  waterNormalContext.putImageData(waterNormalImage, 0, 0);
  const waterNormalTexture = new THREE.CanvasTexture(waterNormalCanvas);
  waterNormalTexture.wrapS = waterNormalTexture.wrapT = THREE.RepeatWrapping;
  waterNormalTexture.repeat.set(3.1, 2.55);
  waterNormalTextureRef = waterNormalTexture;
  const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: grassTexture,
      roughness: 0.96,
      metalness: 0,
    }),
    soilMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: soilTexture,
      roughness: 1,
    }),
    wetSoilMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wetSoilTexture,
      roughness: 0.82,
    }),
    barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f4027,
      roughness: 1,
    }),
    leafMaterials = [0x315b35, 0x3f703e, 0x527d43].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    ),
    concreteMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concreteTexture,
      roughness: 0.88,
      metalness: 0.08,
    }),
    asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphaltTexture,
      roughness: 0.9,
    }),
    wetAsphaltMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x81969b,
      map: asphaltTexture,
      roughness: 0.24,
      clearcoat: 0.72,
      clearcoatRoughness: 0.19,
    }),
    gravelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: gravelTexture,
      roughness: 1,
    }),
    sandMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandTexture,
      roughness: 1,
    }),
    lowGripMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: polymerTexture,
      roughness: 0.16,
      clearcoat: 0.58,
    }),
    columnMaterial = new THREE.MeshStandardMaterial({
      color: 0x43565a,
      roughness: 0.52,
      metalness: 0.42,
    }),
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x216877,
      emissive: 0x082b35,
      emissiveIntensity: 0.11,
      roughness: 0.13,
      metalness: 0,
      transparent: true,
      opacity: 0.64,
      transmission: 0.26,
      ior: 1.333,
      thickness: 1.8,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      normalMap: waterNormalTexture,
      normalScale: new THREE.Vector2(0.2, 0.2),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  const materialEntries = /** @type {Array<[string, THREE.Material]>} */ ([
      ["short-grass", grassMaterial],
      ["dry-asphalt", asphaltMaterial],
      ["wet-asphalt", wetAsphaltMaterial],
      ["weathered-concrete", concreteMaterial],
      ["compacted-soil", soilMaterial],
      ["loose-gravel", gravelMaterial],
      ["dry-sand", sandMaterial],
      ["saturated-mud", wetSoilMaterial],
      ["low-grip-polymer", lowGripMaterial],
    ]),
    materialsByKey = new Map(materialEntries),
    [fieldCenterX, fieldCenterZ] = testSite.footprint.centerM;
  const fieldGeometry = createTestSiteTerrainGeometry({
    testSite,
    terrainHeightAt,
    baseHeightM: fieldSurfaceY,
  });
  const field = mesh(
    fieldGeometry,
    grassMaterial,
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
  const performanceField = mesh(
    performanceFieldGeometry,
    grassMaterial,
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
    materialsByKey,
  });
  function basinOverlay(pond) {
    const radialSegments = 14,
      angularSegments = 72,
      vertices = [],
      uvs = [],
      indices = [];
    for (let ring = 0; ring <= radialSegments; ring++) {
      const radius = ring / radialSegments;
      for (let segment = 0; segment < angularSegments; segment++) {
        const angle = (segment / angularSegments) * Math.PI * 2,
          x = pond.x + Math.cos(angle) * pond.rx * radius,
          z = pond.z + Math.sin(angle) * pond.rz * radius;
        vertices.push(x, terrainHeightAt(x, z) + 0.012, z);
        uvs.push(
          (Math.cos(angle) * radius + 1) / 2,
          (Math.sin(angle) * radius + 1) / 2,
        );
      }
    }
    for (let ring = 0; ring < radialSegments; ring++)
      for (let segment = 0; segment < angularSegments; segment++) {
        const next = (segment + 1) % angularSegments,
          a = ring * angularSegments + segment,
          b = ring * angularSegments + next,
          c = (ring + 1) * angularSegments + segment,
          d = (ring + 1) * angularSegments + next;
        indices.push(a, c, b, b, c, d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const bed = mesh(geometry, wetSoilMaterial, [], [], environment);
    bed.castShadow = false;
    return bed;
  }
  // Both water meshes and their terrain beds consume the same fluid regions.
  for (const pond of pondSpecs) {
    basinOverlay(pond);
    const water = mesh(
      new THREE.CircleGeometry(1, 96),
      waterMaterial.clone(),
      [pond.x, pond.waterY, pond.z],
      [-Math.PI / 2, 0, 0],
      environment,
    );
    water.scale.set(pond.rx * 0.965, pond.rz * 0.965, 1);
    water.castShadow = false;
    water.receiveShadow = true;
    const shorePoints = [];
    for (let i = 0; i < 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      shorePoints.push(
        new THREE.Vector3(
          pond.x + Math.cos(angle) * pond.rx * 0.972,
          pond.waterY + 0.012,
          pond.z + Math.sin(angle) * pond.rz * 0.972,
        ),
      );
    }
    const shore = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(shorePoints),
      new THREE.LineBasicMaterial({
        color: 0xb6d3ba,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
    );
    environment.add(shore);
  }

  // Physical fixtures stay recognizable at every presentation LOD. Only
  // decorative scatter is expendable when distance or assembly size needs the
  // render budget; colliders, terrain, soils, water, and landmarks remain.
  const fixtureEnvironment = new THREE.Group(),
    scatterEnvironment = new THREE.Group();
  fixtureEnvironment.name = "testSiteFixtureEnvironment";
  scatterEnvironment.name = "fieldScatterEnvironment";
  environment.add(fixtureEnvironment, scatterEnvironment);

  createTestSiteFixtureFeature({
    parent: fixtureEnvironment,
    world,
    groundMaterial,
    testSite,
    terrainHeightAt,
    materials: {
      bark: barkMaterial,
      leaves: leafMaterials,
      stone: concreteMaterial,
      signPost: columnMaterial,
      signFace: lowGripMaterial,
    },
  });

  let seed = 19790317;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Crossed tapered blades catch light from multiple angles and vary in both
  // species color and height, without carpeting water or engineered surfaces.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.055, 0, 0, 0.055, 0, 0, 0.012, 0.48, 0, 0, 0, -0.055, 0, 0, 0.055, 0,
        0.43, 0.012, -0.04, 0, -0.04, 0.04, 0, 0.04, 0, 0.36, 0,
      ],
      3,
    ),
  );
  bladeGeometry.computeVertexNormals();
  const grassBladeCount = 2200;
  const blades = new THREE.InstancedMesh(
      bladeGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      grassBladeCount,
    ),
    dummy = new THREE.Object3D(),
    grassColors = [0x6e8b45, 0x8d9d52, 0x526f3a, 0x9a8b4b].map(
      (color) => new THREE.Color(color),
    );
  let grassPlaced = 0,
    grassAttempts = 0;
  while (
    grassPlaced < grassBladeCount &&
    grassAttempts++ < grassBladeCount * 20
  ) {
    const x = -66 + random() * 132,
      z = -66 + random() * 132;
    if ((Math.abs(x) < 25 && Math.abs(z) < 25) || pondAt(x, z, 1.06)) continue;
    const dryPatch = Math.hypot((x + 35) / 14, (z + 31) / 10) < 1;
    if (dryPatch || random() < 0.37) continue;
    const s = 0.55 + random() * 1.15;
    dummy.position.set(x, terrainHeightAt(x, z) + 0.012, z);
    dummy.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.12);
    dummy.scale.set(0.72 + random() * 0.55, s, 0.72 + random() * 0.55);
    dummy.updateMatrix();
    blades.setMatrixAt(grassPlaced, dummy.matrix);
    blades.setColorAt(
      grassPlaced,
      grassColors[Math.floor(random() * grassColors.length)],
    );
    grassPlaced++;
  }
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  blades.receiveShadow = true;
  scatterEnvironment.add(blades);

  let performanceMode = false,
    detailLod = "near";
  const applyDetailLod = () => {
      const visibleCount = performanceMode
        ? 0
        : detailLod === "near"
          ? grassPlaced
          : detailLod === "mid"
            ? Math.min(grassPlaced, 760)
            : 0;
      blades.count = visibleCount;
      scatterEnvironment.visible = visibleCount > 0;
    },
    updateDetailLod = (distanceM) => {
      const next = distanceM > 140 ? "far" : distanceM > 40 ? "mid" : "near";
      if (next === detailLod) return;
      detailLod = next;
      applyDetailLod();
    };
  applyDetailLod();

  return {
    root: environment,
    detailRoot: scatterEnvironment,
    fixtureRoot: fixtureEnvironment,
    surfaceMesh,
    waterNormalTexture: waterNormalTextureRef,
    updateDetailLod,
    detailLodSnapshot: () => ({
      level: performanceMode ? "performance" : detailLod,
      grassBladesVisible: blades.count,
      fixtureVisualsVisible: fixtureEnvironment.visible,
      surfaceRegionsVisible: surfaceRegions.visible,
    }),
    setPerformanceMode(enabled) {
      performanceMode = Boolean(enabled);
      field.visible = !enabled;
      performanceField.visible = performanceMode;
      applyDetailLod();
    },
  };
}
