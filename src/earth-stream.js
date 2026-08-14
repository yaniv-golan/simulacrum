import { trackOwnedRenderResource } from "./presentation/render-resources.js";

export function createEarthStreamer({
  THREE,
  CANNON,
  scene,
  world,
  groundMaterial,
  chunkSize,
  seaLevelY,
  surfaceSample,
  coordinateHash,
  generatedPoolAt,
  localTerrainBounds = null,
  streamRadius = 3,
  collisionRadius = 1,
}) {
  const group = new THREE.Group(),
    chunks = new Map(),
    terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
    }),
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x176e87,
      transparent: true,
      opacity: 0.7,
      roughness: 0.16,
      transmission: 0.18,
      ior: 1.333,
      depthWrite: false,
    }),
    roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x555955,
      roughness: 0.9,
    }),
    gravelMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a7b65,
      roughness: 1,
    }),
    trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x59412d,
      roughness: 1,
    }),
    leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x416d3e,
      roughness: 0.94,
    });
  group.name = "deterministicEarthChunkStream";
  scene.add(group);
  let centerKey = "";

  function terrainColor(sample) {
    if (sample.water) return new THREE.Color(0x236f7d);
    if (sample.biome === "tundra") return new THREE.Color(0x9da59b);
    if (sample.biome === "dryland") return new THREE.Color(0x9a8256);
    if (sample.biome === "mountain")
      return new THREE.Color(0x59605a).lerp(
        new THREE.Color(0xe0dfd5),
        THREE.MathUtils.smoothstep(sample.elevation, 500, 1700),
      );
    return new THREE.Color(0x587544);
  }

  function makeChunk(chunkX, chunkZ, originEastM, originNorthM) {
    const resolution = 16,
      step = chunkSize / resolution,
      minEast = chunkX * chunkSize,
      minNorth = chunkZ * chunkSize,
      axisCoordinates = (minimum, origin, low, high) => {
        const values = Array.from(
          { length: resolution + 1 },
          (_, index) => index * step,
        );
        if (localTerrainBounds)
          for (const boundary of [low, high]) {
            const local = origin + boundary - minimum;
            if (local > 1e-6 && local < chunkSize - 1e-6) values.push(local);
          }
        return [...new Set(values)].sort((a, b) => a - b);
      },
      xCoordinates = axisCoordinates(
        minEast,
        originEastM,
        localTerrainBounds?.minX,
        localTerrainBounds?.maxX,
      ),
      zCoordinates = axisCoordinates(
        minNorth,
        originNorthM,
        localTerrainBounds?.minZ,
        localTerrainBounds?.maxZ,
      ),
      vertices = [],
      colors = [],
      indices = [],
      vertexIndex = (ix, iz) => ix * zCoordinates.length + iz,
      locallyOwned = (localX, localZ) =>
        !!localTerrainBounds &&
        localX >= localTerrainBounds.minX &&
        localX <= localTerrainBounds.maxX &&
        localZ >= localTerrainBounds.minZ &&
        localZ <= localTerrainBounds.maxZ;
    let waterVertices = 0;
    for (let ix = 0; ix < xCoordinates.length; ix++) {
      for (let iz = 0; iz < zCoordinates.length; iz++) {
        const sample = surfaceSample(
            minEast + xCoordinates[ix],
            minNorth + zCoordinates[iz],
          ),
          color = terrainColor(sample);
        vertices.push(xCoordinates[ix], sample.elevation, zCoordinates[iz]);
        colors.push(color.r, color.g, color.b);
        if (sample.water) waterVertices++;
      }
    }
    for (let ix = 0; ix < xCoordinates.length - 1; ix++)
      for (let iz = 0; iz < zCoordinates.length - 1; iz++) {
        const localCenterX =
            minEast +
            (xCoordinates[ix] + xCoordinates[ix + 1]) * 0.5 -
            originEastM,
          localCenterZ =
            minNorth +
            (zCoordinates[iz] + zCoordinates[iz + 1]) * 0.5 -
            originNorthM;
        if (locallyOwned(localCenterX, localCenterZ)) continue;
        const a = vertexIndex(ix, iz),
          b = vertexIndex(ix + 1, iz),
          c = a + 1,
          d = b + 1;
        indices.push(a, c, b, b, c, d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const chunkGroup = new THREE.Group(),
      terrain = new THREE.Mesh(geometry, terrainMaterial),
      centerSample = surfaceSample(
        minEast + chunkSize * 0.5,
        minNorth + chunkSize * 0.5,
      ),
      reserveDistance = Math.hypot(
        minEast + chunkSize * 0.5,
        minNorth + chunkSize * 0.5,
      ),
      outsideWorkshopReserve = reserveDistance > 900;
    chunkGroup.name = `earth-chunk-${chunkX}-${chunkZ}`;
    chunkGroup.position.set(minEast - originEastM, 0, minNorth - originNorthM);
    terrain.receiveShadow = true;
    chunkGroup.add(terrain);
    if (!centerSample.land) {
      const ocean = new THREE.Mesh(
        new THREE.PlaneGeometry(chunkSize, chunkSize),
        waterMaterial,
      );
      ocean.position.set(chunkSize * 0.5, seaLevelY, chunkSize * 0.5);
      ocean.rotation.x = -Math.PI / 2;
      ocean.receiveShadow = true;
      chunkGroup.add(ocean);
    }
    const pool = generatedPoolAt(
      minEast + chunkSize * 0.5,
      minNorth + chunkSize * 0.5,
    );
    if (pool && Math.hypot(pool.centerEast, pool.centerNorth) > 900) {
      const sample = surfaceSample(pool.centerEast, pool.centerNorth),
        water = new THREE.Mesh(
          new THREE.CircleGeometry(pool.radius * 0.94, 40),
          waterMaterial,
        );
      water.position.set(
        pool.centerEast - minEast,
        sample.waterY + 0.02,
        pool.centerNorth - minNorth,
      );
      water.rotation.x = -Math.PI / 2;
      chunkGroup.add(water);
    }
    if (
      outsideWorkshopReserve &&
      centerSample.land &&
      coordinateHash(chunkX, chunkZ, 4101) < 0.24
    ) {
      const road = new THREE.Mesh(
        new THREE.BoxGeometry(chunkSize * 1.2, 0.16, 5.5),
        roadMaterial,
      );
      road.position.set(
        chunkSize * 0.5,
        centerSample.elevation + 0.12,
        chunkSize * 0.5,
      );
      road.rotation.y = coordinateHash(chunkX, chunkZ, 4102) * Math.PI;
      road.receiveShadow = true;
      chunkGroup.add(road);
    }
    if (
      outsideWorkshopReserve &&
      centerSample.land &&
      coordinateHash(chunkX, chunkZ, 4201) < 0.3
    ) {
      const gravel = new THREE.Mesh(
        new THREE.CircleGeometry(
          18 + coordinateHash(chunkX, chunkZ, 4202) * 42,
          28,
        ),
        gravelMaterial,
      );
      gravel.position.set(
        chunkSize * (0.2 + coordinateHash(chunkX, chunkZ, 4203) * 0.6),
        centerSample.elevation + 0.08,
        chunkSize * (0.2 + coordinateHash(chunkX, chunkZ, 4204) * 0.6),
      );
      gravel.rotation.x = -Math.PI / 2;
      chunkGroup.add(gravel);
    }
    const treeCount = !outsideWorkshopReserve
      ? 0
      : centerSample.biome === "temperate"
        ? 4 + Math.floor(coordinateHash(chunkX, chunkZ, 4301) * 8)
        : centerSample.biome === "dryland"
          ? Math.floor(coordinateHash(chunkX, chunkZ, 4302) * 3)
          : 0;
    if (treeCount) {
      const trunks = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.22, 0.34, 3.2, 7),
          trunkMaterial,
          treeCount,
        ),
        crowns = new THREE.InstancedMesh(
          new THREE.IcosahedronGeometry(1.55, 1),
          leafMaterial,
          treeCount,
        ),
        dummy = new THREE.Object3D();
      for (let index = 0; index < treeCount; index++) {
        const localX =
            chunkSize *
            (0.08 + coordinateHash(chunkX, chunkZ, 4400 + index * 3) * 0.84),
          localZ =
            chunkSize *
            (0.08 + coordinateHash(chunkX, chunkZ, 4401 + index * 3) * 0.84),
          sample = surfaceSample(minEast + localX, minNorth + localZ),
          scale = 0.7 + coordinateHash(chunkX, chunkZ, 4402 + index * 3) * 0.8;
        dummy.position.set(localX, sample.elevation + 1.6 * scale, localZ);
        dummy.scale.set(scale, scale, scale);
        dummy.rotation.y =
          coordinateHash(chunkX, chunkZ, 4500 + index) * Math.PI;
        dummy.updateMatrix();
        trunks.setMatrixAt(index, dummy.matrix);
        dummy.position.y = sample.elevation + 4.2 * scale;
        dummy.scale.set(scale, scale * 0.9, scale);
        dummy.updateMatrix();
        crowns.setMatrixAt(index, dummy.matrix);
      }
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      chunkGroup.add(trunks, crowns);
    }
    const ownedGeometries = new Set();
    chunkGroup.traverse((object) => {
      if (object.geometry) ownedGeometries.add(object.geometry);
    });
    for (const geometry of ownedGeometries)
      trackOwnedRenderResource(geometry, "earthChunkGeometries");
    group.add(chunkGroup);
    return {
      key: `${chunkX},${chunkZ}`,
      chunkX,
      chunkZ,
      minEast,
      minNorth,
      group: chunkGroup,
      collisionVertices: vertices,
      collisionIndices: indices,
      collisionBody: null,
      collisionEnabled: false,
      biome: centerSample.biome,
      land: centerSample.land,
      waterFraction:
        waterVertices / (xCoordinates.length * zCoordinates.length),
      treeCount,
      signature: [
        coordinateHash(chunkX, chunkZ, 4101),
        coordinateHash(chunkX, chunkZ, 4201),
        coordinateHash(chunkX, chunkZ, 4301),
      ]
        .map((value) => value.toString(36).slice(2, 8))
        .join("-"),
    };
  }

  function setCollision(chunk, enabled, originEastM, originNorthM) {
    if (enabled === chunk.collisionEnabled) return;
    chunk.collisionEnabled = enabled;
    if (!enabled) {
      if (chunk.collisionBody) world.removeBody(chunk.collisionBody);
      chunk.collisionBody = null;
      return;
    }
    if (!chunk.collisionIndices.length) return;
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
    });
    body.addShape(
      new CANNON.Trimesh(chunk.collisionVertices, chunk.collisionIndices),
    );
    body.position.set(
      chunk.minEast - originEastM,
      0,
      chunk.minNorth - originNorthM,
    );
    body.userData = {
      externalBodyId: `environment:earth:${chunk.key}`,
      checkpointPolicy: "reconstruct-from-owner-v1",
      surface: "streamed Earth terrain",
      materialKey: "natural-terrain",
      earthChunk: chunk.key,
    };
    world.addBody(body);
    chunk.collisionBody = body;
  }

  function disposeChunk(chunk) {
    if (chunk.collisionBody) world.removeBody(chunk.collisionBody);
    group.remove(chunk.group);
    chunk.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
  }

  function clear() {
    for (const chunk of chunks.values()) disposeChunk(chunk);
    chunks.clear();
    centerKey = "";
  }

  function geometryResources() {
    const geometries = new Set();
    for (const chunk of chunks.values())
      chunk.group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
      });
    return [...geometries];
  }

  function update(
    originEastM,
    originNorthM,
    focusX,
    focusZ,
    maxNewChunks = Infinity,
  ) {
    const globalEast = originEastM + focusX,
      globalNorth = originNorthM + focusZ,
      centerX = Math.floor(globalEast / chunkSize),
      centerZ = Math.floor(globalNorth / chunkSize),
      nextCenterKey = `${centerX},${centerZ}`,
      centerChanged = nextCenterKey !== centerKey,
      required = new Set(),
      candidates = [];
    centerKey = nextCenterKey;
    for (let dx = -streamRadius; dx <= streamRadius; dx++)
      for (let dz = -streamRadius; dz <= streamRadius; dz++) {
        const chunkX = centerX + dx,
          chunkZ = centerZ + dz,
          key = `${chunkX},${chunkZ}`;
        required.add(key);
        candidates.push({ chunkX, chunkZ, key, dx, dz });
      }
    candidates.sort(
      (left, right) =>
        Math.max(Math.abs(left.dx), Math.abs(left.dz)) -
          Math.max(Math.abs(right.dx), Math.abs(right.dz)) ||
        left.dx ** 2 + left.dz ** 2 - (right.dx ** 2 + right.dz ** 2),
    );
    let changed = centerChanged,
      created = 0;
    for (const [key, chunk] of [...chunks]) {
      if (required.has(key)) continue;
      disposeChunk(chunk);
      chunks.delete(key);
      changed = true;
    }
    for (const candidate of candidates) {
      let chunk = chunks.get(candidate.key);
      if (!chunk && created < maxNewChunks) {
        chunk = makeChunk(
          candidate.chunkX,
          candidate.chunkZ,
          originEastM,
          originNorthM,
        );
        chunks.set(candidate.key, chunk);
        created++;
        changed = true;
      }
      if (chunk)
        setCollision(
          chunk,
          Math.abs(candidate.dx) <= collisionRadius &&
            Math.abs(candidate.dz) <= collisionRadius,
          originEastM,
          originNorthM,
        );
    }
    return {
      centerX,
      centerZ,
      changed,
      pending: required.size - chunks.size,
    };
  }

  return { group, chunks, update, clear, geometryResources };
}
