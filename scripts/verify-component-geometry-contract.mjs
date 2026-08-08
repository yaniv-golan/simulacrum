import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import {
  boundsCenter,
  boundsDimensions,
  COMPONENT_GEOMETRY_SCHEMA_VERSION,
  deformedBodyBoundsPartM,
  flexibleRuntimeBoundsWorldM,
  GEOMETRY_CLASSES,
  mechanismDeformationTransforms,
  physicalFeaturePrimitivesForDescriptor,
  PORT_SPATIAL_CLASSES,
  primaryGeometryAxisPart,
  projectBoundsToWorld,
  resolveComponentGeometryContract,
  resolveComponentGeometryContractForType,
  validateComponentGeometryDefinitionOrThrow,
  validateGeometryDescriptorOrThrow,
} from "../src/model/component-geometry-contract.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { flexibleLinePreviewReadModel } from "../src/model/flexible-line-preview-read-model.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { worldPortFrame } from "../src/model/connection-frame-invariants.js";
import { compileAssembly } from "./lib/compile-assembly.mjs";
import { supportMaterialResponse } from "../src/model/contact-material-pairs.js";

assert.equal(COMPONENT_GEOMETRY_SCHEMA_VERSION, 2);
assert.equal(new Set(GEOMETRY_CLASSES).size, 3);
assert.equal(new Set(PORT_SPATIAL_CLASSES).size, 4);
for (const journalId of ["JOURNAL LEFT", "JOURNAL RIGHT"])
  assert.equal(
    TYPES.axle.ports.find(({ id }) => id === journalId)?.multiplicity,
    "one",
    `${journalId} allowed overlapping attachments at one physical seat`,
  );
assert.deepEqual(
  primaryGeometryAxisPart({
    portClasses: { POWER: "network-only", SHAFT: "spatial-mechanical" },
    portFrames: {
      POWER: { framePart: { orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } },
      SHAFT: { framePart: { orientation: [0, 0, 0, 1] } },
    },
  }),
  [0, 0, 1],
  "a network terminal became authoritative for a physical component axis",
);

const hinge = resolveComponentGeometryContractForType("hinge");
assert.deepEqual(
  hinge.portFrames.BASE.framePart.positionM,
  hinge.portFrames.ARM.framePart.positionM,
  "a revolute component declared two translated pivot lines",
);
assert.deepEqual(hinge.portFrames.BASE.framePart.orientation, [0, 1, 0, 0]);
assert.deepEqual(hinge.portFrames.ARM.framePart.orientation, [0, 0, 0, 1]);

const bearing = resolveComponentGeometryContractForType("bearing");
assert.deepEqual(
  bearing.portFrames.MOUNT.framePart.positionM,
  [0, -0.29, 0],
  "pillow-block mount is not on the underside of its housing",
);
assert.deepEqual(bearing.portFrames.MOUNT.framePart.orientation, [
  Math.SQRT1_2,
  0,
  0,
  Math.SQRT1_2,
]);

for (const [type, networkPorts] of Object.entries({
  battery: ["POWER"],
  computer: ["POWER", "IN A", "IN B", "OUT"],
  motor: ["POWER", "CONTROL"],
  sensor: ["SIGNAL"],
})) {
  const descriptor = resolveComponentGeometryContractForType(type);
  for (const portId of networkPorts)
    assert.ok(
      descriptor.portFrames[portId]?.framePart.positionM.every(Number.isFinite),
      `${type}.${portId} has no canonical physical conduit terminal`,
    );
}

for (const patch of [
  { type: "" },
  { type: 42 },
  { geometryClass: "invented-v1" },
]) {
  const invalid = structuredClone(hinge);
  Object.assign(invalid, patch);
  assert.throws(
    () => validateGeometryDescriptorOrThrow(invalid),
    (error) =>
      ["INVALID_GEOMETRY_TYPE", "UNKNOWN_GEOMETRY_CLASS"].includes(error.code),
    "invalid descriptor identity passed strict validation",
  );
}

