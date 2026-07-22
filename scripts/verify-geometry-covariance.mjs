import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { analyzeAssembly } from "../src/model/engineering-analysis.js";
import { geometryDescriptorForPart } from "../src/model/geometry-descriptors.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import {
  canonicalQuaternion,
  quaternionFromEulerXYZ,
  rotateVectorByQuaternion,
} from "../src/model/primitives.js";
import { TYPES } from "../src/model/component-catalog.js";
import { resolveWireComponentConfig } from "../src/model/component-resolver.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { applyMechanismPose } from "../src/presentation/mechanism-pose-presenter.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";

const CAPACITY = Object.freeze({
  ultimateForceN: 24_000,
  ultimateTorqueNm: 6_000,
});
const UNIT_SCALE = Object.freeze({ x: 1, y: 1, z: 1 });

function close(actual, expected, message, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function closeVector(actual, expected, message, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length, `${message} dimension`);
  actual.forEach((value, axis) =>
    close(value, expected[axis], `${message} axis ${axis}`, tolerance),
  );
}

function multiplyQuaternion(left, right) {
  const [ax, ay, az, aw] = left,
    [bx, by, bz, bw] = right;
  return canonicalQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function ordinaryPart(id, type, pos, orientation) {
  return {
    id,
    type,
    pos,
    orientation,
    scale: { ...UNIT_SCALE },
    config: resolveWireComponentConfig({ type, config: {} }),
  };
}

function mechanismPart(id, type, pos, orientation) {
  return {
    id,
    type,
    pos,
    orientation,
    scale: { ...UNIT_SCALE },
    mechanism: structuredClone(mechanismComponentDefinition(type)),
  };
}

function springFixture() {
  const leftOrientation = quaternionFromEulerXYZ([0.2, -0.15, 0.35]),
    rightOrientation = quaternionFromEulerXYZ([-0.1, 0.25, -0.45]),
    parts = [
      ordinaryPart(11, "plate", [-1.4, 0.7, 0.35], leftOrientation),
      mechanismPart(12, "spring", [0, 1.2, 0], [0, 0, 0, 1]),
      ordinaryPart(13, "beam", [1.6, 1.1, -0.4], rightOrientation),
    ],
    connections = [
      {
        id: "f2-left",
        a: 11,
        b: 12,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        anchorA: [0.32, 0.08, -0.27],
        capacity: { ...CAPACITY },
      },
      {
        id: "f2-right",
        a: 12,
        b: 13,
        kind: "mechanical",
        portA: "END_B",
        portB: "A",
        capacity: { ...CAPACITY },
      },
    ];
  return {
    format: "simulacrum-blueprint",
    version: 1,
    name: "F2 off-center rotated spring",
    created: new Date(0).toISOString(),
    parts,
    connections,
    remoteProfiles: {},
    defaultRemoteProfile: null,
  };
}

function transformAssembly(snapshot, translation, orientation) {
  return {
    ...structuredClone(snapshot),
    parts: snapshot.parts.map((part) => ({
      ...structuredClone(part),
      pos: rotateVectorByQuaternion(part.pos, orientation).map(
        (value, axis) => value + translation[axis],
      ),
      orientation: multiplyQuaternion(orientation, part.orientation),
    })),
  };
}

function mirrorAssembly(snapshot, idOffset = 100) {
  const reflection = new THREE.Matrix4().makeScale(-1, 1, 1),
    partId = new Map(
      snapshot.parts.map((part) => [part.id, part.id + idOffset]),
    ),
    mirroredPort = (port) =>
      ({
        A: "B",
        B: "A",
        TOP: "BOTTOM",
        BOTTOM: "TOP",
        LEFT: "RIGHT",
        RIGHT: "LEFT",
      })[port] || port;
  return {
    ...structuredClone(snapshot),
    parts: snapshot.parts.map((part) => {
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
          new THREE.Quaternion(...part.orientation),
        ),
        mirroredRotation = reflection
          .clone()
          .multiply(rotation)
          .multiply(reflection),
        mirroredQuaternion = new THREE.Quaternion().setFromRotationMatrix(
          mirroredRotation,
        );
      return {
        ...structuredClone(part),
        id: partId.get(part.id),
        pos: [-part.pos[0], part.pos[1], part.pos[2]],
        orientation: canonicalQuaternion(mirroredQuaternion.toArray()),
      };
    }),
    connections: snapshot.connections.map((connection) => ({
      ...structuredClone(connection),
      id: `mirror-${connection.id}`,
      a: partId.get(connection.a),
      b: partId.get(connection.b),
      portA: mirroredPort(connection.portA),
      portB: mirroredPort(connection.portB),
      ...(connection.anchorA
        ? {
            anchorA: [
              -connection.anchorA[0],
              connection.anchorA[1],
              connection.anchorA[2],
            ],
          }
        : {}),
      ...(connection.anchorB
        ? {
            anchorB: [
              -connection.anchorB[0],
              connection.anchorB[1],
              connection.anchorB[2],
            ],
          }
        : {}),
    })),
  };
}

