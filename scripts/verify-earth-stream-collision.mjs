import * as CANNON from "cannon-es";
import * as THREE from "three";
import { createEarthStreamer } from "../src/earth-stream.js";
import { assert } from "./lib/assert.mjs";

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  scene = new THREE.Group(),
  material = new CANNON.Material("earth"),
  localTerrainBounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  streamer = createEarthStreamer({
    THREE,
    CANNON,
    scene,
    world,
    groundMaterial: material,
    chunkSize: 160,
    seaLevelY: -2,
    surfaceSample: () => ({
      elevation: 0,
      water: false,
      land: true,
      biome: "grassland",
    }),
    coordinateHash: () => 0.5,
    generatedPoolAt: () => null,
    localTerrainBounds,
    streamRadius: 0,
    collisionRadius: 0,
  });

streamer.update(0, 0, 10, 10, 1);
const chunk = streamer.chunks.get("0,0"),
  collider = chunk?.collisionBody;
assert.ok(chunk && collider, "Earth collision chunk was not materialized");
assert.ok(
  collider.shapes[0] instanceof CANNON.Trimesh,
  "Earth collision did not use the rendered triangle ownership mesh",
);
assert.equal(
  collider.userData.materialKey,
  "natural-terrain",
  "Earth collider omitted its explicit contact material identity",
);

for (let offset = 0; offset < chunk.collisionIndices.length; offset += 3) {
  const triangle = chunk.collisionIndices
      .slice(offset, offset + 3)
      .map((index) => chunk.collisionVertices.slice(index * 3, index * 3 + 3)),
    centerX = triangle.reduce((sum, vertex) => sum + vertex[0], 0) / 3,
    centerZ = triangle.reduce((sum, vertex) => sum + vertex[2], 0) / 3,
    locallyOwned =
      centerX >= localTerrainBounds.minX &&
      centerX <= localTerrainBounds.maxX &&
      centerZ >= localTerrainBounds.minZ &&
      centerZ <= localTerrainBounds.maxZ;
  assert.equal(
    locallyOwned,
    false,
    "streamed Earth retained a collision triangle under local terrain",
  );
}

function probe(position) {
  const body = new CANNON.Body({
    mass: 1,
    position: new CANNON.Vec3(...position),
  });
  body.addShape(new CANNON.Sphere(0.5));
  world.addBody(body);
  return body;
}

const localProbe = probe([20, 5, 20]),
  earthProbe = probe([90, 5, 90]);
for (let tick = 0; tick < 360; tick++) world.step(1 / 120);
assert.ok(
  localProbe.position.y < -5,
  "streamed Earth collider still supported a body inside the local cutout",
);
assert.ok(
  earthProbe.position.y >= 0.45 && earthProbe.position.y <= 0.7,
  `body did not settle on streamed Earth triangles: ${earthProbe.position.y}`,
);

streamer.clear();
assert.equal(
  world.bodies.includes(collider),
  false,
  "clearing streamed Earth retained its collision body",
);
console.log("Earth collision ownership verified");
