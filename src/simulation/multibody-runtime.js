import * as CANNON from "cannon-es";
import { readActuatorCommand } from "../model/actuator-contracts.js";
import { compileAssemblyFromIssuedRoots } from "../model/assembly-compiler.js";
import {
  compareCanonicalIds,
  compareCompiledIds,
  deepFreeze,
  DomainValidationError,
  identitySetUsesTypedStrings,
  identityToken,
} from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { compiledPhysicalSemanticsFingerprint } from "../model/compiled-physical-semantics.js";
import {
  registerCannonCollisionExclusion,
  unregisterCannonCollisionExclusion,
} from "./cannon-solver-transaction.js";
import {
  CannonWorldAdapter,
  completedWorldEvidenceCandidates,
} from "./cannon-world-adapter.js";
import {
  applyAxialForce,
  AxialLimitConstraint,
  axialState,
  damperResponse,
  forceSpeedCapacity,
  mechanismClamp,
  PrismaticConstraint,
  springResponse,
  stopResponse,
} from "./two-frame-mechanisms.js";
import {
  constraintReactionContributionCandidates,
  constraintReactionCandidateRowId,
  invalidConstraintReactionCandidate,
  constraintReactionWrench,
  constraintReactionWrenchEvidence,
  materializeConstraintReactionContribution,
} from "./constraint-reaction-wrench.js";
import { TireContactConstraint } from "./tire-contact.js";
import {
  registerRollingSupport,
  unregisterRollingSupport,
} from "./rolling-support-registration.js";
import { validateMultibodyCheckpointState } from "./multibody-checkpoint-validation.js";
import { canonicalCannonCheckpointQuaternion } from "./cannon-checkpoint-quaternion.js";
import {
  boundsCenter,
  boundsDimensions,
  deformedBodyBoundsPartM,
  primaryGeometryAxisPart,
  projectBoundsToWorld,
} from "../model/component-geometry-contract.js";
import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import {
  clonePlainMassPropertyData,
  engineMassPropertiesProjection,
  validateRuntimeMassPropertiesAuthority,
} from "../model/assembly-compiler-mass-properties.js";

const COORDINATE_KINDS = new Set([
  "revolute",
  "linear-guide",
  "linear-actuator",
]);
const failureEvidenceByRuntime = new WeakMap();
const fluidDescriptorsByRuntime = new WeakMap();
const telemetryBodyDescriptorsByRuntime = new WeakMap();
const constraintOrderPredecessorsByRuntime = new WeakMap();
const constraintValueFieldsByRuntime = new WeakMap();
const massPropertyCommittersByRuntime = new WeakMap();
const engineAuthorityByRuntime = new WeakMap();
const evidenceCapturingRuntimes = new WeakSet();
const ENGINE_CONSTRAINT_VECTOR_FIELDS = Object.freeze([
  "pivotA",
  "pivotB",
  "axisA",
  "axisB",
  "xA",
  "yA",
  "zA",
  "xB",
  "yB",
  "zB",
  "localAnchorA",
  "localAnchorB",
  "referenceA",
  "referenceB",
]);

function engineVector(value) {
  return value &&
    [value.x, value.y, value.z].every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
    ? plainVector(value)
    : null;
}

function shapeGeometryAuthority(shape) {
  if (shape instanceof CANNON.Box)
    return {
      kind: "box",
      halfExtents: plainVector(shape.halfExtents),
    };
  if (shape instanceof CANNON.Sphere)
    return { kind: "sphere", radius: shape.radius };
  if (shape instanceof CANNON.ConvexPolyhedron)
    return {
      kind: shape instanceof CANNON.Cylinder ? "cylinder" : "convex",
      vertices: shape.vertices.map(plainVector),
      faces: shape.faces.map((face) => [...face]),
      uniqueAxes: (shape.uniqueAxes || []).map(plainVector),
      uniqueEdges: (shape.uniqueEdges || []).map(plainVector),
    };
  throw new DomainValidationError(
    "MULTIBODY_ENGINE_AUTHORITY_UNSUPPORTED",
    "Compiled collision shape lacks a closed engine-authority projection",
  );
}

function sameVectorAuthority(value, expected) {
  return Boolean(
    value &&
    expected &&
    Object.is(value.x, expected.x) &&
    Object.is(value.y, expected.y) &&
    Object.is(value.z, expected.z),
  );
}

function sameQuaternionAuthority(value, expected) {
  return Boolean(
    sameVectorAuthority(value, expected) && Object.is(value.w, expected.w),
  );
}

function samePlainAuthority(value, expected) {
  if (Object.is(value, expected)) return true;
  if (
    value == null ||
    expected == null ||
    typeof value !== "object" ||
    typeof expected !== "object" ||
    Array.isArray(value) !== Array.isArray(expected)
  )
    return false;
  if (Array.isArray(expected))
    return (
      value.length === expected.length &&
      expected.every((item, index) => samePlainAuthority(value[index], item))
    );
  const expectedKeys = Object.keys(expected),
    valueKeys = Object.keys(value);
  return (
    valueKeys.length === expectedKeys.length &&
    expectedKeys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        samePlainAuthority(value[key], expected[key]),
    )
  );
}

function sameVectorListAuthority(values, expected) {
  return (
    values.length === expected.length &&
    expected.every((item, index) => sameVectorAuthority(values[index], item))
  );
}

function sameQuaternionListAuthority(values, expected) {
  return (
    values.length === expected.length &&
    expected.every((item, index) =>
      sameQuaternionAuthority(values[index], item),
    )
  );
}

function sameShapeGeometryAuthority(shape, expected) {
  if (expected.kind === "box")
    return (
      shape instanceof CANNON.Box &&
      sameVectorAuthority(shape.halfExtents, expected.halfExtents)
    );
  if (expected.kind === "sphere")
    return (
      shape instanceof CANNON.Sphere && Object.is(shape.radius, expected.radius)
    );
  if (
    !(shape instanceof CANNON.ConvexPolyhedron) ||
    (shape instanceof CANNON.Cylinder ? "cylinder" : "convex") !==
      expected.kind ||
    !sameVectorListAuthority(shape.vertices, expected.vertices) ||
    !sameVectorListAuthority(shape.uniqueAxes || [], expected.uniqueAxes) ||
    !sameVectorListAuthority(shape.uniqueEdges || [], expected.uniqueEdges) ||
    shape.faces.length !== expected.faces.length
  )
    return false;
  return expected.faces.every(
    (face, index) =>
      shape.faces[index].length === face.length &&
      face.every((vertexIndex, offset) =>
        Object.is(shape.faces[index][offset], vertexIndex),
      ),
  );
}

function sameBodyPhysicalAuthority(body, expected) {
  return (
    Object.is(body.mass, expected.mass) &&
    Object.is(body.invMass, expected.invMass) &&
    sameVectorAuthority(body.inertia, expected.inertia) &&
    sameVectorAuthority(body.invInertia, expected.invInertia) &&
    sameQuaternionAuthority(
      body.userData?.massFrame?.principalToPart,
      expected.massFrame.principalToPart,
    ) &&
    sameVectorAuthority(
      body.userData?.massFrame?.comPart,
      expected.massFrame.comPart,
    ) &&
    body.userData?.massProperties === expected.massProperties &&
    sameVectorListAuthority(body.shapeOffsets, expected.shapeOffsets) &&
    sameQuaternionListAuthority(
      body.shapeOrientations,
      expected.shapeOrientations,
    )
  );
}

function sameConstraintVectorsAuthority(entry, expected) {
  let actualCount = 0;
  for (const field of ENGINE_CONSTRAINT_VECTOR_FIELDS) {
    const value = entry.constraint?.[field] ?? entry[field];
    if (value == null) {
      if (Object.hasOwn(expected, field)) return false;
      continue;
    }
    actualCount++;
    if (
      !Object.hasOwn(expected, field) ||
      !sameVectorAuthority(value, expected[field])
    )
      return false;
  }
  return actualCount === Object.keys(expected).length;
}

function identityOccurrenceCount(values, expected) {
  let count = 0;
  for (const value of values) if (value === expected) count++;
  return count;
}

function bodyPhysicalAuthority(body) {
  return {
    mass: body.mass,
    invMass: body.invMass,
    inertia: plainVector(body.inertia),
    invInertia: plainVector(body.invInertia),
    massFrame: {
      principalToPart: plainQuaternion(body.userData.massFrame.principalToPart),
      comPart: plainVector(body.userData.massFrame.comPart),
    },
    massProperties: body.userData.massProperties,
    shapeOffsets: body.shapeOffsets.map(plainVector),
    shapeOrientations: body.shapeOrientations.map(plainQuaternion),
  };
}

function captureBodyEngineAuthority(body, descriptor) {
  return {
    body,
    descriptor,
    constructor: body.constructor,
    material: body.material,
    type: body.type,
    collisionResponse: body.collisionResponse,
    collisionFilterGroup: body.collisionFilterGroup,
    collisionFilterMask: body.collisionFilterMask,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    allowSleep: body.allowSleep,
    fixedRotation: body.fixedRotation,
    physical: bodyPhysicalAuthority(body),
    shapes: body.shapes.map((shape) => ({
      shape,
      constructor: shape.constructor,
      type: shape.type,
      material: shape.material,
      collisionResponse: shape.collisionResponse,
      collisionFilterGroup: shape.collisionFilterGroup,
      collisionFilterMask: shape.collisionFilterMask,
      userData: structuredClone(shape.userData || null),
      geometry: shapeGeometryAuthority(shape),
    })),
  };
}

function captureConstraintVectors(entry) {
  const vectors = {};
  for (const field of ENGINE_CONSTRAINT_VECTOR_FIELDS) {
    const value = entry.constraint?.[field] ?? entry[field];
    if (value != null) vectors[field] = engineVector(value);
  }
  return vectors;
}

function captureConstraintEquations(entry) {
  if (entry.kind === "rolling-contact-v1" || !entry.constraint) return null;
  return entry.constraint.equations.map((equation) => {
    // Guide friction derives its Coulomb bound from the current transverse
    // impulse and velocity through accessors. Every other owned row has either
    // immutable bounds or an owner mutation followed by an authority refresh.
    const ownsForceBounds = equation !== entry.constraint.guideFrictionEquation;
    return {
      equation,
      constructor: equation.constructor,
      bodyA: equation.bi,
      bodyB: equation.bj,
      enabled: equation.enabled,
      spookA: equation.a,
      spookB: equation.b,
      epsilon: equation.eps,
      restitution:
        typeof equation.restitution === "number" ? equation.restitution : null,
      targetVelocity:
        typeof equation.targetVelocity === "number"
          ? equation.targetVelocity
          : null,
      minForce: ownsForceBounds ? equation.minForce : null,
      maxForce: ownsForceBounds ? equation.maxForce : null,
    };
  });
}

function captureConstraintEngineAuthority(entry) {
  return {
    entry,
    descriptor: entry.descriptor,
    constraint: entry.constraint || null,
    constructor: entry.constraint?.constructor || null,
    bodyA: entry.constraint?.bodyA || null,
    bodyB: entry.constraint?.bodyB || null,
    collideConnected: entry.constraint?.collideConnected ?? null,
    distance: entry.constraint?.distance ?? null,
    vectors: captureConstraintVectors(entry),
    equations: captureConstraintEquations(entry),
    active: entry.active !== false,
  };
}

function captureMultibodyEngineAuthority(runtime) {
  engineAuthorityByRuntime.set(runtime, {
    bodies: new Map(
      runtime.compiled.bodies.map((descriptor) => [
        descriptor.partId,
        captureBodyEngineAuthority(
          runtime.bodyByPart.get(descriptor.partId),
          descriptor,
        ),
      ]),
    ),
    constraints: new Map(
      runtime.constraintEntries.map((entry) => [
        entry.descriptor.id,
        captureConstraintEngineAuthority(entry),
      ]),
    ),
    exclusions: new Map(
      runtime.collisionExclusionConstraints.map((entry) => [
        entry.descriptor.id,
        {
          entry,
          descriptor: entry.descriptor,
          exclusion: entry.exclusion,
          bodyA: entry.exclusion.bodyA,
          bodyB: entry.exclusion.bodyB,
          active: entry.active !== false,
        },
      ]),
    ),
  });
}

function refreshConstraintEquationAuthority(runtime, entry) {
  const expected = engineAuthorityByRuntime
    .get(runtime)
    ?.constraints.get(entry.descriptor.id);
  if (expected) expected.equations = captureConstraintEquations(entry);
}

function refreshBodyPhysicalAuthority(runtime, partId) {
  const expected = engineAuthorityByRuntime.get(runtime)?.bodies.get(partId),
    body = runtime.bodyByPart.get(partId);
  if (expected && body === expected.body)
    expected.physical = bodyPhysicalAuthority(body);
}

function refreshConstraintFrameAuthority(runtime, entry) {
  const expected = engineAuthorityByRuntime
    .get(runtime)
    ?.constraints.get(entry.descriptor.id);
  if (expected) expected.vectors = captureConstraintVectors(entry);
}

function refreshEngineActivityAuthority(runtime) {
  const authority = engineAuthorityByRuntime.get(runtime);
  if (!authority) return;
  for (const [id, expected] of authority.constraints)
    expected.active =
      runtime.constraintEntries.find((entry) => entry.descriptor.id === id)
        ?.active !== false;
  for (const [id, expected] of authority.exclusions)
    expected.active =
      runtime.collisionExclusionConstraints.find(
        (entry) => entry.descriptor.id === id,
      )?.active !== false;
}

function engineAuthorityMismatch(message) {
  throw new DomainValidationError(
    "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
    message,
  );
}

function validateLiveMultibodyEngineAuthority(
  runtime,
  { validateStaticGeometry = true } = {},
) {
  const authority = engineAuthorityByRuntime.get(runtime);
  if (!authority || !runtime.compiled)
    engineAuthorityMismatch("Live engine authority was not initialized");
  if (
    authority.bodies.size !== runtime.bodyByPart.size ||
    authority.constraints.size !== runtime.constraintEntries.length ||
    authority.exclusions.size !== runtime.collisionExclusionConstraints.length
  )
    engineAuthorityMismatch("Live engine owner identity sets changed");
  for (const [partId, expected] of authority.bodies) {
    const body = runtime.bodyByPart.get(partId);
    if (
      body !== expected.body ||
      body?.constructor !== expected.constructor ||
      body?.material !== expected.material ||
      body?.type !== expected.type ||
      body?.collisionResponse !== expected.collisionResponse ||
      body?.collisionFilterGroup !== expected.collisionFilterGroup ||
      body?.collisionFilterMask !== expected.collisionFilterMask ||
      body?.linearDamping !== expected.linearDamping ||
      body?.angularDamping !== expected.angularDamping ||
      body?.allowSleep !== expected.allowSleep ||
      body?.fixedRotation !== expected.fixedRotation ||
      body?.userData?.partId !== partId ||
      body?.userData?.compiledBodyId !== expected.descriptor.id ||
      !sameBodyPhysicalAuthority(body, expected.physical) ||
      identityOccurrenceCount(runtime.world.bodies, body) !== 1 ||
      body.shapes.length !== expected.shapes.length
    )
      engineAuthorityMismatch(
        `Live Cannon body authority changed for part ${String(partId)}`,
      );
    for (const [index, shapeExpected] of expected.shapes.entries()) {
      const shape = body.shapes[index];
      if (
        shape !== shapeExpected.shape ||
        shape.constructor !== shapeExpected.constructor ||
        shape.type !== shapeExpected.type ||
        shape.material !== shapeExpected.material ||
        shape.collisionResponse !== shapeExpected.collisionResponse ||
        shape.collisionFilterGroup !== shapeExpected.collisionFilterGroup ||
        shape.collisionFilterMask !== shapeExpected.collisionFilterMask ||
        (validateStaticGeometry &&
          (!samePlainAuthority(
            shape.userData || null,
            shapeExpected.userData,
          ) ||
            !sameShapeGeometryAuthority(shape, shapeExpected.geometry)))
      )
        engineAuthorityMismatch(
          `Live Cannon collision geometry changed for part ${String(partId)} shape ${index}`,
        );
    }
  }
  let constraintIndex = 0;
  for (const [id, expected] of authority.constraints) {
    const entry = runtime.constraintEntries[constraintIndex++];
    if (
      entry !== expected.entry ||
      entry?.descriptor?.id !== id ||
      entry?.descriptor !== expected.descriptor ||
      (entry?.constraint || null) !== expected.constraint ||
      (entry?.constraint?.constructor || null) !== expected.constructor ||
      (entry?.constraint?.bodyA || null) !== expected.bodyA ||
      (entry?.constraint?.bodyB || null) !== expected.bodyB ||
      (entry?.constraint?.collideConnected ?? null) !==
        expected.collideConnected ||
      (entry?.constraint?.distance ?? null) !== expected.distance ||
      !sameConstraintVectorsAuthority(entry, expected.vectors) ||
      (entry.active !== false) !== expected.active
    )
      engineAuthorityMismatch(
        `Live Cannon constraint authority changed for ${id}`,
      );
    const occurrences = expected.constraint
      ? identityOccurrenceCount(runtime.world.constraints, expected.constraint)
      : 0;
    if (occurrences !== (expected.active && expected.constraint ? 1 : 0))
      engineAuthorityMismatch(
        `Live Cannon constraint activity changed for ${id}`,
      );
    const equations = entry.constraint?.equations || null;
    if (
      expected.equations !== null &&
      (equations?.length !== expected.equations.length ||
        equations.some(
          (equation, index) =>
            equation !== expected.equations[index].equation ||
            equation.constructor !== expected.equations[index].constructor ||
            equation.bi !== expected.equations[index].bodyA ||
            equation.bj !== expected.equations[index].bodyB ||
            equation.enabled !== expected.equations[index].enabled ||
            equation.a !== expected.equations[index].spookA ||
            equation.b !== expected.equations[index].spookB ||
            equation.eps !== expected.equations[index].epsilon ||
            (typeof equation.restitution === "number"
              ? equation.restitution
              : null) !== expected.equations[index].restitution ||
            (typeof equation.targetVelocity === "number"
              ? equation.targetVelocity
              : null) !== expected.equations[index].targetVelocity ||
            (expected.equations[index].minForce !== null &&
              (equation.minForce !== expected.equations[index].minForce ||
                equation.maxForce !== expected.equations[index].maxForce)),
        ))
    )
      engineAuthorityMismatch(
        `Live Cannon equation authority changed for ${id}`,
      );
  }
  let exclusionIndex = 0;
  for (const [id, expected] of authority.exclusions) {
    const entry = runtime.collisionExclusionConstraints[exclusionIndex++];
    if (
      entry !== expected.entry ||
      entry?.descriptor?.id !== id ||
      entry?.descriptor !== expected.descriptor ||
      entry?.exclusion !== expected.exclusion ||
      entry?.exclusion?.bodyA !== expected.bodyA ||
      entry?.exclusion?.bodyB !== expected.bodyB ||
      (entry?.active !== false) !== expected.active
    )
      engineAuthorityMismatch(
        `Live Cannon collision exclusion authority changed for ${id}`,
      );
  }
}
const CHECKPOINT_CONSTRAINT_SCALAR_FIELDS = Object.freeze([
  "active",
  "angle",
  "rawAngle",
  "velocity",
  "reactionTorque",
  "force",
  "coordinateM",
  "rateMPerS",
  "transverseM",
  "reactionForceN",
  "appliedForceN",
  "elasticPotentialJ",
  "dampingWorkJ",
  "dampingPowerW",
  "frictionWorkJ",
  "actuatorMechanicalWorkJ",
  "actuatorElectricalEnergyJ",
  "actuatorDissipatedEnergyJ",
  "temperatureK",
  "powered",
  "saturated",
  "thermalDerate",
  "thermalShutdown",
  "clutchEngaged",
  "clutchCoordinateM",
  "phaseA",
  "phaseB",
]);
const ACTUATOR_AMBIENT_TEMPERATURE_K = 293.15;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function coolRotaryActuator(entry, thermal, dt) {
  const coolingW =
    thermal.ambientConductanceWPerK *
    (entry.temperatureK - ACTUATOR_AMBIENT_TEMPERATURE_K);
  entry.temperatureK = Math.max(
    Number.EPSILON,
    entry.temperatureK - (coolingW * dt) / thermal.thermalMassJPerK,
  );
}