function strippedTopology(compiled, idMap = (id) => id) {
  return {
    bodies: compiled.bodies.map((body) => ({
      id: idMap(body.partId),
      type: body.type,
      mass: body.mass,
      dimensions: body.geometry.dimensions,
      inertia: body.massProperties.principalMomentsKgM2,
    })),
    constraints: compiled.constraints.map((constraint) => ({
      kind: constraint.kind,
      a: idMap(constraint.a),
      b: idMap(constraint.b),
    })),
    forceElements: compiled.forceElements.map((element) => element.kind),
  };
}

const f2Wire = springFixture(),
  f2Decoded = decodeBlueprintOrThrow(
    JSON.parse(JSON.stringify(f2Wire)),
  ).assembly,
  f2 = compileAssembly(f2Decoded, TYPES),
  f2Spring = f2.constraints.find((constraint) => constraint.kind === "spring"),
  leftPart = f2Decoded.parts.find((part) => part.id === 11),
  rightPart = f2Decoded.parts.find((part) => part.id === 13),
  rightFrame = geometryDescriptorForPart(rightPart, TYPES).portFrames.A,
  expectedLeft = rotateVectorByQuaternion(
    f2Decoded.connections[0].anchorA,
    leftPart.orientation,
  ).map((value, axis) => value + leftPart.pos[axis]),
  expectedRight = rotateVectorByQuaternion(
    rightFrame.position,
    rightPart.orientation,
  ).map((value, axis) => value + rightPart.pos[axis]);

assert.equal(f2.stats.errorCount, 0);
assert.deepEqual(f2Spring.sourceConnectionIds, ["f2-left", "f2-right"]);
closeVector(f2Spring.anchorA, expectedLeft, "F2 left authored frame");
closeVector(f2Spring.anchorB, expectedRight, "F2 right authored frame");

const transformOrientation = quaternionFromEulerXYZ([0.3, -0.5, 0.7]),
  translation = [4.2, -1.7, 2.3],
  transformedSnapshot = transformAssembly(
    f2Decoded,
    translation,
    transformOrientation,
  ),
  transformed = compileAssembly(transformedSnapshot, TYPES),
  transformedSpring = transformed.constraints.find(
    (constraint) => constraint.kind === "spring",
  );
for (const [actual, source, label] of [
  [transformedSpring.anchorA, f2Spring.anchorA, "anchor A"],
  [transformedSpring.anchorB, f2Spring.anchorB, "anchor B"],
])
  closeVector(
    actual,
    rotateVectorByQuaternion(source, transformOrientation).map(
      (value, axis) => value + translation[axis],
    ),
    `F2 transformed ${label}`,
  );
assert.deepEqual(
  strippedTopology(transformed),
  strippedTopology(f2),
  "world placement changed local compiled topology",
);

const cartSnapshot = decodeBlueprintOrThrow(
    builtInDemo("cart").blueprint,
  ).assembly,
  compiledCart = compileAssembly(cartSnapshot, TYPES),
  cartShafts = compiledCart.constraints.filter(
    (constraint) => constraint.kind === "revolute" && constraint.motorId,
  );
assert.equal(
  cartShafts.length,
  4,
  "cart must compile four physical hub shafts",
);
for (const shaft of cartShafts) {
  const wheel = cartSnapshot.parts.find((part) => part.id === shaft.rotorId),
    expectedAxis = rotateVectorByQuaternion([0, 0, 1], wheel.orientation);
  closeVector(
    shaft.axisWorld,
    expectedAxis,
    `cart shaft ${shaft.id} follows the authored wheel axle`,
  );
}
const transformedCart = compileAssembly(
    transformAssembly(cartSnapshot, translation, transformOrientation),
    TYPES,
  ),
  transformedCartShafts = transformedCart.constraints.filter(
    (constraint) => constraint.kind === "revolute" && constraint.motorId,
  );
for (let index = 0; index < cartShafts.length; index++)
  closeVector(
    transformedCartShafts[index].axisWorld,
    rotateVectorByQuaternion(cartShafts[index].axisWorld, transformOrientation),
    `transformed cart shaft ${cartShafts[index].id}`,
  );

const mirroredSnapshot = mirrorAssembly(f2Decoded),
  mirrored = compileAssembly(mirroredSnapshot, TYPES);
assert.deepEqual(
  strippedTopology(mirrored, (id) => id - 100),
  strippedTopology(f2),
  "mirroring and stable ID remapping changed local physical topology",
);
const mirroredSpring = mirrored.constraints.find(
  (constraint) => constraint.kind === "spring",
);
closeVector(
  mirroredSpring.anchorA,
  [-f2Spring.anchorA[0], f2Spring.anchorA[1], f2Spring.anchorA[2]],
  "mirrored F2 anchor A",
);
closeVector(
  mirroredSpring.anchorB,
  [-f2Spring.anchorB[0], f2Spring.anchorB[1], f2Spring.anchorB[2]],
  "mirrored F2 anchor B",
);

const analysis = analyzeAssembly(f2Decoded, TYPES);
close(analysis.totalMass, f2.stats.totalMass, "analysis/compiler total mass");
const expectedCom = f2.bodies
  .reduce(
    (sum, body) =>
      sum.map((value, axis) => value + body.position[axis] * body.mass),
    [0, 0, 0],
  )
  .map((value) => value / f2.stats.totalMass);
