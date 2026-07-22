import assert from "node:assert/strict";
import {
  compileMechanismBodyGeometry,
  mechanismGeometryIdentityQuaternion,
} from "../src/model/mechanism-geometry-compiler.js";
import { stableStringify } from "../src/model/primitives.js";

const identity = [...mechanismGeometryIdentityQuaternion];
const frame = (positionM = [0, 0, 0], orientation = identity) => ({
  positionM,
  orientation,
});
const failureLoadLaw = null;

function axleComponent(massPropertySource, collisionRegions = []) {
  return {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType: "axle",
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource,
    collisionRegions,
    config: {
      radiusM: 0.1,
      axialLengthM: 1,
      axis: "local-positive-z-v1",
      materialKey: "steel",
      failureLoadLaw,
    },
  };
}

const explicitMass = () => ({
  kind: "explicit-tensor-v1",
  massKg: 5,
  comPositionPartM: [0.1, -0.2, 0.3],
  inertiaTensorAtComPartKgM2: {
    xx: 2,
    yy: 3,
    zz: 4,
    xy: 0.1,
    xz: -0.2,
    yz: 0.3,
  },
});

const structureRegion = (
  geometry,
  localFramePart = frame(),
  key = "structure",
) => ({
  key,
  localFramePart,
  geometry,
  materialKey: "steel",
  contactRole: "structure",
});

function compile(component, overrides = {}) {
  return compileMechanismBodyGeometry({
    sourcePartId: 7,
    component,
    positionWorldM: [0, 0, 0],
    orientationWorld: identity,
    ...overrides,
  });
}

function close(actual, expected, tolerance = 1e-10, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function closeVector(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    close(value, expected[index], tolerance, `axis ${index}`),
  );
}

const explicit = axleComponent(explicitMass(), [
    structureRegion(
      { kind: "box-v1", fullSizeM: [2, 4, 6] },
      frame([1, 2, 3], [0, 0, Math.SQRT1_2, Math.SQRT1_2]),
    ),
  ]),
  before = stableStringify(explicit),
  compiled = compile(explicit, { positionWorldM: [10, 20, 30] });
assert.equal(
  stableStringify(explicit),
  before,
  "compiler mutated authored input",
);
assert.ok(Object.isFrozen(compiled) && Object.isFrozen(compiled.body));
assert.equal(compiled.descriptorVersion, 1);
assert.equal(compiled.body.id, "body:7");
assert.equal(compiled.body.telemetryOwnerId, "body:7");
assert.equal(compiled.body.failureGroupId, "part:7");
assert.deepEqual(compiled.body.frameWorld, {
  positionM: [10, 20, 30],
  orientation: identity,
});
assert.deepEqual(compiled.body.dimensionalScalingPolicy, {
  kind: "fixed-authored-size-v1",
});
assert.equal(compiled.body.massProperties.sourceKind, "explicit-tensor-v1");
assert.equal(compiled.body.massProperties.massKg, 5);
assert.deepEqual(
  compiled.body.massProperties.comPositionPartM,
  [0.1, -0.2, 0.3],
);
assert.deepEqual(
  compiled.body.massProperties.inertiaTensorAtComPartKgM2,
  explicit.massPropertySource.inertiaTensorAtComPartKgM2,
);
assert.deepEqual(compiled.body.massProperties.contributingSolidIds, []);
assert.equal(
  compiled.body.massProperties.decompositionPolicy,
  "ordered-right-handed-jacobi-v1",
);
const reconstructedTensor = [0, 1, 2].map((row) =>
  [0, 1, 2].map((column) =>
    compiled.body.massProperties.principalMomentsKgM2.reduce(
      (total, moment, index) =>
        total +
        moment *
          compiled.body.massProperties.principalAxesPart[index][row] *
          compiled.body.massProperties.principalAxesPart[index][column],
      0,
    ),
  ),
);
close(reconstructedTensor[0][0], 2);
close(reconstructedTensor[1][1], 3);
close(reconstructedTensor[2][2], 4);
close(reconstructedTensor[0][1], 0.1);
close(reconstructedTensor[0][2], -0.2);
close(reconstructedTensor[1][2], 0.3);
assert.equal(compiled.body.collisionRegions[0].id, "collision:7:structure");
closeVector(compiled.body.collisionRegions[0].boundsPartM.minimumM, [-1, 1, 0]);
closeVector(compiled.body.collisionRegions[0].boundsPartM.maximumM, [3, 3, 6]);
assert.deepEqual(
  compiled.body.boundsPartM,
  compiled.body.collisionRegions[0].boundsPartM,
);
assert.match(compiled.sourceFingerprint, /^sim-sha256-[0-9a-f]{64}$/);
assert.match(compiled.topologyDigest, /^sim-sha256-[0-9a-f]{64}$/);
assert.equal(
  compile(explicit).topologyDigest,
  compile(explicit).topologyDigest,
);
assert.equal(
  compile(explicit).sourceFingerprint,
  compile(explicit, {
    positionWorldM: [4, 5, 6],
    orientationWorld: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  }).sourceFingerprint,
  "reusable definition fingerprint must not depend on instance placement",
);
assert.notEqual(
  compile(explicit).topologyDigest,
  compile(explicit, { positionWorldM: [0, 0, 1] }).topologyDigest,
);
assert.notEqual(
  compile(explicit).topologyDigest,
  compile(explicit, {
    orientationWorld: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  }).topologyDigest,
);
assert.deepEqual(compiled.body.collisionRegions[0].provenance, [
  {
    target: "framePart",
    sourcePath: ["collisionRegions", 0, "localFramePart"],
  },
  {
    target: "geometry",
    sourcePath: ["collisionRegions", 0, "geometry"],
  },
  {
    target: "materialKey",
    sourcePath: ["collisionRegions", 0, "materialKey"],
  },
  {
    target: "contactRole",
    sourcePath: ["collisionRegions", 0, "contactRole"],
  },
]);

