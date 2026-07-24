import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { testSiteShapeBounds } from "../model/test-site-shapes.js";
import {
  TEST_SITE_TERRAIN_ELEMENT_SIZE_M,
  testSiteHeightFeatureShape,
} from "../model/test-site-terrain.js";

/**
 * Builds the authoritative visual terrain grid from the same world-height
 * query and element size consumed by the physical test-site projection.
 */
export function createTestSiteTerrainGeometry({
  testSite,
  terrainHeightAt,
  baseHeightM,
  targetElementSizeM = TEST_SITE_TERRAIN_ELEMENT_SIZE_M,
}) {
  const [centerX, centerZ] = testSite.footprint.centerM,
    [width, depth] = testSite.footprint.sizeM,
    segmentsX = Math.ceil(width / targetElementSizeM),
    segmentsZ = Math.ceil(depth / targetElementSizeM),
    elementSizeX = width / segmentsX,
    elementSizeZ = depth / segmentsZ,
    tileTargetSizeM = 40,
    tilesX = Math.ceil(width / tileTargetSizeM),
    tilesZ = Math.ceil(depth / tileTargetSizeM),
    tileWidthM = width / tilesX,
    tileDepthM = depth / tilesZ,
    minimumX = centerX - width / 2,
    minimumZ = centerZ - depth / 2,
    varyingBounds = [
      ...testSite.heightFeatures.map((feature) =>
        testSiteShapeBounds(testSiteHeightFeatureShape(feature)),
      ),
      ...testSite.fluidRegions.map(({ shape }) => testSiteShapeBounds(shape)),
    ],
    positions = [],
    uvs = [],
    indices = [];
  if (Math.abs(elementSizeX - elementSizeZ) > 1e-9)
    throw new RangeError(
      "Test-site visual footprint must resolve to square terrain cells",
    );
  let denseTileCount = 0;
  for (let tileZ = 0; tileZ < tilesZ; tileZ++)
    for (let tileX = 0; tileX < tilesX; tileX++) {
      const minX = minimumX + tileX * tileWidthM,
        maxX = minX + tileWidthM,
        minZ = minimumZ + tileZ * tileDepthM,
        maxZ = minZ + tileDepthM,
        dense = varyingBounds.some(
          (bounds) =>
            bounds.maxX >= minX - targetElementSizeM &&
            bounds.minX <= maxX + targetElementSizeM &&
            bounds.maxZ >= minZ - targetElementSizeM &&
            bounds.minZ <= maxZ + targetElementSizeM,
        ),
        tileElementSizeM = dense ? targetElementSizeM : targetElementSizeM * 4,
        tileSegmentsX = Math.ceil(tileWidthM / tileElementSizeM),
        tileSegmentsZ = Math.ceil(tileDepthM / tileElementSizeM),
        stepX = tileWidthM / tileSegmentsX,
        stepZ = tileDepthM / tileSegmentsZ,
        rowWidth = tileSegmentsX + 1,
        vertexOffset = positions.length / 3;
      if (dense) denseTileCount++;
      for (let iz = 0; iz <= tileSegmentsZ; iz++)
        for (let ix = 0; ix <= tileSegmentsX; ix++) {
          const worldX = minX + ix * stepX,
            worldZ = minZ + iz * stepZ;
          positions.push(
            worldX - centerX,
            centerZ - worldZ,
            terrainHeightAt(worldX, worldZ) - baseHeightM,
          );
          uvs.push(worldX, worldZ);
        }
      for (let iz = 0; iz < tileSegmentsZ; iz++)
        for (let ix = 0; ix < tileSegmentsX; ix++) {
          const a = vertexOffset + iz * rowWidth + ix,
            b = a + 1,
            c = a + rowWidth,
            d = c + 1;
          // Dense tiles align to Cannon's 2 m grid and use its a-d diagonal.
          // Coarse tiles are allowed only where the canonical height is flat.
          indices.push(a, c, d, a, d, b);
        }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  Object.assign(geometry.userData, {
    authority: "test-site-surface-field",
    elementSizeM: elementSizeX,
    segmentsX,
    segmentsZ,
    tileSizeM: tileWidthM,
    denseTileCount,
    tileCount: tilesX * tilesZ,
    triangleCount: indices.length / 3,
  });
  return geometry;
}

function worldPoint(shape, localX, localZ) {
  const cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad);
  return {
    x: shape.centerM[0] + localX * cosine - localZ * sine,
    z: shape.centerM[1] + localX * sine + localZ * cosine,
  };
}