for (const [type, definition] of Object.entries(TYPES)) {
  validateComponentGeometryDefinitionOrThrow(definition.geometryContract);
  const descriptor = resolveComponentGeometryContractForType(type),
    validated = validateGeometryDescriptorOrThrow(descriptor),
    mesh = componentMesh(type),
    projection = mesh.userData.geometryProjection;
  assert.equal(validated.type, type);
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(
    projection.bodyPrimitiveIds,
    descriptor.bodyPrimitives.map(({ id }) => id),
    `${type} rendered a non-canonical body set`,
  );
  assert.deepEqual(
    projection.featureIds,
    descriptor.physicalFeatures.map(({ id }) => id),
    `${type} rendered a non-canonical feature set`,
  );
  assert.deepEqual(projection.bodyPrimitives, descriptor.bodyPrimitives);
  assert.deepEqual(
    projection.featurePrimitives,
    physicalFeaturePrimitivesForDescriptor(descriptor),
  );
  for (const collisionPrimitive of descriptor.collisionPrimitives)
    assert.doesNotThrow(
      () => supportMaterialResponse(collisionPrimitive.materialKey),
      `${type} collision geometry names an unknown contact material`,
    );
  assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(
    Object.keys(descriptor.portClasses).sort(),
    definition.ports.map(({ id }) => id).sort(),
    `${type} did not classify every port`,
  );
  if (descriptor.geometryClass === "runtime-flexible-v1") {
    assert.equal(descriptor.bodyPrimitives.length, 0);
    assert.equal(descriptor.collisionPrimitives.length, 0);
    assert.equal(
      projection.runtimeCapacity,
      descriptor.runtimeGeometryContract.maximumSegmentCount,
    );
  }
  mesh.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material))
      object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
}

for (const type of [
  "airreservoir",
  "receiver",
  "rangesensor",
  "sensor",
  "loadcell",
  "gyro",
  "headlight",
]) {
  const defaultDescriptor = resolveComponentGeometryContractForType(type),
    scaledDescriptor = resolveComponentGeometryContract({
      id: 800,
      type,
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1.7, y: 0.65, z: 1.25 },
      config: componentDefaults(type),
    });
  assert.equal(
    defaultDescriptor.bodyPrimitives[0].geometry.kind,
    "cylinder-v1",
    `${type} lost its round catalog silhouette`,
  );
  assert.equal(
    scaledDescriptor.bodyPrimitives[0].geometry.kind,
    "elliptic-cylinder-v1",
    `${type} did not preserve its silhouette under independent-axis scaling`,
  );
}

for (const type of ["imu", "contactsensor"]) {
  const defaultDescriptor = resolveComponentGeometryContractForType(type),
    scaledDescriptor = resolveComponentGeometryContract({
      id: 801,
      type,
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1.7, y: 0.65, z: 1.25 },
      config: componentDefaults(type),
    });
  assert.equal(
    defaultDescriptor.bodyPrimitives[0].geometry.kind,
    "rounded-box-v1",
  );
  assert.equal(
    scaledDescriptor.bodyPrimitives[0].geometry.kind,
    "rounded-box-v1",
  );
}

for (const type of [
  "navsensor",
  "thermalprobe",
  "pressureprobe",
  "rocket",
  "rcs",
])
  assert.throws(
    () =>
      resolveComponentGeometryContract({
        id: 801,
        type,
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1.2, y: 1, z: 1 },
        config: componentDefaults(type),
      }),
    (error) => error.code === "GEOMETRY_SCALE_POLICY_VIOLATION",
    `${type} accepted a nonuniform scale that its rotational profile cannot represent`,
  );

const axiallyScaledRocket = resolveComponentGeometryContract({
  id: 802,
  type: "rocket",
  pos: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: { x: 0.5, y: 1, z: 0.5 },
  config: componentDefaults("rocket"),
});
const [scaledChamber, scaledNozzle] = axiallyScaledRocket.bodyPrimitives.map(
  (primitive) => primitive.geometry,
);
assert.equal(scaledChamber.kind, "cylinder-v1");
assert.ok(Math.abs(scaledChamber.radiusM - 0.15) < 1e-12);
assert.ok(Math.abs(scaledChamber.axialLengthM - 0.62) < 1e-12);
assert.equal(scaledNozzle.kind, "cone-v1");
assert.ok(Math.abs(scaledNozzle.startRadiusM - 0.09) < 1e-12);
assert.ok(Math.abs(scaledNozzle.endRadiusM - 0.2) < 1e-12);
assert.ok(Math.abs(scaledNozzle.axialLengthM - 0.53) < 1e-12);

