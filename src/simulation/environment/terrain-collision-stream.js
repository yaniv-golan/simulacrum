import * as CANNON from "cannon-es";
import { createYUpHeightfieldCandidateFilter } from "../heightfield-broadphase.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../../model/plain-data-contract.js";

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
      checkpointPolicy: "reconstruct-from-owner-v1",
      surface: "streamed terrain",
      materialKey: "compacted-soil",
      tile: key,
      rollingSupportAt: (x, z) => {
        const localX = (x - minimumX) / elementSize,
          localZ = (maximumZ - z) / elementSize,
          ix = Math.max(0, Math.min(this.segments - 1, Math.floor(localX))),
          iz = Math.max(0, Math.min(this.segments - 1, Math.floor(localZ))),
          fx = localX - ix,
          fz = localZ - iz,
          triangle = fx + fz <= 1 ? 0 : 1,
          delta = elementSize * 0.5,
          left = Number(this.heightAt(x - delta, z)) || 0,
          right = Number(this.heightAt(x + delta, z)) || 0,
          back = Number(this.heightAt(x, z - delta)) || 0,
          front = Number(this.heightAt(x, z + delta)) || 0,
          nx = -(right - left) / (2 * delta),
          nz = -(front - back) / (2 * delta),
          length = Math.hypot(nx, 1, nz);
        return Object.freeze({
          validity:
            localX >= 0 &&
            localX <= this.segments &&
            localZ >= 0 &&
            localZ <= this.segments
              ? "measured"
              : "unavailable",
          heightM: Number(this.heightAt(x, z)) || 0,
          normal: Object.freeze({
            x: nx / length,
            y: 1 / length,
            z: nz / length,
          }),
          materialKey: "compacted-soil",
          featureId: `terrain:${key}:heightfield:cell:${ix}:${iz}:triangle:${triangle}`,
        });
      },
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
    return issueInertPlainData({
      version: 2,
      keys: [...this.tiles.keys()].sort(),
    });
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_TERRAIN_CHECKPOINT_INPUT",
      message:
        "Terrain checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      Object.keys(state).sort().join("\0") !== "keys\0version" ||
      state.version !== 2
    )
      throw new TypeError(
        "terrain checkpoint must be an exact version 2 mutable projection",
      );
    if (
      !Array.isArray(state.keys) ||
      new Set(state.keys).size !== state.keys.length ||
      state.keys.some((key) => {
        if (typeof key !== "string") return true;
        const values = key.split(",").map(Number);
        return (
          values.length !== 2 ||
          values.some((value) => !Number.isSafeInteger(value)) ||
          key !== `${values[0]},${values[1]}` ||
          key === this.centralKey
        );
      })
    )
      throw new TypeError("terrain checkpoint contains invalid tile keys");
    return new Set(state.keys);
  }

  checkpointExternalBodyPlan(state) {
    const required = this.validateState(state);
    return {
      currentExternalBodyIds: [...this.tiles.values()].map(
        (body) => body.userData.externalBodyId,
      ),
      targetExternalBodies: [...required].map((key) => ({
        externalBodyId: `environment:terrain:${key}`,
        type: CANNON.Body.STATIC,
        checkpointPolicy: "reconstruct-from-owner-v1",
      })),
    };
  }

  importState(state) {
    const required = this.validateState(state);
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