const tetrahedronGeometry = {
    kind: "closed-triangle-mesh-v1",
    coordinateExponent10: 0,
    verticesTicks: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    triangleIndices: [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ],
  },
  collisionGeometryFamilies = [
    { kind: "sphere-v1", radiusM: 0.2 },
    {
      kind: "cylinder-v1",
      radiusM: 0.2,
      axialLengthM: 0.6,
      axis: "local-positive-z-v1",
    },
    {
      kind: "capsule-v1",
      radiusM: 0.2,
      straightLengthM: 0.6,
      axis: "local-positive-z-v1",
    },
    {
      kind: "rounded-wheel-v1",
      radiusM: 0.5,
      widthM: 0.3,
      shoulderRadiusM: 0.05,
      axis: "local-positive-z-v1",
    },
    tetrahedronGeometry,
  ],
  collisionFamilyComponent = axleComponent(
    explicitMass(),
    collisionGeometryFamilies.map((geometry, index) =>
      structureRegion(geometry, frame(), `region-${index}`),
    ),
  ),
  compiledCollisionFamilies = compile(collisionFamilyComponent).body
    .collisionRegions;
assert.equal(
  compiledCollisionFamilies.length,
  collisionGeometryFamilies.length,
);
for (const region of compiledCollisionFamilies) {
  assert.ok(region.boundsPartM.minimumM.every(Number.isFinite));
  assert.ok(region.boundsPartM.maximumM.every(Number.isFinite));
}

const bearing = {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType: "bearing",
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: explicitMass(),
    collisionRegions: [],
    config: {
      frameA: frame([1, 0, 0]),
      frameB: frame([-1, 0, 0]),
      freeAxis: "local-positive-z-v1",
      angleRangeRad: null,
      lowerHardImpactLaw: null,
      upperHardImpactLaw: null,
      lowerStop: null,
      upperStop: null,
      friction: { kind: "none-v1" },
      actuation: null,
      failureLoadLaw,
    },
  },
  bearingFrames = compile(bearing).body.attachmentFrames;
assert.deepEqual(
  bearingFrames.map(({ id }) => id),
  ["frame-a", "frame-b"],
);
assert.deepEqual(bearingFrames[0].provenancePath, ["config", "frameA"]);

function uniformComponent(
  geometry,
  localFramePart = frame(),
  densityKgPerM3 = 1,
) {
  return axleComponent({
    kind: "uniform-density-solids-v1",
    densityKgPerM3,
    massSolids: [{ id: "solid", localFramePart, geometry }],
  });
}

const box = compile(uniformComponent({ kind: "box-v1", fullSizeM: [2, 4, 6] }))
  .body.massProperties;
close(box.massKg, 48);
close(box.volumeM3, 48);
close(box.inertiaTensorAtComPartKgM2.xx, 208);
close(box.inertiaTensorAtComPartKgM2.yy, 160);
close(box.inertiaTensorAtComPartKgM2.zz, 80);
assert.equal(
  box.massEvaluationPolicy,
  "analytic-primitives-exact-polyhedra-simpson-1024-rounded-profile-v1",
);

const sphere = compile(
  uniformComponent({ kind: "sphere-v1", radiusM: 2 }, frame(), 3),
).body.massProperties;
close(sphere.volumeM3, (32 * Math.PI) / 3);
close(sphere.massKg, 32 * Math.PI);
close(sphere.inertiaTensorAtComPartKgM2.xx, (256 * Math.PI) / 5);

const cylinder = compile(
  uniformComponent({
    kind: "cylinder-v1",
    radiusM: 2,
    axialLengthM: 6,
    axis: "local-positive-z-v1",
  }),
).body.massProperties;
close(cylinder.volumeM3, 24 * Math.PI);
close(cylinder.inertiaTensorAtComPartKgM2.zz, 48 * Math.PI);
close(cylinder.inertiaTensorAtComPartKgM2.xx, 96 * Math.PI);

