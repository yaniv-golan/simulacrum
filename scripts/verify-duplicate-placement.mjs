import assert from "node:assert/strict";
import { TYPES } from "../src/model/component-catalog.js";
import { planDuplicatePlacement } from "../src/model/duplicate-placement.js";
import { AUTHORING_WORKSPACE_BOUNDS_WORLD_M } from "../src/model/authoring-space-policy.js";

const part = (id, pos, overrides = {}) => ({
  id,
  type: "beam",
  pos,
  orientation: [0, 0, 0, 1],
  scale: { x: 1, y: 1, z: 1 },
  config: {},
  ...overrides,
});
const plan = (parts, options = {}) =>
  planDuplicatePlacement({
    snapshot: { parts, connections: [] },
    catalog: TYPES,
    selectedPartIds: [1],
    intent: {
      camera: {
        positionWorldM: [10, 8, 0],
        rightWorld: [0, 0, 1],
      },
    },
    ...options,
  });

const towardCamera = plan([part(1, [0, 1, 0])]);
assert.equal(towardCamera.status, "placed");
assert.equal(towardCamera.strategy, "toward-camera");
assert.deepEqual(towardCamera.directionWorld, [1, 0, 0]);
assert.deepEqual(towardCamera.offsetWorldM, [2.5, 0, 0]);
assert.equal(towardCamera.stepIndex, 1);

const skippedObstacle = plan([part(1, [0, 1, 0]), part(2, [2.5, 1, 0])]);
assert.equal(skippedObstacle.status, "placed");
assert.ok(skippedObstacle.stepIndex > 1);
assert.deepEqual(skippedObstacle.offsetWorldM, [5, 0, 0]);
assert.ok(
  skippedObstacle.rejectedCandidates.some((candidate) =>
    candidate.blockerPartIds?.includes(2),
  ),
);

const nestedObstacles = plan([
  part(1, [0, 1, 0]),
  part(2, [2.5, 1, 0]),
  part(3, [5, 1, 0]),
]);
assert.deepEqual(nestedObstacles.offsetWorldM, [7.5, 0, 0]);
assert.equal(nestedObstacles.stepIndex, 21);

const group = plan(
  [part(1, [0, 1, 0]), part(2, [0, 1, 1]), part(3, [5, 1, 0])],
  { selectedPartIds: [1, 2] },
);
assert.equal(group.status, "placed");
assert.deepEqual(group.offsetWorldM, [2.5, 0, 0]);

const hoveredFace = plan([part(1, [0, 1, 0])], {
  intent: {
    hoveredFace: { partId: 1, normalWorld: [0.1, 0, -0.9] },
    camera: { positionWorldM: [10, 8, 0], rightWorld: [1, 0, 0] },
  },
});
assert.equal(hoveredFace.strategy, "hover-face");
assert.deepEqual(hoveredFace.directionWorld, [0, 0, -1]);
assert.deepEqual(hoveredFace.offsetWorldM, [0, 0, -0.5]);

const topViewFallback = plan([part(1, [0, 1, 0])], {
  intent: {
    camera: { positionWorldM: [0, 20, 0], rightWorld: [0, 0, 1] },
  },
});
assert.equal(topViewFallback.strategy, "camera-right-fallback");
assert.deepEqual(topViewFallback.directionWorld, [0, 0, 1]);

const blocked = plan([part(1, [0, 1, 0]), part(2, [2.5, 1, 0])], {
  maxSteps: 1,
});
assert.equal(blocked.status, "rejected");
assert.equal(blocked.reason, "no-clear-position");
assert.deepEqual(blocked.rejectedCandidates[0].blockerPartIds, [2]);

const rotatedScaled = plan([
  part(1, [0, 1, 0], {
    orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: { x: 2, y: 1, z: 1 },
  }),
]);
assert.equal(rotatedScaled.status, "placed");
assert.deepEqual(rotatedScaled.offsetWorldM, [0.5, 0, 0]);

const edgeRejected = plan([part(1, [20.5, 1, 0])], {
  intent: {
    camera: { positionWorldM: [100, 8, 0], rightWorld: [0, 0, 1] },
  },
});
assert.equal(edgeRejected.status, "rejected");
assert.equal(edgeRejected.reason, "no-in-bounds-position");
assert.equal(edgeRejected.rejectedCandidates[0].outOfBounds, true);
assert.deepEqual(AUTHORING_WORKSPACE_BOUNDS_WORLD_M.minimumM, [-22, null, -22]);

const externallyPlaced = plan([part(1, [100, 1, 0])], {
  intent: {
    camera: { positionWorldM: [110, 8, 0], rightWorld: [0, 0, 1] },
  },
});
assert.equal(externallyPlaced.status, "placed");
assert.deepEqual(externallyPlaced.offsetWorldM, [2.5, 0, 0]);

const flexibleLine = plan([
  part(1, [0, 2, 0], {
    type: "rope",
    config: { lengthM: 4, diameterM: 0.04 },
  }),
]);
assert.equal(flexibleLine.status, "placed");
assert.deepEqual(flexibleLine.offsetWorldM, [0.25, 0, 0]);

const manyBlockers = plan(
  [
    part(1, [0, 1, 0]),
    ...Array.from({ length: 20 }, (_, index) =>
      part(index + 2, [(index + 1) * 2.5, 1, 0]),
    ),
  ],
  { boundsWorldM: null, maxSteps: 220 },
);
assert.equal(manyBlockers.status, "placed");
assert.ok(manyBlockers.rejectedCandidates.length <= 16);

assert.deepEqual(
  plan([part(1, [0, 1, 0]), part(2, [2.5, 1, 0])]),
  skippedObstacle,
  "identical placement input was not deterministic",
);

console.log(
  "duplicate placement passed (intent precedence, snapped clearance, deterministic obstacle skipping and bounded rejection)",
);