assert.throws(
  () =>
    resolveComponentGeometryContract(
      {
        id: 99,
        type: "missingGeometry",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: { mass: 1, size: [1, 1, 1] },
      },
      {
        missingGeometry: {
          mass: 1,
          size: [1, 1, 1],
          ports: [],
        },
      },
    ),
  (error) => error.code === "MISSING_COMPONENT_GEOMETRY_DEFINITION",
  "alternate physical catalog silently gained fallback geometry",
);

const motor = resolveComponentGeometryContract({
    id: 1,
    type: "motor",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    config: {},
  }),
  shaft = physicalFeaturePrimitivesForDescriptor(motor).find(
    ({ id }) => id === "feature:shaft",
  ),
  shaftPort = motor.portFrames.SHAFT.framePart.positionM;
assert.deepEqual(shaft.framePart.positionM, [0, 0, 0.68]);
assert.equal(shaft.geometry.axialLengthM, 0.48);
assert.deepEqual(shaftPort, [0, 0, 0.92]);
assert.equal(
  shaft.framePart.positionM[2] + shaft.geometry.axialLengthM / 2,
  0.92,
);
for (const [axialOrigin, expectedCenterZ] of [
  ["center-v1", 0.92],
  ["start-v1", 1.16],
  ["end-v1", 0.68],
]) {
  const descriptor = structuredClone(motor);
  descriptor.physicalFeatures[0].axialOrigin = axialOrigin;
  const primitive = physicalFeaturePrimitivesForDescriptor(descriptor)[0];
  assert.ok(
    Math.abs(primitive.framePart.positionM[2] - expectedCenterZ) <= 1e-12,
  );
}

const affineMotor = resolveComponentGeometryContract({
  id: 2,
  type: "motor",
  pos: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: { x: 2, y: 1, z: 1 },
  config: {},
});
assert.equal(affineMotor.physicalFeatures[0].primitive, "elliptic-cylinder-v1");
assert.equal(affineMotor.collisionPrimitives[0].approximationOf !== null, true);
assert.deepEqual(
  resolveComponentGeometryContractForType("battery").provenance.approximations,
  [{ id: "collision", approximationOf: "body" }],
  "ordinary components lost explicit collision provenance",
);
assert.deepEqual(
  resolveComponentGeometryContractForType("fin").provenance.approximations,
  [{ id: "collision", approximationOf: "fin-profile" }],
  "ordinary custom bodies lost collision provenance",
);
assert.equal(
  TYPES.fin.geometryContract.collisionPrimitives[0].approximationOf,
  TYPES.fin.geometryContract.bodyPrimitives[0].id,
  "shaped ordinary collision fallback did not name its authored body",
);

for (const [type, expected] of [
  [
    "aircompressor",
    [
      ["collision", "body"],
      ["compressor-motor-collision", "compressor-motor"],
    ],
  ],
  [
    "pneumaticvalve",
    [
      ["collision", "body"],
      ["valve-solenoid-1-collision", "valve-solenoid-1"],
      ["valve-solenoid-2-collision", "valve-solenoid-2"],
    ],
  ],
]) {
  const descriptor = resolveComponentGeometryContractForType(type);
  assert.deepEqual(
    descriptor.collisionPrimitives.map(({ id, approximationOf }) => [
      id,
      approximationOf,
    ]),
    expected,
    `${type} lost visible-body collision provenance`,
  );
  assert.deepEqual(
    new Set(
      descriptor.provenance.approximations.map(
        (entry) => entry.approximationOf,
      ),
    ),
    new Set(descriptor.bodyPrimitives.map(({ id }) => id)),
    `${type} has visible bodies with no collision approximation`,
  );
}
const compressor = resolveComponentGeometryContractForType("aircompressor"),
  compressorMotor = compressor.bodyPrimitives.find(
    ({ id }) => id === "compressor-motor",
  ),
  valve = resolveComponentGeometryContractForType("pneumaticvalve");
assert.deepEqual(compressorMotor.framePart.positionM, [0, 0.34, 0]);
assert.equal(compressorMotor.materialKey, "workshop-steel");
assert.deepEqual(
  valve.bodyPrimitives
    .filter(({ id }) => id.startsWith("valve-solenoid-"))
    .map(({ framePart }) => framePart.positionM),
  [
    [-0.2, 0.3, 0],
    [0.2, 0.3, 0],
  ],
  "pneumatic valve solenoids lost their symmetric physical placement",
);
assert.deepEqual(
  valve.collisionPrimitives
    .filter(({ id }) => id.startsWith("valve-solenoid-"))
    .map(({ framePart }) => framePart.positionM),
  [
    [-0.2, 0.3, 0],
    [0.2, 0.3, 0],
  ],
  "pneumatic valve collision regions lost their symmetric placement",
);