const capsule = compile(
  uniformComponent({
    kind: "capsule-v1",
    radiusM: 0.5,
    straightLengthM: 2,
    axis: "local-positive-z-v1",
  }),
).body.massProperties;
assert.ok(capsule.massKg > 0 && capsule.inertiaTensorAtComPartKgM2.xx > 0);
close(
  capsule.inertiaTensorAtComPartKgM2.xx,
  capsule.inertiaTensorAtComPartKgM2.yy,
);
close(capsule.comPositionPartM[2], 0);

const roundedWheel = compile(
  uniformComponent({
    kind: "rounded-wheel-v1",
    radiusM: 0.5,
    widthM: 0.3,
    shoulderRadiusM: 0.05,
    axis: "local-positive-z-v1",
  }),
).body.massProperties;
assert.ok(
  roundedWheel.volumeM3 > 0 &&
    roundedWheel.inertiaTensorAtComPartKgM2.zz >
      roundedWheel.inertiaTensorAtComPartKgM2.xx,
);
close(
  roundedWheel.inertiaTensorAtComPartKgM2.xx,
  roundedWheel.inertiaTensorAtComPartKgM2.yy,
);

const tetrahedron = compile(uniformComponent(tetrahedronGeometry)).body
  .massProperties;
close(tetrahedron.massKg, 1 / 6);
assert.deepEqual(tetrahedron.comPositionPartM, [0.25, 0.25, 0.25]);
close(tetrahedron.inertiaTensorAtComPartKgM2.xx, 1 / 80);
close(tetrahedron.inertiaTensorAtComPartKgM2.xy, 1 / 480);

const rotatedBox = compile(
  uniformComponent(
    { kind: "box-v1", fullSizeM: [2, 4, 6] },
    frame([3, -2, 1], [0, 0, Math.SQRT1_2, Math.SQRT1_2]),
  ),
).body.massProperties;
assert.deepEqual(rotatedBox.comPositionPartM, [3, -2, 1]);
close(rotatedBox.inertiaTensorAtComPartKgM2.xx, 160);
close(rotatedBox.inertiaTensorAtComPartKgM2.yy, 208);
close(rotatedBox.inertiaTensorAtComPartKgM2.zz, 80);

const pairedSpheres = axleComponent({
    kind: "uniform-density-solids-v1",
    densityKgPerM3: 1,
    massSolids: [-1, 1].map((x) => ({
      id: `sphere-${x}`,
      localFramePart: frame([x, 0, 0]),
      geometry: { kind: "sphere-v1", radiusM: 0.5 },
    })),
  }),
  paired = compile(pairedSpheres).body.massProperties;
assert.deepEqual(paired.comPositionPartM, [0, 0, 0]);
assert.ok(
  paired.inertiaTensorAtComPartKgM2.yy > paired.inertiaTensorAtComPartKgM2.xx,
);
assert.deepEqual(paired.contributingSolidIds, ["sphere--1", "sphere-1"]);

assert.throws(
  () => compile(explicit, { scale: [2, 2, 2] }),
  (error) =>
    error.code === "MECHANISM_SCALE_FORBIDDEN_BY_POLICY" &&
    stableStringify(error.path) === stableStringify(["scale"]) &&
    error.details.policy === "fixed-authored-size-v1",
);
assert.throws(
  () =>
    compileMechanismBodyGeometry({
      sourcePartId: null,
      component: explicit,
      positionWorldM: [0, 0, 0],
      orientationWorld: identity,
    }),
  (error) => error.code === "INVALID_ID",
);
assert.throws(
  () =>
    compileMechanismBodyGeometry({
      sourcePartId: 7,
      component: explicit,
      orientationWorld: identity,
    }),
  (error) =>
    error.code === "INVALID_VECTOR3" &&
    stableStringify(error.path) === stableStringify(["positionWorldM"]),
);
assert.throws(
  () =>
    compileMechanismBodyGeometry({
      sourcePartId: 7,
      component: explicit,
      positionWorldM: [0, 0, 0],
    }),
  (error) =>
    error.code === "INVALID_QUATERNION" &&
    stableStringify(error.path) === stableStringify(["orientationWorld"]),
);
assert.throws(
  () => compile(explicit, { orientationWorld: [0, 0, 0, -1] }),
  (error) =>
    error.code === "NONCANONICAL_QUATERNION" &&
    stableStringify(error.path) === stableStringify(["orientationWorld"]),
);
assert.throws(
  () => compile(explicit, { positionWorldM: [0, Number.NaN, 0] }),
  (error) => error.code === "INVALID_FINITE_NUMBER",
);

console.log(
  "canonical mechanism body geometry, mass, frames, provenance and digest passed",
);
