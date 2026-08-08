import { completeMassProperties } from "./mechanism-geometry-compiler.js";
import { cloneCompiledValue } from "./assembly-compiler-shared.js";
import { dynamicMassContributorIdentity } from "./dynamic-mass-properties.js";
import { validatePhysicalInertiaTensor } from "./physical-inertia-validation.js";
import { canonicalId, detachPlainData, stableStringify } from "./primitives.js";

const ZERO_MATRIX = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0, 0, 0]),
  Object.freeze([0, 0, 0]),
]);

const tensorMatrix = (tensor) => [
  [tensor.xx, tensor.xy, tensor.xz],
  [tensor.xy, tensor.yy, tensor.yz],
  [tensor.xz, tensor.yz, tensor.zz],
];

const tensorRecord = (matrix) => ({
  xx: matrix[0][0],
  yy: matrix[1][1],
  zz: matrix[2][2],
  xy: (matrix[0][1] + matrix[1][0]) / 2,
  xz: (matrix[0][2] + matrix[2][0]) / 2,
  yz: (matrix[1][2] + matrix[2][1]) / 2,
});

const addMatrices = (left, right) =>
  left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
  );

function finiteThreeVector(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite three-vector`);
  return value;
}

function finiteNonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new RangeError(`${label} must be finite and nonnegative`);
  return value;
}

/** Detaches caller data after proving that cloning cannot execute accessors. */
export function clonePlainMassPropertyData(value, label = "mass properties") {
  return detachPlainData(value, {
    code: "INVALID_PLAIN_MASS_PROPERTY_DATA",
    finiteNumbers: true,
    message: `${label} must contain only accessor-free, acyclic, finite plain data`,
  });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort(),
    required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  )
    throw new TypeError(`${label} has an invalid field set`);
}

function validateCoreMassProperties(properties, label) {
  exactKeys(
    properties.inertiaTensorAtComPartKgM2,
    ["xx", "yy", "zz", "xy", "xz", "yz"],
    `${label} inertia tensor`,
  );
  if (!(properties.massKg > 0) || !Number.isFinite(properties.massKg))
    throw new RangeError(`${label} mass must be finite and positive`);
  finiteNonnegative(properties.volumeM3, `${label} volume`);
  finiteThreeVector(properties.comPositionPartM, `${label} COM`);
  validatePhysicalInertiaTensor(
    tensorMatrix(properties.inertiaTensorAtComPartKgM2),
    `${label} inertia tensor`,
  );
}

function validateEndpointPointMasses(pointMasses, label) {
  if (!Array.isArray(pointMasses))
    throw new TypeError(`${label} must be an array`);
  for (const [index, point] of pointMasses.entries()) {
    const pointLabel = `${label} ${index}`;
    exactKeys(
      point,
      [
        "sourcePartId",
        "sourceConnectionId",
        "sourcePortId",
        "targetPartId",
        "targetPortId",
        "positionFramePartId",
        "massKg",
        "positionPartM",
      ],
      pointLabel,
    );
    canonicalId(point.sourcePartId);
    canonicalId(point.sourceConnectionId);
    canonicalId(point.targetPartId);
    canonicalId(point.positionFramePartId);
    if (
      typeof point.sourcePortId !== "string" ||
      !point.sourcePortId ||
      typeof point.targetPortId !== "string" ||
      !point.targetPortId
    )
      throw new TypeError(`${pointLabel} requires non-empty endpoint ports`);
    if (point.positionFramePartId !== point.targetPartId)
      throw new TypeError(
        `${pointLabel} position frame must be owned by the target part`,
      );
    finiteNonnegative(point.massKg, `${pointLabel} mass`);
    finiteThreeVector(point.positionPartM, `${pointLabel} position`);
  }
}

function validateDynamicMaterialStore(properties, label) {
  if (!Object.hasOwn(properties, "dynamicMaterialStore")) return;
  const store = properties.dynamicMaterialStore;
  if (store === null) return;
  exactKeys(
    store,
    ["partId", "remainingMassKg", "centerPartM", "sizeM"],
    `${label} dynamic material store`,
  );
  canonicalId(store.partId);
  finiteNonnegative(
    store.remainingMassKg,
    `${label} dynamic material store mass`,
  );
  finiteThreeVector(
    store.centerPartM,
    `${label} dynamic material store center`,
  );
  finiteThreeVector(store.sizeM, `${label} dynamic material store size`);
  if (store.sizeM.some((dimension) => !(dimension > 0)))
    throw new RangeError(
      `${label} dynamic material store dimensions must be positive`,
    );
}

export function validateRigidMemberMassProperties(candidate, bodyId) {
  const label = `rigid member ${String(bodyId)} mass properties`;
  const properties = clonePlainMassPropertyData(candidate, label);
  if (!properties || typeof properties !== "object")
    throw new TypeError(`${label} must be an object`);
  exactKeys(
    properties,
    [
      "sourceKind",
      "massEvaluationPolicy",
      "massKg",
      "volumeM3",
      "comPositionPartM",
      "inertiaTensorAtComPartKgM2",
      "contributingSolidIds",
      "principalMomentsKgM2",
      "principalAxesPart",
      "decompositionPolicy",
      ...(Object.hasOwn(properties, "endpointPointMasses")
        ? ["endpointPointMasses"]
        : []),
      ...(Object.hasOwn(properties, "dynamicMaterialStore")
        ? ["dynamicMaterialStore"]
        : []),
    ],
    label,
  );
  validateCoreMassProperties(properties, label);
  for (const field of [
    "sourceKind",
    "massEvaluationPolicy",
    "decompositionPolicy",
  ])
    if (typeof properties[field] !== "string" || !properties[field])
      throw new TypeError(`${label} requires ${field}`);
  if (
    !Array.isArray(properties.contributingSolidIds) ||
    properties.contributingSolidIds.some(
      (identity) => typeof identity !== "string" || !identity,
    ) ||
    new Set(properties.contributingSolidIds).size !==
      properties.contributingSolidIds.length
  )
    throw new TypeError(`${label} has invalid contributing solid identities`);
  if (
    !Array.isArray(properties.principalMomentsKgM2) ||
    properties.principalMomentsKgM2.length !== 3 ||
    properties.principalMomentsKgM2.some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value <= 0,
    )
  )
    throw new TypeError(`${label} has invalid principal moments`);
  if (
    !Array.isArray(properties.principalAxesPart) ||
    properties.principalAxesPart.length !== 3
  )
    throw new TypeError(`${label} has invalid principal axes`);
  for (const [index, axis] of properties.principalAxesPart.entries())
    finiteThreeVector(axis, `${label} principal axis ${index}`);
  if (Object.hasOwn(properties, "endpointPointMasses"))
    validateEndpointPointMasses(
      properties.endpointPointMasses,
      `${label} endpoint point masses`,
    );
  validateDynamicMaterialStore(properties, label);
  const recompleted = completeMassProperties(properties);
  for (const field of [
    "principalMomentsKgM2",
    "principalAxesPart",
    "decompositionPolicy",
  ])
    if (
      JSON.stringify(recompleted[field]) !== JSON.stringify(properties[field])
    )
      throw new RangeError(`${label} has contradictory ${field}`);
  return properties;
}

/** Shared preflight for every Cannon mass/inertia construction boundary. */
export function engineMassPropertiesProjection(properties, bodyId) {
  properties = validateRigidMemberMassProperties(properties, bodyId);
  const invMass = 1 / properties.massKg,
    invInertia = properties.principalMomentsKgM2.map((value) => 1 / value);
  if (
    !Number.isFinite(invMass) ||
    !(invMass > 0) ||
    invInertia.some((value) => !Number.isFinite(value) || !(value > 0))
  )
    throw new RangeError(
      `Part ${String(bodyId)} produces non-finite Cannon mass reciprocals`,
    );
  return {
    massKg: properties.massKg,
    inertia: [...properties.principalMomentsKgM2],
    invMass,
    invInertia,
  };
}

function nearlyEqual(left, right, tolerance = 1e-10) {
  return (
    Math.abs(left - right) <=
    tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function validateDynamicContributorAuthority(
  properties,
  { compiledSolidIds, contributorKinds, partId },
) {
  const candidateSolidIds = properties.contributingSolidIds,
    materialStoreId = dynamicMassContributorIdentity("material-store", partId),
    pneumaticGasId = dynamicMassContributorIdentity("pneumatic-gas", partId),
    hasPneumaticGas = candidateSolidIds.includes(pneumaticGasId),
    expectedSolidIds = [
      ...compiledSolidIds,
      ...(properties.dynamicMaterialStore ? [materialStoreId] : []),
      ...(hasPneumaticGas ? [pneumaticGasId] : []),
    ];
  if (
    properties.dynamicMaterialStore &&
    (!contributorKinds.has("material-store-v1") ||
      properties.dynamicMaterialStore.partId !== partId)
  )
    throw new TypeError(
      `Part ${String(partId)} changed material-store mass authority`,
    );
  if (
    (hasPneumaticGas &&
      !contributorKinds.has("tire-chamber-v1") &&
      !contributorKinds.has("ideal-gas-control-volume-v1")) ||
    stableStringify(candidateSolidIds) !== stableStringify(expectedSolidIds)
  )
    throw new TypeError(
      `Part ${String(partId)} changed dynamic mass contributor authority`,
    );
}

/**
 * Validates one runtime mass projection against immutable compiler authority.
 * Dynamic owners may change quantities, but may not mint provenance kinds or
 * replace the compiled solid/endpoint prefix.
 */
export function validateRuntimeMassPropertiesAuthority(
  properties,
  { compiledProperties, partId, dynamicMassContributorKinds = [] },
) {
  validateRigidMemberMassProperties(properties, partId);
  const candidateEndpoints = Object.hasOwn(properties, "endpointPointMasses")
      ? properties.endpointPointMasses
      : null,
    compiledEndpoints = Object.hasOwn(compiledProperties, "endpointPointMasses")
      ? compiledProperties.endpointPointMasses
      : null,
    dynamic = properties.sourceKind === "dynamic-dry-ablation-bladder-v1";
  if (
    stableStringify(candidateEndpoints) !== stableStringify(compiledEndpoints)
  )
    throw new TypeError(
      `Part ${String(partId)} changed compiled endpoint mass provenance`,
    );
  if (!dynamic) {
    if (stableStringify(properties) !== stableStringify(compiledProperties))
      throw new TypeError(
        `Part ${String(partId)} changed immutable compiled mass authority`,
      );
    return properties;
  }
  const contributorKinds = new Set(dynamicMassContributorKinds);
  if (!contributorKinds.size)
    throw new TypeError(
      `Part ${String(partId)} introduced dynamic mass without compiled authority`,
    );
  if (
    properties.massEvaluationPolicy !== "single-post-thermal-transaction-v1" ||
    !nearlyEqual(properties.volumeM3, compiledProperties.volumeM3)
  )
    throw new TypeError(
      `Part ${String(partId)} changed dynamic mass evaluation authority`,
    );
  validateDynamicContributorAuthority(properties, {
    compiledSolidIds: compiledProperties.contributingSolidIds,
    contributorKinds,
    partId,
  });
  return properties;
}

function quaternionRotationMatrix(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError("rigid member orientation must be a finite quaternion");
  const norm = Math.hypot(...value);
  if (Math.abs(norm - 1) > 1e-10)
    throw new RangeError("rigid member orientation must be unit length");
  const [x, y, z, w] = value;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function multiplyMatrices(left, right) {
  return left.map((row) =>
    right[0].map((_, columnIndex) =>
      row.reduce(
        (sum, value, innerIndex) =>
          sum + value * right[innerIndex][columnIndex],
        0,
      ),
    ),
  );
}

function transposeMatrix(matrix) {
  return matrix[0].map((_, columnIndex) =>
    matrix.map((row) => row[columnIndex]),
  );
}

function rotateVector(matrix, vector) {
  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  );
}

function parallelAxis(massKg, offset) {
  const distanceSquared = offset.reduce(
    (total, value) => total + value * value,
    0,
  );
  return ZERO_MATRIX.map((row, rowIndex) =>
    row.map(
      (_, columnIndex) =>
        massKg *
        (distanceSquared * (rowIndex === columnIndex ? 1 : 0) -
          offset[rowIndex] * offset[columnIndex]),
    ),
  );
}

export function composePointMasses(base, pointMasses) {
  validateEndpointPointMasses(pointMasses, "endpoint point masses");
  if (!pointMasses.length) return base;
  const massKg =
      base.massKg + pointMasses.reduce((sum, point) => sum + point.massKg, 0),
    weighted = base.comPositionPartM.map((value) => value * base.massKg);
  for (const point of pointMasses)
    for (let axis = 0; axis < 3; axis++)
      weighted[axis] += point.positionPartM[axis] * point.massKg;
  const comPositionPartM = weighted.map((value) => value / massKg),
    baseOffset = base.comPositionPartM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
  let inertia = addMatrices(
    tensorMatrix(base.inertiaTensorAtComPartKgM2),
    parallelAxis(base.massKg, baseOffset),
  );
  for (const point of pointMasses) {
    const offset = point.positionPartM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
    inertia = addMatrices(inertia, parallelAxis(point.massKg, offset));
  }
  return completeMassProperties({
    sourceKind: "base-solid-plus-endpoint-point-masses-v1",
    massEvaluationPolicy: "parallel-axis-exact-point-masses-v1",
    massKg,
    volumeM3: base.volumeM3,
    comPositionPartM,
    inertiaTensorAtComPartKgM2: tensorRecord(inertia),
    contributingSolidIds: [...(base.contributingSolidIds || [])],
    endpointPointMasses: cloneCompiledValue(pointMasses),
  });
}

/**
 * Composes complete member mass properties in an authored cluster frame.
 * This is an engine-neutral Newton-Euler operation: rotate each inertia tensor
 * into the common frame, then translate it to the aggregate centre of mass.
 */
export function composeRigidBodyMassProperties(members) {
  if (!members.length)
    throw new TypeError("rigid mass-property composition requires members");
  const resolved = members.map((member) => {
      const properties = member.massProperties,
        massKg = properties?.massKg,
        volumeM3 = properties?.volumeM3,
        positionClusterM = finiteThreeVector(
          member.positionClusterM,
          `rigid member ${String(member.bodyId)} position`,
        ),
        comPositionPartM = finiteThreeVector(
          properties?.comPositionPartM,
          `rigid member ${String(member.bodyId)} COM`,
        ),
        inertiaPart = tensorMatrix(
          properties?.inertiaTensorAtComPartKgM2 || {},
        ),
        rotation = quaternionRotationMatrix(member.orientationCluster),
        rotatedCom = rotateVector(rotation, comPositionPartM);
      validateRigidMemberMassProperties(properties, member.bodyId);
      if (!(massKg > 0) || !Number.isFinite(massKg))
        throw new RangeError(
          `rigid member ${String(member.bodyId)} requires finite positive mass`,
        );
      if (!(volumeM3 >= 0) || !Number.isFinite(volumeM3))
        throw new RangeError(
          `rigid member ${String(member.bodyId)} requires finite nonnegative volume`,
        );
      validatePhysicalInertiaTensor(
        inertiaPart,
        `rigid member ${String(member.bodyId)} inertia`,
      );
      if (member.massKg != null) {
        if (
          typeof member.massKg !== "number" ||
          !Number.isFinite(member.massKg)
        )
          throw new TypeError(
            `rigid member ${String(member.bodyId)} declared mass must be finite numeric data`,
          );
        if (
          Math.abs(member.massKg - massKg) >
          1e-12 * Math.max(Math.abs(member.massKg), Math.abs(massKg))
        )
          throw new RangeError(
            `rigid member ${String(member.bodyId)} mass disagrees with its mass properties`,
          );
      }
      return {
        ...member,
        properties,
        comClusterM: finiteThreeVector(
          positionClusterM.map((value, index) => value + rotatedCom[index]),
          `rigid member ${String(member.bodyId)} cluster COM`,
        ),
        inertiaClusterAtCom: multiplyMatrices(
          multiplyMatrices(rotation, inertiaPart),
          transposeMatrix(rotation),
        ),
      };
    }),
    massKg = resolved.reduce(
      (sum, member) => sum + member.properties.massKg,
      0,
    );
  if (!(massKg > 0) || !Number.isFinite(massKg))
    throw new RangeError(
      "rigid mass-property composition requires finite positive mass",
    );
  const comPositionPartM = [0, 1, 2].map(
    (axis) =>
      resolved.reduce(
        (sum, member) =>
          sum + member.comClusterM[axis] * member.properties.massKg,
        0,
      ) / massKg,
  );
  finiteThreeVector(comPositionPartM, "composed rigid-cluster COM");
  let inertia = ZERO_MATRIX.map((row) => [...row]);
  for (const member of resolved) {
    const offset = member.comClusterM.map(
      (value, axis) => value - comPositionPartM[axis],
    );
    inertia = addMatrices(
      inertia,
      addMatrices(
        member.inertiaClusterAtCom,
        parallelAxis(member.properties.massKg, offset),
      ),
    );
  }
  validatePhysicalInertiaTensor(inertia, "composed rigid-cluster inertia");
  const volumeM3 = resolved.reduce(
    (sum, member) => sum + Number(member.properties.volumeM3 || 0),
    0,
  );
  finiteNonnegative(volumeM3, "composed rigid-cluster volume");
  return completeMassProperties(
    {
      sourceKind: "fixed-rigid-cluster-v1",
      massEvaluationPolicy: "rotated-tensor-parallel-axis-v1",
      massKg,
      volumeM3,
      comPositionPartM,
      inertiaTensorAtComPartKgM2: tensorRecord(inertia),
      contributingSolidIds: resolved.map((member) => member.bodyId),
      memberMassPropertySources: cloneCompiledValue(
        resolved.map((member) => ({
          bodyId: member.bodyId,
          positionClusterM: member.positionClusterM,
          orientationCluster: member.orientationCluster,
          massProperties: member.properties,
        })),
      ),
    },
    { normalizeScale: true },
  );
}
