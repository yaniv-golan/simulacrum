import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import {
  COMPONENT_GEOMETRY_SCHEMA_VERSION,
  deformedBodyBoundsPartM,
  flexibleRuntimeBoundsWorldM,
  GEOMETRY_CLASSES,
  physicalFeaturePrimitivesForDescriptor,
  PORT_SPATIAL_CLASSES,
  resolveComponentGeometryContract,
  resolveComponentGeometryContractForType,
  validateComponentGeometryDefinitionOrThrow,
  validateGeometryDescriptorOrThrow,
} from "../src/model/component-geometry-contract.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { flexibleLinePreviewReadModel } from "../src/model/flexible-line-preview-read-model.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { worldPortFrame } from "../src/model/connection-frame-invariants.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { supportMaterialResponse } from "../src/model/contact-material-pairs.js";

assert.equal(COMPONENT_GEOMETRY_SCHEMA_VERSION, 2);
assert.equal(new Set(GEOMETRY_CLASSES).size, 3);
assert.equal(new Set(PORT_SPATIAL_CLASSES).size, 4);

const hinge = resolveComponentGeometryContractForType("hinge");
assert.deepEqual(
  hinge.portFrames.BASE.framePart.positionM,
  hinge.portFrames.ARM.framePart.positionM,
  "a revolute component declared two translated pivot lines",
);
assert.deepEqual(hinge.portFrames.BASE.framePart.orientation, [0, 1, 0, 0]);
assert.deepEqual(hinge.portFrames.ARM.framePart.orientation, [0, 0, 0, 1]);

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

const spring = resolveComponentGeometryContractForType("spring"),
  axialCoordinate = spring.deformationContract.coordinates[0],
  deformed = deformedBodyBoundsPartM(spring, {
    [axialCoordinate.telemetryField]: axialCoordinate.referenceValue,
  });
assert.deepEqual(deformed, spring.bodyBoundsPartM);
assert.throws(
  () =>
    deformedBodyBoundsPartM(spring, {
      [axialCoordinate.telemetryField]: axialCoordinate.referenceValue,
      presentationGuess: 1,
    }),
  (error) => error.code === "UNKNOWN_GEOMETRY_FIELD",
  "undeclared presentation deformation became runtime geometry",
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
]) {
  const invalid = structuredClone(
    resolveComponentGeometryContractForType("beam"),
  );
  mutation(invalid);
  assert.throws(() => validateGeometryDescriptorOrThrow(invalid));
}

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