function rotaryThermalAvailability(entry, thermal) {
  const availability = clamp(
    (thermal.shutdownTemperatureK - entry.temperatureK) /
      (thermal.shutdownTemperatureK - thermal.derateTemperatureK),
    0,
    1,
  );
  entry.thermalDerate = availability;
  entry.thermalShutdown = availability <= 0;
  if (entry.thermalShutdown) entry.powered = false;
  return availability;
}

function addRotaryActuatorHeat(entry, thermal, heatJ) {
  entry.temperatureK += Math.max(0, heatJ) / thermal.thermalMassJPerK;
}
const plainVector = (value) => ({ x: value.x, y: value.y, z: value.z });
const plainQuaternion = (value) => ({
  x: value.x,
  y: value.y,
  z: value.z,
  w: value.w,
});
const checkpointQuaternion = (value) => {
  const result = canonicalCannonCheckpointQuaternion(value);
  if (!result)
    throw new DomainValidationError(
      "INVALID_MULTIBODY_LIVE_QUATERNION",
      "Live multibody orientation cannot be projected to checkpoint authority",
    );
  return result;
};
const cannonCheckpointQuaternion = (value) => {
  const projection = checkpointQuaternion(value);
  return new CANNON.Quaternion(
    projection.x,
    projection.y,
    projection.z,
    projection.w,
  );
};
const canonicalizeLiveQuaternion = (value) => {
  const projection = checkpointQuaternion(value);
  value.set(projection.x, projection.y, projection.z, projection.w);
  return value;
};

function connectionTelemetryProjection(values, typedStrings) {
  const entries = [...values]
    .map(([connectionId, value]) => [
      identityToken(connectionId, { typedStrings }),
      value,
    ])
    .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1));
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new DomainValidationError(
      "CONNECTION_TELEMETRY_IDENTITY_COLLISION",
      "Connection telemetry identities must remain injective",
    );
  return Object.fromEntries(entries);
}

/**
 * @template {string|number} K
 * @template V
 * @param {Iterable<[K,V]>} values
 * @returns {Array<[K,V]>}
 */
function sortedIdentityEntries(values) {
  return [...values].sort(([left], [right]) =>
    compareCanonicalIds(left, right),
  );
}

function fluidStateRecordsByPart(state) {
  return new Map(
    (state?.byPart || []).map((record) => [record.partId, record]),
  );
}

function runtimeMassContributorKindsByPart(compiled) {
  return new Map(
    compiled.rigidClusters.flatMap((cluster) =>
      cluster.members.map((member) => [
        member.partId,
        member.runtimeMassContributorKinds,
      ]),
    ),
  );
}

function multibodyCheckpointValidationOptions(
  runtime,
  baseline,
  expectedMassPropertiesByPart = null,
) {
  const compiledBodies = new Map(
      runtime.compiled.bodies.map((descriptor) => [
        descriptor.partId,
        descriptor,
      ]),
    ),
    dynamicMassContributorKindsByPart = runtimeMassContributorKindsByPart(
      runtime.compiled,
    );
  return {
    baseline,
    compiledPartIds: new Set(runtime.compiled.parts.map((part) => part.id)),
    compiledBodyPartIds: new Set(
      runtime.compiled.bodies.map((descriptor) => descriptor.partId),
    ),
    compiledConnectionIds: new Set(
      runtime.compiled.constraints.flatMap(
        (constraint) => constraint.sourceConnectionIds || [],
      ),
    ),
    constraintValueFieldsById: constraintValueFieldsByRuntime.get(runtime),
    collisionExclusionActiveFor: (id, activeByConstraintId) => {
      const exclusion = runtime.collisionExclusionConstraints.find(
        (entry) => entry.descriptor.id === id,
      );
      if (!exclusion) return null;
      return collisionExclusionRequired(
        runtime.constraintEntries.map((entry) => ({
          ...entry,
          active: activeByConstraintId.get(entry.descriptor.id),
        })),
        exclusion.descriptor,
      );
    },
    bodyAuthorityFor: (record) => {
      const descriptor = compiledBodies.get(record.partId),
        frame = physicsFrame({
          ...descriptor,
          massProperties: record.massProperties,
        }),
        shapeFrames = descriptor.geometry.collisionPrimitives.map((primitive) =>
          shapeFrame(primitive, frame),
        );
      return {
        compiledMassProperties: descriptor.massProperties,
        expectedMassProperties:
          expectedMassPropertiesByPart?.get(record.partId) ?? null,
        dynamicMassContributorKinds:
          dynamicMassContributorKindsByPart.get(record.partId) || [],
        massFrame: {
          principalToPart: checkpointQuaternion(frame.principalToPart),
          comPart: plainVector(frame.comPart),
        },
        shapeOffsets: shapeFrames.map(({ offset }) => plainVector(offset)),
        shapeOrientations: shapeFrames.map(({ orientation }) =>
          checkpointQuaternion(orientation),
        ),
      };
    },
  };
}

const frameValuesEqual = (left, right, tolerance = 1e-12) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - right[index]) <= tolerance);

function evidenceRowMagnitude(row) {
  return Math.max(
    0,
    Number(row?.forceMagnitudeN || 0),
    Number(row?.momentMagnitudeNm || 0),
  );
}

function evidenceRowOrder(left, right) {
  const magnitudeOrder =
    evidenceRowMagnitude(right) - evidenceRowMagnitude(left);
  if (magnitudeOrder) return magnitudeOrder;
  const leftId = String(left.rowOrderKey || left.rowId),
    rightId = String(right.rowOrderKey || right.rowId);
  if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  const leftSide = String(left.side || ""),
    rightSide = String(right.side || "");
  return leftSide === rightSide ? 0 : leftSide < rightSide ? -1 : 1;
}

function evidenceRowKey(row) {
  return `${String(row?.rowOrderKey || row?.rowId)}\0${String(
    row?.side || "",
  )}`;
}

function addBoundedEvidenceRow(bucket, row, maximum) {
  const rows = bucket.rows;
  if (!bucket.sorted) {
    rows.push(row);
    if (rows.length <= maximum) return;
    rows.sort(evidenceRowOrder);
    rows.length = maximum;
    bucket.sorted = true;
    return;
  }
  let low = 0,
    high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (evidenceRowOrder(row, rows[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  if (low >= maximum) return;
  rows.splice(low, 0, row);
  if (rows.length > maximum) rows.pop();
}

function selectEvidenceRows(rows, { triggered, nearConnectionIds, policy }) {
  const seenEquationsBySide = new Map(),
    fallbackUniqueKeys = new Set();
  if (triggered) {
    const unique = [];
    for (const row of rows) {
      if (row?.equation && typeof row.equation === "object") {
        const side = String(row.side || ""),
          seen = seenEquationsBySide.get(side) || new WeakSet();
        if (seen.has(row.equation)) continue;
        seen.add(row.equation);
        seenEquationsBySide.set(side, seen);
      } else {
        const key = evidenceRowKey(row);
        if (fallbackUniqueKeys.has(key)) continue;
        fallbackUniqueKeys.add(key);
      }
      unique.push(row);
    }
    return {
      rows: unique.sort(evidenceRowOrder).slice(0, policy.maxRowsOnTriggerTick),
      totalRowCount: unique.length,
    };
  }
  if (
    (nearConnectionIds || []).some((identity) => typeof identity !== "string")
  )
    throw new TypeError(
      "near-failure connection identities must use compiled string tokens",
    );
  const nearConnections = new Set(nearConnectionIds || []);
  const retainedCandidates = new WeakSet(),
    retainedFallbackKeys = new Set(),
    byConnection = new Map(),
    unprojected = { rows: [], sorted: false };
  let totalRowCount = 0;
  for (const row of rows) {
    if (row?.equation && typeof row.equation === "object") {
      const side = String(row.side || ""),
        seen = seenEquationsBySide.get(side) || new WeakSet();
      if (seen.has(row.equation)) continue;
      seen.add(row.equation);
      seenEquationsBySide.set(side, seen);
    } else {
      const key = evidenceRowKey(row);
      if (fallbackUniqueKeys.has(key)) continue;
      fallbackUniqueKeys.add(key);
    }
    totalRowCount++;
    const connectionIds = row.sourceConnectionIds || [];
    if (!connectionIds.length) {
      addBoundedEvidenceRow(unprojected, row, policy.topRowsPerConnection);
      continue;
    }
    for (const connectionId of connectionIds) {
      const key = String(connectionId),
        bucket = byConnection.get(key) || { rows: [], sorted: false };
      addBoundedEvidenceRow(
        bucket,
        row,
        nearConnections.has(key)
          ? policy.maxRowsPerExactFrame
          : policy.topRowsPerConnection,
      );
      byConnection.set(key, bucket);
    }
  }
  const selected = { rows: [], sorted: false };
  for (const bucket of byConnection.values()) {
    for (const row of bucket.rows) {
      if (row && typeof row === "object") {
        if (retainedCandidates.has(row)) continue;
        retainedCandidates.add(row);
      } else {
        const key = evidenceRowKey(row);
        if (retainedFallbackKeys.has(key)) continue;
        retainedFallbackKeys.add(key);
      }
      addBoundedEvidenceRow(selected, row, policy.maxRowsPerExactFrame);
    }
  }
  for (const row of unprojected.rows) {
    if (row && typeof row === "object") {
      if (retainedCandidates.has(row)) continue;
      retainedCandidates.add(row);
    } else {
      const key = evidenceRowKey(row);
      if (retainedFallbackKeys.has(key)) continue;
      retainedFallbackKeys.add(key);
    }
    addBoundedEvidenceRow(selected, row, policy.maxRowsPerExactFrame);
  }
  if (!selected.sorted) selected.rows.sort(evidenceRowOrder);
  return { rows: selected.rows, totalRowCount };
}

function constraintEvidenceCandidates(evidence) {
  evidence.constraintCandidates ||=
    evidence.candidates ||
    evidence.constraints.flatMap(({ constraint, metadata }) =>
      constraintReactionContributionCandidates(constraint, "A", metadata),
    );
  return evidence.constraintCandidates;
}

function materializeDeferredEvidence(evidence, options = null) {
  const worldCandidates = completedWorldEvidenceCandidates(
    evidence.worldAdapter,
  );
  const constraints = constraintEvidenceCandidates(evidence);
  const candidates = [...worldCandidates, ...constraints],
    selection = options
      ? selectEvidenceRows(candidates, options)
      : {
          rows: candidates,
          totalRowCount: new Set(candidates.map(evidenceRowKey)).size,
        },
    selected = selection.rows;
  const rows = selected
    .map((candidate) =>
      materializeConstraintReactionContribution(candidate, !options),
    )
    .filter(Boolean);
  return {
    rows: Object.freeze(rows),
    totalRowCount: selection.totalRowCount,
    retentionApplied: Boolean(options),
  };
}

function massFrameIsInvariant(body, properties) {
  const current = body.userData?.massProperties;
  return Boolean(
    current &&
    frameValuesEqual(current.comPositionPartM, properties.comPositionPartM) &&
    current.principalAxesPart.every((axis, index) =>
      frameValuesEqual(axis, properties.principalAxesPart[index]),
    ),
  );
}

function cannonVector(value) {
  return new CANNON.Vec3(value[0], value[1], value[2]);
}

function cannonQuaternion(orientation) {
  return new CANNON.Quaternion(...orientation);
}

function quaternionFromPositiveZ(axis) {
  const quaternion = new CANNON.Quaternion();
  quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), axis);
  quaternion.normalize();
  return quaternion;
}

function motorIdsFor(runtime, component) {
  const memberPartIds = new Set(component.supportPartIds),
    constraintEntries = Array.isArray(runtime.constraintEntries)
      ? runtime.constraintEntries
      : [];
  return [
    ...new Set(
      constraintEntries
        .filter(
          (entry) =>
            entry.active !== false &&
            entry.descriptor.motorId != null &&
            memberPartIds.has(entry.descriptor.motorId),
        )
        .map((entry) => entry.descriptor.motorId),
    ),
  ];
}

function motorEvidenceStates(runtime, component, context) {
  if (!context) return [];
  return motorIdsFor(runtime, component).map((id) => {
    const command = readActuatorCommand(
        context.commandBus,
        runtime.part(id),
        "throttle",
        0,
      ),
      allocation = context.powerNetwork?.allocationFor(id),
      availablePowerW = allocation?.allocatedW || 0,
      drivenEntry = runtime.constraintEntries.find(
        (entry) => entry.active !== false && entry.descriptor?.motorId === id,
      );
    return {
      partId: id,
      resolvedThrottle: command.value,
      commandSource: command.source,
      availablePowerW,
      deliveredPowerW: runtime.motorElectricalWByPart.get(id) || 0,
      operational: Boolean(allocation?.operational && drivenEntry),
      shaftPositionRad: Number(drivenEntry?.angle || 0),
      shaftAngularSpeedRadPerS: Number(drivenEntry?.velocity || 0),
    };
  });
}

/** Internal diagnostic view without extending the Core-exported runtime. */
export function completedMultibodyFailureEvidence(runtime) {
  const evidence = failureEvidenceByRuntime.get(runtime);
  if (!evidence || Array.isArray(evidence))
    return evidence || Object.freeze([]);
  const completed = materializeDeferredEvidence(evidence).rows;
  failureEvidenceByRuntime.set(runtime, completed);
  return completed;
}

/** Materializes only rows admitted by the recorder's existing retention policy. */
export function boundedMultibodyFailureEvidence(runtime, options) {
  const evidence = failureEvidenceByRuntime.get(runtime);
  if (!evidence) return { rows: Object.freeze([]), totalRowCount: 0 };
  if (Array.isArray(evidence)) {
    const selection = selectEvidenceRows([...evidence], options);
    return {
      rows: Object.freeze(selection.rows),
      totalRowCount: selection.totalRowCount,
      retentionApplied: true,
    };
  }
  return materializeDeferredEvidence(evidence, options);
}

/** Finds a non-finite completed contribution without allocating every row DTO. */
export function invalidMultibodyFailureEvidenceCandidate(runtime) {
  const evidence = failureEvidenceByRuntime.get(runtime);
  if (!evidence) return null;
  if (Array.isArray(evidence))
    return evidence.find(
      (row) =>
        !Number.isFinite(row.forceMagnitudeN) ||
        !Number.isFinite(row.momentMagnitudeNm),
    );
  const invalid = invalidConstraintReactionCandidate,
    worldInvalid = completedWorldEvidenceCandidates(evidence.worldAdapter).find(
      invalid,
    );
  const candidate =
    worldInvalid || constraintEvidenceCandidates(evidence).find(invalid);
  return candidate?.rowId
    ? candidate
    : candidate
      ? { ...candidate, rowId: constraintReactionCandidateRowId(candidate) }
      : null;
}

/** Marks exactly the next completed integration for provenance capture. */
export function requestMultibodyFailureEvidenceCapture(runtime) {
  if (runtime) evidenceCapturingRuntimes.add(runtime);
}

/** Internal per-motor command/power view for the evidence telemetry system. */
export function multibodyFailureEvidenceMotorStates(
  runtime,
  component,
  context,
) {
  return motorEvidenceStates(runtime, component, context);
}

function quaternionFromPrincipalAxes(axes) {
  const matrix = [
      [axes[0][0], axes[1][0], axes[2][0]],
      [axes[0][1], axes[1][1], axes[2][1]],
      [axes[0][2], axes[1][2], axes[2][2]],
    ],
    trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  let x, y, z, w;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = scale / 4;
    x = (matrix[2][1] - matrix[1][2]) / scale;
    y = (matrix[0][2] - matrix[2][0]) / scale;
    z = (matrix[1][0] - matrix[0][1]) / scale;
  } else if (matrix[0][0] > matrix[1][1] && matrix[0][0] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    w = (matrix[2][1] - matrix[1][2]) / scale;
    x = scale / 4;
    y = (matrix[0][1] + matrix[1][0]) / scale;
    z = (matrix[0][2] + matrix[2][0]) / scale;
  } else if (matrix[1][1] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    w = (matrix[0][2] - matrix[2][0]) / scale;
    x = (matrix[0][1] + matrix[1][0]) / scale;
    y = scale / 4;
    z = (matrix[1][2] + matrix[2][1]) / scale;
  } else {
    const scale = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    w = (matrix[1][0] - matrix[0][1]) / scale;
    x = (matrix[0][2] + matrix[2][0]) / scale;
    y = (matrix[1][2] + matrix[2][1]) / scale;
    z = scale / 4;
  }
  const quaternion = new CANNON.Quaternion(x, y, z, w);
  quaternion.normalize();
  return quaternion;
}

function physicsFrame(descriptor) {
  const partToWorld = cannonCheckpointQuaternion(
      cannonQuaternion(descriptor.orientation),
    ),
    principalToPart = cannonCheckpointQuaternion(
      quaternionFromPrincipalAxes(descriptor.massProperties.principalAxesPart),
    ),
    partToPrincipal = principalToPart.conjugate(new CANNON.Quaternion()),
    bodyToWorld = cannonCheckpointQuaternion(
      partToWorld.mult(principalToPart, new CANNON.Quaternion()),
    ),
    comPart = cannonVector(descriptor.massProperties.comPositionPartM),
    position = partToWorld
      .vmult(comPart)
      .vadd(cannonVector(descriptor.position));
  return {
    partToWorld,
    principalToPart,
    partToPrincipal,
    bodyToWorld,
    comPart,
    position,
  };
}

function partFrame(body) {
  const frame = body.userData.massFrame,
    partToPrincipal = frame.principalToPart.conjugate(new CANNON.Quaternion()),
    quaternion = body.quaternion.mult(partToPrincipal, new CANNON.Quaternion()),
    comOffsetWorld = quaternion.vmult(frame.comPart),
    position = body.position.vsub(comOffsetWorld),
    originOffset = position.vsub(body.position),
    velocity = body.angularVelocity.cross(originOffset).vadd(body.velocity);
  return { position, quaternion, velocity };
}

function solvedPartPoint(body, positionPartM) {
  const massFrame = body.userData.massFrame,
    position = body.previousPosition || body.position,
    quaternion = body.previousQuaternion || body.quaternion,
    // principalToPart is the serialized authority. Never trust a cached
    // inverse: mass-property commits and checkpoint imports intentionally
    // replace the authority and older checkpoints do not carry the inverse.
    partToPrincipal = massFrame.principalToPart.conjugate(
      new CANNON.Quaternion(),
    ),
    partFromCom = cannonVector(positionPartM).vsub(massFrame.comPart),
    bodyLocalPoint = partToPrincipal.vmult(partFromCom);
  return position.vadd(quaternion.vmult(bodyLocalPoint));
}

function solvedConstraintPoint(constraint, side) {
  const body = constraint[`body${side}`],
    position = body.previousPosition || body.position,
    quaternion = body.previousQuaternion || body.quaternion,
    localPoint = constraint[`pivot${side}`] || new CANNON.Vec3();
  return position.vadd(quaternion.vmult(localPoint));
}

function translatedConstraintWrench(constraint, side, applicationPoint) {
  const wrench = constraintReactionWrench(constraint, side),
    referencePoint = solvedConstraintPoint(constraint, side),
    referenceToApplication = referencePoint.vsub(applicationPoint),
    force = cannonVector([wrench.force.x, wrench.force.y, wrench.force.z]),
    moment = cannonVector([wrench.moment.x, wrench.moment.y, wrench.moment.z]);
  referenceToApplication
    .cross(force, moment)
    .vadd(
      cannonVector([wrench.moment.x, wrench.moment.y, wrench.moment.z]),
      moment,
    );
  return Object.freeze({
    force: wrench.force,
    moment: Object.freeze({ x: moment.x, y: moment.y, z: moment.z }),
    forceN: wrench.forceN,
    torqueNm: moment.length(),
  });
}

function partWorldAxis(body, partLocalAxis) {
  return partFrame(body).quaternion.vmult(partLocalAxis);
}

function uniqueUndirectedAxes(vectors) {
  const unique = [];
  for (const vector of vectors) {
    const candidate = vector.unit(new CANNON.Vec3());
    if (
      unique.some((existing) => Math.abs(existing.dot(candidate)) >= 1 - 1e-7)
    )
      continue;
    unique.push(candidate);
  }
  return unique;
}