const pinionGeometry =
    resolveComponentGeometryContractForType("gear12").bodyPrimitives[0]
      .geometry,
  wheelGearGeometry =
    resolveComponentGeometryContractForType("gear24").bodyPrimitives[0]
      .geometry,
  wheelGapAtStockContactRad =
    wheelGearGeometry.toothPhaseRad +
    11.5 * ((Math.PI * 2) / wheelGearGeometry.toothCount);
assert.equal(pinionGeometry.toothPhaseRad, 0);
assert.equal(pinionGeometry.pressureAngleRad, (20 * Math.PI) / 180);
assert.equal(wheelGearGeometry.pressureAngleRad, (20 * Math.PI) / 180);
assert.ok(Math.abs(wheelGapAtStockContactRad - Math.PI) < 1e-12);
assert.equal(pinionGeometry.moduleM, wheelGearGeometry.moduleM);
assert.equal(
  resolveComponentGeometryContractForType("gear12").portFrames.MESH.clearanceM,
  0,
);
assert.equal(
  resolveComponentGeometryContractForType("gear24").portFrames.MESH.clearanceM,
  0,
);
const stockGearParts = builtInDemo("gearbox").blueprint.parts.filter((part) =>
    ["gear12", "gear24"].includes(part.type),
  ),
  stockGearCenterDistanceM = Math.hypot(
    ...stockGearParts[0].pos.map(
      (value, axis) => value - stockGearParts[1].pos[axis],
    ),
  );
assert.ok(
  Math.abs(
    stockGearCenterDistanceM -
      pinionGeometry.pitchRadiusM -
      wheelGearGeometry.pitchRadiusM,
  ) < 1e-12,
  "stock gears are not centered at the canonical pitch-radius sum",
);

const stockGearbox = builtInDemo("gearbox").blueprint,
  stockPartById = new Map(stockGearbox.parts.map((part) => [part.id, part])),
  stockPlates = stockGearbox.parts.filter((part) => part.type === "plate"),
  stockPlate = stockPlates.toSorted(
    (a, b) => b.scale.x * b.scale.z - a.scale.x * a.scale.z,
  )[0],
  stockPedestalFeet = stockPlates.filter(({ id }) => id !== stockPlate.id),
  stockOutputGear = stockGearbox.parts.find((part) => part.type === "gear24"),
  stockOutputAxle = stockGearbox.parts.find((part) => part.type === "axle"),
  stockPlateBounds = projectBoundsToWorld(
    resolveComponentGeometryContract(stockPlate).bodyBoundsPartM,
    stockPlate.pos,
    stockPlate.orientation,
  ),
  stockGearBounds = projectBoundsToWorld(
    resolveComponentGeometryContract(stockOutputGear).bodyBoundsPartM,
    stockOutputGear.pos,
    stockOutputGear.orientation,
  ),
  stockSupportTargets = stockGearbox.connections
    .filter(({ portA, portB }) => portA === "B" && portB === "MOUNT")
    .map(({ a, b }) => [stockPartById.get(a), stockPartById.get(b)]),
  targetCounts = Object.fromEntries(
    ["motor", "bearing", "sensor"].map((type) => [
      type,
      stockSupportTargets.filter(
        ([support, target]) =>
          support?.type === "beam" && target?.type === type,
      ).length,
    ]),
  );
