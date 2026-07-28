import assert from "node:assert/strict";
import {
  buildCanonicalRollingSupportPoint,
  rollingContactPatchHalfLength,
  rollingSupportManifoldId,
} from "../src/simulation/rolling-support-manifold.js";

const dot = (left, right) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const subtract = (left, right) => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});
const near = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;
const rotateY = (value, angle) => ({
  x: value.x * Math.cos(angle) + value.z * Math.sin(angle),
  y: value.y,
  z: -value.x * Math.sin(angle) + value.z * Math.cos(angle),
});

const wheel = { x: 0.12, y: -0.5, z: 0.2 },
  support = { x: 0.12, y: -0.54, z: 0.2 },
  normal = { x: 0, y: 1, z: 0 },
  axle = { x: 0, y: 0, z: 1 },
  originalGap = dot(normal, subtract(support, wheel)),
  canonical = buildCanonicalRollingSupportPoint({
    wheelOffsetWorld: wheel,
    supportOffsetWorld: support,
    supportNormalWorld: normal,
    axleWorld: axle,
    maximumShiftM: 0.2,
  });
assert.equal(canonical.accepted, true);
assert.ok(near(canonical.wheelOffsetWorld.x, 0));
assert.ok(near(canonical.supportOffsetWorld.x, 0));
assert.ok(near(canonical.signedNormalGapM, originalGap));
assert.ok(
  near(
    dot(
      normal,
      subtract(canonical.supportOffsetWorld, canonical.wheelOffsetWorld),
    ),
    originalGap,
  ),
  "canonicalization changed signed normal separation",
);

for (const angle of [0, Math.PI / 7, Math.PI / 2, Math.PI, -Math.PI / 3]) {
  const rotated = buildCanonicalRollingSupportPoint({
    wheelOffsetWorld: rotateY(wheel, angle),
    supportOffsetWorld: rotateY(support, angle),
    supportNormalWorld: rotateY(normal, angle),
    axleWorld: rotateY(axle, angle),
    maximumShiftM: 0.2,
  });
  assert.equal(rotated.accepted, true);
  assert.ok(near(rotated.requiredCorrectionM, canonical.requiredCorrectionM));
  assert.ok(near(rotated.signedNormalGapM, originalGap));
}

const mirrored = buildCanonicalRollingSupportPoint({
  wheelOffsetWorld: { ...wheel, x: -wheel.x },
  supportOffsetWorld: { ...support, x: -support.x },
  supportNormalWorld: normal,
  axleWorld: { ...axle, z: -axle.z },
  maximumShiftM: 0.2,
});
assert.equal(mirrored.accepted, true);
assert.ok(near(mirrored.requiredCorrectionM, canonical.requiredCorrectionM));
assert.ok(near(mirrored.wheelOffsetWorld.x, -canonical.wheelOffsetWorld.x));

const rejected = buildCanonicalRollingSupportPoint({
  wheelOffsetWorld: { ...wheel, x: 0.5 },
  supportOffsetWorld: { ...support, x: 0.5 },
  supportNormalWorld: normal,
  axleWorld: axle,
  maximumShiftM: 0.2,
});
assert.equal(rejected.accepted, false);
assert.equal(rejected.reasonCode, "OUTSIDE_AUTHORED_CONTACT_PATCH");
assert.deepEqual(rejected.wheelOffsetWorld, { ...wheel, x: 0.5 });
assert.deepEqual(rejected.supportOffsetWorld, { ...support, x: 0.5 });

assert.ok(
  near(
    rollingContactPatchHalfLength({ radiusM: 0.7, maximumDeflectionM: 0.08 }),
    Math.sqrt(2 * 0.7 * 0.08 - 0.08 ** 2),
  ),
);
const identity = rollingSupportManifoldId({
  wheelId: "wheel-1",
  supportBodyId: "terrain",
  supportShapeId: "heightfield",
  featureId: "cell:3:4:triangle:1",
});
assert.equal(
  identity,
  rollingSupportManifoldId({
    featureId: "cell:3:4:triangle:1",
    supportShapeId: "heightfield",
    supportBodyId: "terrain",
    wheelId: "wheel-1",
  }),
  "manifold identity depended on construction order",
);

console.log("rolling-support manifold geometry passed");