function roundedWheelShape({ radiusM, widthM, shoulderRadiusM }) {
  // The production tire law derives radial compliance, friction and semantic
  // tread/shoulder/sidewall regions from the solved manifold. The convex hull
  // supplies that manifold: 32 circumferential tread facets preserve the
  // validated curb/gap/rock response, while two convex shoulder facets per
  // side retain a rounded load path at large terrain height discontinuities.
  // Shoulder rings step down to 16 and then 8 vertices as their radius shrinks;
  // the exact 2:1 triangulation preserves a closed convex surface without
  // spending tread-level resolution on the nearly axial caps. Cannon's generic
  // hull setup retains antiparallel duplicates, although SAT axes are
  // undirected; canonicalizing those exact axes removes work without changing
  // the collision surface. The obstacle, sidewall and platform-edge sweeps
  // guard these behaviors.
  const circumferenceSegments = 32,
    phaseOffsetRad = Math.PI / circumferenceSegments,
    shoulderAngles = [0, Math.PI / 6, Math.PI / 2],
    halfWidth = widthM / 2,
    shoulder = Math.min(shoulderRadiusM, halfWidth * 0.95, radiusM * 0.95),
    straightHalfWidth = halfWidth - shoulder,
    axialRings = [];
  for (let index = shoulderAngles.length - 1; index >= 0; index--) {
    const angle = shoulderAngles[index];
    axialRings.push({
      z: -straightHalfWidth - shoulder * Math.sin(angle),
      radius: radiusM - shoulder + shoulder * Math.cos(angle),
    });
  }
  axialRings.push({ z: straightHalfWidth, radius: radiusM });
  for (let index = 1; index < shoulderAngles.length; index++) {
    const angle = shoulderAngles[index];
    axialRings.push({
      z: straightHalfWidth + shoulder * Math.sin(angle),
      radius: radiusM - shoulder + shoulder * Math.cos(angle),
    });
  }
  const collisionRings = axialRings.map((ring, index) => ({
      ...ring,
      segments:
        index === 0 || index === axialRings.length - 1
          ? circumferenceSegments / 4
          : index === 1 || index === axialRings.length - 2
            ? circumferenceSegments / 2
            : circumferenceSegments,
    })),
    vertices = collisionRings.flatMap((ring) =>
      Array.from({ length: ring.segments }, (_, index) => {
        const angle = (index / ring.segments) * Math.PI * 2 + phaseOffsetRad;
        return new CANNON.Vec3(
          ring.radius * Math.cos(angle),
          ring.radius * Math.sin(angle),
          ring.z,
        );
      }),
    ),
    faces = [];
  let lowerOffset = 0;
  for (let ring = 0; ring < collisionRings.length - 1; ring++) {
    const lowerSegments = collisionRings[ring].segments,
      upperSegments = collisionRings[ring + 1].segments,
      upperOffset = lowerOffset + lowerSegments;
    if (lowerSegments === upperSegments)
      for (let index = 0; index < lowerSegments; index++) {
        const next = (index + 1) % lowerSegments;
        faces.push([
          lowerOffset + index,
          lowerOffset + next,
          upperOffset + next,
          upperOffset + index,
        ]);
      }
    else if (upperSegments === lowerSegments * 2)
      for (let index = 0; index < lowerSegments; index++) {
        const lower = lowerOffset + index,
          lowerNext = lowerOffset + ((index + 1) % lowerSegments),
          upper = upperOffset + index * 2,
          upperMiddle = upperOffset + ((index * 2 + 1) % upperSegments),
          upperNext = upperOffset + ((index * 2 + 2) % upperSegments);
        faces.push(
          [lower, lowerNext, upperNext],
          [lower, upperNext, upperMiddle],
          [lower, upperMiddle, upper],
        );
      }
    else if (lowerSegments === upperSegments * 2)
      for (let index = 0; index < upperSegments; index++) {
        const lower = lowerOffset + index * 2,
          lowerMiddle = lowerOffset + ((index * 2 + 1) % lowerSegments),
          lowerNext = lowerOffset + ((index * 2 + 2) % lowerSegments),
          upper = upperOffset + index,
          upperNext = upperOffset + ((index + 1) % upperSegments);
        faces.push(
          [upper, lower, lowerMiddle],
          [upper, lowerMiddle, lowerNext],
          [upper, lowerNext, upperNext],
        );
      }
    else
      throw new Error(
        "Rounded wheel collision rings must have equal or 2:1 segment counts",
      );
    lowerOffset = upperOffset;
  }
  const firstRingSegments = collisionRings[0].segments,
    lastRingSegments = collisionRings.at(-1).segments,
    lastRingOffset = vertices.length - lastRingSegments;
  faces.push(
    Array.from(
      { length: firstRingSegments },
      (_, index) => firstRingSegments - 1 - index,
    ),
    Array.from(
      { length: lastRingSegments },
      (_, index) => lastRingOffset + index,
    ),
  );
  const shape = new CANNON.ConvexPolyhedron({ vertices, faces });
  shape.uniqueAxes = uniqueUndirectedAxes(shape.faceNormals);
  shape.uniqueEdges = uniqueUndirectedAxes(shape.uniqueEdges);
  return shape;
}

function primitiveOrientationPart(descriptor) {
  const geometry = descriptor.geometry,
    axial = [
      "cylinder-v1",
      "elliptic-cylinder-v1",
      "capsule-v1",
      "cone-v1",
    ].includes(geometry.kind);
  if (axial) {
    const axisOrientation = new CANNON.Quaternion();
    // Cannon.Cylinder is authored around local Y. The rounded-wheel hull above
    // is authored around the canonical mechanism +Z axle and therefore must
    // not inherit the cylinder adapter's Y-to-Z correction.
    axisOrientation.setFromEuler(Math.PI / 2, 0, 0);
    return cannonQuaternion(descriptor.framePart.orientation).mult(
      axisOrientation,
      new CANNON.Quaternion(),
    );
  }
  return cannonQuaternion(descriptor.framePart.orientation);
}

function shapeFrame(descriptor, frame) {
  const orientationPart = primitiveOrientationPart(descriptor),
    offsetPart = cannonVector(descriptor.framePart.positionM).vsub(
      frame.comPart,
    );
  return {
    orientation: cannonCheckpointQuaternion(
      frame.partToPrincipal.mult(orientationPart, new CANNON.Quaternion()),
    ),
    offset: frame.partToPrincipal.vmult(offsetPart),
  };
}

function shapeAndOrientation(descriptor, frame) {
  const geometry = descriptor.geometry;
  let shape;
  if (geometry.kind === "rounded-wheel-v1") shape = roundedWheelShape(geometry);
  else if (geometry.kind === "cylinder-v1")
    shape = new CANNON.Cylinder(
      geometry.radiusM,
      geometry.radiusM,
      geometry.axialLengthM,
      20,
    );
  else if (geometry.kind === "elliptic-cylinder-v1")
    shape = new CANNON.Cylinder(
      Math.max(geometry.radiusXM, geometry.radiusYM),
      Math.max(geometry.radiusXM, geometry.radiusYM),
      geometry.axialLengthM,
      20,
    );
  else if (geometry.kind === "capsule-v1")
    shape = new CANNON.Cylinder(
      geometry.radiusM,
      geometry.radiusM,
      geometry.cylinderLengthM + geometry.radiusM * 2,
      20,
    );
  else if (geometry.kind === "cone-v1")
    shape = new CANNON.Cylinder(
      geometry.endRadiusM,
      geometry.startRadiusM,
      geometry.axialLengthM,
      20,
    );
  else if (geometry.kind === "sphere-v1")
    shape = new CANNON.Sphere(geometry.radiusM);
  else if (geometry.kind === "box-v1")
    shape = new CANNON.Box(
      new CANNON.Vec3(
        geometry.fullSizeM[0] * 0.5,
        geometry.fullSizeM[1] * 0.5,
        geometry.fullSizeM[2] * 0.5,
      ),
    );
  else throw new Error(`Unsupported collision primitive ${geometry.kind}`);
  const runtimeShape = /** @type {any} */ (shape);
  runtimeShape.userData = {
    semanticKey: descriptor.semanticKey || null,
    materialKey: descriptor.materialKey || "generic-structure",
    contactRole: descriptor.contactRole || "structure",
    semanticRegions: descriptor.semanticRegions
      ? structuredClone(descriptor.semanticRegions)
      : Object.freeze([]),
    geometryKind: geometry.kind,
  };
  return { shape, ...shapeFrame(descriptor, frame) };
}

function partPoseForFrame(position, quaternion, massFrame) {
  const inversePrincipal = massFrame.principalToPart.conjugate(
      new CANNON.Quaternion(),
    ),
    partQuaternion = quaternion.mult(inversePrincipal, new CANNON.Quaternion()),
    comWorld = partQuaternion.vmult(massFrame.comPart),
    partPosition = position.vsub(comWorld);
  return { position: partPosition, quaternion: partQuaternion };
}

function writePrincipalPose(partPose, frame, position, quaternion) {
  partPose.quaternion.mult(frame.principalToPart, quaternion);
  canonicalizeLiveQuaternion(quaternion);
  const comWorld = partPose.quaternion.vmult(frame.comPart);
  partPose.position.vadd(comWorld, position);
}

function captureFixedConstraintFrame(entry) {
  const constraint = entry.constraint,
    bodyA = constraint.bodyA,
    bodyB = constraint.bodyB,
    point = (body, value) => body.pointToWorldFrame(value, new CANNON.Vec3()),
    vector = (body, value) => body.vectorToWorldFrame(value, new CANNON.Vec3());
  return {
    entry,
    local: Object.fromEntries(
      ["pivotA", "pivotB", "xA", "yA", "zA", "xB", "yB", "zB"].map((field) => [
        field,
        constraint[field].clone(),
      ]),
    ),
    points: {
      pivotA: point(bodyA, constraint.pivotA),
      pivotB: point(bodyB, constraint.pivotB),
    },
    vectors: {
      xA: vector(bodyA, constraint.xA),
      yA: vector(bodyA, constraint.yA),
      zA: vector(bodyA, constraint.zA),
      xB: vector(bodyB, constraint.xB),
      yB: vector(bodyB, constraint.yB),
      zB: vector(bodyB, constraint.zB),
    },
  };
}

function restoreFixedConstraintLocalFrame(snapshot) {
  const constraint = snapshot.entry.constraint;
  for (const [field, value] of Object.entries(snapshot.local))
    constraint[field].copy(value);
}

function captureMassCommitBodyState(body) {
  return {
    body,
    position: body.position.clone(),
    previousPosition: body.previousPosition.clone(),
    interpolatedPosition: body.interpolatedPosition.clone(),
    quaternion: body.quaternion.clone(),
    previousQuaternion: body.previousQuaternion.clone(),
    interpolatedQuaternion: body.interpolatedQuaternion.clone(),
    velocity: body.velocity.clone(),
    torque: body.torque.clone(),
    mass: body.mass,
    invMass: body.invMass,
    inertia: body.inertia.clone(),
    invInertia: body.invInertia.clone(),
    invInertiaWorld: [...body.invInertiaWorld.elements],
    invMassSolve: body.invMassSolve,
    invInertiaSolve: body.invInertiaSolve.clone(),
    invInertiaWorldSolve: [...body.invInertiaWorldSolve.elements],
    massFrame: body.userData.massFrame,
    massProperties: body.userData.massProperties,
    shapeOffsets: body.shapeOffsets.map((value) => value.clone()),
    shapeOrientations: body.shapeOrientations.map((value) => value.clone()),
    shapeBoundingSphereRadii: body.shapes.map(
      (shape) => shape.boundingSphereRadius,
    ),
    boundingRadius: body.boundingRadius,
    aabbLowerBound: body.aabb.lowerBound.clone(),
    aabbUpperBound: body.aabb.upperBound.clone(),
    aabbNeedsUpdate: body.aabbNeedsUpdate,
  };
}

function restoreMassCommitBodyState(snapshot) {
  const body = snapshot.body;
  for (const field of [
    "position",
    "previousPosition",
    "interpolatedPosition",
    "quaternion",
    "previousQuaternion",
    "interpolatedQuaternion",
    "velocity",
    "torque",
    "inertia",
    "invInertia",
    "invInertiaSolve",
  ])
    body[field].copy(snapshot[field]);
  body.mass = snapshot.mass;
  body.invMass = snapshot.invMass;
  body.invMassSolve = snapshot.invMassSolve;
  body.invInertiaWorld.elements.splice(
    0,
    body.invInertiaWorld.elements.length,
    ...snapshot.invInertiaWorld,
  );
  body.invInertiaWorldSolve.elements.splice(
    0,
    body.invInertiaWorldSolve.elements.length,
    ...snapshot.invInertiaWorldSolve,
  );
  body.userData.massFrame = snapshot.massFrame;
  body.userData.massProperties = snapshot.massProperties;
  snapshot.shapeOffsets.forEach((value, index) =>
    body.shapeOffsets[index].copy(value),
  );
  snapshot.shapeOrientations.forEach((value, index) =>
    body.shapeOrientations[index].copy(value),
  );
  snapshot.shapeBoundingSphereRadii.forEach((value, index) => {
    body.shapes[index].boundingSphereRadius = value;
  });
  body.boundingRadius = snapshot.boundingRadius;
  body.aabb.lowerBound.copy(snapshot.aabbLowerBound);
  body.aabb.upperBound.copy(snapshot.aabbUpperBound);
  body.aabbNeedsUpdate = snapshot.aabbNeedsUpdate;
}

/** Package-internal owner port; intentionally absent from Core exports. */
export function commitOwnedMultibodyMassProperties(runtime, records) {
  const commit = massPropertyCommittersByRuntime.get(runtime);
  if (!commit)
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_REQUIRED",
      "Mass-property mutation requires the registered runtime owner port",
    );
  return commit(records);
}

function recordMultibodyMotorSettlement(
  runtime,
  partId,
  deliveredW,
  settlement = null,
) {
  runtime.motorElectricalWByPart.set(
    partId,
    (runtime.motorElectricalWByPart.get(partId) || 0) +
      Math.max(0, Number(deliveredW) || 0),
  );
  const entry = runtime.constraintEntries.find(
    (candidate) =>
      candidate.descriptor.controlled &&
      candidate.descriptor.sourcePartId === partId,
  );
  if (entry && settlement) {
    entry.actuatorMechanicalWorkJ +=
      settlement.positiveMechanicalWorkJ - settlement.absorbedMechanicalWorkJ;
    entry.actuatorElectricalEnergyJ += Math.max(0, deliveredW) * settlement.dt;
    entry.actuatorDissipatedEnergyJ += settlement.rejectedHeatJ;
    entry.saturated = entry.saturated || settlement.saturated;
    addRotaryActuatorHeat(
      entry,
      entry.descriptor.mechanism.actuation.thermalLimits,
      settlement.rejectedHeatJ,
    );
    rotaryThermalAvailability(
      entry,
      entry.descriptor.mechanism.actuation.thermalLimits,
    );
  }
  return runtime.lastTelemetry;
}

/** Package-internal solved motor-energy owner port; absent from Core exports. */
export function settleOwnedMultibodyMotorEnergy(
  runtime,
  partId,
  deliveredW,
  settlement,
) {
  return recordMultibodyMotorSettlement(
    runtime,
    partId,
    deliveredW,
    settlement,
  );
}

/** Package-internal checkpoint capture boundary; absent from Core exports. */
export function exportValidatedMultibodyState(runtime) {
  if (!runtime?.compiled)
    throw new DomainValidationError(
      "MULTIBODY_CHECKPOINT_NOT_RUNNING",
      "Cannot validate multibody checkpoint state before runtime start",
    );
  const state = runtime.exportState();
  return validateMultibodyCheckpointState(
    state,
    multibodyCheckpointValidationOptions(runtime, state),
  );
}

/** Package-internal restore validator; intentionally absent from Core exports. */
export function validateMultibodyStateForCheckpointRestore(
  runtime,
  state,
  expectedMassPropertiesByPart = null,
) {
  if (!runtime?.compiled)
    throw new DomainValidationError(
      "INVALID_MULTIBODY_CHECKPOINT",
      "Multibody checkpoint does not match the running runtime",
    );
  if (
    expectedMassPropertiesByPart &&
    (!(expectedMassPropertiesByPart instanceof Map) ||
      expectedMassPropertiesByPart.size !== runtime.compiled.bodies.length ||
      runtime.compiled.bodies.some(
        (descriptor) => !expectedMassPropertiesByPart.has(descriptor.partId),
      ))
  )
    throw new DomainValidationError(
      "MULTIBODY_CHECKPOINT_MASS_AUTHORITY_COVERAGE_MISMATCH",
      "Checkpoint mass authority must exactly cover compiled body identities",
    );
  const baseline = exportValidatedMultibodyState(runtime);
  return validateMultibodyCheckpointState(state, {
    ...multibodyCheckpointValidationOptions(
      runtime,
      baseline,
      expectedMassPropertiesByPart,
    ),
    baseline,
  });
}

function restoreFixedConstraintFrame(snapshot) {
  const constraint = snapshot.entry.constraint,
    bodyA = constraint.bodyA,
    bodyB = constraint.bodyB;
  bodyA.pointToLocalFrame(snapshot.points.pivotA, constraint.pivotA);
  bodyB.pointToLocalFrame(snapshot.points.pivotB, constraint.pivotB);
  for (const field of ["xA", "yA", "zA"])
    bodyA.vectorToLocalFrame(snapshot.vectors[field], constraint[field]);
  for (const field of ["xB", "yB", "zB"])
    bodyB.vectorToLocalFrame(snapshot.vectors[field], constraint[field]);
}

function localAxis(body, worldAxis) {
  return body.quaternion.conjugate(new CANNON.Quaternion()).vmult(worldAxis);
}

function signedAngleVelocity(body, localAxisValue) {
  const axis = partWorldAxis(body, localAxisValue);
  axis.normalize();
  return body.angularVelocity.dot(axis);
}

function perpendicularReference(axis) {
  const seed =
      Math.abs(axis.y) < 0.8
        ? new CANNON.Vec3(0, 1, 0)
        : new CANNON.Vec3(1, 0, 0),
    reference = axis.cross(seed);
  reference.normalize();
  return reference;
}

function updateRevoluteMeasurement(entry, bodyA, bodyB) {
  const axis = bodyA.quaternion.vmult(entry.axisA),
    referenceA = bodyA.quaternion.vmult(entry.referenceA),
    referenceB = bodyB.quaternion.vmult(entry.referenceB),
    crossed = referenceA.cross(referenceB);
  axis.normalize();
  referenceA.normalize();
  referenceB.normalize();
  const raw = Math.atan2(axis.dot(crossed), referenceA.dot(referenceB)),
    previousRaw = entry.rawAngle ?? raw;
  let delta = raw - previousRaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  entry.angle = (entry.angle || 0) + delta;
  entry.rawAngle = raw;
  entry.velocity =
    signedAngleVelocity(bodyB, entry.axisB) -
    signedAngleVelocity(bodyA, entry.axisA);
  return entry.angle;
}

function mean(values, fallback = 0) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

// Cannon's Equation.minForce/maxForce names are misleading: GSSolver clamps
// lambda in impulse units and exposes multiplier=lambda/dt afterward. Keep the
// conversion at this engine boundary so model/runtime contracts remain SI.
function solverImpulseLimit(rate, dt) {
  return Math.abs(rate) * dt;
}

function activeFixedCluster(constraintEntries, seed) {
  const cluster = new Set([seed]),
    pending = [seed];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of constraintEntries) {
      if (entry.active === false || entry.descriptor.kind !== "fixed") continue;
      const { a, b } = entry.descriptor;
      if (a !== current && b !== current) continue;
      const neighbor = a === current ? b : a;
      if (cluster.has(neighbor)) continue;
      cluster.add(neighbor);
      pending.push(neighbor);
    }
  }
  return cluster;
}

function collisionExclusionRequired(constraintEntries, descriptor) {
  const leftCluster = activeFixedCluster(constraintEntries, descriptor.a);
  if (leftCluster.has(descriptor.b)) return true;
  const rightCluster = activeFixedCluster(constraintEntries, descriptor.b);
  return constraintEntries.some((entry) => {
    if (entry.active === false || !COORDINATE_KINDS.has(entry.descriptor.kind))
      return false;
    const { a, b } = entry.descriptor;
    return (
      (leftCluster.has(a) && rightCluster.has(b)) ||
      (leftCluster.has(b) && rightCluster.has(a))
    );
  });
}