assert.ok(
  stockGearBounds.minimumM[1] - stockPlateBounds.maximumM[1] >= 0.3,
  "stock 24T gear lacks visually unambiguous mounting-plate clearance",
);
assert.equal(stockPedestalFeet.length, 2);
assert.deepEqual(
  stockPedestalFeet.map((part) => part.pos[2]).sort(),
  stockGearbox.parts
    .filter((part) => part.type === "bearing")
    .map((part) => part.pos[2])
    .sort(),
  "bearing pedestal feet are not centered beneath both bearing housings",
);
assert.deepEqual(
  targetCounts,
  { motor: 2, bearing: 2, sensor: 1 },
  "stock drivetrain lost an explicit structural support load path",
);
for (const [support, target] of stockSupportTargets) {
  const directBaseConnection = stockGearbox.connections.some(
    ({ a, b, portA, portB }) =>
      a === stockPlate.id &&
      b === support.id &&
      portA === "TOP" &&
      portB === "A",
  );
  if (target.type !== "bearing") {
    assert.ok(
      directBaseConnection,
      `support ${support.id} does not terminate on the mounting plate`,
    );
    continue;
  }
  const footToColumn = stockGearbox.connections.find(
    ({ a, b, portA, portB }) =>
      b === support.id &&
      stockPedestalFeet.some(({ id }) => id === a) &&
      portA === "TOP" &&
      portB === "A",
  );
  assert.ok(
    footToColumn,
    `bearing support ${support.id} has no distinct pedestal foot`,
  );
  assert.ok(
    stockGearbox.connections.some(
      ({ a, b, portA, portB }) =>
        a === stockPlate.id &&
        b === footToColumn.a &&
        portA === "TOP" &&
        portB === "BOTTOM",
    ),
    `bearing pedestal ${footToColumn.a} does not terminate on the base plate`,
  );
}
assert.deepEqual(
  stockGearbox.connections
    .filter(
      ({ a, b, portA }) =>
        b === stockOutputAxle.id &&
        portA === "SHAFT" &&
        stockPartById.get(a)?.type === "bearing",
    )
    .map(({ portB }) => portB)
    .sort(),
  ["JOURNAL LEFT", "JOURNAL RIGHT"],
  "stock output shaft is not supported on both sides of the large gear",
);
for (const part of stockGearbox.parts) {
  const worldBounds = projectBoundsToWorld(
    resolveComponentGeometryContract(part).selectionBoundsPartM,
    part.pos,
    part.orientation,
  );
  assert.ok(
    worldBounds.minimumM[0] >= stockPlateBounds.minimumM[0] - 1e-9 &&
      worldBounds.maximumM[0] <= stockPlateBounds.maximumM[0] + 1e-9 &&
      worldBounds.minimumM[2] >= stockPlateBounds.minimumM[2] - 1e-9 &&
      worldBounds.maximumM[2] <= stockPlateBounds.maximumM[2] + 1e-9,
    `stock ${part.type} #${part.id} hangs outside the mounting plate footprint`,
  );
}

const aerodynamicFixture = resolveComponentGeometryContract({
  id: 991,
  type: "beam",
  pos: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  config: {
    ...componentDefaults("beam"),
    size: [2, 3, 4],
    liftSlope: 0.7,
  },
});
assert.equal(aerodynamicFixture.aerodynamicSurfaces[0].areaM2, 12);
assert.equal(aerodynamicFixture.aerodynamicSurfaces[0].liftSlope, 0.7);
for (const [size, expectedAreaM2] of [
  [[4, 3, 2], 12],
  [[4, 2, 3], 12],
]) {
  const fixture = resolveComponentGeometryContract({
    id: 992,
    type: "beam",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config: { ...componentDefaults("beam"), size },
  });
  assert.equal(fixture.aerodynamicSurfaces[0].areaM2, expectedAreaM2);
}
assert.deepEqual(boundsCenter(null), [0, 0, 0]);
assert.deepEqual(boundsDimensions(null), [0, 0, 0]);

const spring = resolveComponentGeometryContractForType("spring"),
  axialCoordinate = spring.deformationContract.coordinates[0],
  referenceSample = {
    coordinateId: axialCoordinate.id,
    coordinateM: axialCoordinate.referenceCoordinateM,
  },
  deformed = deformedBodyBoundsPartM(spring, [referenceSample]);
assert.deepEqual(spring.provenance.approximations, [
  { id: "housing", approximationOf: "spring-coil" },
]);
assert.equal(spring.collisionPrimitives[0].geometry.kind, "box-v1");
assert.deepEqual(deformed, spring.bodyBoundsPartM);
assert.deepEqual(
  mechanismDeformationTransforms(spring, [referenceSample])[
    axialCoordinate.projections[0].id
  ].scale,
  [1, 1, 1],
);
assert.throws(
  () =>
    deformedBodyBoundsPartM(spring, [
      { ...referenceSample, presentationGuess: 1 },
    ]),
  (error) => error.code === "UNKNOWN_GEOMETRY_FIELD",
  "undeclared presentation deformation became runtime geometry",
);

const damper = resolveComponentGeometryContractForType("damper"),
  damperCoordinate = damper.deformationContract.coordinates[0],
  damperAtMinimum = mechanismDeformationTransforms(damper, [
    {
      coordinateId: damperCoordinate.id,
      coordinateM: damperCoordinate.allowedCoordinateRangeM.minimum,
    },
  ]),
  [damperEndA, damperEndB] = damperCoordinate.projections;
