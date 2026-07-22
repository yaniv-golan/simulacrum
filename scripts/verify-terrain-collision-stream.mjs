import * as CANNON from "cannon-es";
import { TerrainCollisionStream } from "../src/simulation/environment/terrain-collision-stream.js";
import { assert } from "./lib/assert.mjs";

const heightAt = (x, z) =>
    1.5 + Math.sin(x * 0.013) * 0.4 + Math.cos(z * 0.017) * 0.3,
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.80665, 0) }),
  stream = new TerrainCollisionStream({
    world,
    heightAt,
    material: new CANNON.Material("terrain"),
    tileSize: 160,
    segments: 32,
    neighborhood: 1,
  }),
  initialWorldBodies = world.bodies.length,
  remotePosition = new CANNON.Vec3(400, 20, 10),
  first = stream.update([remotePosition]),
  firstIds = world.bodies
    .map((body) => body.userData?.externalBodyId)
    .filter(Boolean)
    .sort();

assert.equal(first.activeTiles, 9, "remote neighborhood was not materialized");
assert.equal(
  world.bodies.length,
  initialWorldBodies + 9,
  "terrain tiles were not added to the shared world",
);
stream.update([remotePosition]);
assert.equal(
  world.bodies.length,
  initialWorldBodies + 9,
  "stable positions duplicated terrain colliders",
);

const box = new CANNON.Body({ mass: 4, position: remotePosition.clone() });
box.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
world.addBody(box);
for (let index = 0; index < 600; index++) world.step(1 / 120);
const expectedSurface = heightAt(box.position.x, box.position.z);
assert.ok(
  box.position.y >= expectedSurface + 0.35 &&
    box.position.y <= expectedSurface + 0.9,
  `body did not settle on streamed terrain: y=${box.position.y.toFixed(3)} surface=${expectedSurface.toFixed(3)}`,
);

stream.update([new CANNON.Vec3(700, 10, -500)]);
assert.equal(
  stream.telemetry().activeTiles,
  9,
  "inactive collision tiles were retained",
);
stream.update([remotePosition]);
const returningIds = world.bodies
  .map((body) => body.userData?.externalBodyId)
  .filter(Boolean)
  .sort();
assert.deepEqual(
  returningIds,
  firstIds,
  "returning to coordinates changed deterministic collider identity",
);

stream.dispose();
assert.equal(
  world.bodies.length,
  initialWorldBodies + 1,
  "dispose left streamed terrain bodies in the world",
);
console.log("terrain collision stream verified");