function mergedManagedConstraintOrder(
  currentConstraints,
  managedConstraints,
  activeManagedConstraints,
  predecessorConstraints,
) {
  const result = [];
  let activeIndex = 0,
    insertionAfterLastManaged = 0,
    foundManaged = false;
  for (const constraint of currentConstraints) {
    if (!managedConstraints.has(constraint)) {
      result.push(constraint);
      continue;
    }
    foundManaged = true;
    if (activeIndex < activeManagedConstraints.length)
      result.push(activeManagedConstraints[activeIndex++]);
    insertionAfterLastManaged = result.length;
  }
  if (activeIndex < activeManagedConstraints.length) {
    let insertionIndex = insertionAfterLastManaged;
    if (!foundManaged) {
      const predecessors = new Set(predecessorConstraints);
      insertionIndex = 0;
      for (let index = 0; index < result.length; index++)
        if (predecessors.has(result[index])) insertionIndex = index + 1;
    }
    result.splice(
      insertionIndex,
      0,
      ...activeManagedConstraints.slice(activeIndex),
    );
  }
  return result;
}

/**
 * Cannon adapter for an engine-neutral compiled assembly. It owns one body
 * registry and one set of constraints for any construction topology.
 */
export class MultibodyRuntime {
  /**
   * @param {{
   *   world:any,
   *   worldAdapter?:CannonWorldAdapter,
   *   material:any,
   *   catalog?:string,
   *   fixedDt?:number,
   *   surfaceHeightAt?:any,
   *   terrainHeightAt?:any,
   *   pondAt?:any,
   *   waterDensity?:number,
   *   groundBody?:any,
   *   fieldBody?:any,
   *   materialForKey?:(materialKey:string)=>any
   * }} input
   */
  constructor({
    world,
    worldAdapter = new CannonWorldAdapter(world),
    material,
    catalog = "{}",
    fixedDt = 1 / 120,
    surfaceHeightAt = () => 0,
    terrainHeightAt = surfaceHeightAt,
    pondAt = (_x = 0, _z = 0) => null,
    waterDensity = 1000,
    groundBody = null,
    fieldBody = null,
    materialForKey = null,
  }) {
    this.world = world;
    this.worldAdapter = worldAdapter;
    this.material = material;
    this.catalog = /** @type {any} */ (
      requireInertPlainData(catalog, {
        code: "INVALID_COMPONENT_CATALOG_PLAIN_DATA",
        message:
          "Component catalog input must be serialized JSON or an exported immutable data root",
        path: ["catalog"],
      })
    );
    this.fixedDt = fixedDt;
    this.surfaceHeightAt = surfaceHeightAt;
    this.terrainHeightAt = terrainHeightAt;
    this.pondAt = pondAt;
    this.waterDensity = waterDensity;
    this.groundBody = groundBody;
    this.fieldBody = fieldBody;
    this.materialForKey = materialForKey;
    this.compiled = null;
    this.connectionIdsUseTypedStrings = false;
    this.geometryByPart = new Map();
    fluidDescriptorsByRuntime.set(this, []);
    telemetryBodyDescriptorsByRuntime.set(this, new Map());
    this.bodyByPart = new Map();
    this.constraintEntries = [];
    constraintOrderPredecessorsByRuntime.set(this, []);
    constraintValueFieldsByRuntime.set(this, new Map());
    this.collisionExclusionConstraints = [];
    this.phaseByPart = new Map();
    this.loadByConnection = new Map();
    this.torqueByConnection = new Map();
    this.motorElectricalWByPart = new Map();
    failureEvidenceByRuntime.set(this, Object.freeze([]));
    this.lastTelemetry = null;
    this.activeLuminairePartIds = [];
    this.fluidState = null;
    this.topologyRevision = 0;
    massPropertyCommittersByRuntime.set(this, (records) =>
      this.#commitMassProperties(records),
    );
  }

  /** @param {string} snapshotInput */
  start(snapshotInput) {
    if (
      this.compiled ||
      this.bodyByPart.size ||
      this.constraintEntries.length ||
      this.collisionExclusionConstraints.length
    )
      throw new DomainValidationError(
        "MULTIBODY_RUNTIME_ALREADY_STARTED",
        "A running multibody runtime must be disposed before it can start another assembly",
      );
    let engineInstallationStarted = false;
    try {
      const detachedSnapshot = /** @type {any} */ (
        requireInertPlainData(snapshotInput, {
          code: "INVALID_ASSEMBLY_PLAIN_DATA",
          message:
            "Assembly input must be serialized JSON or an exported immutable data root",
          path: ["assembly"],
        })
      );
      // Every constraint already present belongs to an earlier world owner.
      // Keep those exact object identities as the stable insertion boundary for
      // later reactivation after a checkpoint in which this owner's whole block
      // was inactive. Owners started after this runtime remain after the block.
      constraintOrderPredecessorsByRuntime.set(this, [
        ...this.world.constraints,
      ]);
      this.compiled = compileAssemblyFromIssuedRoots(
        detachedSnapshot,
        this.catalog,
      );
      let engineMassByPart;
      try {
        engineMassByPart = new Map(
          this.compiled.bodies.map((descriptor) => {
            const projection = engineMassPropertiesProjection(
              descriptor.massProperties,
              descriptor.partId,
            );
            if (descriptor.mass !== projection.massKg)
              throw new RangeError(
                `Part ${String(descriptor.partId)} compiled scalar mass contradicts its mass properties`,
              );
            return [descriptor.partId, projection];
          }),
        );
      } catch (cause) {
        throw new DomainValidationError(
          "INVALID_COMPILED_ENGINE_MASS_PROPERTIES",
          "Compiled assembly cannot produce finite Cannon mass authority",
          { cause },
        );
      }
      this.connectionIdsUseTypedStrings = identitySetUsesTypedStrings(
        (detachedSnapshot.connections || []).map(
          (connection, index) => connection.id ?? `connection-${index}`,
        ),
      );
      for (const part of this.compiled.parts) {
        const bodyGeometry = this.compiled.bodies.find(
          (body) => body.partId === part.id,
        )?.geometry;
        this.geometryByPart.set(
          part.id,
          bodyGeometry || geometryDescriptorForPart(part, this.catalog),
        );
      }
      for (const descriptor of this.compiled.bodies) {
        engineInstallationStarted = true;
        const engineMass = engineMassByPart.get(descriptor.partId),
          frame = physicsFrame(descriptor);
        const body = new CANNON.Body({
          mass: engineMass.massKg,
          material: this.material,
          position: frame.position,
          quaternion: frame.bodyToWorld,
        });
        for (const [
          primitiveIndex,
          primitive,
        ] of descriptor.geometry.collisionPrimitives.entries()) {
          const { shape, offset, orientation } = shapeAndOrientation(
            primitive,
            frame,
          );
          if (this.materialForKey)
            shape.material = this.materialForKey(primitive.materialKey);
          const evidenceShape = /** @type {any} */ (shape);
          evidenceShape.userData = {
            ...(evidenceShape.userData || {}),
            shapeId: `part:${descriptor.id.startsWith("body:") ? descriptor.id.slice("body:".length) : descriptor.id}:shape:${primitiveIndex}`,
          };
          body.addShape(shape, offset, orientation || undefined);
        }
        const [ix, iy, iz] = engineMass.inertia;
        body.invMass = engineMass.invMass;
        body.inertia.set(ix, iy, iz);
        body.invInertia.set(
          engineMass.invInertia[0],
          engineMass.invInertia[1],
          engineMass.invInertia[2],
        );
        body.updateInertiaWorld(true);
        body.linearDamping = descriptor.linearDamping;
        body.angularDamping = descriptor.angularDamping;
        body.allowSleep = false;
        body.collisionFilterGroup = 8;
        // Compiled bodies collide with the environment and with other compiled
        // bodies. Authored constraint topology supplies only the pair-specific
        // exclusions required for rigid clusters and adjacent coordinates.
        body.collisionFilterMask = 1 | 8;
        const runtimeBody = /** @type {any} */ (body);
        runtimeBody.userData = {
          ...(runtimeBody.userData || {}),
          partId: descriptor.partId,
          compiledBodyId: descriptor.id,
          massFrame: {
            principalToPart: frame.principalToPart,
            comPart: frame.comPart,
          },
          massProperties: deepFreeze(
            structuredClone(descriptor.massProperties),
          ),
        };
        this.bodyByPart.set(descriptor.partId, body);
        this.world.addBody(body);
        telemetryBodyDescriptorsByRuntime.get(this).set(descriptor.partId, {
          descriptor,
          primaryAxisPart: cannonVector(
            primaryGeometryAxisPart(descriptor.geometry),
          ),
        });
        this.phaseByPart.set(descriptor.partId, 0);
        const collisionBounds = descriptor.geometry.collisionBoundsPartM;
        fluidDescriptorsByRuntime.get(this).push({
          partId: descriptor.partId,
          buoyancyCenterPart: cannonVector(boundsCenter(collisionBounds)),
          halfHeightM: Math.max(
            0.03,
            (boundsDimensions(collisionBounds)[1] || 0.2) / 2,
          ),
          volumeM3: descriptor.geometry.displacementM3,
        });
      }
      for (const descriptor of this.compiled.constraints)
        this.createConstraint(descriptor);
      const supportBody =
        this.groundBody ||
        this.fieldBody ||
        this.world.bodies.find((body) => body.type === CANNON.Body.STATIC);
      if (supportBody)
        for (const descriptor of this.compiled.contactRegions || []) {
          if (descriptor.kind !== "rolling-contact-v1") continue;
          const body = this.bodyByPart.get(descriptor.sourcePartId);
          if (!body) continue;
          const constraint = new TireContactConstraint(
            this.world,
            body,
            supportBody,
            descriptor,
            this.fixedDt,
          );
          const entry = {
            descriptor: {
              ...descriptor,
              kind: "rolling-contact",
              sourceConnectionIds: [],
            },
            kind: "rolling-contact-v1",
            constraint,
          };
          this.constraintEntries.push(entry);
          registerRollingSupport(this.worldAdapter.transaction, {
            wheelBody: body,
            wheelShape: body.shapes[0],
            descriptor,
            constraint,
          });
          this.world.addConstraint(constraint);
        }
      constraintValueFieldsByRuntime.set(
        this,
        new Map(
          this.constraintEntries.map((entry) => [
            entry.descriptor.id,
            Object.freeze(
              CHECKPOINT_CONSTRAINT_SCALAR_FIELDS.filter(
                (key) => key === "active" || Object.hasOwn(entry, key),
              ),
            ),
          ]),
        ),
      );
      for (const entry of this.constraintEntries)
        if (entry.constraint)
          entry.constraint.simulacrumEvidence = Object.freeze({
            constraintId: String(entry.descriptor.id),
            sourceConnectionIds: Object.freeze(
              [...new Set(entry.descriptor.sourceConnectionIds || [])]
                .map((connectionId) =>
                  identityToken(connectionId, {
                    typedStrings: this.connectionIdsUseTypedStrings,
                  }),
                )
                .sort(),
            ),
            source:
              entry.kind === "rolling-contact-v1" ? "tire-force" : "constraint",
          });
      for (const descriptor of this.compiled.collisionExclusions) {
        const bodyA = this.bodyByPart.get(descriptor.a),
          bodyB = this.bodyByPart.get(descriptor.b);
        if (!bodyA || !bodyB) continue;
        const exclusion = { bodyA, bodyB };
        this.collisionExclusionConstraints.push({
          descriptor,
          exclusion,
          active: true,
        });
        registerCannonCollisionExclusion(
          this.worldAdapter.transaction,
          exclusion,
        );
      }
      captureMultibodyEngineAuthority(this);
      this.lastTelemetry = this.telemetry();
      return this.lastTelemetry;
    } catch (cause) {
      try {
        this.dispose();
      } catch (rollbackError) {
        throw new AggregateError(
          [cause, rollbackError],
          "Multibody startup failed and exact installation rollback failed",
          { cause: rollbackError },
        );
      }
      if (cause instanceof DomainValidationError || !engineInstallationStarted)
        throw cause;
      throw new DomainValidationError(
        "MULTIBODY_START_ENGINE_INSTALL_FAILED",
        "Multibody startup failed after validation; installed engine authority was removed",
        { cause },
      );
    }
  }