assert.ok(damperAtMinimum[damperEndA.id].positionM[2] > 0);
assert.ok(damperAtMinimum[damperEndB.id].positionM[2] < 0);
assert.equal(damperAtMinimum[damperEndA.id].positionM[2], 0.4);
assert.equal(damperAtMinimum[damperEndB.id].positionM[2], -0.4);
assert.equal(
  Math.abs(damperAtMinimum[damperEndA.id].positionM[2]),
  Math.abs(damperAtMinimum[damperEndB.id].positionM[2]),
);

const guide = resolveComponentGeometryContractForType("linear-guide"),
  guideCoordinate = guide.deformationContract.coordinates[0],
  guideProjection = guideCoordinate.projections[0],
  guideAtMaximum = mechanismDeformationTransforms(guide, [
    {
      coordinateId: guideCoordinate.id,
      coordinateM: guideCoordinate.allowedCoordinateRangeM.maximum,
    },
  ]);
assert.equal(guideCoordinate.referenceCoordinateM, 0.3);
assert.equal(guideAtMaximum[guideProjection.id].positionM[2], 0.3);
assert.equal(Object.isFrozen(guideAtMaximum[guideProjection.id]), true);
assert.deepEqual(
  deformedBodyBoundsPartM(guide, [
    {
      coordinateId: guideCoordinate.id,
      coordinateM: guideCoordinate.allowedCoordinateRangeM.maximum,
    },
  ]),
  {
    minimumM: [-0.41, -0.25, -0.5],
    maximumM: [0.41, 0.25, 0.5],
  },
  "unprojected guide rails did not retain their reference bounds",
);

const shortStrokeActuatorMechanism = structuredClone(
    mechanismComponentDefinition("linear-actuator"),
  ),
  shortStrokeRangeM = { lower: 0.7, upper: 0.9 };
shortStrokeActuatorMechanism.config.lengthRangeM = shortStrokeRangeM;
const shortStrokeActuator = resolveComponentGeometryContract({
    id: 803,
    type: "linear-actuator",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    mechanism: shortStrokeActuatorMechanism,
  }),
  shortStrokeCoordinate =
    shortStrokeActuator.deformationContract.coordinates[0];
assert.ok(
  shortStrokeCoordinate.referenceCoordinateM >
    shortStrokeCoordinate.allowedCoordinateRangeM.maximum,
  "fixture did not exercise an external affine calibration reference",
);
assert.deepEqual(shortStrokeCoordinate.allowedCoordinateRangeM, {
  minimum: shortStrokeRangeM.lower,
  maximum: shortStrokeRangeM.upper,
});
for (const coordinateM of Object.values(
  shortStrokeCoordinate.allowedCoordinateRangeM,
))
  for (const transform of Object.values(
    mechanismDeformationTransforms(shortStrokeActuator, [
      { coordinateId: shortStrokeCoordinate.id, coordinateM },
    ]),
  ))
    assert.ok(
      [
        ...transform.positionM,
        ...transform.orientation,
        ...transform.scale,
      ].every(Number.isFinite),
      "external reference produced a non-finite allowed-range transform",
    );

const springAtMinimumSample = {
    coordinateId: axialCoordinate.id,
    coordinateM: axialCoordinate.allowedCoordinateRangeM.minimum,
  },
  springAtMaximumSample = {
    coordinateId: axialCoordinate.id,
    coordinateM: axialCoordinate.allowedCoordinateRangeM.maximum,
  },
  springAtMinimum = deformedBodyBoundsPartM(spring, [springAtMinimumSample]),
  springAtMaximum = deformedBodyBoundsPartM(spring, [springAtMaximumSample]),
  referenceHalfLengthM = spring.bodyBoundsPartM.maximumM[2],
  expectedMinimumHalfLengthM =
    referenceHalfLengthM *
    (springAtMinimumSample.coordinateM / axialCoordinate.referenceBodyLengthM),
  expectedMaximumHalfLengthM =
    referenceHalfLengthM *
    (springAtMaximumSample.coordinateM / axialCoordinate.referenceBodyLengthM);
