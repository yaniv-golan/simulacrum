import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { BodyRegistry } from "../src/simulation/body-registry.js";

const catalog = {
  line: {
    flexibleLine: { kind: "flexible-line-v1" },
    ports: [],
  },
};
const snapshot = {
    parts: [
      {
        id: "line-1",
        type: "line",
        pos: [0, 2, 0],
        orientation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        config: {},
      },
    ],
  },
  registry = new BodyRegistry(snapshot, catalog),
  engineBodies = Array.from(
    { length: 3 },
    (_, index) =>
      new CANNON.Body({
        mass: 0.2,
        position: new CANNON.Vec3(0, 2 - index * 0.5, 0),
      }),
  );

registry.registerPhysicalEntities(
  "line-1",
  engineBodies.map((engineBody, index) => ({
    bodyId: `flex:line-1:node:${index}`,
    engineBody,
    descriptor: {
      kind: "flexible-line-node-v1",
      sourcePartId: "line-1",
      nodeIndex: index,
    },
    pose: {
      position: engineBody.position,
      quaternion: engineBody.quaternion,
    },
  })),
);

assert.equal(
  registry.bodyForPart("line-1"),
  null,
  "ambiguous source part silently selected one entity",
);
assert.deepEqual(
  registry.bodiesForPart("line-1").map(({ bodyId }) => bodyId),
  ["flex:line-1:node:0", "flex:line-1:node:1", "flex:line-1:node:2"],
);
assert.equal(registry.engineBody("flex:line-1:node:1"), engineBodies[1]);

registry.beginTick(7);
registry.updateKinematics("flex:line-1:node:1", {
  position: [1, 1, 0],
  velocity: [2, 0, 0],
});
const checkpoint = registry.exportState();
registry.updateKinematics("flex:line-1:node:1", { position: [9, 9, 9] });
registry.importState(checkpoint);
assert.deepEqual(registry.body("flex:line-1:node:1").pose.position, {
  x: 1,
  y: 1,
  z: 0,
});

console.log("flexible-line physical ownership passed");