  /**
   * Legacy public surface retained for API compatibility. Physical mass is
   * mutable only through the package-internal coordinated owner port.
   * @returns {{partId:any,previousMassKg:any,massKg:any,massDeltaKg:number,comPositionPartM:any[],principalMomentsKgM2:any[],sourceKind:any}[]}
   */
  commitMassProperties(records) {
    void records;
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_REQUIRED",
      "Direct mass-property mutation is unavailable; use the coordinated physical owner transaction",
    );
  }

  #commitMassProperties(records) {
    let detachedRecords;
    try {
      detachedRecords = clonePlainMassPropertyData(
        records,
        "mass-property transaction",
      );
    } catch (cause) {
      throw new DomainValidationError(
        "INVALID_MASS_PROPERTY_TRANSACTION",
        "Mass-property transaction must be detached plain finite data",
        { cause },
      );
    }
    if (!this.compiled || !Array.isArray(detachedRecords))
      throw new DomainValidationError(
        "INVALID_MASS_PROPERTY_TRANSACTION",
        "Mass-property commit requires a running multibody runtime and records",
      );
    validateLiveMultibodyEngineAuthority(this);
    const byPart = new Map(),
      dynamicContributorKindsByPart = runtimeMassContributorKindsByPart(
        this.compiled,
      );
    for (const [index, record] of detachedRecords.entries()) {
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        Object.keys(record).sort().join("\u0000") !==
          ["massProperties", "partId"].join("\u0000") ||
        record.partId == null ||
        byPart.has(record.partId)
      )
        throw new DomainValidationError(
          "INVALID_MASS_PROPERTY_TRANSACTION",
          "Mass-property commit records must be field-exact with present unique part IDs",
          { path: ["records", index] },
        );
      const body = this.bodyByPart.get(record.partId),
        descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === record.partId,
        ),
        properties = record.massProperties;
      if (
        !body ||
        !descriptor ||
        !Number.isFinite(properties?.massKg) ||
        properties.massKg <= 0 ||
        !Array.isArray(properties.comPositionPartM) ||
        properties.comPositionPartM.length !== 3 ||
        properties.comPositionPartM.some((value) => !Number.isFinite(value)) ||
        !Array.isArray(properties.principalMomentsKgM2) ||
        properties.principalMomentsKgM2.length !== 3 ||
        properties.principalMomentsKgM2.some(
          (value) => !Number.isFinite(value) || value <= 0,
        ) ||
        body.shapes.length !== descriptor.geometry.collisionPrimitives.length
      )
        throw new DomainValidationError(
          "INVALID_MASS_PROPERTIES",
          `Part ${String(record.partId)} has invalid dynamic mass properties`,
          { path: ["records", index, "massProperties"] },
        );
      let detachedProperties, frame, primitiveFrames, invMass, invInertia;
      try {
        validateRuntimeMassPropertiesAuthority(properties, {
          compiledProperties: descriptor.massProperties,
          partId: record.partId,
          dynamicMassContributorKinds:
            dynamicContributorKindsByPart.get(record.partId) || [],
        });
        detachedProperties = deepFreeze(properties);
        frame = physicsFrame({
          ...descriptor,
          massProperties: detachedProperties,
        });
        primitiveFrames = descriptor.geometry.collisionPrimitives.map(
          (primitive) => shapeFrame(primitive, frame),
        );
        const engineMass = engineMassPropertiesProjection(
          detachedProperties,
          record.partId,
        );
        invMass = engineMass.invMass;
        invInertia = engineMass.invInertia;
        for (const value of [
          frame.principalToPart,
          frame.comPart,
          ...primitiveFrames.flatMap((primitiveFrame) => [
            primitiveFrame.offset,
            primitiveFrame.orientation,
          ]),
        ])
          if (
            ![value.x, value.y, value.z, value.w]
              .filter((entry) => entry !== undefined)
              .every(Number.isFinite)
          )
            throw new RangeError(
              `Part ${String(record.partId)} produces a non-finite engine frame`,
            );
      } catch (cause) {
        throw new DomainValidationError(
          "INVALID_MASS_PROPERTIES",
          `Part ${String(record.partId)} has invalid or unauthorized dynamic mass properties`,
          { path: ["records", index, "massProperties"], cause },
        );
      }
      byPart.set(record.partId, {
        body,
        descriptor,
        properties: detachedProperties,
        frame,
        primitiveFrames,
        invMass,
        invInertia,
      });
    }
    const frameInvariantPartIds = new Set(
        [...byPart]
          .filter(([, { body, properties }]) =>
            massFrameIsInvariant(body, properties),
          )
          .map(([partId]) => partId),
      ),
      affectedPartIds = new Set(byPart.keys()),
      affectedEntries = this.constraintEntries.filter(
        (entry) =>
          entry.constraint &&
          (affectedPartIds.has(entry.descriptor.a) ||
            affectedPartIds.has(entry.descriptor.b)),
      );
    for (const entry of affectedEntries)
      if (
        entry.descriptor.kind !== "fixed" &&
        [entry.descriptor.a, entry.descriptor.b]
          .filter((partId) => affectedPartIds.has(partId))
          .some((partId) => !frameInvariantPartIds.has(partId))
      )
        throw new DomainValidationError(
          "DYNAMIC_MASS_CONSTRAINT_UNSUPPORTED",
          `Dynamic mass part participates in unsupported ${entry.descriptor.kind} constraint ${String(entry.descriptor.id)}`,
          { details: { descriptor: entry.descriptor } },
        );
    const constraintFrames = affectedEntries
        .filter((entry) => entry.descriptor.kind === "fixed")
        .map(captureFixedConstraintFrame),
      plans = [...byPart].map(
        ([
          partId,
          { body, properties, frame, primitiveFrames, invMass, invInertia },
        ]) => {
          const oldFrame = body.userData.massFrame,
            currentPose = partPoseForFrame(
              body.position,
              body.quaternion,
              oldFrame,
            ),
            previousPose = partPoseForFrame(
              body.previousPosition,
              body.previousQuaternion,
              oldFrame,
            ),
            interpolatedPose = partPoseForFrame(
              body.interpolatedPosition,
              body.interpolatedQuaternion,
              oldFrame,
            ),
            originOffset = currentPose.position.vsub(body.position),
            originVelocity = body.angularVelocity
              .cross(originOffset, new CANNON.Vec3())
              .vadd(body.velocity),
            previousMassKg = body.mass,
            oldComPosition = body.position.clone();
          return {
            partId,
            body,
            properties,
            frame,
            primitiveFrames,
            invMass,
            invInertia,
            currentPose,
            previousPose,
            interpolatedPose,
            originVelocity,
            previousMassKg,
            oldComPosition,
          };
        },
      ),
      bodySnapshots = plans.map(({ body }) => captureMassCommitBodyState(body)),
      committed = [];
    // Every caller-controlled clone, provenance check, decomposition, frame
    // derivation, and constraint-compatibility check completed above. The
    // remaining phase is a deterministic assignment of the detached plans.
    try {
      for (const plan of plans) {
        const {
          partId,
          body,
          properties,
          frame,
          primitiveFrames,
          invMass,
          invInertia,
          currentPose,
          previousPose,
          interpolatedPose,
          originVelocity,
          previousMassKg,
          oldComPosition,
        } = plan;
        writePrincipalPose(currentPose, frame, body.position, body.quaternion);
        writePrincipalPose(
          previousPose,
          frame,
          body.previousPosition,
          body.previousQuaternion,
        );
        writePrincipalPose(
          interpolatedPose,
          frame,
          body.interpolatedPosition,
          body.interpolatedQuaternion,
        );
        const newComOffset = body.position.vsub(currentPose.position);
        body.angularVelocity
          .cross(newComOffset, body.velocity)
          .vadd(originVelocity, body.velocity);
        const torqueShift = oldComPosition
          .vsub(body.position)
          .cross(body.force, new CANNON.Vec3());
        body.torque.vadd(torqueShift, body.torque);
        body.mass = properties.massKg;
        body.invMass = invMass;
        body.inertia.set(...properties.principalMomentsKgM2);
        body.invInertia.set(...invInertia);
        body.userData.massFrame = {
          principalToPart: frame.principalToPart,
          comPart: frame.comPart,
        };
        body.userData.massProperties = properties;
        for (let index = 0; index < primitiveFrames.length; index++) {
          const primitiveFrame = primitiveFrames[index];
          body.shapeOffsets[index].copy(primitiveFrame.offset);
          body.shapeOrientations[index].copy(primitiveFrame.orientation);
        }
        body.updateBoundingRadius();
        body.aabbNeedsUpdate = true;
        body.updateAABB();
        body.updateInertiaWorld(true);
        body.updateSolveMassProperties();
        committed.push({
          partId,
          previousMassKg,
          massKg: properties.massKg,
          massDeltaKg: properties.massKg - previousMassKg,
          comPositionPartM: [...properties.comPositionPartM],
          principalMomentsKgM2: [...properties.principalMomentsKgM2],
          sourceKind: properties.sourceKind,
        });
      }
      for (const frame of constraintFrames) {
        restoreFixedConstraintFrame(frame);
        refreshConstraintFrameAuthority(this, frame.entry);
      }
      for (const { partId } of plans)
        refreshBodyPhysicalAuthority(this, partId);
    } catch (cause) {
      try {
        for (const snapshot of bodySnapshots)
          restoreMassCommitBodyState(snapshot);
        for (const frame of constraintFrames)
          restoreFixedConstraintLocalFrame(frame);
      } catch (rollbackError) {
        throw new AggregateError(
          [cause, rollbackError],
          `Mass-property application failed and exact rollback failed: ${String(cause)}; rollback: ${String(rollbackError)}`,
          { cause: rollbackError },
        );
      }
      throw new DomainValidationError(
        "MASS_PROPERTY_ENGINE_COMMIT_FAILED",
        "Mass-property application failed after validation; live engine state was restored",
        { cause },
      );
    }
    return committed;
  }

  createConstraint(descriptor) {
    const bodyA = this.bodyByPart.get(descriptor.a),
      bodyB = this.bodyByPart.get(descriptor.b);
    if (descriptor.kind === "measurement") {
      this.constraintEntries.push({ descriptor, kind: "measurement" });
      return;
    }
    if (!bodyA || !bodyB) return;
    if (descriptor.kind === "fixed") {
      const constraint = new CANNON.LockConstraint(bodyA, bodyB, {
        // Keep the numerical solver ceiling above the material limit. The
        // structure system must observe the demanded reaction and decide when
        // an attachment fails; clipping at breakForce hides impact overloads.
        maxForce: solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
      });
      // Keep Cannon's one common COM-midpoint solver reference. It preserves
      // the authored relative transform without forcing the two physical
      // endpoints of a rigid element to coincide, and it retains the existing
      // finite-solver conditioning. Attachment frames are evidence/application
      // points; solved reactions are translated to them below.
      constraint.collideConnected = false;
      this.constraintEntries.push({ descriptor, constraint });
      this.world.addConstraint(constraint);
      return;
    }
    if (descriptor.kind === "revolute") {
      const anchor = cannonVector(descriptor.anchor),
        rotorBody = this.bodyByPart.get(descriptor.rotorId) || bodyB,
        rotorLocalAxis = cannonVector(descriptor.axis),
        worldAxis = descriptor.axisWorld
          ? cannonVector(descriptor.axisWorld)
          : partWorldAxis(rotorBody, rotorLocalAxis);
      worldAxis.normalize();
      const worldReference = perpendicularReference(worldAxis),
        axisA = localAxis(bodyA, worldAxis),
        axisB = localAxis(bodyB, worldAxis),
        referenceA = localAxis(bodyA, worldReference),
        referenceB = localAxis(bodyB, worldReference);
      const constraint = new CANNON.HingeConstraint(bodyA, bodyB, {
        pivotA: bodyA.pointToLocalFrame(anchor),
        pivotB: bodyB.pointToLocalFrame(anchor),
        axisA,
        axisB,
        // The hinge equations keep both bodies attached; their force ceiling
        // is a structural property. Actuator torque is bounded independently
        // on the motor equation below. Conflating the two lets a heavy limb
        // pull its pivot apart merely because its servo is modestly rated.
        maxForce: solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
        collideConnected: false,
      });
      const entry = {
        descriptor,
        constraint,
        axisA,
        axisB,
        referenceA,
        referenceB,
        angle: 0,
        rawAngle: 0,
        velocity: 0,
        reactionTorque: 0,
        ...(descriptor.controlled
          ? {
              actuatorMechanicalWorkJ: 0,
              actuatorElectricalEnergyJ: 0,
              actuatorDissipatedEnergyJ: 0,
              temperatureK: ACTUATOR_AMBIENT_TEMPERATURE_K,
              powered: false,
              saturated: false,
              thermalDerate: 1,
              thermalShutdown: false,
            }
          : {}),
      };
      this.constraintEntries.push(entry);
      this.world.addConstraint(constraint);
      return;
    }
    if (
      descriptor.kind === "spring" ||
      descriptor.kind === "damper" ||
      descriptor.kind === "linear-actuator"
    ) {
      const localAnchorA = bodyA.pointToLocalFrame(
          cannonVector(descriptor.anchorA),
        ),
        localAnchorB = bodyB.pointToLocalFrame(
          cannonVector(descriptor.anchorB),
        ),
        initialAxis = cannonVector(descriptor.anchorB).vsub(
          cannonVector(descriptor.anchorA),
        ),
        limitConstraint = new AxialLimitConstraint(bodyA, bodyB, {
          localAnchorA,
          localAnchorB,
          axisWorld: initialAxis,
          limits: [
            descriptor.mechanism.lengthRangeM.lower,
            descriptor.mechanism.lengthRangeM.upper,
          ],
          holdingClutch:
            descriptor.mechanism.unpoweredLaw?.kind === "holding-clutch-v1",
          maximumConstraintImpulse: solverImpulseLimit(
            Math.max(1, descriptor.breakForce || 24000) * 100,
            this.fixedDt,
          ),
        });
      const entry = {
        descriptor,
        kind:
          descriptor.kind === "linear-actuator"
            ? "axial-actuator-v1"
            : "axial-force-v1",
        constraint: limitConstraint,
        localAnchorA,
        localAnchorB,
        force: 0,
        coordinateM: descriptor.restLength || 0,
        rateMPerS: 0,
        elasticPotentialJ: 0,
        dampingWorkJ: 0,
        dampingPowerW: 0,
        reactionForceN: 0,
        appliedForceN: 0,
        frictionWorkJ: 0,
        actuatorMechanicalWorkJ: 0,
        actuatorElectricalEnergyJ: 0,
        actuatorDissipatedEnergyJ: 0,
        temperatureK: 293.15,
        powered: false,
        saturated: false,
        thermalDerate: 1,
        thermalShutdown: false,
        clutchEngaged: false,
        clutchCoordinateM: null,
      };
      this.constraintEntries.push(entry);
      this.world.addConstraint(limitConstraint);
      return;
    }
    if (descriptor.kind === "linear-guide") {
      const localAnchorA = bodyA.pointToLocalFrame(
          cannonVector(descriptor.anchorA),
        ),
        localAnchorB = bodyB.pointToLocalFrame(
          cannonVector(descriptor.anchorB),
        ),
        constraint = new PrismaticConstraint(bodyA, bodyB, {
          localAnchorA,
          localAnchorB,
          axisWorld: cannonVector(descriptor.axisWorld),
          coordinateOffsetM: descriptor.coordinateOffsetM,
          limits: descriptor.limits,
          guideFrictionLaw:
            descriptor.mechanism.guideFriction?.kind === "coulomb-viscous-v1"
              ? descriptor.mechanism.guideFriction
              : null,
          fixedDt: this.fixedDt,
          maximumConstraintImpulse: solverImpulseLimit(
            Math.max(1, descriptor.breakForce || 24000) * 100,
            this.fixedDt,
          ),
        });
      const entry = {
        descriptor,
        kind: "prismatic-coordinate-v1",
        constraint,
        localAnchorA,
        localAnchorB,
        coordinateM: descriptor.coordinateOffsetM,
        rateMPerS: 0,
        transverseM: 0,
        reactionForceN: 0,
        appliedForceN: 0,
        frictionWorkJ: 0,
        actuatorMechanicalWorkJ: 0,
        actuatorElectricalEnergyJ: 0,
        actuatorDissipatedEnergyJ: 0,
        temperatureK: 293.15,
        powered: false,
        saturated: false,
        clutchEngaged: false,
        clutchCoordinateM: null,
      };
      this.constraintEntries.push(entry);
      this.world.addConstraint(constraint);
      return;
    }
    if (descriptor.kind === "linkage") {
      const constraint = new CANNON.DistanceConstraint(
        bodyA,
        bodyB,
        Math.max(0.01, descriptor.restLength),
        solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
      );
      constraint.collideConnected = false;
      this.constraintEntries.push({ descriptor, constraint });
      this.world.addConstraint(constraint);
      return;
    }
    if (descriptor.kind === "gear") {
      this.constraintEntries.push({
        descriptor,
        kind: "gear",
        phaseA: 0,
        phaseB: 0,
        reactionTorque: 0,
      });
    }
  }

  part(id) {
    return this.compiled?.parts.find((candidate) => candidate.id === id);
  }

  hasWheels() {
    return (this.compiled?.contactRegions || []).some(
      (region) => region.kind === "rolling-contact-v1",
    );
  }

  hasArticulation() {
    return this.constraintEntries.some(
      (entry) =>
        entry.active !== false &&
        entry.descriptor.kind === "revolute" &&
        entry.descriptor.controlled &&
        entry.descriptor.sourcePartId != null,
    );
  }

  wheelContactSamples(body, up) {
    const samples = [];
    for (const contact of this.world.contacts || []) {
      if (contact.bi !== body && contact.bj !== body) continue;
      const bodyIsA = contact.bi === body,
        normal = contact.ni.scale(bodyIsA ? -1 : 1),
        otherBody = bodyIsA ? contact.bj : contact.bi,
        normalAlignment = normal.dot(up);
      if (normalAlignment <= 0.05) continue;
      const contactMaterial =
        this.world.getContactMaterial?.(body.material, otherBody.material) ||
        this.world.defaultContactMaterial;
      samples.push({
        otherBody,
        normal,
        normalAlignment,
        forceN:
          Math.abs(contact.multiplier || 0) * Math.max(0, normalAlignment),
        friction: Math.max(0, Number(contactMaterial?.friction ?? 0.3)),
      });
    }
    return samples;
  }

  tireContactStates() {
    return this.constraintEntries
      .filter((entry) => entry.kind === "rolling-contact-v1")
      .map((entry) => ({
        partId: entry.descriptor.sourcePartId,
        state: structuredClone(entry.constraint.state),
      }));
  }

  forEachTireMechanicalState(visitor) {
    for (const entry of this.constraintEntries)
      if (entry.kind === "rolling-contact-v1")
        visitor(entry.descriptor.sourcePartId, {
          deflectionM: entry.constraint.state.carcassDeflectionM,
          carcassTemperatureK: entry.constraint.state.temperatureK,
          rimLoadN: entry.constraint.state.rimLoadN,
          normalLoadN: entry.constraint.state.normalLoadN,
          contactRoles: entry.constraint.state.contactRoles,
        });
  }

  setTirePneumaticGasState(
    partId,
    state,
    carcassHeatJ = 0,
    ambientPressurePa = null,
  ) {
    const entry = this.constraintEntries.find(
      (candidate) =>
        candidate.kind === "rolling-contact-v1" &&
        candidate.descriptor.sourcePartId === partId,
    );
    if (!entry) return false;
    entry.constraint.setPneumaticGasState(
      state,
      carcassHeatJ,
      ambientPressurePa,
    );
    return true;
  }

  mobilityTelemetryFor(component, context = null, _dt = 0) {
    if (!component?.id)
      throw new DomainValidationError(
        "MOBILITY_COMPONENT_REQUIRED",
        "Mobility telemetry requires a canonical physical component",
      );
    const memberPartIds = new Set(component.supportPartIds),
      regions = (this.compiled?.contactRegions || []).filter((region) =>
        memberPartIds.has(region.sourcePartId),
      );
    if (!regions.length) return null;
    const wheelStates = regions
        .map((region) => {
          const body = this.bodyByPart.get(region.sourcePartId);
          if (!body) return null;
          const tireState = this.constraintEntries.find(
              (entry) =>
                entry.kind === "rolling-contact-v1" &&
                entry.descriptor.sourcePartId === region.sourcePartId,
            )?.constraint.state,
            tireTouching = Boolean(tireState?.touching);
          const up = new CANNON.Vec3(0, 1, 0),
            contacts = this.wheelContactSamples(body, up),
            axle = partWorldAxis(body, cannonVector(region.localAxleAxis)),
            angularSpeed = body.angularVelocity.dot(axle),
            normalLoadN = tireState?.normalLoadN || 0;
          return {
            partId: region.sourcePartId,
            axleWorld: plainVector(axle),
            headingWorld: { x: 0, y: 0, z: 0 },
            steeringAngleRad: 0,
            touching: tireTouching,
            normalLoadN,
            longitudinalForceN: tireState?.longitudinalForceN || 0,
            lateralForceN: tireState?.lateralForceN || 0,
            carcassDeflectionM: tireState?.carcassDeflectionM || 0,
            carcassDeflectionRateMPerS:
              tireState?.carcassDeflectionRateMPerS || 0,
            longitudinalSlipMPerS: tireState?.slipLongMPerS || 0,
            lateralSlipMPerS: tireState?.slipLatMPerS || 0,
            frictionEllipseUtilization:
              tireState?.frictionEllipseUtilization || 0,
            rollingResistanceTorqueNm:
              tireState?.rollingResistanceTorqueNm || 0,
            rollingHysteresisEnergyPerCycleJ:
              tireState?.rollingHysteresisEnergyPerCycleJ || 0,
            effectiveRollingResistanceCoefficient:
              tireState?.effectiveRollingResistanceCoefficient || 0,
            surfaceSinkageM: tireState?.surfaceSinkageM || 0,
            surfaceRollingResistanceMultiplier:
              tireState?.surfaceRollingResistanceMultiplier || 1,
            rimLoadN: tireState?.rimLoadN || 0,
            dissipatedEnergyJ: tireState?.dissipatedEnergyJ || 0,
            temperatureK: tireState?.temperatureK || 293.15,
            absolutePressurePa: tireState?.absolutePressurePa ?? null,
            gaugePressurePa: tireState?.gaugePressurePa ?? null,
            gasTemperatureK: tireState?.gasTemperatureK ?? null,
            chamberVolumeM3: tireState?.chamberVolumeM3 ?? null,
            gasMassKg: tireState?.pneumaticGasState?.massKg ?? null,
            contactRoles: tireState?.contactRoles || [],
            contactRegionKeys: tireState?.contactRegionKeys || [],
            contactMaterialKeys: tireState?.contactMaterialKeys || [],
            supportMaterialKeys: tireState?.supportMaterialKeys || [],
            supportMaterialLaws: tireState?.supportMaterialLaws || [],
            manifoldPointCount: tireState?.manifoldPointCount || 0,
            angularSpeed,
            groundY: this.surfaceHeightAt(body.position.x, body.position.z),
            inPond: Boolean(this.pondAt(body.position.x, body.position.z)),
            onPlatform: contacts.some(
              (contact) => contact.otherBody === this.groundBody,
            ),
            onField: contacts.some(
              (contact) => contact.otherBody === this.fieldBody,
            ),
          };
        })
        .filter(Boolean),
      bodies = [...this.bodyByPart.entries()]
        .filter(([partId]) => component.bodyPartIds.includes(partId))
        .map(([, body]) => body),
      mass = bodies.reduce((sum, body) => sum + body.mass, 0),
      position = new CANNON.Vec3(),
      velocity = new CANNON.Vec3();
    for (const body of bodies) {
      position.x += body.position.x * body.mass;
      position.y += body.position.y * body.mass;
      position.z += body.position.z * body.mass;
      velocity.x += body.velocity.x * body.mass;
      velocity.y += body.velocity.y * body.mass;
      velocity.z += body.velocity.z * body.mass;
    }
    position.scale(1 / Math.max(0.001, mass), position);
    velocity.scale(1 / Math.max(0.001, mass), velocity);
    const carrier = this.bodyByPart.get(component.framePartId) || bodies[0],
      carrierFrame = partFrame(carrier),
      carrierUp = carrierFrame.quaternion.vmult(new CANNON.Vec3(0, 1, 0)),
      forward = carrierFrame.quaternion.vmult(new CANNON.Vec3(0, 0, -1)),
      grounded = wheelStates.some((wheel) => wheel.touching),
      inWater = wheelStates.some((wheel) => wheel.inPond),
      platformShape = this.groundBody?.shapes?.find(
        (shape) => shape.halfExtents,
      ),
      edgeDistance = platformShape
        ? Math.min(
            platformShape.halfExtents.x -
              Math.abs(position.x - this.groundBody.position.x),
            platformShape.halfExtents.z -
              Math.abs(position.z - this.groundBody.position.z),
          )
        : 0,
      motorIds = motorIdsFor(this, component),
      motorStates = motorEvidenceStates(this, component, context),
      requestedThrottle = context
        ? mean(motorStates.map((motor) => motor.resolvedThrottle))
        : 0,
      brake = context
        ? Math.max(
            0,
            ...motorIds.map(
              (id) =>
                readActuatorCommand(
                  context.commandBus,
                  this.part(id),
                  "brake",
                  0,
                ).value,
            ),
          )
        : 0,
      fluidByPart = fluidStateRecordsByPart(this.fluidState),
      fluidParts = [...memberPartIds]
        .map((partId) => fluidByPart.get(partId))
        .filter(Boolean),
      displacedVolumeM3 = fluidParts.reduce(
        (sum, state) => sum + state.volumeM3,
        0,
      ),
      submergedVolumeM3 = fluidParts.reduce(
        (sum, state) => sum + state.submergedVolumeM3,
        0,
      ),
      buoyancyN = fluidParts.reduce((sum, state) => sum + state.buoyancyN, 0),
      hydrodynamicDragN = fluidParts.reduce(
        (sum, state) => sum + state.dragN,
        0,
      ),
      waterDepth = Math.max(0, ...fluidParts.map((state) => state.waterDepth));
    carrierUp.normalize();
    forward.vsub(carrierUp.scale(forward.dot(carrierUp)), forward);
    forward.normalize();
    for (const wheel of wheelStates) {
      const axle = new CANNON.Vec3(
          wheel.axleWorld.x,
          wheel.axleWorld.y,
          wheel.axleWorld.z,
        ),
        projectedAxle = axle.vsub(carrierUp.scale(axle.dot(carrierUp)));
      if (projectedAxle.lengthSquared() <= 1e-12) {
        wheel.headingWorld = plainVector(forward);
        wheel.steeringAngleRad = 0;
        continue;
      }
      projectedAxle.normalize();
      const heading = carrierUp.cross(projectedAxle);
      heading.normalize();
      if (heading.dot(forward) < 0) heading.negate(heading);
      wheel.headingWorld = plainVector(heading);
      wheel.steeringAngleRad = Math.atan2(
        forward.cross(heading).dot(carrierUp),
        clamp(forward.dot(heading), -1, 1),
      );
    }
    return {
      active: true,
      poseMode: "per-part",
      pose: {
        position: plainVector(position),
        quaternion: plainQuaternion(carrierFrame.quaternion),
        visualOffsetY: 0,
      },
      velocity: plainVector(velocity),
      angularVelocity: plainVector(carrier.angularVelocity),
      signedSpeed: velocity.dot(forward),
      assemblyId: component.id,
      framePartId: carrier.userData?.partId ?? null,
      memberPartIds: component.supportPartIds,
      bodyPartIds: component.bodyPartIds,
      lineage: component.lineage,
      steering: {
        angleRad: mean(wheelStates.map((wheel) => wheel.steeringAngleRad)),
        wheelPartIds: wheelStates.map((wheel) => wheel.partId),
      },
      brake,
      lights: this.activeLuminairePartIds.some((id) => memberPartIds.has(id)),
      activeLuminairePartIds: this.activeLuminairePartIds.filter((id) =>
        memberPartIds.has(id),
      ),
      driveForce: {
        requestedThrottle,
        availableMotorPowerW: motorIds.reduce(
          (sum, id) =>
            sum + (context?.powerNetwork?.allocationFor(id)?.allocatedW || 0),
          0,
        ),
        deliveredMotorPowerW: motorIds.reduce(
          (sum, id) => sum + (this.motorElectricalWByPart.get(id) || 0),
          0,
        ),
        tractionLimitN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.normalLoadN,
          0,
        ),
        longitudinalForceN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.longitudinalForceN,
          0,
        ),
        lateralForceN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.lateralForceN,
          0,
        ),
      },
      motorPartIds: motorIds,
      edgeDistance,
      grounded,
      onPlatform: wheelStates.some((wheel) => wheel.onPlatform),
      onField: wheelStates.some((wheel) => wheel.onField),
      inWater,
      bottomContact: inWater && grounded,
      wheelContacts: wheelStates.filter((wheel) => wheel.touching).length,
      supportMaterialKeys: [
        ...new Set(wheelStates.flatMap((wheel) => wheel.supportMaterialKeys)),
      ].sort(),
      supportMaterialLaws: [
        ...new Map(
          wheelStates
            .flatMap((wheel) => wheel.supportMaterialLaws)
            .map((law) => [law.materialKey, law]),
        ).values(),
      ].sort((left, right) =>
        left.materialKey.localeCompare(right.materialKey),
      ),
      submergedFraction:
        submergedVolumeM3 / Math.max(Number.EPSILON, displacedVolumeM3),
      displacedVolumeM3,
      buoyancyN,
      weightN: mass * 9.80665,
      mass,
      hydrodynamicDragN,
      waterDepth,
      surface: inWater
        ? "water"
        : wheelStates.some((wheel) => wheel.onPlatform)
          ? "platform"
          : wheelStates.some((wheel) => wheel.onField)
            ? "field"
            : "air",
      fallen: position.y < this.terrainHeightAt(position.x, position.z) - 6,
      wheelStates,
      validity: {
        valid: Boolean(carrier && wheelStates.length),
        reason:
          carrier && wheelStates.length
            ? null
            : "incomplete physical mobility component",
      },
    };
  }

  applyFluidForces() {
    if (!this.compiled) return null;
    let displacedVolumeM3 = 0,
      submergedVolumeM3 = 0,
      buoyancyN = 0,
      hydrodynamicDragN = 0,
      wetBodies = 0,
      waterDepth = 0;
    const byPart = new Map();
    for (const descriptor of fluidDescriptorsByRuntime.get(this) || []) {
      const body = this.bodyByPart.get(descriptor.partId);
      if (!body) continue;
      const frame = partFrame(body),
        buoyancyCenter = frame.quaternion
          .vmult(descriptor.buoyancyCenterPart)
          .vadd(frame.position),
        pond = this.pondAt(buoyancyCenter.x, buoyancyCenter.z),
        volume = descriptor.volumeM3,
        halfHeight = descriptor.halfHeightM;
      displacedVolumeM3 += volume;
      byPart.set(descriptor.partId, {
        volumeM3: volume,
        submerged: 0,
        submergedVolumeM3: 0,
        buoyancyN: 0,
        dragN: 0,
        waterDepth: 0,
      });
      if (!pond) continue;
      const submerged = clamp(
        (pond.waterY - (buoyancyCenter.y - halfHeight)) / (halfHeight * 2),
        0,
        1,
      );
      if (submerged <= 0) continue;
      wetBodies++;
      const lift = this.waterDensity * 9.80665 * volume * submerged,
        speed = body.velocity.length(),
        area = Math.max(0.001, Math.pow(volume, 2 / 3) * 0.85),
        dragMagnitude = Math.min(
          0.5 * this.waterDensity * 1.05 * area * submerged * speed * speed,
          body.mass * 9.80665 * 2.2,
        );
      body.applyForce(
        new CANNON.Vec3(0, lift, 0),
        buoyancyCenter.vsub(body.position),
      );
      if (speed > 0.015)
        body.applyForce(
          body.velocity.scale(-dragMagnitude / speed),
          new CANNON.Vec3(),
        );
      submergedVolumeM3 += volume * submerged;
      buoyancyN += lift;
      hydrodynamicDragN += dragMagnitude;
      const localWaterDepth = Math.max(
        0,
        pond.waterY - this.terrainHeightAt(buoyancyCenter.x, buoyancyCenter.z),
      );
      waterDepth = Math.max(waterDepth, localWaterDepth);
      byPart.set(descriptor.partId, {
        volumeM3: volume,
        submerged,
        submergedVolumeM3: volume * submerged,
        buoyancyN: lift,
        dragN: dragMagnitude,
        waterDepth: localWaterDepth,
      });
    }
    this.fluidState = {
      active: true,
      inWater: wetBodies > 0,
      wetBodies,
      submergedFraction: clamp(
        submergedVolumeM3 / Math.max(1e-9, displacedVolumeM3),
        0,
        1,
      ),
      displacedVolumeM3,
      buoyancyN,
      hydrodynamicDragN,
      waterDepth,
      byPart: sortedIdentityEntries(byPart).map(([partId, record]) => ({
        partId,
        ...record,
      })),
    };
    return { ...this.fluidState };
  }

  applyExternalForce(force, worldPoint, partId = null) {
    if (!this.compiled) return false;
    let body = partId == null ? null : this.bodyByPart.get(partId);
    if (!body) {
      const point = new CANNON.Vec3(
        Number(worldPoint?.x || 0),
        Number(worldPoint?.y || 0),
        Number(worldPoint?.z || 0),
      );
      body = [...this.bodyByPart.values()].reduce(
        (nearest, candidate) =>
          !nearest ||
          candidate.position.distanceSquared(point) <
            nearest.position.distanceSquared(point)
            ? candidate
            : nearest,
        null,
      );
    }
    if (!body) return false;
    const point = new CANNON.Vec3(
        Number(worldPoint?.x ?? body.position.x),
        Number(worldPoint?.y ?? body.position.y),
        Number(worldPoint?.z ?? body.position.z),
      ),
      relative = point.vsub(body.position);
    body.applyForce(
      new CANNON.Vec3(
        Number(force?.x || 0),
        Number(force?.y || 0),
        Number(force?.z || 0),
      ),
      relative,
    );
    return true;
  }

  applyBodyTorque(partId, torque, { local = false } = {}) {
    const body = this.bodyByPart.get(partId);
    if (!body) return false;
    let applied = new CANNON.Vec3(
      Number(torque?.x || 0),
      Number(torque?.y || 0),
      Number(torque?.z || 0),
    );
    if (local) applied = partWorldAxis(body, applied);
    body.torque.vadd(applied, body.torque);
    return true;
  }

  constraintPoseForPart(partId) {
    const entry = this.constraintEntries.find(
      (candidate) =>
        candidate.active !== false &&
        candidate.descriptor.sourcePartId === partId &&
        candidate.constraint?.pivotA,
    );
    if (!entry) return null;
    const bodyA = this.bodyByPart.get(entry.descriptor.a),
      position = bodyA.pointToWorldFrame(entry.constraint.pivotA);
    return {
      position: plainVector(position),
      quaternion: plainQuaternion(partFrame(bodyA).quaternion),
      angle: entry.angle || 0,
      angularVelocity: entry.velocity || 0,
      reactionTorque: entry.reactionTorque || 0,
      constraintId: entry.descriptor.id,
    };
  }

  rotaryStateForPart(partId) {
    const candidates = this.constraintEntries.filter(
      (entry) =>
        entry.active !== false &&
        entry.descriptor.kind === "revolute" &&
        entry.descriptor.rotorId === partId,
    );
    if (candidates.length !== 1)
      return Object.freeze({
        valid: false,
        reason: candidates.length ? "ambiguous-shaft" : "missing-shaft",
        candidateCount: candidates.length,
      });
    const entry = candidates[0],
      rotorIsB = entry.descriptor.b === partId,
      body = this.bodyByPart.get(partId),
      localAxis = rotorIsB ? entry.axisB : entry.axisA,
      worldAxis = body.quaternion.vmult(localAxis);
    worldAxis.normalize();
    return Object.freeze({
      valid: true,
      reason: "resolved",
      constraintId: entry.descriptor.id,
      motorId: entry.descriptor.motorId ?? null,
      rotorPartId: partId,
      statorPartId: rotorIsB ? entry.descriptor.a : entry.descriptor.b,
      worldAxis: Object.freeze(plainVector(worldAxis)),
      relativeAngularSpeedRadS: rotorIsB
        ? entry.velocity || 0
        : -(entry.velocity || 0),
      absoluteAngularSpeedRadS: body.angularVelocity.dot(worldAxis),
      reactionTorqueNm: entry.reactionTorque || 0,
    });
  }

  bodyPose(partId) {
    const body = this.bodyByPart.get(partId);
    if (!body) return null;
    const frame = partFrame(body);
    return {
      position: frame.position,
      quaternion: frame.quaternion,
      velocity: frame.velocity,
      angularVelocity: body.angularVelocity,
    };
  }

  primaryBodyPose() {
    const body = [...this.bodyByPart.values()].sort(
      (left, right) => right.mass - left.mass,
    )[0];
    if (!body) return null;
    const pose = this.bodyPose(body.userData.partId);
    return {
      position: plainVector(pose.position),
      quaternion: plainQuaternion(pose.quaternion),
      velocity: plainVector(pose.velocity),
      angularVelocity: plainVector(pose.angularVelocity),
    };
  }

  stepTwoFrameMechanisms(context, dt) {
    let activeActuators = 0;
    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      const { descriptor } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b);
      if (!bodyA || !bodyB) continue;
      if (entry.kind === "axial-force-v1") {
        const state = axialState(
            bodyA,
            bodyB,
            entry.localAnchorA,
            entry.localAnchorB,
          ),
          mechanism = descriptor.mechanism,
          response =
            descriptor.kind === "spring"
              ? springResponse(mechanism, state.coordinateM, state.rateMPerS)
              : damperResponse(mechanism, state.rateMPerS),
          lowerStop = stopResponse(
            mechanism.lowerStop,
            "lower",
            state.coordinateM,
            state.rateMPerS,
          ),
          upperStop = stopResponse(
            mechanism.upperStop,
            "upper",
            state.coordinateM,
            state.rateMPerS,
          ),
          signedTensionN =
            response.forceN +
            (lowerStop?.forceN || 0) +
            (upperStop?.forceN || 0),
          dampingPowerW =
            response.dampingPowerW +
            (lowerStop?.dampingPowerW || 0) +
            (upperStop?.dampingPowerW || 0);
        applyAxialForce(bodyA, bodyB, state, signedTensionN);
        entry.force = Math.abs(signedTensionN);
        entry.coordinateM = state.coordinateM;
        entry.rateMPerS = state.rateMPerS;
        entry.elasticPotentialJ =
          response.elasticPotentialJ +
          (lowerStop?.elasticPotentialJ || 0) +
          (upperStop?.elasticPotentialJ || 0);
        entry.dampingPowerW = Math.min(0, dampingPowerW);
        entry.dampingWorkJ += entry.dampingPowerW * dt;
        for (const id of descriptor.sourceConnectionIds)
          this.loadByConnection.set(id, entry.force);
        continue;
      }
      if (
        entry.kind !== "prismatic-coordinate-v1" &&
        entry.kind !== "axial-actuator-v1"
      )
        continue;

      const axialActuator = entry.kind === "axial-actuator-v1",
        axis = axialActuator ? null : entry.constraint.axisWorld(),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
          axis,
          axialActuator ? 0 : descriptor.coordinateOffsetM,
        ),
        mechanism = descriptor.mechanism;
      entry.coordinateM = state.coordinateM;
      entry.rateMPerS = state.rateMPerS;
      entry.transverseM = state.transverseM;
      if (entry.constraint.holdEquation)
        entry.constraint.holdEquation.enabled = false;
      if (entry.constraint.holdEquation)
        refreshConstraintEquationAuthority(this, entry);
      let signedTensionN = 0,
        coordinateForceN = 0,
        frictionPowerW = 0,
        electricalPowerW = 0,
        powered = false,
        saturated = false;

      if (descriptor.kind === "linear-guide") {
        signedTensionN = 0;
      } else {
        const actuator = this.part(descriptor.sourcePartId),
          allocation = context.powerNetwork?.allocationFor(actuator.id),
          law = mechanism.commandLaw;
        const thermal = mechanism.thermalLimits,
          thermalAvailability = thermal
            ? mechanismClamp(
                (thermal.shutdownTemperatureK - entry.temperatureK) /
                  Math.max(
                    Number.EPSILON,
                    thermal.shutdownTemperatureK - thermal.derateTemperatureK,
                  ),
                0,
                1,
              )
            : 1;
        entry.thermalDerate = thermalAvailability;
        entry.thermalShutdown = thermalAvailability <= 0;
        if (allocation?.operational && thermalAvailability > 0) {
          entry.clutchEngaged = false;
          entry.clutchCoordinateM = null;
          const normalizedPosition = mechanismClamp(
              (state.coordinateM - mechanism.lengthRangeM.lower) /
                (mechanism.lengthRangeM.upper - mechanism.lengthRangeM.lower),
              0,
              1,
            ),
            command = context.commandBus
              ? law.kind === "position-impedance-v1"
                ? readActuatorCommand(
                    context.commandBus,
                    actuator,
                    "linear_target",
                    normalizedPosition,
                  ).value
                : law.kind === "velocity-servo-v1"
                  ? readActuatorCommand(
                      context.commandBus,
                      actuator,
                      "linear_velocity",
                      0,
                    ).value
                  : readActuatorCommand(
                      context.commandBus,
                      actuator,
                      "linear_force",
                      0,
                    ).value
              : law.kind === "position-impedance-v1"
                ? normalizedPosition
                : 0,
            unconstrainedCapacity = forceSpeedCapacity(
              mechanism.forceSpeedEnvelope,
              state.rateMPerS,
            ),
            capacity = {
              extendN: unconstrainedCapacity.extendN * thermalAvailability,
              retractN: unconstrainedCapacity.retractN * thermalAvailability,
            };
          if (law.kind === "position-impedance-v1") {
            const targetM =
              mechanism.lengthRangeM.lower +
              mechanismClamp(command, 0, 1) *
                (mechanism.lengthRangeM.upper - mechanism.lengthRangeM.lower);
            coordinateForceN =
              law.stiffnessNPerM * (targetM - state.coordinateM) -
              law.dampingNsPerM * state.rateMPerS;
          } else if (law.kind === "velocity-servo-v1") {
            const maximumSpeedMPerS =
              mechanism.forceSpeedEnvelope.points.at(-1).absSpeedMPerS;
            coordinateForceN =
              law.velocityGainNsPerM *
              (mechanismClamp(command, -1, 1) * maximumSpeedMPerS -
                state.rateMPerS);
          } else
            coordinateForceN =
              mechanismClamp(command, -1, 1) *
              (command >= 0 ? capacity.extendN : capacity.retractN);
          const unclampedForceN = coordinateForceN;
          coordinateForceN = mechanismClamp(
            coordinateForceN,
            -capacity.retractN,
            capacity.extendN,
          );
          saturated =
            thermalAvailability < 1 ||
            Math.abs(coordinateForceN - unclampedForceN) > 1e-9;
          const mechanicalPowerW = coordinateForceN * state.rateMPerS,
            requestedElectricalW =
              mechanism.powerLaw.idlePowerW +
              Math.max(0, mechanicalPowerW) /
                mechanism.powerLaw.electricalMotoringEfficiency,
            deliveredElectricalW = context.powerNetwork.drawPower(
              actuator.id,
              requestedElectricalW,
              dt,
            ),
            deliveryRatio = requestedElectricalW
              ? Math.min(1, deliveredElectricalW / requestedElectricalW)
              : 1;
          coordinateForceN *= deliveryRatio;
          electricalPowerW = deliveredElectricalW;
          powered = deliveryRatio > 0;
          signedTensionN = -coordinateForceN;
          const deliveredMechanicalPowerW = coordinateForceN * state.rateMPerS;
          entry.actuatorMechanicalWorkJ += deliveredMechanicalPowerW * dt;
          entry.actuatorElectricalEnergyJ += deliveredElectricalW * dt;
          entry.actuatorDissipatedEnergyJ +=
            Math.max(0, deliveredElectricalW - deliveredMechanicalPowerW) * dt;
          activeActuators += powered ? 1 : 0;
        } else {
          const unpowered = mechanism.unpoweredLaw;
          if (unpowered.kind === "viscous-drag-v1")
            signedTensionN = unpowered.dampingNsPerM * state.rateMPerS;
          else if (unpowered.kind === "holding-clutch-v1") {
            entry.clutchEngaged =
              entry.clutchEngaged ||
              Math.abs(state.rateMPerS) <= unpowered.reengageSpeedMPerS;
            if (entry.clutchEngaged && entry.clutchCoordinateM == null)
              entry.clutchCoordinateM = state.coordinateM;
            const capacityN = entry.clutchEngaged
              ? unpowered.staticForceCapacityN
              : unpowered.dynamicForceCapacityN;
            const capacityImpulseNs = solverImpulseLimit(capacityN, dt);
            entry.constraint.holdEquation.minForce = -capacityImpulseNs;
            entry.constraint.holdEquation.maxForce = capacityImpulseNs;
            entry.constraint.holdEquation.enabled = true;
            refreshConstraintEquationAuthority(this, entry);
          }
          frictionPowerW = -signedTensionN * state.rateMPerS;
        }
      }
      if (signedTensionN) applyAxialForce(bodyA, bodyB, state, signedTensionN);
      entry.appliedForceN = coordinateForceN || -signedTensionN;
      entry.powered = powered;
      entry.saturated = saturated;
      entry.frictionWorkJ += Math.min(0, frictionPowerW) * dt;
      const thermal = mechanism.thermalLimits;
      if (thermal) {
        const heatInputW = Math.max(
            0,
            electricalPowerW - coordinateForceN * state.rateMPerS,
          ),
          coolingW =
            thermal.ambientConductanceWPerK * (entry.temperatureK - 293.15);
        entry.temperatureK +=
          ((heatInputW - coolingW) * dt) / thermal.thermalMassJPerK;
      }
      const transmittedForceN = Math.max(
        Math.abs(entry.appliedForceN),
        entry.reactionForceN,
      );
      for (const id of descriptor.sourceConnectionIds)
        this.loadByConnection.set(id, transmittedForceN);
    }
    return activeActuators;
  }

  stepActuators(context, dt) {
    if (!this.compiled) return null;
    // Static collision geometry has no runtime mutation port and is fully
    // attested at installation, owner transactions, and checkpoint capture.
    // The fixed-step guard still covers all mutable mass/frame, solver-row,
    // policy, identity, ordering, membership, and activity authority.
    validateLiveMultibodyEngineAuthority(this, {
      validateStaticGeometry: false,
    });
    this.loadByConnection.clear();
    this.torqueByConnection.clear();
    this.motorElectricalWByPart.clear();
    const commandFor = (part, channel, fallback = 0) =>
      readActuatorCommand(context.commandBus, part, channel, fallback).value;
    let activeMotors = this.stepTwoFrameMechanisms(context, dt);
    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      if (entry.descriptor.kind !== "revolute") continue;
      const { descriptor, constraint } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b);
      updateRevoluteMeasurement(entry, bodyA, bodyB);
      const passiveTorque = clamp(
        -entry.velocity * (descriptor.damping || 0),
        -(descriptor.maxTorque || 120),
        descriptor.maxTorque || 120,
      );
      let targetTorque = passiveTorque;
      if (passiveTorque) {
        const axis = bodyB.quaternion.vmult(entry.axisB);
        bodyB.torque.vadd(axis.scale(passiveTorque), bodyB.torque);
        bodyA.torque.vsub(axis.scale(passiveTorque), bodyA.torque);
      }
      if (descriptor.motorId) {
        const motor = this.part(descriptor.motorId),
          allocation = context.powerNetwork?.allocationFor(motor.id);
        if (allocation?.operational) {
          const brake = commandFor(motor, "brake", 0),
            throttle = brake
              ? 0
              : clamp(commandFor(motor, "throttle", 0), -1, 1);
          if (!brake && Math.abs(throttle) <= 1e-6) {
            constraint.disableMotor();
            refreshConstraintEquationAuthority(this, entry);
            this.motorElectricalWByPart.set(motor.id, 0);
          } else {
            const targetSpeed =
                descriptor.driveLaw.noLoadSpeedRadPerS *
                descriptor.driveLaw.direction *
                throttle,
              powerW = Math.max(1, descriptor.driveLaw.maximumElectricalPowerW),
              allocationRatio = Math.min(
                1,
                allocation.allocatedW / Math.max(1, powerW),
              ),
              stallTorque = Math.max(
                1,
                (powerW /
                  Math.max(
                    1,
                    Math.abs(descriptor.driveLaw.noLoadSpeedRadPerS),
                  )) *
                  2.2,
              ),
              speedError = targetSpeed - entry.velocity;
            targetTorque = clamp(
              speedError * stallTorque * 0.32 * allocationRatio,
              -stallTorque * allocationRatio,
              stallTorque * allocationRatio,
            );
            this.motorElectricalWByPart.set(motor.id, 0);
            constraint.enableMotor();
            constraint.setMotorSpeed(targetSpeed);
            const torqueImpulseNms = solverImpulseLimit(targetTorque, dt);
            constraint.motorEquation.maxForce = torqueImpulseNms;
            constraint.motorEquation.minForce = -torqueImpulseNms;
            refreshConstraintEquationAuthority(this, entry);
            this.worldAdapter.transaction.registerMotorEnergyBudget({
              tick: context.clock.tick,
              equation: constraint.motorEquation,
              partId: motor.id,
              constraintId: descriptor.id,
              mode: brake
                ? "brake"
                : throttle < 0
                  ? "reverse-motoring"
                  : "motoring",
              allocatedBusW: brake ? 0 : allocation.allocatedW,
              mechanicalBudgetJ:
                (brake ? 0 : allocation.allocatedW) *
                dt *
                descriptor.driveLaw.electricalEfficiency,
              electricalEfficiency: descriptor.driveLaw.electricalEfficiency,
              torqueImpulseLimitNms: torqueImpulseNms,
            });
            activeMotors++;
          }
        } else {
          constraint.disableMotor();
          refreshConstraintEquationAuthority(this, entry);
        }
      } else if (descriptor.controlled && descriptor.sourcePartId) {
        const actuator = this.part(descriptor.sourcePartId),
          allocation = context.powerNetwork?.allocationFor(actuator.id),
          actuation = descriptor.mechanism.actuation,
          thermal = actuation.thermalLimits;
        coolRotaryActuator(entry, thermal, dt);
        const thermalAvailability = rotaryThermalAvailability(entry, thermal);
        entry.powered = false;
        entry.saturated = thermalAvailability < 1;
        if (allocation?.operational && thermalAvailability > 0) {
          const control = clamp(commandFor(actuator, "joint_target", 0), -1, 1),
            commandRange = actuation.commandRangeRad,
            target =
              commandRange.lower +
              ((control + 1) / 2) * (commandRange.upper - commandRange.lower),
            error = target - entry.angle,
            equilibriumSpeed = actuation.dampingNmsPerRad
              ? (actuation.stiffnessNmPerRad * error) /
                actuation.dampingNmsPerRad
              : Math.sign(error) * actuation.maximumSpeedRadPerS,
            targetSpeed = clamp(
              equilibriumSpeed,
              -actuation.maximumSpeedRadPerS,
              actuation.maximumSpeedRadPerS,
            ),
            unconstrainedServoTorque = actuation.dampingNmsPerRad
              ? actuation.dampingNmsPerRad * (targetSpeed - entry.velocity)
              : actuation.stiffnessNmPerRad * error,
            powerLaw = actuation.powerLaw,
            electricalEfficiency = powerLaw.electricalMotoringEfficiency,
            availableBusW = Math.max(
              0,
              allocation.allocatedW - allocation.deliveredW,
            ),
            deliveredIdleW = context.powerNetwork.drawPower(
              actuator.id,
              Math.min(availableBusW, powerLaw.idlePowerW),
              dt,
            ),
            mechanicalBusW = Math.max(0, availableBusW - deliveredIdleW),
            torqueLimit = actuation.maximumTorqueNm * thermalAvailability,
            poweredTorque = clamp(
              unconstrainedServoTorque,
              -torqueLimit,
              torqueLimit,
            );
          entry.powered = true;
          entry.saturated =
            entry.saturated ||
            targetSpeed !== equilibriumSpeed ||
            poweredTorque !== unconstrainedServoTorque;
          entry.actuatorElectricalEnergyJ += deliveredIdleW * dt;
          entry.actuatorDissipatedEnergyJ += deliveredIdleW * dt;
          addRotaryActuatorHeat(entry, thermal, deliveredIdleW * dt);
          this.motorElectricalWByPart.set(actuator.id, deliveredIdleW);
          constraint.enableMotor();
          // Cannon's hinge motor speed is expressed in A-relative-to-B
          // convention, while our measured joint angle is B-relative-to-A.
          // Negate once at this engine boundary so authored/controller target
          // signs stay consistent with telemetry and joint limits.
          constraint.setMotorSpeed(-targetSpeed);
          const torqueImpulseNms = solverImpulseLimit(
            Math.abs(poweredTorque),
            dt,
          );
          constraint.motorEquation.maxForce = torqueImpulseNms;
          constraint.motorEquation.minForce = -torqueImpulseNms;
          refreshConstraintEquationAuthority(this, entry);
          this.worldAdapter.transaction.registerMotorEnergyBudget({
            tick: context.clock.tick,
            equation: constraint.motorEquation,
            partId: actuator.id,
            constraintId: descriptor.id,
            mode: "position-impedance",
            allocatedBusW: mechanicalBusW,
            mechanicalBudgetJ:
              Math.min(
                powerLaw.maximumMechanicalMotoringPowerW,
                mechanicalBusW * electricalEfficiency,
              ) * dt,
            electricalEfficiency,
            torqueImpulseLimitNms: torqueImpulseNms,
          });
          targetTorque += poweredTorque;
          activeMotors++;
        } else {
          constraint.disableMotor();
          refreshConstraintEquationAuthority(this, entry);
        }
      }
      if (descriptor.limits) {
        const [low, high] = descriptor.limits,
          penetration =
            entry.angle < low
              ? low - entry.angle
              : entry.angle > high
                ? high - entry.angle
                : 0;
        if (penetration) {
          const limitTorque = clamp(
            penetration * descriptor.maxTorque * 20 -
              entry.velocity * descriptor.damping,
            -descriptor.maxTorque,
            descriptor.maxTorque,
          );
          const axis = bodyB.quaternion.vmult(entry.axisB);
          bodyB.torque.vadd(axis.scale(limitTorque), bodyB.torque);
          bodyA.torque.vsub(axis.scale(limitTorque), bodyA.torque);
          targetTorque += limitTorque;
        }
      }
      entry.reactionTorque = Math.abs(targetTorque);
      for (const id of descriptor.sourceConnectionIds || [])
        this.torqueByConnection.set(
          id,
          Math.max(entry.reactionTorque, this.torqueByConnection.get(id) || 0),
        );
    }

    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      if (entry.kind !== "gear") continue;
      const { descriptor } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b),
        localAxisA = cannonVector(descriptor.axisA),
        localAxisB = cannonVector(descriptor.axisB),
        velocityA = signedAngleVelocity(bodyA, localAxisA),
        velocityB = signedAngleVelocity(bodyB, localAxisB);
      entry.phaseA += velocityA * dt;
      entry.phaseB += velocityB * dt;
      const error = entry.phaseB + descriptor.ratio * entry.phaseA,
        relativeVelocity = velocityB + descriptor.ratio * velocityA,
        toothTorque = clamp(
          -descriptor.stiffness * error - descriptor.damping * relativeVelocity,
          -descriptor.breakTorque,
          descriptor.breakTorque,
        ),
        axisA = partWorldAxis(bodyA, localAxisA),
        axisB = partWorldAxis(bodyB, localAxisB),
        torqueA = axisA.scale(toothTorque * descriptor.ratio),
        torqueB = axisB.scale(toothTorque);
      bodyA.torque.vadd(torqueA, bodyA.torque);
      bodyB.torque.vadd(torqueB, bodyB.torque);
      entry.reactionTorque = Math.abs(toothTorque);
      for (const id of descriptor.sourceConnectionIds)
        this.torqueByConnection.set(id, Math.abs(toothTorque));
      for (const id of descriptor.sourceConnectionIds)
        this.loadByConnection.set(
          id,
          Math.abs(toothTorque) /
            Math.max(
              0.01,
              Math.min(descriptor.pitchRadiusA, descriptor.pitchRadiusB),
            ),
        );
    }

    // The production pipeline publishes mechanisms again after the owned
    // integration step. No intervening system consumes this projection, so
    // avoid building the same pose/joint DTO twice in one fixed tick.
    if (context.services.deferMechanismTelemetryUntilIntegration) {
      this.lastTelemetry = { ...this.lastTelemetry, activeMotors };
      return this.lastTelemetry;
    }
    this.lastTelemetry = this.telemetry(activeMotors);
    return this.lastTelemetry;
  }

  afterIntegration(dt) {
    if (!this.compiled) return null;
    const captureEvidence = evidenceCapturingRuntimes.delete(this),
      tick = this.worldAdapter?.telemetry().integratedTick ?? null,
      contributionCandidates = [];
    for (const entry of this.constraintEntries)
      if (entry.active !== false && entry.kind === "rolling-contact-v1")
        entry.constraint.commitSolvedState();
    for (const entry of this.constraintEntries)
      if (
        entry.active !== false &&
        ["prismatic-coordinate-v1", "axial-actuator-v1"].includes(entry.kind)
      ) {
        if (entry.kind === "prismatic-coordinate-v1")
          entry.constraint.project();
        if (entry.clutchEngaged) {
          const equation = entry.constraint.holdEquation,
            saturated =
              Math.abs(equation.multiplier || 0) * dt >=
              Math.abs(equation.maxForce) * (1 - 1e-6);
          if (saturated) {
            entry.clutchEngaged = false;
            entry.clutchCoordinateM = null;
          } else entry.constraint.projectCoordinate(entry.clutchCoordinateM);
        }
      }
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        entry.descriptor.kind !== "revolute" ||
        !entry.referenceA
      )
        continue;
      updateRevoluteMeasurement(
        entry,
        this.bodyByPart.get(entry.descriptor.a),
        this.bodyByPart.get(entry.descriptor.b),
      );
    }
    // The exact checkpoint representation is also the fixed-step live
    // representation. A restore therefore cannot perturb the uninterrupted
    // trajectory merely because Cannon produced another near-unit encoding.
    for (const body of this.bodyByPart.values()) {
      canonicalizeLiveQuaternion(body.quaternion);
      canonicalizeLiveQuaternion(body.previousQuaternion);
      canonicalizeLiveQuaternion(body.interpolatedQuaternion);
      body.updateInertiaWorld(true);
    }
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        !["prismatic-coordinate-v1", "axial-actuator-v1"].includes(entry.kind)
      )
        continue;
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        bodyB = this.bodyByPart.get(entry.descriptor.b),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
          entry.kind === "axial-actuator-v1"
            ? null
            : entry.constraint.axisWorld(),
          entry.kind === "axial-actuator-v1"
            ? 0
            : entry.descriptor.coordinateOffsetM,
        );
      entry.coordinateM = state.coordinateM;
      entry.rateMPerS = state.rateMPerS;
      entry.transverseM = state.transverseM;
      entry.reactionForceN =
        entry.kind === "axial-actuator-v1"
          ? constraintReactionWrench(entry.constraint).forceN
          : Math.hypot(
              ...entry.constraint.transverseEquations.map(
                (equation) => equation.multiplier || 0,
              ),
            );
      if (
        entry.kind === "prismatic-coordinate-v1" &&
        entry.constraint.guideFrictionEquation
      ) {
        entry.appliedForceN = Number(
          entry.constraint.guideFrictionEquation.multiplier || 0,
        );
        entry.frictionWorkJ -=
          Math.abs(entry.appliedForceN * entry.rateMPerS) * dt;
      }
    }
    for (const entry of this.constraintEntries) {
      if (entry.active === false || !entry.constraint) continue;
      const metadata = {
        ...entry.constraint.simulacrumEvidence,
        tick,
      };
      if (
        entry.descriptor.kind === "fixed" &&
        entry.descriptor.failureAttachments?.length
      ) {
        for (const attachment of entry.descriptor.failureAttachments) {
          const body = this.bodyByPart.get(attachment.bodyPartId),
            attachmentFrame =
              entry.descriptor[`attachmentFrame${attachment.side}`],
            applicationPoint = solvedPartPoint(
              body,
              attachmentFrame.positionPartM,
            ),
            attachmentMetadata = {
              ...metadata,
              sourceConnectionIds: [
                identityToken(attachment.connectionId, {
                  typedStrings: this.connectionIdsUseTypedStrings,
                }),
              ],
              applicationPointWorldM: {
                x: applicationPoint.x,
                y: applicationPoint.y,
                z: applicationPoint.z,
              },
            },
            evidence = captureEvidence
              ? constraintReactionWrenchEvidence(
                  entry.constraint,
                  attachment.side,
                  attachmentMetadata,
                )
              : null,
            reaction =
              evidence?.wrench ||
              translatedConstraintWrench(
                entry.constraint,
                attachment.side,
                applicationPoint,
              );
          if (evidence) contributionCandidates.push(...evidence.candidates);
          this.loadByConnection.set(
            attachment.connectionId,
            Math.max(
              reaction.forceN,
              this.loadByConnection.get(attachment.connectionId) || 0,
            ),
          );
          this.torqueByConnection.set(
            attachment.connectionId,
            Math.max(
              reaction.torqueNm,
              this.torqueByConnection.get(attachment.connectionId) || 0,
            ),
          );
        }
        continue;
      }
      const evidence = captureEvidence
          ? constraintReactionWrenchEvidence(entry.constraint, "A", metadata)
          : null,
        reaction =
          evidence?.wrench || constraintReactionWrench(entry.constraint);
      if (evidence) contributionCandidates.push(...evidence.candidates);
      if (entry.descriptor.kind === "revolute")
        entry.reactionTorque = reaction.torqueNm;
      for (const id of entry.descriptor.sourceConnectionIds || []) {
        this.loadByConnection.set(
          id,
          Math.max(reaction.forceN, this.loadByConnection.get(id) || 0),
        );
        this.torqueByConnection.set(
          id,
          Math.max(reaction.torqueNm, this.torqueByConnection.get(id) || 0),
        );
      }
    }
    failureEvidenceByRuntime.set(
      this,
      captureEvidence
        ? {
            worldAdapter: this.worldAdapter,
            candidates: contributionCandidates,
            constraints: [],
          }
        : Object.freeze([]),
    );
    for (const [partId, body] of this.bodyByPart) {
      const descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === partId,
        ),
        axis = cannonVector(primaryGeometryAxisPart(descriptor.geometry));
      this.phaseByPart.set(
        partId,
        (this.phaseByPart.get(partId) || 0) +
          signedAngleVelocity(body, axis) * dt,
      );
    }
    this.lastTelemetry = this.telemetry(this.lastTelemetry?.activeMotors || 0);
    return this.lastTelemetry;
  }

  recordSettledMotorElectricalPower(partId, deliveredW) {
    return recordMultibodyMotorSettlement(this, partId, deliveredW);
  }

  applyConnectionFailures(connections) {
    validateLiveMultibodyEngineAuthority(this);
    const failed = new Set(
        connections
          .filter((connection) => connection.failed)
          .map((connection) => connection.id),
      ),
      detached = [];
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        !(entry.descriptor.sourceConnectionIds || []).some((id) =>
          failed.has(id),
        )
      )
        continue;
      entry.active = false;
      if (entry.constraint) this.world.removeConstraint(entry.constraint);
      detached.push(entry.descriptor.id);
    }
    for (const entry of this.collisionExclusionConstraints) {
      if (
        entry.active === false ||
        collisionExclusionRequired(this.constraintEntries, entry.descriptor)
      )
        continue;
      entry.active = false;
      unregisterCannonCollisionExclusion(
        this.worldAdapter.transaction,
        entry.exclusion,
      );
    }
    if (detached.length) this.topologyRevision++;
    refreshEngineActivityAuthority(this);
    return detached;
  }

  telemetry(activeMotors = 0) {
    if (!this.compiled) return null;
    const contactsByBody = new Map();
    for (const contact of this.world.contacts || []) {
      const forceN = Math.abs(contact.multiplier || 0);
      for (const body of contact.bi === contact.bj
        ? [contact.bi]
        : [contact.bi, contact.bj]) {
        const summary = contactsByBody.get(body) || { count: 0, forceN: 0 };
        summary.count++;
        summary.forceN += forceN;
        contactsByBody.set(body, summary);
      }
    }
    const poses = [],
      poseByPart = new Map(),
      descriptors = telemetryBodyDescriptorsByRuntime.get(this);
    for (const [partId, body] of this.bodyByPart) {
      const indexed = descriptors.get(partId),
        frame = partFrame(body),
        speed = signedAngleVelocity(body, indexed.primaryAxisPart),
        phase = this.phaseByPart.get(partId) || 0,
        contact = contactsByBody.get(body);
      poses.push({
        id: partId,
        position: plainVector(frame.position),
        quaternion: plainQuaternion(frame.quaternion),
        velocity: plainVector(frame.velocity),
        angularVelocity: plainVector(body.angularVelocity),
        contact: Boolean(contact?.count),
        contactForceN: contact?.forceN || 0,
        phase,
        angularSpeed: speed,
      });
      poseByPart.set(partId, poses.at(-1));
    }
    for (const entry of this.constraintEntries) {
      const motorId = entry.descriptor.motorId;
      if (!motorId) continue;
      const pose = poseByPart.get(motorId);
      if (pose) pose.phase = entry.angle;
    }
    const joints = this.constraintEntries
      .filter((entry) => entry.descriptor.kind === "revolute")
      .map((entry) => ({
        id: entry.descriptor.id,
        sourcePartId: entry.descriptor.sourcePartId || null,
        angle: entry.angle,
        angularVelocity: entry.velocity,
        reactionTorque: entry.reactionTorque,
        ...(entry.descriptor.controlled
          ? {
              mechanicalWorkJ: entry.actuatorMechanicalWorkJ,
              electricalEnergyJ: entry.actuatorElectricalEnergyJ,
              dissipatedEnergyJ: entry.actuatorDissipatedEnergyJ,
              temperatureK: entry.temperatureK,
              powered: entry.powered,
              saturated: entry.saturated,
              thermalDerate: entry.thermalDerate,
              thermalShutdown: entry.thermalShutdown,
            }
          : {}),
      }));
    for (const entry of this.constraintEntries.filter(
      (candidate) =>
        candidate.active !== false &&
        candidate.descriptor.kind === "revolute" &&
        candidate.descriptor.sourcePartId != null &&
        !this.bodyByPart.has(candidate.descriptor.sourcePartId),
    )) {
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        position = bodyA.pointToWorldFrame(entry.constraint.pivotA);
      poses.push({
        id: entry.descriptor.sourcePartId,
        position: plainVector(position),
        quaternion: plainQuaternion(bodyA.quaternion),
        jointAngle: entry.angle,
        reactionTorque: entry.reactionTorque,
      });
    }
    for (const entry of this.constraintEntries.filter(
      (candidate) =>
        candidate.active !== false &&
        [
          "axial-force-v1",
          "axial-actuator-v1",
          "prismatic-coordinate-v1",
        ].includes(candidate.kind),
    )) {
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        bodyB = this.bodyByPart.get(entry.descriptor.b),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
          entry.kind === "prismatic-coordinate-v1"
            ? entry.constraint.axisWorld()
            : null,
          entry.kind === "prismatic-coordinate-v1"
            ? entry.descriptor.coordinateOffsetM
            : 0,
        ),
        geometry = this.geometryByPart.get(entry.descriptor.sourcePartId),
        coordinate = geometry.deformationContract.coordinates[0],
        orientation = quaternionFromPositiveZ(state.axis),
        position = state.pointA.vadd(state.pointB).scale(0.5),
        coordinateSample = {
          coordinateId: coordinate.id,
          coordinateM: state.coordinateM,
        };
      poses.push({
        id: entry.descriptor.sourcePartId,
        position: plainVector(position),
        quaternion: plainQuaternion(orientation),
        deformationOutOfRange:
          state.coordinateM < coordinate.allowedCoordinateRangeM.minimum ||
          state.coordinateM > coordinate.allowedCoordinateRangeM.maximum,
        deformedBodyBoundsWorldM: projectBoundsToWorld(
          deformedBodyBoundsPartM(geometry, [coordinateSample]),
          [position.x, position.y, position.z],
          [orientation.x, orientation.y, orientation.z, orientation.w],
        ),
      });
    }
    const integratedTick =
        this.worldAdapter?.telemetry().integratedTick ?? null,
      twoFrameMechanisms =
        /** @type {Array<{id:string|number,sourcePartId:string|number,coordinateId:string,kind:string,active:boolean,tick:number|null,unit:"m",allowedCoordinateRangeM:{minimum:number,maximum:number},validity:"measured"|"invalid",rangeStatus:"within-range"|"below-range"|"above-range"|"invalid",coordinateM:number,rateMPerS:number,forceN:number,reactionForceN:number,transverseM:number,elasticPotentialJ:number,dampingWorkJ:number,frictionWorkJ:number,mechanicalWorkJ:number,electricalEnergyJ:number,dissipatedEnergyJ:number,temperatureK:number|null,powered:boolean,saturated:boolean,thermalDerate:number,thermalShutdown:boolean}>} */ (
          this.constraintEntries
            .filter((entry) =>
              [
                "axial-force-v1",
                "axial-actuator-v1",
                "prismatic-coordinate-v1",
              ].includes(entry.kind),
            )
            .map((entry) => {
              const geometry = this.geometryByPart.get(
                  entry.descriptor.sourcePartId,
                ),
                coordinate = geometry?.deformationContract?.coordinates?.[0],
                coordinateM = Number(entry.coordinateM),
                allowedCoordinateRangeM = coordinate?.allowedCoordinateRangeM,
                validity = Number.isFinite(coordinateM)
                  ? "measured"
                  : "invalid",
                rangeStatus =
                  validity === "invalid"
                    ? "invalid"
                    : coordinateM < allowedCoordinateRangeM.minimum
                      ? "below-range"
                      : coordinateM > allowedCoordinateRangeM.maximum
                        ? "above-range"
                        : "within-range";
              return {
                id: entry.descriptor.id,
                sourcePartId: entry.descriptor.sourcePartId,
                coordinateId: coordinate.id,
                kind: entry.descriptor.kind,
                active: entry.active !== false,
                tick: integratedTick,
                unit: "m",
                allowedCoordinateRangeM: { ...allowedCoordinateRangeM },
                validity,
                rangeStatus,
                coordinateM,
                rateMPerS: entry.rateMPerS,
                forceN:
                  entry.kind === "axial-force-v1"
                    ? entry.force
                    : entry.appliedForceN,
                reactionForceN: entry.reactionForceN || 0,
                transverseM: entry.transverseM || 0,
                elasticPotentialJ: entry.elasticPotentialJ || 0,
                dampingWorkJ: entry.dampingWorkJ || 0,
                frictionWorkJ: entry.frictionWorkJ || 0,
                mechanicalWorkJ: entry.actuatorMechanicalWorkJ || 0,
                electricalEnergyJ: entry.actuatorElectricalEnergyJ || 0,
                dissipatedEnergyJ: entry.actuatorDissipatedEnergyJ || 0,
                temperatureK: entry.temperatureK || null,
                powered: Boolean(entry.powered),
                saturated: Boolean(entry.saturated),
                thermalDerate: entry.thermalDerate ?? 1,
                thermalShutdown: Boolean(entry.thermalShutdown),
              };
            })
        );
    return {
      active: true,
      activeMotors,
      compiled: this.compiled.stats,
      diagnostics: this.compiled.diagnostics,
      poses,
      joints,
      twoFrameMechanisms,
      connectionLoads: connectionTelemetryProjection(
        this.loadByConnection,
        this.connectionIdsUseTypedStrings,
      ),
      connectionTorques: connectionTelemetryProjection(
        this.torqueByConnection,
        this.connectionIdsUseTypedStrings,
      ),
    };
  }

  exportState() {
    if (!this.compiled)
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_NOT_RUNNING",
        "Cannot checkpoint a multibody runtime before it starts",
      );
    validateLiveMultibodyEngineAuthority(this);
    const bodyState = (partId, body) => ({
        partId,
        position: plainVector(body.position),
        previousPosition: plainVector(body.previousPosition),
        interpolatedPosition: plainVector(body.interpolatedPosition),
        quaternion: checkpointQuaternion(body.quaternion),
        previousQuaternion: checkpointQuaternion(body.previousQuaternion),
        interpolatedQuaternion: checkpointQuaternion(
          body.interpolatedQuaternion,
        ),
        velocity: plainVector(body.velocity),
        angularVelocity: plainVector(body.angularVelocity),
        force: plainVector(body.force),
        torque: plainVector(body.torque),
        mass: body.mass,
        invMass: body.invMass,
        inertia: plainVector(body.inertia),
        invInertia: plainVector(body.invInertia),
        massFrame: {
          principalToPart: checkpointQuaternion(
            body.userData.massFrame.principalToPart,
          ),
          comPart: plainVector(body.userData.massFrame.comPart),
        },
        massProperties: structuredClone(body.userData.massProperties),
        shapeOffsets: body.shapeOffsets.map(plainVector),
        shapeOrientations: body.shapeOrientations.map(checkpointQuaternion),
        sleepState: body.sleepState,
        timeLastSleepy: body.timeLastSleepy,
      }),
      constraintValueFields = constraintValueFieldsByRuntime.get(this),
      entries = this.constraintEntries
        .map((entry) => ({
          id: entry.descriptor.id,
          kind: entry.kind || null,
          values: {
            active: entry.active !== false,
            ...Object.fromEntries(
              constraintValueFields
                .get(entry.descriptor.id)
                .filter((key) => key !== "active" && Object.hasOwn(entry, key))
                .map((key) => [key, entry[key]]),
            ),
          },
          tireState:
            entry.kind === "rolling-contact-v1"
              ? structuredClone(entry.constraint.state)
              : null,
          fixedFrame:
            entry.descriptor.kind === "fixed" && entry.constraint
              ? {
                  pivotA: plainVector(entry.constraint.pivotA),
                  pivotB: plainVector(entry.constraint.pivotB),
                  xA: plainVector(entry.constraint.xA),
                  yA: plainVector(entry.constraint.yA),
                  zA: plainVector(entry.constraint.zA),
                  xB: plainVector(entry.constraint.xB),
                  yB: plainVector(entry.constraint.yB),
                  zB: plainVector(entry.constraint.zB),
                }
              : null,
        }))
        .sort((left, right) => compareCompiledIds(left.id, right.id));
    return issueInertPlainData({
      version: 2,
      compiledPhysicalSemanticsFingerprint:
        compiledPhysicalSemanticsFingerprint(this.compiled),
      fixedDt: this.fixedDt,
      sourceRevision: this.compiled.sourceRevision,
      world: {
        time: this.world.time,
        stepnumber: this.world.stepnumber,
      },
      bodies: sortedIdentityEntries(this.bodyByPart).map(([partId, body]) =>
        bodyState(partId, body),
      ),
      entries,
      exclusionStates: this.collisionExclusionConstraints
        .map((entry) => ({
          id: entry.descriptor.id,
          active: entry.active !== false,
        }))
        .sort((left, right) => compareCompiledIds(left.id, right.id)),
      phaseByPart: sortedIdentityEntries(this.phaseByPart),
      loadByConnection: sortedIdentityEntries(this.loadByConnection),
      torqueByConnection: sortedIdentityEntries(this.torqueByConnection),
      motorElectricalWByPart: sortedIdentityEntries(
        this.motorElectricalWByPart,
      ),
      activeLuminairePartIds: [...this.activeLuminairePartIds].sort(
        compareCanonicalIds,
      ),
      fluidState: this.fluidState,
      topologyRevision: this.topologyRevision,
      solverStatePolicy: "deterministic-cold-start-v1",
    });
  }

  validateState(state) {
    return validateMultibodyStateForCheckpointRestore(this, state);
  }

  importState(state) {
    const baseline = exportValidatedMultibodyState(this),
      validated = validateMultibodyCheckpointState(state, {
        ...multibodyCheckpointValidationOptions(this, baseline),
        baseline,
      });
    // The candidate is closed, detached, finite, physically consistent, and
    // topology-exact before the first Cannon object is touched. The remaining
    // phase contains no caller-controlled validation and commits the candidate
    // in canonical solver order.
    try {
      this.#applyImportedState(validated);
    } catch (restoreError) {
      try {
        this.#applyImportedState(baseline);
      } catch (rollbackError) {
        throw new AggregateError(
          [restoreError, rollbackError],
          "Multibody checkpoint import failed and exact rollback could not recover the live engine state",
          { cause: rollbackError },
        );
      }
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_ENGINE_COMMIT_FAILED",
        "Multibody checkpoint import failed after validation; live engine state was restored",
        { cause: restoreError },
      );
    }
  }

  #applyImportedState(state) {
    if (!this.compiled || state?.version !== 2)
      throw new DomainValidationError(
        "INVALID_MULTIBODY_CHECKPOINT",
        "Multibody checkpoint does not match the running runtime",
      );
    if (
      state.compiledPhysicalSemanticsFingerprint !==
      compiledPhysicalSemanticsFingerprint(this.compiled)
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_PHYSICAL_SEMANTICS_MISMATCH",
        "Multibody checkpoint physical semantics do not match the running runtime",
      );
    if (
      state.fixedDt !== this.fixedDt ||
      state.sourceRevision !== this.compiled.sourceRevision ||
      state.solverStatePolicy !== "deterministic-cold-start-v1"
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_IDENTITY_MISMATCH",
        "Multibody checkpoint identities do not match the running runtime",
      );
    if (!Array.isArray(state.exclusionStates))
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
        "Multibody checkpoint collision exclusion set is missing",
      );
    const exclusionStates = new Map();
    for (const record of state.exclusionStates) {
      if (
        !record ||
        typeof record.id !== "string" ||
        typeof record.active !== "boolean" ||
        exclusionStates.has(record.id)
      )
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
          "Multibody checkpoint collision exclusion identities are invalid",
        );
      exclusionStates.set(record.id, record.active);
    }
    if (
      exclusionStates.size !== this.collisionExclusionConstraints.length ||
      this.collisionExclusionConstraints.some(
        (entry) => !exclusionStates.has(entry.descriptor.id),
      )
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
        "Multibody checkpoint collision exclusion set does not match compiled topology",
      );
    if (!Array.isArray(state.entries))
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_CONSTRAINT_MISMATCH",
        "Multibody checkpoint constraint set is missing",
      );
    const entries = new Map(state.entries.map((record) => [record.id, record]));
    if (
      entries.size !== state.entries.length ||
      entries.size !== this.constraintEntries.length ||
      this.constraintEntries.some((entry) => !entries.has(entry.descriptor.id))
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_CONSTRAINT_MISMATCH",
        "Multibody checkpoint constraint set does not match compiled topology",
      );
    const targetConstraintEntries = this.constraintEntries.map((entry) => {
      const record = entries.get(entry.descriptor.id);
      if ((entry.kind || null) !== record.kind)
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_CONSTRAINT_KIND_MISMATCH",
          `Constraint ${entry.descriptor.id} changed kind`,
        );
      if (typeof record.values?.active !== "boolean")
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_CONSTRAINT_ACTIVITY_MISMATCH",
          `Constraint ${entry.descriptor.id} has invalid activity state`,
        );
      return { ...entry, active: record.values.active };
    });
    if (
      this.collisionExclusionConstraints.some(
        (entry) =>
          exclusionStates.get(entry.descriptor.id) !==
          collisionExclusionRequired(targetConstraintEntries, entry.descriptor),
      )
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_ACTIVITY_MISMATCH",
        "Multibody checkpoint collision exclusions disagree with restored constraint topology",
      );
    if (!Array.isArray(state.bodies))
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
        "Multibody checkpoint body set is missing",
      );
    const bodies = new Map();
    for (const record of state.bodies) {
      if (
        !record ||
        !Object.hasOwn(record, "partId") ||
        bodies.has(record.partId)
      )
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
          "Multibody checkpoint body identities are invalid",
        );
      bodies.set(record.partId, record);
    }
    const compiledBodyPartIds = new Set(
      this.compiled.bodies.map((descriptor) => descriptor.partId),
    );
    if (
      bodies.size !== state.bodies.length ||
      bodies.size !== this.bodyByPart.size ||
      bodies.size !== compiledBodyPartIds.size ||
      compiledBodyPartIds.size !== this.compiled.bodies.length ||
      [...this.bodyByPart.keys()].some((partId) => !bodies.has(partId)) ||
      [...compiledBodyPartIds].some((partId) => !bodies.has(partId))
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
        "Multibody checkpoint body set does not match compiled and live topology",
      );
    const copyVector = (target, value) =>
        target.set(Number(value.x), Number(value.y), Number(value.z)),
      copyQuaternion = (target, value) =>
        target.set(
          Number(value.x),
          Number(value.y),
          Number(value.z),
          Number(value.w),
        );
    for (const [partId, body] of this.bodyByPart) {
      const record = bodies.get(partId);
      copyVector(body.position, record.position);
      copyVector(body.previousPosition, record.previousPosition);
      copyVector(body.interpolatedPosition, record.interpolatedPosition);
      copyQuaternion(body.quaternion, record.quaternion);
      copyQuaternion(body.previousQuaternion, record.previousQuaternion);
      copyQuaternion(
        body.interpolatedQuaternion,
        record.interpolatedQuaternion,
      );
      copyVector(body.velocity, record.velocity);
      copyVector(body.angularVelocity, record.angularVelocity);
      copyVector(body.force, record.force);
      copyVector(body.torque, record.torque);
      body.mass = record.mass;
      body.invMass = record.invMass;
      copyVector(body.inertia, record.inertia);
      copyVector(body.invInertia, record.invInertia);
      copyQuaternion(
        body.userData.massFrame.principalToPart,
        record.massFrame.principalToPart,
      );
      copyVector(body.userData.massFrame.comPart, record.massFrame.comPart);
      body.userData.massProperties = deepFreeze(
        structuredClone(record.massProperties),
      );
      if (
        record.shapeOffsets.length !== body.shapeOffsets.length ||
        record.shapeOrientations.length !== body.shapeOrientations.length
      )
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
          `Multibody checkpoint shape frame set changed for ${String(partId)}`,
        );
      for (let index = 0; index < body.shapeOffsets.length; index++) {
        copyVector(body.shapeOffsets[index], record.shapeOffsets[index]);
        copyQuaternion(
          body.shapeOrientations[index],
          record.shapeOrientations[index],
        );
      }
      body.sleepState = record.sleepState;
      body.timeLastSleepy = record.timeLastSleepy;
      body.aabbNeedsUpdate = true;
      body.updateInertiaWorld(true);
    }
    for (const entry of this.constraintEntries) {
      const record = entries.get(entry.descriptor.id);
      Object.assign(entry, structuredClone(record.values));
      if (entry.descriptor.kind === "fixed") {
        if (!record.fixedFrame)
          throw new DomainValidationError(
            "MULTIBODY_CHECKPOINT_FIXED_FRAME_MISMATCH",
            `Constraint ${entry.descriptor.id} is missing its fixed frame`,
          );
        for (const field of [
          "pivotA",
          "pivotB",
          "xA",
          "yA",
          "zA",
          "xB",
          "yB",
          "zB",
        ])
          copyVector(entry.constraint[field], record.fixedFrame[field]);
      }
      if (entry.kind === "rolling-contact-v1") {
        entry.constraint.state = structuredClone(record.tireState);
        entry.constraint.solvedContactRows = [];
      }
    }
    const managedConstraints = new Set(
        this.constraintEntries.map((entry) => entry.constraint).filter(Boolean),
      ),
      activeManagedConstraints = this.constraintEntries
        .filter((entry) => entry.constraint && entry.active !== false)
        .map((entry) => entry.constraint),
      targetConstraintOrder = mergedManagedConstraintOrder(
        this.world.constraints,
        managedConstraints,
        activeManagedConstraints,
        constraintOrderPredecessorsByRuntime.get(this) || [],
      );
    this.world.constraints.splice(
      0,
      this.world.constraints.length,
      ...targetConstraintOrder,
    );
    for (const entry of this.collisionExclusionConstraints) {
      entry.active = exclusionStates.get(entry.descriptor.id) !== false;
      if (!entry.active)
        unregisterCannonCollisionExclusion(
          this.worldAdapter.transaction,
          entry.exclusion,
        );
      else
        registerCannonCollisionExclusion(
          this.worldAdapter.transaction,
          entry.exclusion,
        );
    }
    this.world.time = state.world.time;
    this.world.stepnumber = state.world.stepnumber;
    this.world.contacts.length = 0;
    this.world.frictionEquations.length = 0;
    // Cannon body/shape IDs are process-local allocation handles. The declared
    // cold-start policy deliberately rebuilds broadphase, overlap, narrowphase,
    // friction, and solver rows from restored canonical bodies at the next
    // fixed tick instead of serializing those unstable handles.
    this.world.collisionMatrix.reset();
    this.world.collisionMatrixPrevious.reset();
    this.world.bodyOverlapKeeper.current.length = 0;
    this.world.bodyOverlapKeeper.previous.length = 0;
    this.world.shapeOverlapKeeper.current.length = 0;
    this.world.shapeOverlapKeeper.previous.length = 0;
    this.world.broadphase.dirty = true;
    this.phaseByPart = new Map(state.phaseByPart);
    this.loadByConnection = new Map(state.loadByConnection);
    this.torqueByConnection = new Map(state.torqueByConnection);
    this.motorElectricalWByPart = new Map(state.motorElectricalWByPart);
    this.activeLuminairePartIds = [...state.activeLuminairePartIds];
    this.fluidState = structuredClone(state.fluidState);
    this.topologyRevision = state.topologyRevision;
    for (const entry of this.constraintEntries)
      refreshConstraintFrameAuthority(this, entry);
    for (const partId of this.bodyByPart.keys())
      refreshBodyPhysicalAuthority(this, partId);
    refreshEngineActivityAuthority(this);
    this.lastTelemetry = this.telemetry(this.lastTelemetry?.activeMotors || 0);
  }

  dispose() {
    for (const entry of this.constraintEntries)
      if (entry.constraint) {
        if (entry.kind === "rolling-contact-v1")
          unregisterRollingSupport(this.worldAdapter?.transaction, {
            wheelBody: entry.constraint.wheelBody,
            wheelShape: entry.constraint.wheelBody.shapes[0],
            constraint: entry.constraint,
          });
        this.world.removeConstraint(entry.constraint);
      }
    for (const entry of this.collisionExclusionConstraints)
      unregisterCannonCollisionExclusion(
        this.worldAdapter.transaction,
        entry.exclusion,
      );
    for (const body of this.bodyByPart.values()) this.world.removeBody(body);
    this.constraintEntries.length = 0;
    constraintOrderPredecessorsByRuntime.set(this, []);
    constraintValueFieldsByRuntime.set(this, new Map());
    this.collisionExclusionConstraints.length = 0;
    this.bodyByPart.clear();
    this.geometryByPart.clear();
    fluidDescriptorsByRuntime.set(this, []);
    telemetryBodyDescriptorsByRuntime.set(this, new Map());
    this.phaseByPart.clear();
    this.loadByConnection.clear();
    this.torqueByConnection.clear();
    this.compiled = null;
    this.lastTelemetry = null;
    this.motorElectricalWByPart.clear();
    evidenceCapturingRuntimes.delete(this);
    failureEvidenceByRuntime.set(this, Object.freeze([]));
    this.activeLuminairePartIds = [];
    this.fluidState = null;
    this.topologyRevision = 0;
    engineAuthorityByRuntime.delete(this);
  }
}

/**
 * @param {string} snapshot
 * @param {{
 *   world:any,
 *   worldAdapter?:CannonWorldAdapter,
 *   material:any,
 *   catalog?:string,
 *   fixedDt?:number,
 *   surfaceHeightAt?:any,
 *   terrainHeightAt?:any,
 *   pondAt?:any,
 *   waterDensity?:number,
 *   groundBody?:any,
 *   fieldBody?:any,
 *   materialForKey?:(materialKey:string)=>any
 * }} options
 */
export function startMultibodyRuntime(snapshot, options) {
  const runtime = new MultibodyRuntime(options);
  runtime.start(snapshot);
  return runtime;
}