assert.equal(springAtMinimum.minimumM[2], -expectedMinimumHalfLengthM);
assert.equal(springAtMinimum.maximumM[2], expectedMinimumHalfLengthM);
assert.equal(springAtMaximum.minimumM[2], -expectedMaximumHalfLengthM);
assert.equal(springAtMaximum.maximumM[2], expectedMaximumHalfLengthM);
assert.deepEqual(spring.selectionBoundsPartM, {
  minimumM: [-0.178, -0.178, -1],
  maximumM: [0.178, 0.178, 1],
});
assert.deepEqual(
  deformedBodyBoundsPartM(damper, [
    {
      coordinateId: damperCoordinate.id,
      coordinateM: damperCoordinate.allowedCoordinateRangeM.minimum,
    },
  ]),
  {
    minimumM: [-0.13, -0.13, -0.45000000000000007],
    maximumM: [0.13, 0.13, 0.52],
  },
);
assert.deepEqual(
  deformedBodyBoundsPartM(damper, [
    {
      coordinateId: damperCoordinate.id,
      coordinateM: damperCoordinate.allowedCoordinateRangeM.maximum,
    },
  ]),
  {
    minimumM: [-0.13, -0.13, -0.8],
    maximumM: [0.13, 0.13, 0.8],
  },
);
assert.deepEqual(
  deformedBodyBoundsPartM(spring, [springAtMinimumSample]),
  springAtMinimum,
  "cached deformation projection changed endpoint bounds",
);
for (const [coordinateM, expected] of [
  [axialCoordinate.allowedCoordinateRangeM.minimum - 1, springAtMinimum],
  [axialCoordinate.allowedCoordinateRangeM.maximum + 1, springAtMaximum],
])
  assert.deepEqual(
    deformedBodyBoundsPartM(spring, [
      { coordinateId: axialCoordinate.id, coordinateM },
    ]),
    expected,
    "out-of-range physical telemetry escaped the authored deformation envelope",
  );
const rigidBeam = resolveComponentGeometryContractForType("beam");
assert.deepEqual(
  deformedBodyBoundsPartM(rigidBeam, []),
  rigidBeam.bodyBoundsPartM,
  "rigid geometry did not preserve its canonical body bounds",
);
for (const samples of [
  null,
  [],
  [{ coordinateId: "unknown", coordinateM: 0.5 }],
  [{ coordinateId: axialCoordinate.id, coordinateM: Number.NaN }],
  [referenceSample, referenceSample],
])
  assert.throws(
    () => mechanismDeformationTransforms(spring, samples),
    (error) => error.code === "INVALID_DEFORMATION_TELEMETRY",
    "invalid completed mechanism coordinates reached geometry projection",
  );
assert.deepEqual(
  flexibleRuntimeBoundsWorldM(
    [
      { x: -1, y: 2, z: 3 },
      { x: 4, y: -2, z: 1 },
    ],
    0.1,
  ),
  {
    minimumM: [-1.1, -2.1, 0.9],
    maximumM: [4.1, 2.1, 3.1],
  },
);

const ropePart = {
    id: 10,
    type: "rope",
    pos: [0, 1, 0],
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config: componentDefaults("rope"),
  },
  previewTarget = {
    id: 11,
    type: "plate",
    pos: [-2, 1, 0],
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config: componentDefaults("plate"),
  },
  ropeDescriptor = resolveComponentGeometryContract(ropePart),
  targetDescriptor = resolveComponentGeometryContract(previewTarget),
  preview = flexibleLinePreviewReadModel({
    part: ropePart,
    parts: [ropePart, previewTarget],
    connections: [
      {
        id: "preview-attachment",
        kind: "mechanical",
        a: ropePart.id,
        b: previewTarget.id,
        portA: "END_A",
        portB: "TOP",
      },
    ],
  }),
  expectedPreviewCenterline = [
    worldPortFrame(previewTarget, targetDescriptor, "TOP").positionWorld,
    worldPortFrame(ropePart, ropeDescriptor, "END_B").positionWorld,
  ];
assert.deepEqual(
  preview.centerline,
  expectedPreviewCenterline.map(([x, y, z]) => ({ x, y, z })),
  "flexible preview invented presentation-owned endpoint geometry",
);
assert.deepEqual(
  preview.previewBoundsWorldM,
  flexibleRuntimeBoundsWorldM(
    preview.centerline,
    ropeDescriptor.runtimeGeometryContract.diameterM / 2,
  ),
);