function localShapeGeometry(shape, localRings) {
  const [outer, ...holes] = localRings,
    outline = new THREE.Shape();
  outer.forEach(([x, z], index) =>
    index ? outline.lineTo(x, -z) : outline.moveTo(x, -z),
  );
  outline.closePath();
  for (const ring of holes) {
    const hole = new THREE.Path();
    ring.forEach(([x, z], index) =>
      index ? hole.lineTo(x, -z) : hole.moveTo(x, -z),
    );
    hole.closePath();
    outline.holes.push(hole);
  }
  const geometry = new THREE.ShapeGeometry(outline);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const point = worldPoint(
      shape,
      positions.getX(index),
      positions.getZ(index),
    );
    positions.setXYZ(index, point.x, 0, point.z);
  }
  positions.needsUpdate = true;
  return geometry;
}

function corridorGeometry(shape) {
  const pieces = [],
    halfWidth = shape.widthM / 2;
  for (const path of shape.pathsM) {
    for (let index = 0; index < path.length - 1; index++) {
      const start = path[index],
        end = path[index + 1],
        dx = end[0] - start[0],
        dz = end[1] - start[1],
        length = Math.hypot(dx, dz),
        ux = dx / length,
        uz = dz / length,
        extension = shape.cap === "square" ? halfWidth : 0,
        px = -uz * halfWidth,
        pz = ux * halfWidth;
      pieces.push(
        localShapeGeometry(shape, [
          [
            [start[0] - ux * extension + px, start[1] - uz * extension + pz],
            [start[0] - ux * extension - px, start[1] - uz * extension - pz],
            [end[0] + ux * extension - px, end[1] + uz * extension - pz],
            [end[0] + ux * extension + px, end[1] + uz * extension + pz],
          ],
        ]),
      );
    }
    if (shape.cap === "round" || shape.join === "round") {
      const vertices =
        shape.cap === "round" ? path : path.length > 2 ? path.slice(1, -1) : [];
      for (const [x, z] of vertices) {
        const circle = new THREE.CircleGeometry(halfWidth, 24);
        circle.rotateX(-Math.PI / 2);
        const positions = circle.attributes.position;
        for (let index = 0; index < positions.count; index++) {
          const point = worldPoint(
            shape,
            positions.getX(index) + x,
            positions.getZ(index) + z,
          );
          positions.setXYZ(index, point.x, 0, point.z);
        }
        positions.needsUpdate = true;
        pieces.push(circle);
      }
    }
  }
  return mergeGeometries(pieces, false);
}

