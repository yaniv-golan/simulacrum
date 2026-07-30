import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import {
  GEOMETRY_PRIMITIVE_KINDS,
  resolveComponentGeometryContract,
  validateComponentGeometryDefinitionOrThrow,
  validateGeometryDescriptorOrThrow,
} from "../src/model/component-geometry-contract.js";
import { projectCanonicalComponentGeometry } from "../src/presentation/canonical-component-geometry-projector.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";

const IDENTITY_FRAME = {
    position: { kind: "constant-v1", value: [0, 0, 0] },
    orientation: [0, 0, 0, 1],
  },
  bodyPrimitive = (geometry) => ({
    id: "body",
    frame: IDENTITY_FRAME,
    geometry,
    semanticKey: "body",
    materialKey: "workshop-steel",
    contactRole: "structure",
    approximationOf: null,
  }),
  collisionPrimitive = {
    id: "collision",
    frame: IDENTITY_FRAME,
    geometry: {
      kind: "box-v1",
      fullSize: { kind: "config-vector-v1", field: "size" },
    },
    semanticKey: "collision",
    materialKey: "workshop-steel",
    contactRole: "structure",
    approximationOf: "body",
  },
  geometries = {
    "rounded-box-v1": {
      kind: "rounded-box-v1",
      fullSizeM: [1.2, 0.8, 0.5],
      radiusM: 0.08,
    },
    "spur-gear-v1": {
      kind: "spur-gear-v1",
      toothCount: 24,
      pitchRadiusM: 0.6,
      pressureAngleRad: (20 * Math.PI) / 180,
      moduleM: 0.05,
      axialThicknessM: 0.18,
      rootRadiusM: 0.535,
      tipRadiusM: 0.65,
      boreRadiusM: 0.12,
      hubRadiusM: 0.24,
      hubThicknessM: 0.24,
    },
    "helical-spring-v1": {
      kind: "helical-spring-v1",
      meanCoilRadiusM: 0.17,
      wireRadiusM: 0.025,
      activeTurns: 6,
      endTreatment: "closed-ground-v1",
      referenceAxialLengthM: 1.1,
    },
    "extruded-profile-v1": {
      kind: "extruded-profile-v1",
      pointsM: [
        [-0.6, -0.2],
        [0.5, -0.2],
        [0.65, 0.1],
        [-0.45, 0.25],
      ],
      axialThicknessM: 0.12,
    },
  };

for (const kind of Object.keys(geometries))
  assert.ok(
    GEOMETRY_PRIMITIVE_KINDS.includes(kind),
    `${kind} is not in the closed primitive union`,
  );

function descriptorFor(
  kind,
  geometry = geometries[kind],
  scale = [1, 1, 1],
  dimensionalScalingPolicy = "uniform-similarity-v1",
) {
  const type = `test-${kind}`,
    geometryContract = {
      schemaVersion: 1,
      kind: "primitive-component-geometry-v1",
      geometryClass: "rigid-static-v1",
      dimensionalScalingPolicy,
      portFrames: {},
      collisionPrimitives: [collisionPrimitive],
      bodyPrimitives: [bodyPrimitive(geometry)],
      physicalFeatures: [],
    },
    catalog = {
      [type]: {
        mass: 1,
        size: [1.4, 1.4, 1.4],
        ports: [],
        geometryContract,
      },
    };
  return resolveComponentGeometryContract(
    {
      id: 1,
      type,
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale,
      config: { mass: 1, size: [1.4, 1.4, 1.4] },
    },
    catalog,
  );
}

function canonicalBody(root) {
  let result = null;
  root.traverse((object) => {
    if (object.userData?.canonicalGeometryId === "body") result = object;
  });
  return result;
}

function definitionForBodyGeometry(geometry) {
  return {
    schemaVersion: 1,
    kind: "primitive-component-geometry-v1",
    geometryClass: "rigid-static-v1",
    dimensionalScalingPolicy: "axis-aligned-affine-v1",
    portFrames: {},
    collisionPrimitives: [collisionPrimitive],
    bodyPrimitives: [bodyPrimitive(geometry)],
    physicalFeatures: [],
  };
}

