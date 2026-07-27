import * as CANNON from "cannon-es";
import { createYUpHeightfieldCandidateFilter } from "../heightfield-broadphase.js";

/**
 * Maintains deterministic heightfield collision tiles around active bodies.
 * Tile coordinates, not demo identity or travel history, determine every
 * sample, so returning to a location recreates the same physical terrain.
 */
export class TerrainCollisionStream {
  constructor({
    world,
    heightAt,
    material,
    tileSize = 160,
    segments = 32,
    centralTile = { x: 0, z: 0 },
    neighborhood = 1,
  }) {
    this.world = world;
    this.heightAt = heightAt;
    this.material = material;
    this.tileSize = Math.max(10, Number(tileSize));
    this.segments = Math.max(2, Math.floor(segments));
    this.centralKey = this.#key(centralTile.x, centralTile.z);
    this.neighborhood = Math.max(0, Math.floor(neighborhood));
    this.tiles = new Map();
  }

  #coordinate(value) {
    return Math.floor((Number(value) + this.tileSize / 2) / this.tileSize);
  }

  #key(x, z) {
    return `${x},${z}`;
  }

  update(positions) {
    const required = new Set();
    for (const position of positions || []) {
      const centerX = this.#coordinate(position.x),
        centerZ = this.#coordinate(position.z);
      for (let dx = -this.neighborhood; dx <= this.neighborhood; dx++)
        for (let dz = -this.neighborhood; dz <= this.neighborhood; dz++) {
          const x = centerX + dx,
            z = centerZ + dz,
            key = this.#key(x, z);
          if (key !== this.centralKey) required.add(key);
        }
    }
    for (const key of required) {
      if (this.tiles.has(key)) continue;
      const [x, z] = key.split(",").map(Number);
      this.tiles.set(key, this.#createTile(x, z, key));
    }
    for (const [key, body] of this.tiles) {
      if (required.has(key)) continue;
      this.world.removeBody(body);
      this.tiles.delete(key);
    }
    return this.telemetry();
  }

  #createTile(tileX, tileZ, key) {
    const minimumX = tileX * this.tileSize - this.tileSize / 2,
      maximumZ = tileZ * this.tileSize + this.tileSize / 2,
      elementSize = this.tileSize / this.segments,
      heights = [];
    for (let ix = 0; ix <= this.segments; ix++) {
      const row = [],
        x = minimumX + ix * elementSize;
      for (let iz = 0; iz <= this.segments; iz++) {
        const z = maximumZ - iz * elementSize;
        row.push(Number(this.heightAt(x, z)) || 0);
      }
      heights.push(row);
    }
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.material,
    });
    const heightfield = new CANNON.Heightfield(heights, { elementSize });
    /** @type {any} */ (heightfield).userData = {
      materialKey: "compacted-soil",
      shapeId: `terrain:${key}:heightfield`,
      featureIdentityKind: "heightfield-cell-triangle-v1",
    };
    body.addShape(heightfield);
    body.position.set(minimumX, 0, maximumZ);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    const runtimeBody = /** @type {any} */ (body);
    runtimeBody.userData = {
      externalBodyId: `environment:terrain:${key}`,
      surface: "streamed terrain",
      materialKey: "compacted-soil",
      tile: key,
      broadphaseCandidateFilter: createYUpHeightfieldCandidateFilter({
        heights,
        elementSize,
        originX: minimumX,
        originZ: maximumZ,
      }),
    };
    this.world.addBody(body);
    return body;
  }

  telemetry() {
    return {
      activeTiles: this.tiles.size,
      tileSize: this.tileSize,
      segments: this.segments,
      keys: [...this.tiles.keys()].sort(),
    };
  }

  exportState() {
    return {
      version: 1,
      tileSize: this.tileSize,
      segments: this.segments,
      centralKey: this.centralKey,
      neighborhood: this.neighborhood,
      keys: [...this.tiles.keys()].sort(),
    };
  }

  importState(state) {
    if (
      state?.version !== 1 ||
      state.tileSize !== this.tileSize ||
      state.segments !== this.segments ||
      state.centralKey !== this.centralKey ||
      state.neighborhood !== this.neighborhood
    )
      throw new TypeError(
        "terrain checkpoint does not match the running terrain stream",
      );
    const required = new Set(state.keys || []);
    for (const [key, body] of this.tiles) {
      if (required.has(key)) continue;
      this.world.removeBody(body);
      this.tiles.delete(key);
    }
    for (const key of required) {
      if (this.tiles.has(key)) continue;
      const [x, z] = key.split(",").map(Number);
      this.tiles.set(key, this.#createTile(x, z, key));
    }
  }

  dispose() {
    for (const body of this.tiles.values()) this.world.removeBody(body);
    this.tiles.clear();
  }
}