function conformGeometryToTerrain(geometry, terrainHeightAt, yOffset) {
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index),
      z = positions.getZ(index);
    positions.setY(index, terrainHeightAt(x, z) + yOffset);
    geometry.attributes.uv?.setXY(index, x, z);
  }
  if (!geometry.attributes.uv) {
    const uvs = [];
    for (let index = 0; index < positions.count; index++)
      uvs.push(positions.getX(index), positions.getZ(index));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }
  positions.needsUpdate = true;
  geometry.attributes.uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function regionGeometry(
  region,
  terrainHeightAt,
  yOffset = 0.018,
  elementSizeM = 5,
) {
  const shape = region.shape;
  if (shape.kind === "polygon")
    return conformGeometryToTerrain(
      localShapeGeometry(shape, shape.ringsM),
      terrainHeightAt,
      yOffset,
    );
  if (shape.kind === "corridor-network")
    return conformGeometryToTerrain(
      corridorGeometry(shape),
      terrainHeightAt,
      yOffset,
    );
  if (shape.kind === "ellipse") {
    const geometry = new THREE.CircleGeometry(1, 72),
      positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const localX = positions.getX(index) * shape.sizeM[0] * 0.5,
        localZ = -positions.getY(index) * shape.sizeM[1] * 0.5,
        point = worldPoint(shape, localX, localZ);
      positions.setXYZ(
        index,
        point.x,
        terrainHeightAt(point.x, point.z) + yOffset,
        point.z,
      );
      geometry.attributes.uv.setXY(index, point.x, point.z);
    }
    positions.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }
  const segmentsX = Math.max(1, Math.ceil(shape.sizeM[0] / elementSizeM)),
    segmentsZ = Math.max(1, Math.ceil(shape.sizeM[1] / elementSizeM)),
    geometry = new THREE.PlaneGeometry(
      shape.sizeM[0],
      shape.sizeM[1],
      segmentsX,
      segmentsZ,
    ),
    positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const point = worldPoint(
      shape,
      positions.getX(index),
      -positions.getY(index),
    );
    positions.setXYZ(
      index,
      point.x,
      terrainHeightAt(point.x, point.z) + yOffset,
      point.z,
    );
    geometry.attributes.uv.setXY(index, point.x, point.z);
  }
  positions.needsUpdate = true;
  geometry.attributes.uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function shoulderGeometry(region, terrainHeightAt, widthM) {
  const { shape } = region,
    positions = [],
    uvs = [],
    indices = [],
    pushQuad = (localPoints) => {
      const offset = positions.length / 3;
      for (const [localX, localZ] of localPoints) {
        const point = worldPoint(shape, localX, localZ);
        positions.push(
          point.x,
          terrainHeightAt(point.x, point.z) + 0.013,
          point.z,
        );
        uvs.push(point.x, point.z);
      }
      indices.push(
        offset,
        offset + 1,
        offset + 2,
        offset,
        offset + 2,
        offset + 3,
      );
    };
  if (shape.kind === "corridor-network")
    return regionGeometry(
      { ...region, shape: { ...shape, widthM: shape.widthM + widthM * 2 } },
      terrainHeightAt,
      0.013,
    );
  if (shape.kind === "polygon")
    return regionGeometry(region, terrainHeightAt, 0.013);
  if (shape.kind === "ellipse") {
    const segments = 96,
      innerX = shape.sizeM[0] / 2,
      innerZ = shape.sizeM[1] / 2,
      outerX = innerX + widthM,
      outerZ = innerZ + widthM;
    for (let index = 0; index < segments; index++) {
      const angleA = (index / segments) * Math.PI * 2,
        angleB = ((index + 1) / segments) * Math.PI * 2;
      pushQuad([
        [Math.cos(angleA) * innerX, Math.sin(angleA) * innerZ],
        [Math.cos(angleA) * outerX, Math.sin(angleA) * outerZ],
        [Math.cos(angleB) * outerX, Math.sin(angleB) * outerZ],
        [Math.cos(angleB) * innerX, Math.sin(angleB) * innerZ],
      ]);
    }
  } else {
    const innerX = shape.sizeM[0] / 2,
      innerZ = shape.sizeM[1] / 2,
      outerX = innerX + widthM,
      outerZ = innerZ + widthM,
      sides = [
        {
          length: shape.sizeM[0],
          point: (t, outer) => [
            THREE.MathUtils.lerp(-outerX, outerX, t),
            outer ? -outerZ : -innerZ,
          ],
        },
        {
          length: shape.sizeM[1],
          point: (t, outer) => [
            outer ? outerX : innerX,
            THREE.MathUtils.lerp(-outerZ, outerZ, t),
          ],
        },
        {
          length: shape.sizeM[0],
          point: (t, outer) => [
            THREE.MathUtils.lerp(outerX, -outerX, t),
            outer ? outerZ : innerZ,
          ],
        },
        {
          length: shape.sizeM[1],
          point: (t, outer) => [
            outer ? -outerX : -innerX,
            THREE.MathUtils.lerp(outerZ, -outerZ, t),
          ],
        },
      ];
    for (const side of sides) {
      const segments = Math.max(1, Math.ceil(side.length / 5));
      for (let index = 0; index < segments; index++) {
        const a = index / segments,
          b = (index + 1) / segments;
        pushQuad([
          side.point(a, false),
          side.point(a, true),
          side.point(b, true),
          side.point(b, false),
        ]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function flatMark(parent, geometry, material, x, z, terrainHeightAt) {
  const mark = new THREE.Mesh(geometry, material);
  mark.position.set(x, terrainHeightAt(x, z) + 0.045, z);
  mark.rotation.x = -Math.PI / 2;
  mark.receiveShadow = false;
  parent.add(mark);
  return mark;
}

function addAirfieldMarkings(root, terrainHeightAt, testSite) {
  const paint = new THREE.MeshStandardMaterial({
      color: 0xf1eee0,
      roughness: 0.86,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    runway = testSite.surfaceRegions.find(({ id }) => id === "runway"),
    helipad = testSite.surfaceRegions.find(({ id }) => id === "helipad"),
    runwayLongX = runway.shape.sizeM[0] >= runway.shape.sizeM[1],
    runwayLength = Math.max(...runway.shape.sizeM),
    runwayWidth = Math.min(...runway.shape.sizeM),
    runwayPoint = (along, across = 0) =>
      worldPoint(
        runway.shape,
        runwayLongX ? along : across,
        runwayLongX ? across : along,
      ),
    runwayGeometry = (along, across) =>
      new THREE.PlaneGeometry(
        runwayLongX ? along : across,
        runwayLongX ? across : along,
      );
  for (
    let along = -runwayLength / 2 + 20;
    along <= runwayLength / 2 - 20;
    along += 14
  ) {
    const point = runwayPoint(along);
    flatMark(
      root,
      runwayGeometry(7, 0.34),
      paint,
      point.x,
      point.z,
      terrainHeightAt,
    );
  }
  for (const along of [-runwayLength / 2 + 12, runwayLength / 2 - 12])
    for (
      let offset = -runwayWidth / 2 + 2;
      offset <= runwayWidth / 2 - 2;
      offset += 2.2
    ) {
      const point = runwayPoint(along, offset);
      flatMark(
        root,
        runwayGeometry(5.5, 0.5),
        paint,
        point.x,
        point.z,
        terrainHeightAt,
      );
    }
  for (const across of [-runwayWidth / 2 + 0.25, runwayWidth / 2 - 0.25]) {
    const point = runwayPoint(0, across);
    flatMark(
      root,
      runwayGeometry(runwayLength, 0.22),
      paint,
      point.x,
      point.z,
      terrainHeightAt,
    );
  }
  const helipadRadius = Math.min(...helipad.shape.sizeM) / 2,
    [helipadX, helipadZ] = helipad.shape.centerM;
  const helipadRing = flatMark(
    root,
    new THREE.RingGeometry(helipadRadius * 0.68, helipadRadius * 0.76, 64),
    paint,
    helipadX,
    helipadZ,
    terrainHeightAt,
  );
  const hBar = (width, depth, offsetX = 0) =>
    flatMark(
      root,
      new THREE.PlaneGeometry(width, depth),
      paint,
      helipadX + offsetX,
      helipadZ,
      terrainHeightAt,
    );
  hBar(1.1, 8, -2.5);
  hBar(1.1, 8, 2.5);
  hBar(5, 1.1);
  return helipadRing;
}

function addSurfaceWear(root, terrainHeightAt, testSite) {
  const fadedPaint = new THREE.MeshStandardMaterial({
      color: 0xc7a84a,
      roughness: 0.9,
      transparent: true,
      opacity: 0.64,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    tirePolish = new THREE.MeshStandardMaterial({
      color: 0x242b2b,
      roughness: 0.5,
      transparent: true,
      opacity: 0.19,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  const lanes = testSite.surfaceRegions.filter(({ id }) =>
    id.startsWith("lane-"),
  );
  for (const lane of lanes) {
    const [x, z] = lane.shape.centerM,
      entryZ = z - lane.shape.sizeM[1] / 2 + 2;
    flatMark(
      root,
      new THREE.PlaneGeometry(lane.shape.sizeM[0] * 0.82, 1.1),
      fadedPaint,
      x,
      entryZ,
      terrainHeightAt,
    );
  }
  const handling = testSite.surfaceRegions.find(
      ({ id }) => id === "handling-pad",
    ),
    [handlingX, handlingZ] = handling.shape.centerM;
  for (const radius of [10.5, 19.5, 26]) {
    const ring = flatMark(
      root,
      new THREE.RingGeometry(radius - 0.22, radius + 0.22, 96),
      tirePolish,
      handlingX,
      handlingZ,
      terrainHeightAt,
    );
    ring.scale.y = 0.86;
  }
  for (const x of [-18, -6, 6, 18])
    flatMark(
      root,
      new THREE.PlaneGeometry(0.09, 44),
      tirePolish,
      x,
      0,
      terrainHeightAt,
    );
}

function addAirfieldLights(root, terrainHeightAt, testSite) {
  const positionsByColor = new Map([
      [0xe9f5ff, []],
      [0x6fffb0, []],
      [0xff665e, []],
    ]),
    add = (color, x, z) =>
      positionsByColor.get(color).push(x, terrainHeightAt(x, z) + 0.16, z),
    runway = testSite.surfaceRegions.find(({ id }) => id === "runway"),
    helipad = testSite.surfaceRegions.find(({ id }) => id === "helipad"),
    runwayLongX = runway.shape.sizeM[0] >= runway.shape.sizeM[1],
    runwayLength = Math.max(...runway.shape.sizeM),
    runwayWidth = Math.min(...runway.shape.sizeM),
    runwayPoint = (along, across = 0) =>
      worldPoint(
        runway.shape,
        runwayLongX ? along : across,
        runwayLongX ? across : along,
      );

  // Bounded, visual-only navigation lights. Physical authority remains the
  // canonical runway/helipad surfaces and clear volumes; these points stay
  // readable in far/night LOD without adding colliders or per-light draws.
  for (let along = -runwayLength / 2; along <= runwayLength / 2; along += 12)
    for (const across of [-runwayWidth / 2, runwayWidth / 2]) {
      const point = runwayPoint(along, across);
      add(0xe9f5ff, point.x, point.z);
    }
  for (const along of [-runwayLength / 2, runwayLength / 2])
    for (
      let across = -runwayWidth / 2 + 1.5;
      across <= runwayWidth / 2 - 1.5;
      across += 3
    ) {
      const point = runwayPoint(along, across);
      add(0x6fffb0, point.x, point.z);
      const overrun = runwayPoint(along + Math.sign(along) * 4, across);
      add(0xff665e, overrun.x, overrun.z);
    }
  const [helipadX, helipadZ] = helipad.shape.centerM,
    helipadRadius = Math.min(...helipad.shape.sizeM) / 2 + 0.5;
  for (let index = 0; index < 28; index++) {
    const angle = (index / 28) * Math.PI * 2;
    add(
      0x6fffb0,
      helipadX + Math.cos(angle) * helipadRadius,
      helipadZ + Math.sin(angle) * helipadRadius,
    );
  }

  for (const [color, positions] of positionsByColor) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const lights = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: 4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    lights.name = `airfield-navigation-lights:${color.toString(16)}`;
    lights.renderOrder = 4;
    root.add(lights);
  }
}

/** Adds clean, zero-thickness appearance layers over the physical surface mesh. */
export function createTestSiteSurfacePresentation({
  parent,
  testSite,
  terrainHeightAt,
  surfaceMaterial,
  applyMaterialProfile,
}) {
  const root = new THREE.Group(),
    shoulders = new THREE.Group(),
    surfaces = new THREE.Group(),
    markings = new THREE.Group(),
    wear = new THREE.Group(),
    navigationLights = new THREE.Group();
  root.name = "testSiteSurfaceRegions";
  shoulders.name = "testSiteSurfaceShoulders";
  surfaces.name = "testSiteCanonicalSurfaceAppearance";
  markings.name = "testSiteSurfaceMarkings";
  wear.name = "testSiteSurfaceWear";
  navigationLights.name = "testSiteNavigationLights";
  root.add(shoulders, surfaces, markings, wear, navigationLights);
  parent.add(root);
  const shoulderGeometries = [],
    surfaceGeometries = [];
  for (const region of testSite.surfaceRegions) {
    const shoulderWidthM = region.materialKey === "short-grass" ? 0.45 : 1.15,
      shoulderGeo = shoulderGeometry(region, terrainHeightAt, shoulderWidthM);
    applyMaterialProfile(shoulderGeo, "compacted-soil");
    shoulderGeometries.push(shoulderGeo);

    const regionBounds = testSiteShapeBounds(region.shape),
      intersectsTerrainFeature = testSite.heightFeatures.some((feature) => {
        const featureBounds = testSiteShapeBounds(
          testSiteHeightFeatureShape(feature),
        );
        return (
          featureBounds.maxX >= regionBounds.minX &&
          featureBounds.minX <= regionBounds.maxX &&
          featureBounds.maxZ >= regionBounds.minZ &&
          featureBounds.minZ <= regionBounds.maxZ
        );
      }),
      // Feature-bearing skins match the canonical cell ceiling so they cannot
      // chord through washboard/grade relief; provably flat skins stay coarse.
      geometry = regionGeometry(
        region,
        terrainHeightAt,
        0.018,
        intersectsTerrainFeature ? TEST_SITE_TERRAIN_ELEMENT_SIZE_M : 5,
      );
    applyMaterialProfile(geometry, region.materialKey);
    surfaceGeometries.push(geometry);
  }
  const shoulder = new THREE.Mesh(
      mergeGeometries(shoulderGeometries, false),
      surfaceMaterial,
    ),
    surface = new THREE.Mesh(
      mergeGeometries(surfaceGeometries, false),
      surfaceMaterial,
    );
  shoulder.name = "surface-shoulders:merged";
  shoulder.receiveShadow = true;
  surface.name = "surface-regions:merged";
  surface.receiveShadow = true;
  shoulders.add(shoulder);
  surfaces.add(surface);
  addAirfieldMarkings(markings, terrainHeightAt, testSite);
  addSurfaceWear(wear, terrainHeightAt, testSite);
  addAirfieldLights(navigationLights, terrainHeightAt, testSite);
  let detailLevel = "near",
    performanceMode = false;
  const applyDetail = () => {
    wear.visible = !performanceMode && detailLevel !== "far";
  };
  root.updateDetailLod = (distanceM) => {
    detailLevel = distanceM > 140 ? "far" : distanceM > 45 ? "mid" : "near";
    applyDetail();
  };
  root.setPerformanceMode = (enabled) => {
    performanceMode = Boolean(enabled);
    applyDetail();
  };
  root.snapshot = () => ({
    level: performanceMode ? "performance" : detailLevel,
    shouldersVisible: shoulders.visible,
    markingsVisible: markings.visible,
    wearVisible: wear.visible,
    navigationLightsVisible: navigationLights.visible,
  });
  return root;
}