const detailPolicies = [
  {
    radialSegments: 12,
    edgeSegments: 2,
    gearFlankSegments: 2,
    springSegmentsPerTurn: 12,
    springWireSegments: 6,
  },
  {
    radialSegments: 32,
    edgeSegments: 6,
    gearFlankSegments: 5,
    springSegmentsPerTurn: 36,
    springWireSegments: 14,
  },
];

for (const [kind, geometry] of Object.entries(geometries)) {
  const descriptor = descriptorFor(kind);
  assert.deepEqual(descriptor.bodyPrimitives[0].geometry, geometry);
  for (const detailPolicy of detailPolicies) {
    const root = new THREE.Group(),
      material = new THREE.MeshStandardMaterial();
    projectCanonicalComponentGeometry({
      g: root,
      geometryDescriptor: descriptor,
      appearanceResolver: () => material,
      detailPolicy,
    });
    const body = canonicalBody(root);
    assert.ok(body, `${kind} did not project a canonical body`);
    body.geometry.computeBoundingBox();
    const actual = body.geometry.boundingBox,
      expected = descriptor.bodyBoundsPartM,
      toleranceM = 1e-6;
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        actual.min.getComponent(axis) >= expected.minimumM[axis] - toleranceM,
        `${kind} escaped its analytic minimum bound`,
      );
      assert.ok(
        actual.max.getComponent(axis) <= expected.maximumM[axis] + toleranceM,
        `${kind} escaped its analytic maximum bound`,
      );
    }
    assert.ok(
      body.geometry.userData.sharedPrimitiveKey,
      `${kind} lacks a deterministic render-resource key`,
    );
    disposeObject3D(root, { remove: false });
    material.dispose();
  }

  const invalidDefinition = {
    schemaVersion: 1,
    kind: "primitive-component-geometry-v1",
    geometryClass: "rigid-static-v1",
    dimensionalScalingPolicy: "uniform-similarity-v1",
    portFrames: {},
    collisionPrimitives: [bodyPrimitive(geometry)],
    bodyPrimitives: [bodyPrimitive({ kind: "box-v1", fullSizeM: [1, 1, 1] })],
    physicalFeatures: [],
  };
  assert.throws(
    () => validateComponentGeometryDefinitionOrThrow(invalidDefinition),
    (error) => error.code === "INVALID_GEOMETRY_PRIMITIVE_ROLE",
    `${kind} was accepted as authored collision geometry`,
  );

  const invalidDescriptor = structuredClone(descriptor);
  invalidDescriptor.collisionPrimitives[0].geometry = structuredClone(geometry);
  assert.throws(
    () => validateGeometryDescriptorOrThrow(invalidDescriptor),
    (error) => error.code === "INVALID_GEOMETRY_PRIMITIVE_ROLE",
    `${kind} was accepted as resolved collision geometry`,
  );
}

const scaledRoundedBox = descriptorFor(
    "rounded-box-v1",
    geometries["rounded-box-v1"],
    [2, 3, 4],
    "axis-aligned-affine-v1",
  ).bodyPrimitives[0].geometry,
  scaledGear = descriptorFor(
    "spur-gear-v1",
    geometries["spur-gear-v1"],
    [2, 2, 3],
    "axis-aligned-affine-v1",
  ).bodyPrimitives[0].geometry,
  scaledSpring = descriptorFor(
    "helical-spring-v1",
    geometries["helical-spring-v1"],
    [2, 2, 3],
    "axis-aligned-affine-v1",
  ).bodyPrimitives[0].geometry,
  scaledProfile = descriptorFor(
    "extruded-profile-v1",
    geometries["extruded-profile-v1"],
    [2, 3, 4],
    "axis-aligned-affine-v1",
  ).bodyPrimitives[0].geometry;