const invalidDefinition = structuredClone(TYPES.beam.geometryContract);
invalidDefinition.presentationDimensions = [1, 1, 1];
assert.throws(
  () => validateComponentGeometryDefinitionOrThrow(invalidDefinition),
  (error) => error.code === "UNKNOWN_GEOMETRY_FIELD",
  "alternate catalog geometry accepted a presentation-only field",
);
const danglingApproximation = structuredClone(TYPES.fin.geometryContract);
danglingApproximation.collisionPrimitives[0].approximationOf = "missing-body";
assert.throws(
  () => validateComponentGeometryDefinitionOrThrow(danglingApproximation),
  (error) => error.code === "INVALID_COMPONENT_GEOMETRY_DEFINITION",
  "collision provenance accepted a missing body target",
);

for (const mutation of [
  (descriptor) => {
    descriptor.unknown = true;
  },
  (descriptor) => {
    descriptor.bodyPrimitives[0].geometry.extra = 1;
  },
  (descriptor) => {
    descriptor.bodyBoundsPartM.maximumM[0] += 0.1;
  },
  (descriptor) => {
    descriptor.portFrames.A.framePart.orientation = [0, 0, 0, 2];
  },
  (descriptor) => {
    descriptor.bodyPrimitives[0].geometry.kind = "invented-v1";
  },
  (descriptor) => {
    descriptor.bodyPrimitives[0].geometry.fullSizeM = [-1, 1, 1];
  },
]) {
  const invalid = structuredClone(
    resolveComponentGeometryContractForType("beam"),
  );
  mutation(invalid);
  assert.throws(() => validateGeometryDescriptorOrThrow(invalid));
}

const unknownPrimitiveDescriptor = structuredClone(
  resolveComponentGeometryContractForType("beam"),
);
unknownPrimitiveDescriptor.bodyPrimitives[0].geometry.kind = "invented-v1";
assert.throws(
  () => validateGeometryDescriptorOrThrow(unknownPrimitiveDescriptor),
  (error) => error.code === "UNKNOWN_GEOMETRY_PRIMITIVE",
  "unknown primitive kind did not fail at the primitive boundary",
);

const invalidBoxDescriptor = structuredClone(
  resolveComponentGeometryContractForType("linear-guide"),
);
invalidBoxDescriptor.bodyPrimitives.find(
  ({ geometry }) => geometry.kind === "box-v1",
).geometry.fullSizeM = [-1, 1, 1];
assert.throws(
  () => validateGeometryDescriptorOrThrow(invalidBoxDescriptor),
  (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  "box dimensions bypassed primitive validation",
);

const rover = builtInDemo("cart").blueprint,
  compiledRover = compileAssembly(rover, TYPES),
  byId = new Map(rover.parts.map((part) => [part.id, part])),
  driveConnections = rover.connections.filter((connection) => {
    const partA = byId.get(connection.a),
      partB = byId.get(connection.b);
    return (
      connection.kind === "mechanical" &&
      new Set([partA.type, partB.type]).has("motor") &&
      new Set([partA.type, partB.type]).has("wheel")
    );
  });
assert.equal(driveConnections.length, 4);
for (const connection of driveConnections) {
  const partA = byId.get(connection.a),
    partB = byId.get(connection.b),
    motorPart = partA.type === "motor" ? partA : partB,
    wheelPart = partA.type === "wheel" ? partA : partB,
    motorFrame = worldPortFrame(
      motorPart,
      resolveComponentGeometryContract(motorPart),
      "SHAFT",
    ),
    wheelFrame = worldPortFrame(
      wheelPart,
      resolveComponentGeometryContract(wheelPart),
      "AXLE",
    );
  assert.deepEqual(motorFrame.positionWorld, wheelFrame.positionWorld);
  const driveConstraint = compiledRover.constraints.find((constraint) =>
    constraint.sourceConnectionIds?.includes(connection.id),
  );
  assert.deepEqual(
    driveConstraint.anchor,
    motorFrame.positionWorld,
    "rotary compilation used an internal coordinate origin as a second attachment location",
  );
  assert.equal(Math.abs(motorFrame.axisWorld[0]), 1);
  assert.equal(Math.sign(motorFrame.axisWorld[0]), Math.sign(wheelPart.pos[0]));
  assert.equal(
    motorPart.config.direction,
    Math.sign(wheelPart.pos[0]),
    "mirrored motor omitted its ordinary authored wiring polarity",
  );
  assert.notDeepEqual(motorPart.pos, wheelPart.pos);
}

console.log(
  `component geometry contract passed (${Object.keys(TYPES).length} component types)`,
);
