import * as THREE from "three";

/**
 * Builds the authoritative visual terrain grid from the same world-height
 * query and element size consumed by the physical test-site projection.
 */
export function createTestSiteTerrainGeometry({
  testSite,
  terrainHeightAt,
  baseHeightM,
  targetElementSizeM = 2.5,
}) {
  const [centerX, centerZ] = testSite.footprint.centerM,
    [width, depth] = testSite.footprint.sizeM,
    segmentsX = Math.ceil(width / targetElementSizeM),
    segmentsZ = Math.ceil(depth / targetElementSizeM),
    elementSizeX = width / segmentsX,
    elementSizeZ = depth / segmentsZ;
  if (Math.abs(elementSizeX - elementSizeZ) > 1e-9)
    throw new RangeError(
      "Test-site visual footprint must resolve to square terrain cells",
    );
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ),
    positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const x = centerX + positions.getX(index),
      worldZ = centerZ - positions.getY(index);
    positions.setZ(index, terrainHeightAt(x, worldZ) - baseHeightM);
  }
  const indices = [],
    rowWidth = segmentsX + 1;
  for (let z = 0; z < segmentsZ; z++)
    for (let x = 0; x < segmentsX; x++) {
      const a = z * rowWidth + x,
        b = a + 1,
        c = a + rowWidth,
        d = c + 1;
      // Cannon Heightfield chooses the a-d diagonal after the Y-up frame
      // rotation. Match it exactly so render and collision interpolate the
      // same nonlinear authored height samples inside every grid cell.
      indices.push(a, c, d, a, d, b);
    }
  geometry.setIndex(indices);
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  Object.assign(geometry.userData, {
    authority: "test-site-surface-field",
    elementSizeM: elementSizeX,
    segmentsX,
    segmentsZ,
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

function regionGeometry(region, terrainHeightAt) {
  const shape = region.shape;
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
        terrainHeightAt(point.x, point.z) + 0.018,
        point.z,
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }
  const segmentsX = Math.max(1, Math.ceil(shape.sizeM[0] / 5)),
    segmentsZ = Math.max(1, Math.ceil(shape.sizeM[1] / 5)),
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
      terrainHeightAt(point.x, point.z) + 0.018,
      point.z,
    );
  }
  positions.needsUpdate = true;
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

function addAirfieldMarkings(root, terrainHeightAt) {
  const paint = new THREE.MeshStandardMaterial({
    color: 0xf1eee0,
    roughness: 0.86,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  for (let x = -98; x <= 98; x += 14)
    flatMark(
      root,
      new THREE.PlaneGeometry(7, 0.34),
      paint,
      x,
      154,
      terrainHeightAt,
    );
  for (const x of [-108, 108])
    for (let offset = -5.5; offset <= 5.5; offset += 2.2)
      flatMark(
        root,
        new THREE.PlaneGeometry(5.5, 0.5),
        paint,
        x,
        154 + offset,
        terrainHeightAt,
      );
  const helipadRing = flatMark(
    root,
    new THREE.RingGeometry(6.2, 6.8, 64),
    paint,
    178,
    124,
    terrainHeightAt,
  );
  const hBar = (width, depth, offsetX = 0) =>
    flatMark(
      root,
      new THREE.PlaneGeometry(width, depth),
      paint,
      178 + offsetX,
      124,
      terrainHeightAt,
    );
  hBar(1.1, 8, -2.5);
  hBar(1.1, 8, 2.5);
  hBar(5, 1.1);
  return helipadRing;
}

function addAirfieldLights(root, terrainHeightAt) {
  const positionsByColor = new Map([
      [0xe9f5ff, []],
      [0x6fffb0, []],
      [0xff665e, []],
    ]),
    add = (color, x, z) =>
      positionsByColor.get(color).push(x, terrainHeightAt(x, z) + 0.16, z);

  // Bounded, visual-only navigation lights. Physical authority remains the
  // canonical runway/helipad surfaces and clear volumes; these points stay
  // readable in far/night LOD without adding colliders or per-light draws.
  for (let x = -114; x <= 114; x += 12)
    for (const z of [146.2, 161.8]) add(0xe9f5ff, x, z);
  for (const x of [-168, -156, -144, -132, 132, 144, 156, 168])
    for (const z of [150, 158]) add(0xe9f5ff, x, z);
  for (const x of [-120, 120])
    for (let z = 148; z <= 160; z += 3) add(0x6fffb0, x, z);
  for (const x of [-124, 124])
    for (let z = 149.5; z <= 158.5; z += 3) add(0xff665e, x, z);
  for (let index = 0; index < 28; index++) {
    const angle = (index / 28) * Math.PI * 2;
    add(0x6fffb0, 178 + Math.cos(angle) * 9.1, 124 + Math.sin(angle) * 9.1);
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
  materialsByKey,
}) {
  const root = new THREE.Group();
  root.name = "testSiteSurfaceRegions";
  parent.add(root);
  for (const region of testSite.surfaceRegions) {
    const material = materialsByKey.get(region.materialKey);
    if (!material) continue;
    const surface = new THREE.Mesh(
      regionGeometry(region, terrainHeightAt),
      material,
    );
    surface.name = `surface-region:${region.id}`;
    surface.receiveShadow = true;
    root.add(surface);
  }
  addAirfieldMarkings(root, terrainHeightAt);
  addAirfieldLights(root, terrainHeightAt);
  return root;
}