assert.deepEqual(scaledRoundedBox, {
  kind: "rounded-box-v1",
  fullSizeM: [2.4, 2.4000000000000004, 2],
  radiusM: 0.16,
});
assert.deepEqual(scaledGear, {
  ...geometries["spur-gear-v1"],
  pitchRadiusM: 1.2,
  moduleM: 0.1,
  axialThicknessM: 0.54,
  rootRadiusM: 1.07,
  tipRadiusM: 1.3,
  boreRadiusM: 0.24,
  hubRadiusM: 0.48,
  hubThicknessM: 0.72,
});
assert.deepEqual(scaledSpring, {
  ...geometries["helical-spring-v1"],
  meanCoilRadiusM: 0.34,
  wireRadiusM: 0.05,
  referenceAxialLengthM: 3.3000000000000003,
});
assert.deepEqual(scaledProfile, {
  kind: "extruded-profile-v1",
  pointsM: [
    [-1.2, -0.6000000000000001],
    [1, -0.6000000000000001],
    [1.3, 0.30000000000000004],
    [-0.9, 0.75],
  ],
  axialThicknessM: 0.48,
});
for (const kind of ["spur-gear-v1", "helical-spring-v1"])
  assert.throws(
    () =>
      descriptorFor(
        kind,
        geometries[kind],
        [2, 3, 1],
        "axis-aligned-affine-v1",
      ),
    (error) => error.code === "GEOMETRY_SCALE_POLICY_VIOLATION",
    `${kind} accepted unequal radial scaling`,
  );