closeVector(analysis.centerOfMass, expectedCom, "analysis/compiler COM");

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  runtime = new MultibodyRuntime({ world, catalog: TYPES }),
  telemetry = runtime.start(f2Decoded);
for (const part of f2Decoded.parts.filter(
  (candidate) => candidate.type !== "spring",
)) {
  const pose = telemetry.poses.find((candidate) => candidate.id === part.id);
  closeVector(
    [pose.position.x, pose.position.y, pose.position.z],
    part.pos,
    `runtime part-frame telemetry ${part.id}`,
  );
}
runtime.dispose();

const cartWire = builtInDemo("cart").blueprint,
  cartRoundTrip = decodeBlueprintOrThrow(
    JSON.parse(JSON.stringify(cartWire)),
  ).assembly,
  cart = compileAssembly(cartRoundTrip, TYPES),
  wheelPart = cartRoundTrip.parts.find((part) => part.type === "wheel"),
  wheelBody = cart.bodies.find((body) => body.partId === wheelPart.id),
  wheelRegion = wheelBody.geometry.collisionRegions.find(
    (region) => region.contactRole === "tire-envelope",
  ),
  wheelPrimitive = wheelBody.geometry.collisionPrimitives[0];
assert.equal(wheelRegion.geometry.kind, "rounded-wheel-v1");
assert.equal(wheelPrimitive.kind, "cylinder");
assert.equal(wheelPrimitive.roundedWheel.kind, "rounded-wheel-v1");
assert.notEqual(wheelPrimitive.kind, "box", "F9 wheel regressed to a box");

const wheelWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0),
  }),
  wheelRuntime = new MultibodyRuntime({ world: wheelWorld, catalog: TYPES });
wheelRuntime.start(cartRoundTrip);
const engineWheel = wheelRuntime.bodyByPart.get(wheelPart.id);
assert.ok(
  engineWheel.shapes.some(
    (shape) =>
      shape instanceof CANNON.ConvexPolyhedron &&
      shape.userData?.geometryKind === "rounded-wheel-v1",
  ),
  "F9 runtime wheel omitted the rounded shoulder hull",
);
assert.ok(
  engineWheel.shapes.every(
    (shape) =>
      !(shape instanceof CANNON.Box) && !(shape instanceof CANNON.Cylinder),
  ),
  "F9 runtime wheel regressed to a rectangular or sharp cylinder hitbox",
);
wheelRuntime.dispose();

const wheelMesh = componentMesh("wheel"),
  renderSize = new THREE.Box3()
    .setFromObject(wheelMesh)
    .getSize(new THREE.Vector3())
    .toArray();
closeVector(
  renderSize,
  wheelBody.geometry.dimensions,
  "F9 render/compiler extent",
  1e-6,
);
assert.deepEqual(
  wheelMesh.userData.geometryDescriptor.dimensions,
  wheelBody.geometry.dimensions,
  "presentation lost the canonical wheel descriptor",
);
disposeObject3D(wheelMesh);

const springMesh = componentMesh("spring"),
  springDeformationRoot = springMesh.userData.mechanismDeformationRoot;
assert.ok(
  springDeformationRoot,
  "mechanism presentation omitted its non-authoritative deformation root",
);
applyMechanismPose({ mesh: springMesh }, { axialScale: 0.72 });
assert.deepEqual(
  springMesh.scale.toArray(),
  [1, 1, 1],
  "runtime deformation mutated the authored part scale",
);
assert.deepEqual(
  springDeformationRoot.scale.toArray(),
  [1, 1, 0.72],
  "axial mechanism deformation was not isolated to local +Z presentation",
);
disposeObject3D(springMesh);

const scaledWheel = structuredClone(wheelPart);
scaledWheel.scale = { x: 2, y: 2, z: 2 };
assert.throws(
  () => geometryDescriptorForPart(scaledWheel, TYPES),
  (error) => error.code === "MECHANISM_SCALE_FORBIDDEN_BY_POLICY",
  "fixed authored wheel scale gained an implicit similarity law",
);

const textState = JSON.parse(
  JSON.stringify({
    fixture: "F2/F9/F14",
    parts: cartRoundTrip.parts.map((part) => ({
      id: part.id,
      type: part.type,
      orientation: part.orientation,
    })),
    engineering: {
      totalMass: cart.stats.totalMass,
      bodyCount: cart.stats.bodyCount,
    },
    wheel: {
      partId: wheelPart.id,
      dimensions: wheelBody.geometry.dimensions,
      collisionKind: wheelPrimitive.roundedWheel.kind,
    },
  }),
);
assert.equal(textState.wheel.collisionKind, "rounded-wheel-v1");
assert.ok(
  textState.parts.every(
    (part) => part.orientation.length === 4 && !Object.hasOwn(part, "rotation"),
  ),
  "text read model exposed a noncanonical Euler placement",
);

console.log(
  `geometry covariance passed (${f2.bodies.length} F2 bodies, ${cart.contactRegions.length} rounded contact regions)`,
);