const hublessGear = descriptorFor("spur-gear-v1", {
  ...geometries["spur-gear-v1"],
  hubRadiusM: null,
  hubThicknessM: null,
}).bodyPrimitives[0].geometry;
assert.equal(hublessGear.hubRadiusM, null);
assert.equal(hublessGear.hubThicknessM, null);
assert.equal(
  descriptorFor("rounded-box-v1", {
    ...geometries["rounded-box-v1"],
    radiusM: 0.25,
  }).bodyPrimitives[0].geometry.radiusM,
  0.25,
);
const invalidRoundedDescriptor = structuredClone(
  descriptorFor("rounded-box-v1"),
);
invalidRoundedDescriptor.bodyPrimitives[0].geometry.radiusM = 0.5;
assert.throws(
  () => validateGeometryDescriptorOrThrow(invalidRoundedDescriptor),
  (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  "resolved rounded-box descriptor accepted an oversized radius",
);
assert.equal(
  descriptorFor("spur-gear-v1", {
    ...geometries["spur-gear-v1"],
    toothCount: 4,
    moduleM: 0.3,
  }).bodyPrimitives[0].geometry.toothCount,
  4,
);
assert.deepEqual(
  descriptorFor("spur-gear-v1", {
    ...geometries["spur-gear-v1"],
    hubRadiusM: geometries["spur-gear-v1"].rootRadiusM,
    hubThicknessM: geometries["spur-gear-v1"].axialThicknessM,
  }).bodyPrimitives[0].geometry,
  {
    ...geometries["spur-gear-v1"],
    hubRadiusM: geometries["spur-gear-v1"].rootRadiusM,
    hubThicknessM: geometries["spur-gear-v1"].axialThicknessM,
  },
);
assert.equal(
  descriptorFor("helical-spring-v1", {
    ...geometries["helical-spring-v1"],
    activeTurns: 1,
  }).bodyPrimitives[0].geometry.activeTurns,
  1,
);

const expectedBounds = {
  "rounded-box-v1": {
    minimumM: [-0.6, -0.4, -0.25],
    maximumM: [0.6, 0.4, 0.25],
  },
  "spur-gear-v1": {
    minimumM: [-0.65, -0.65, -0.12],
    maximumM: [0.65, 0.65, 0.12],
  },
  "helical-spring-v1": {
    minimumM: [-0.195, -0.195, -0.55],
    maximumM: [0.195, 0.195, 0.55],
  },
  "extruded-profile-v1": {
    minimumM: [-0.65, -0.25, -0.06],
    maximumM: [0.65, 0.25, 0.06],
  },
};
for (const kind of Object.keys(expectedBounds))
  assert.deepEqual(descriptorFor(kind).bodyBoundsPartM, expectedBounds[kind]);

assert.throws(
  () =>
    descriptorFor("rounded-box-v1", {
      ...geometries["rounded-box-v1"],
      radiusM: 0.5,
    }),
  (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  "rounded boxes accepted an edge radius outside their envelope",
);

for (const toothCount of [3, 4.5])
  assert.throws(
    () =>
      descriptorFor("spur-gear-v1", {
        ...geometries["spur-gear-v1"],
        toothCount,
      }),
    (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  );
assert.throws(
  () =>
    descriptorFor("spur-gear-v1", {
      ...geometries["spur-gear-v1"],
      pressureAngleRad: Math.PI / 2,
    }),
  (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
);
for (const patch of [
  { boreRadiusM: geometries["spur-gear-v1"].rootRadiusM },
  { rootRadiusM: geometries["spur-gear-v1"].pitchRadiusM },
  { tipRadiusM: geometries["spur-gear-v1"].pitchRadiusM },
  { hubRadiusM: null },
  { hubThicknessM: null },
  { hubRadiusM: geometries["spur-gear-v1"].boreRadiusM },
  { hubRadiusM: 0.54 },
  { hubThicknessM: 0.17 },
])
  assert.throws(
    () =>
      descriptorFor("spur-gear-v1", {
        ...geometries["spur-gear-v1"],
        ...patch,
      }),
    (error) => error.code === "INCONSISTENT_GEAR_GEOMETRY",
  );
assert.throws(
  () =>
    descriptorFor("spur-gear-v1", {
      ...geometries["spur-gear-v1"],
      boreRadiusM: geometries["spur-gear-v1"].rootRadiusM,
      hubRadiusM: null,
      hubThicknessM: null,
    }),
  (error) => error.code === "INCONSISTENT_GEAR_GEOMETRY",
  "hubless gear accepted equal bore and root radii",
);

validateComponentGeometryDefinitionOrThrow(
  definitionForBodyGeometry({
    kind: "rounded-box-v1",
    fullSize: { kind: "config-vector-v1", field: "size" },
    radiusM: 0.1,
  }),
);
for (const geometry of [
  {
    kind: "rounded-box-v1",
    fullSize: { kind: "invented-v1", field: "size" },
    radiusM: 0.1,
  },
  {
    kind: "rounded-box-v1",
    fullSize: { kind: "config-vector-v1", field: 42 },
    radiusM: 0.1,
  },
  { kind: "rounded-box-v1", fullSizeM: [1, 1, 1], radiusM: 0.51 },
  { ...geometries["spur-gear-v1"], toothCount: 3 },
  { ...geometries["helical-spring-v1"], activeTurns: 0.5 },
  {
    ...geometries["extruded-profile-v1"],
    pointsM: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  },
])
  assert.throws(
    () =>
      validateComponentGeometryDefinitionOrThrow(
        definitionForBodyGeometry(geometry),
      ),
    (error) =>
      [
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "INVALID_GEOMETRY_DIMENSION",
        "INVALID_GEOMETRY_PROFILE",
      ].includes(error.code),
    "malformed canonical body geometry passed definition validation",
  );
for (const patch of [
  { meanCoilRadiusM: 0.025 },
  { activeTurns: 0.5 },
  { referenceAxialLengthM: 0.05 },
])
  assert.throws(
    () =>
      descriptorFor("helical-spring-v1", {
        ...geometries["helical-spring-v1"],
        ...patch,
      }),
    (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  );
assert.throws(
  () =>
    descriptorFor("spur-gear-v1", {
      ...geometries["spur-gear-v1"],
      pitchRadiusM: 0.61,
    }),
  (error) => error.code === "INCONSISTENT_GEAR_GEOMETRY",
  "spur gears accepted an inconsistent module/pitch law",
);
assert.throws(
  () =>
    descriptorFor("helical-spring-v1", {
      ...geometries["helical-spring-v1"],
      endTreatment: "invented-v1",
    }),
  (error) => error.code === "INVALID_GEOMETRY_PROFILE",
  "springs accepted an unknown end treatment",
);
assert.throws(
  () =>
    descriptorFor("extruded-profile-v1", {
      ...geometries["extruded-profile-v1"],
      pointsM: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    }),
  (error) => error.code === "INVALID_GEOMETRY_PROFILE",
  "extruded profiles accepted a zero-area polygon",
);

console.log("component visual primitives passed");
