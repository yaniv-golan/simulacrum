import {
  validateRigidMemberMassProperties,
  validateRuntimeMassPropertiesAuthority,
} from "../model/assembly-compiler-mass-properties.js";
import { validatePhysicalInertiaTensor } from "../model/physical-inertia-validation.js";
import {
  canonicalId,
  compareCanonicalIds,
  DomainValidationError,
  stableStringify,
} from "../model/primitives.js";
import { requireInertPlainData } from "../model/plain-data-contract.js";
import { isCanonicalCannonCheckpointQuaternion } from "./cannon-checkpoint-quaternion.js";
import { AXIAL_EFFORT_SATURATION_MASK } from "./axial-effort-settlement.js";

const BODY_FIELDS = Object.freeze([
  "partId",
  "position",
  "previousPosition",
  "interpolatedPosition",
  "quaternion",
  "previousQuaternion",
  "interpolatedQuaternion",
  "velocity",
  "angularVelocity",
  "force",
  "torque",
  "mass",
  "invMass",
  "inertia",
  "invInertia",
  "massFrame",
  "massProperties",
  "shapeOffsets",
  "shapeOrientations",
  "sleepState",
  "timeLastSleepy",
]);
const CONSTRAINT_FIELDS = Object.freeze([
  "id",
  "kind",
  "values",
  "tireState",
  "fixedFrame",
]);
const FIXED_FRAME_FIELDS = Object.freeze([
  "pivotA",
  "pivotB",
  "xA",
  "yA",
  "zA",
  "xB",
  "yB",
  "zB",
]);
const CONSTRAINT_VALUE_FIELDS = Object.freeze([
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
  "requestedForceN",
  "capacityLimitedForceN",
  "appliedForceN",
  "passiveForceN",
  "effortRateSampleMPerS",
  "residualForceN",
  "commandTick",
  "commandSource",
  "commandValidity",
  "saturationCauseMask",
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
const CONSTRAINT_BOOLEAN_FIELDS = new Set([
  "active",
  "powered",
  "saturated",
  "thermalShutdown",
  "clutchEngaged",
]);
const CONSTRAINT_STRING_VALUES = Object.freeze({
  commandSource: new Set(["default", "none", "remote", "script"]),
  commandValidity: new Set([
    "conflict",
    "current",
    "missing",
    "out-of-range",
    "stale",
  ]),
});
const CONSTRAINT_NONNEGATIVE_FIELDS = new Set([
  "reactionTorque",
  "force",
  "transverseM",
  "reactionForceN",
  "saturationCauseMask",
  "elasticPotentialJ",
  "actuatorElectricalEnergyJ",
  "actuatorDissipatedEnergyJ",
]);
const CONSTRAINT_NONPOSITIVE_FIELDS = new Set([
  "dampingWorkJ",
  "dampingPowerW",
  "frictionWorkJ",
]);
const TIRE_STATE_FIELDS = Object.freeze([
  "touching",
  "normalLoadN",
  "longitudinalForceN",
  "lateralForceN",
  "slipLongMPerS",
  "slipLatMPerS",
  "carcassDeflectionM",
  "carcassDeflectionRateMPerS",
  "rimLoadN",
  "rollingResistanceTorqueNm",
  "rollingHysteresisEnergyPerCycleJ",
  "effectiveRollingResistanceCoefficient",
  "surfaceSinkageM",
  "surfaceRollingResistanceMultiplier",
  "dissipatedEnergyJ",
  "temperatureK",
  "pneumaticGasState",
  "ambientPressurePa",
  "absolutePressurePa",
  "gaugePressurePa",
  "gasTemperatureK",
  "chamberVolumeM3",
  "frictionEllipseUtilization",
  "manifoldPointCount",
  "contactRoles",
  "contactRegionKeys",
  "contactMaterialKeys",
  "supportMaterialKeys",
  "supportMaterialLaws",
]);
const FLUID_STATE_FIELDS = Object.freeze([
  "active",
  "inWater",
  "wetBodies",
  "submergedFraction",
  "displacedVolumeM3",
  "buoyancyN",
  "hydrodynamicDragN",
  "waterDepth",
  "byPart",
]);
const FLUID_PART_FIELDS = Object.freeze([
  "partId",
  "volumeM3",
  "submerged",
  "submergedVolumeM3",
  "buoyancyN",
  "dragN",
  "waterDepth",
]);
const TIRE_STRING_ARRAY_FIELDS = Object.freeze([
  "contactRoles",
  "contactRegionKeys",
  "contactMaterialKeys",
  "supportMaterialKeys",
]);
const TIRE_SUPPORT_MATERIAL_LAW_FIELDS = Object.freeze([
  "materialKey",
  "longitudinalFrictionCoefficient",
  "lateralFrictionCoefficient",
  "restitutionCoefficient",
  "foundationStiffnessNPerM",
  "maximumSinkageM",
  "rollingResistanceMultiplier",
]);
const TIRE_CONTACT_ROLES = new Set(["tread", "shoulder", "sidewall", "rim"]);
const TIRE_NONNEGATIVE_FIELDS = new Set([
  "normalLoadN",
  "carcassDeflectionM",
  "rimLoadN",
  "rollingHysteresisEnergyPerCycleJ",
  "effectiveRollingResistanceCoefficient",
  "surfaceSinkageM",
  "surfaceRollingResistanceMultiplier",
  "dissipatedEnergyJ",
  "frictionEllipseUtilization",
  "manifoldPointCount",
]);
const TIRE_POSITIVE_FIELDS = new Set([
  "temperatureK",
  "ambientPressurePa",
  "absolutePressurePa",
  "gasTemperatureK",
  "chamberVolumeM3",
]);

function invalid(code, message, path, cause) {
  throw new DomainValidationError(code, message, { path, cause });
}

function exactKeys(value, expected, code, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(code, "Checkpoint record must be a plain object", path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    invalid(code, "Checkpoint record must be a plain object", path);
  const actual = Object.keys(value).sort(),
    required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  )
    invalid(code, "Checkpoint record has an invalid field set", path);
  return value;
}

function finite(value, code, path, { min = -Infinity, integer = false } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid(code, "Checkpoint value must be finite and physical", path);
  return value;
}

function vector(value, code, path, { positive = false } = {}) {
  exactKeys(value, ["x", "y", "z"], code, path);
  for (const field of ["x", "y", "z"])
    finite(value[field], code, [...path, field], {
      min: positive ? Number.MIN_VALUE : -Infinity,
    });
  return value;
}

function quaternion(value, code, path) {
  exactKeys(value, ["x", "y", "z", "w"], code, path);
  for (const field of ["x", "y", "z", "w"])
    finite(value[field], code, [...path, field]);
  if (!isCanonicalCannonCheckpointQuaternion(value))
    invalid(
      code,
      "Checkpoint quaternion must use the canonical exact representation",
      path,
    );
  return value;
}

function vectorsEqual(left, right) {
  return ["x", "y", "z"].every((field) => left[field] === right[field]);
}

function validateMassAuthority(record, path) {
  const code = "INVALID_MULTIBODY_CHECKPOINT_BODY_STATE";
  try {
    validateRigidMemberMassProperties(record.massProperties, record.partId);
  } catch (cause) {
    invalid(code, "Checkpoint body mass authority is invalid", path, cause);
  }
  const properties = record.massProperties;
  if (
    properties.dynamicMaterialStore &&
    properties.dynamicMaterialStore.partId !== record.partId
  )
    invalid(code, "Checkpoint dynamic-mass owner identity changed", path);
  if (!(properties.massKg > 0) || record.mass !== properties.massKg)
    invalid(code, "Checkpoint body mass authorities disagree", path);
  const moments = properties.principalMomentsKgM2;
  if (
    moments.some((value) => !(value > 0)) ||
    moments.some(
      (value, index) => value !== record.inertia[["x", "y", "z"][index]],
    )
  )
    invalid(code, "Checkpoint body inertia authorities disagree", path);
  try {
    validatePhysicalInertiaTensor(
      [
        [record.inertia.x, 0, 0],
        [0, record.inertia.y, 0],
        [0, 0, record.inertia.z],
      ],
      `checkpoint body ${String(record.partId)} principal inertia`,
    );
  } catch (cause) {
    invalid(code, "Checkpoint body inertia is nonphysical", path, cause);
  }
  for (const [field, index] of [
    ["x", 0],
    ["y", 1],
    ["z", 2],
  ])
    if (record.invInertia[field] !== 1 / moments[index])
      invalid(code, "Checkpoint inverse inertia is contradictory", path);
  if (record.invMass !== 1 / record.mass)
    invalid(code, "Checkpoint inverse mass is contradictory", path);
  if (
    !["x", "y", "z"].every(
      (field, index) =>
        record.massFrame.comPart[field] === properties.comPositionPartM[index],
    )
  )
    invalid(code, "Checkpoint center-of-mass frame is contradictory", path);
}

function validateCompiledBodyAuthority(record, expected, authority, path) {
  const code = "MULTIBODY_CHECKPOINT_PHYSICAL_AUTHORITY_MISMATCH",
    candidateProperties = record.massProperties,
    compiledProperties = authority.compiledMassProperties,
    expectedMassProperties =
      authority.expectedMassProperties ?? expected.massProperties;
  if (
    stableStringify(candidateProperties) !==
    stableStringify(expectedMassProperties)
  )
    invalid(
      code,
      "Checkpoint mass state disagrees with the reconstructed mass owner",
      [...path, "massProperties"],
    );
  try {
    validateRuntimeMassPropertiesAuthority(candidateProperties, {
      compiledProperties,
      partId: record.partId,
      dynamicMassContributorKinds: authority.dynamicMassContributorKinds,
    });
  } catch (cause) {
    invalid(
      code,
      "Checkpoint mass provenance changed",
      [...path, "massProperties"],
      cause,
    );
  }
  if (
    stableStringify(record.massFrame) !== stableStringify(authority.massFrame)
  )
    invalid(
      code,
      "Checkpoint center-of-mass and principal-axis frame disagrees with the reconstructed mass owner",
      [...path, "massFrame"],
    );
  if (
    record.shapeOffsets.length !== authority.shapeOffsets.length ||
    record.shapeOrientations.length !== authority.shapeOrientations.length ||
    record.shapeOffsets.some(
      (value, index) => !vectorsEqual(value, authority.shapeOffsets[index]),
    ) ||
    record.shapeOrientations.some(
      (value, index) =>
        stableStringify(value) !==
        stableStringify(authority.shapeOrientations[index]),
    )
  )
    invalid(
      "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
      "Checkpoint collision frames disagree with compiled geometry and mass authority",
      path,
    );
}

function validateBody(record, expected, index, bodyAuthorityFor) {
  const code = "INVALID_MULTIBODY_CHECKPOINT_BODY_STATE",
    path = ["bodies", index];
  exactKeys(record, BODY_FIELDS, code, path);
  if (record.partId !== expected.partId)
    invalid(code, "Checkpoint body identity changed", [...path, "partId"]);
  for (const field of [
    "position",
    "previousPosition",
    "interpolatedPosition",
    "velocity",
    "angularVelocity",
    "force",
    "torque",
  ])
    vector(record[field], code, [...path, field]);
  for (const field of [
    "quaternion",
    "previousQuaternion",
    "interpolatedQuaternion",
  ])
    quaternion(record[field], code, [...path, field]);
  finite(record.mass, code, [...path, "mass"], { min: Number.MIN_VALUE });
  finite(record.invMass, code, [...path, "invMass"], {
    min: Number.MIN_VALUE,
  });
  vector(record.inertia, code, [...path, "inertia"], { positive: true });
  vector(record.invInertia, code, [...path, "invInertia"], {
    positive: true,
  });
  exactKeys(record.massFrame, ["principalToPart", "comPart"], code, [
    ...path,
    "massFrame",
  ]);
  quaternion(record.massFrame.principalToPart, code, [
    ...path,
    "massFrame",
    "principalToPart",
  ]);
  vector(record.massFrame.comPart, code, [...path, "massFrame", "comPart"]);
  if (
    !Array.isArray(record.shapeOffsets) ||
    !Array.isArray(record.shapeOrientations) ||
    record.shapeOffsets.length !== expected.shapeOffsets.length ||
    record.shapeOrientations.length !== expected.shapeOrientations.length
  )
    invalid(
      "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
      "Checkpoint body shape-frame set changed",
      path,
    );
  record.shapeOffsets.forEach((value, shapeIndex) =>
    vector(value, code, [...path, "shapeOffsets", shapeIndex]),
  );
  record.shapeOrientations.forEach((value, shapeIndex) =>
    quaternion(value, code, [...path, "shapeOrientations", shapeIndex]),
  );
  finite(record.sleepState, code, [...path, "sleepState"], {
    min: 0,
    integer: true,
  });
  if (record.sleepState > 2)
    invalid(code, "Checkpoint body sleep state is invalid", path);
  finite(record.timeLastSleepy, code, [...path, "timeLastSleepy"], { min: 0 });
  validateMassAuthority(record, path);
  let authority;
  try {
    authority = bodyAuthorityFor(record);
  } catch (cause) {
    invalid(
      "MULTIBODY_CHECKPOINT_PHYSICAL_AUTHORITY_MISMATCH",
      "Checkpoint body authority cannot be reconstructed",
      path,
      cause,
    );
  }
  validateCompiledBodyAuthority(record, expected, authority, path);
}

function validateConstraint(
  record,
  expected,
  index,
  constraintValueFieldsById,
  committedTick,
  physicalAuthority,
) {
  const code = "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    path = ["entries", index];
  exactKeys(record, CONSTRAINT_FIELDS, code, path);
  if (record.id !== expected.id || record.kind !== expected.kind)
    invalid(code, "Checkpoint constraint identity or kind changed", path);
  exactKeys(record.values, constraintValueFieldsById.get(record.id), code, [
    ...path,
    "values",
  ]);
  for (const [field, value] of Object.entries(record.values)) {
    if (!CONSTRAINT_VALUE_FIELDS.includes(field))
      invalid(code, "Checkpoint constraint scalar field is unknown", [
        ...path,
        "values",
        field,
      ]);
    if (CONSTRAINT_BOOLEAN_FIELDS.has(field)) {
      if (typeof value !== "boolean")
        invalid(code, "Checkpoint constraint boolean is invalid", [
          ...path,
          "values",
          field,
        ]);
    } else if (CONSTRAINT_STRING_VALUES[field]) {
      if (!CONSTRAINT_STRING_VALUES[field].has(value))
        invalid(code, "Checkpoint constraint string is invalid", [
          ...path,
          "values",
          field,
        ]);
    } else if (
      (field === "clutchCoordinateM" || field === "commandTick") &&
      value === null
    )
      continue;
    else {
      const fieldPath = [...path, "values", field];
      finite(value, code, fieldPath, {
        min: CONSTRAINT_NONNEGATIVE_FIELDS.has(field) ? 0 : -Infinity,
      });
      if (CONSTRAINT_NONPOSITIVE_FIELDS.has(field) && value > 0)
        invalid(
          code,
          "Checkpoint dissipative constraint work or power must be non-positive",
          fieldPath,
        );
      if (field === "temperatureK" && value <= 0)
        invalid(
          code,
          "Checkpoint absolute temperature must be positive",
          fieldPath,
        );
      if (field === "thermalDerate" && (value < 0 || value > 1))
        invalid(
          code,
          "Checkpoint thermal derate must be within [0, 1]",
          fieldPath,
        );
      if (
        field === "commandTick" &&
        (!Number.isSafeInteger(value) || value < 0)
      )
        invalid(code, "Checkpoint command tick is invalid", fieldPath);
      if (
        field === "saturationCauseMask" &&
        (!Number.isSafeInteger(value) ||
          value < 0 ||
          (value & ~AXIAL_EFFORT_SATURATION_MASK) !== 0)
      )
        invalid(
          code,
          "Checkpoint axial-effort saturation mask is invalid",
          fieldPath,
        );
    }
  }
  if (typeof record.values.active !== "boolean")
    invalid(code, "Checkpoint constraint activity is invalid", path);
  if (
    record.values.actuatorDissipatedEnergyJ != null &&
    record.values.actuatorElectricalEnergyJ != null &&
    record.values.actuatorMechanicalWorkJ != null
  ) {
    const expectedDissipationJ =
        record.values.actuatorElectricalEnergyJ -
        record.values.actuatorMechanicalWorkJ,
      scaleJ = Math.max(
        1,
        Math.abs(record.values.actuatorDissipatedEnergyJ),
        Math.abs(expectedDissipationJ),
      ),
      toleranceJ = Math.max(1e-9, scaleJ * 1e-10);
    if (
      expectedDissipationJ < -toleranceJ ||
      Math.abs(record.values.actuatorDissipatedEnergyJ - expectedDissipationJ) >
        toleranceJ
    )
      invalid(
        code,
        "Checkpoint actuator ledger must conserve electrical input as net mechanical work plus dissipation",
        [...path, "values", "actuatorDissipatedEnergyJ"],
      );
  }
  if (
    record.values.thermalShutdown === true &&
    record.values.thermalDerate !== 0
  )
    invalid(
      code,
      "Checkpoint thermal shutdown contradicts its derate authority",
      [...path, "values", "thermalDerate"],
    );
  if (record.values.thermalShutdown === true && record.values.powered === true)
    invalid(code, "Checkpoint thermal shutdown cannot remain powered", [
      ...path,
      "values",
      "powered",
    ]);
  if (Object.hasOwn(record.values, "requestedForceN")) {
    const values = record.values,
      toleranceN = Math.max(
        1e-9,
        1e-10 *
          Math.max(
            1,
            Math.abs(values.requestedForceN),
            Math.abs(values.capacityLimitedForceN),
            Math.abs(values.appliedForceN),
            Math.abs(values.residualForceN),
          ),
      ),
      near = (left, right) => Math.abs(left - right) <= toleranceN,
      sameDirection = (bounded, requested) =>
        near(bounded, 0) || Math.sign(bounded) === Math.sign(requested);
    if (
      !near(
        values.residualForceN,
        values.requestedForceN - values.appliedForceN,
      ) ||
      Math.abs(values.capacityLimitedForceN) >
        Math.abs(values.requestedForceN) + toleranceN ||
      Math.abs(values.appliedForceN) >
        Math.abs(values.capacityLimitedForceN) + toleranceN ||
      !sameDirection(values.capacityLimitedForceN, values.requestedForceN) ||
      !sameDirection(values.appliedForceN, values.requestedForceN)
    )
      invalid(
        code,
        "Checkpoint axial-effort requested, capacity, applied, and residual forces are inconsistent",
        [...path, "values", "residualForceN"],
      );
    const current = values.commandValidity === "current",
      saturated = !near(values.residualForceN, 0),
      measuredRateMPerS = physicalAuthority?.kinematics?.rateMPerS;
    if (
      !Number.isFinite(measuredRateMPerS) ||
      !near(values.rateMPerS, measuredRateMPerS) ||
      (current &&
        (!["remote", "script"].includes(values.commandSource) ||
          !Number.isSafeInteger(values.commandTick) ||
          values.commandTick !== committedTick)) ||
      (!current &&
        (!near(values.requestedForceN, 0) ||
          !near(values.capacityLimitedForceN, 0) ||
          !near(values.appliedForceN, 0) ||
          !near(values.residualForceN, 0) ||
          values.powered)) ||
      values.saturated !== saturated ||
      saturated !== (values.saturationCauseMask !== 0)
    )
      invalid(
        code,
        "Checkpoint axial-effort command authority or saturation evidence is inconsistent",
        [...path, "values", "commandValidity"],
      );
  }
  if (expected.fixedFrame == null) {
    if (record.fixedFrame !== null)
      invalid(code, "Checkpoint constraint gained a fixed frame", path);
  } else {
    exactKeys(record.fixedFrame, FIXED_FRAME_FIELDS, code, [
      ...path,
      "fixedFrame",
    ]);
    for (const field of FIXED_FRAME_FIELDS)
      vector(record.fixedFrame[field], code, [...path, "fixedFrame", field]);
    if (
      FIXED_FRAME_FIELDS.some(
        (field) =>
          !vectorsEqual(record.fixedFrame[field], expected.fixedFrame[field]),
      )
    )
      invalid(
        "MULTIBODY_CHECKPOINT_FIXED_FRAME_MISMATCH",
        "Checkpoint fixed-constraint frame changed",
        [...path, "fixedFrame"],
      );
  }
  if (expected.tireState == null) {
    if (record.tireState !== null)
      invalid(code, "Checkpoint constraint gained tire state", path);
  } else {
    validateTireState(record.tireState, expected.tireState, code, [
      ...path,
      "tireState",
    ]);
  }
}

function sortedUniqueStrings(value, code, path) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry) ||
    new Set(value).size !== value.length ||
    value.some((entry, index) => index > 0 && value[index - 1] > entry)
  )
    invalid(code, "Checkpoint string identity array is invalid", path);
  return value;
}

function validateTireState(value, expected, code, path) {
  exactKeys(value, TIRE_STATE_FIELDS, code, path);
  if (typeof value.touching !== "boolean")
    invalid(code, "Checkpoint tire touching state is invalid", [
      ...path,
      "touching",
    ]);
  for (const field of TIRE_STATE_FIELDS.filter(
    (candidate) =>
      candidate !== "touching" &&
      candidate !== "pneumaticGasState" &&
      !TIRE_STRING_ARRAY_FIELDS.includes(candidate) &&
      candidate !== "supportMaterialLaws",
  )) {
    if (expected[field] === null) {
      if (value[field] !== null)
        invalid(code, "Checkpoint tire nullable scalar schema changed", [
          ...path,
          field,
        ]);
    } else
      finite(value[field], code, [...path, field], {
        min: TIRE_POSITIVE_FIELDS.has(field)
          ? Number.MIN_VALUE
          : TIRE_NONNEGATIVE_FIELDS.has(field)
            ? 0
            : -Infinity,
        integer: field === "manifoldPointCount",
      });
  }
  if (value.frictionEllipseUtilization > 1)
    invalid(code, "Checkpoint tire friction utilization exceeds unity", [
      ...path,
      "frictionEllipseUtilization",
    ]);
  if (expected.pneumaticGasState === null) {
    if (value.pneumaticGasState !== null)
      invalid(code, "Checkpoint tire gained pneumatic state", [
        ...path,
        "pneumaticGasState",
      ]);
  } else {
    exactKeys(
      value.pneumaticGasState,
      ["massKg", "internalEnergyJ", "volumeM3"],
      code,
      [...path, "pneumaticGasState"],
    );
    for (const field of ["massKg", "internalEnergyJ", "volumeM3"])
      finite(
        value.pneumaticGasState[field],
        code,
        [...path, "pneumaticGasState", field],
        { min: Number.MIN_VALUE },
      );
  }
  for (const field of TIRE_STRING_ARRAY_FIELDS)
    sortedUniqueStrings(value[field], code, [...path, field]);
  if (value.contactRoles.some((role) => !TIRE_CONTACT_ROLES.has(role)))
    invalid(code, "Checkpoint tire contact role is unknown", [
      ...path,
      "contactRoles",
    ]);
  if (!Array.isArray(value.supportMaterialLaws))
    invalid(code, "Checkpoint tire support material laws must be an array", [
      ...path,
      "supportMaterialLaws",
    ]);
  const materialKeys = [];
  for (const [index, law] of value.supportMaterialLaws.entries()) {
    const lawPath = [...path, "supportMaterialLaws", index];
    exactKeys(law, TIRE_SUPPORT_MATERIAL_LAW_FIELDS, code, lawPath);
    if (typeof law.materialKey !== "string" || !law.materialKey)
      invalid(code, "Checkpoint tire support material identity is invalid", [
        ...lawPath,
        "materialKey",
      ]);
    materialKeys.push(law.materialKey);
    for (const field of TIRE_SUPPORT_MATERIAL_LAW_FIELDS.slice(1)) {
      if (field === "foundationStiffnessNPerM" && law[field] === null) continue;
      finite(law[field], code, [...lawPath, field], { min: 0 });
    }
    if (law.restitutionCoefficient > 1)
      invalid(code, "Checkpoint tire restitution exceeds unity", [
        ...lawPath,
        "restitutionCoefficient",
      ]);
  }
  sortedUniqueStrings(materialKeys, code, [...path, "supportMaterialLaws"]);
  if (
    stableStringify(materialKeys) !== stableStringify(value.supportMaterialKeys)
  )
    invalid(code, "Checkpoint tire support material laws are contradictory", [
      ...path,
      "supportMaterialLaws",
    ]);
}

function validateIdentityNumberEntries(
  entries,
  label,
  { expectedIds = null, allowedIds = null, min = -Infinity } = {},
) {
  const code = "INVALID_MULTIBODY_CHECKPOINT_RUNTIME_STATE";
  if (!Array.isArray(entries))
    invalid(code, `Checkpoint ${label} must be an array`, [label]);
  const values = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2)
      invalid(code, `Checkpoint ${label} entry is invalid`, [label, index]);
    let id;
    try {
      id = canonicalId(entry[0]);
    } catch (cause) {
      invalid(
        code,
        `Checkpoint ${label} identity is invalid`,
        [label, index, 0],
        cause,
      );
    }
    if (values.has(id) || (allowedIds && !allowedIds.has(id)))
      invalid(code, `Checkpoint ${label} identities are invalid`, [
        label,
        index,
        0,
      ]);
    values.set(id, finite(entry[1], code, [label, index, 1], { min }));
  }
  if (
    expectedIds &&
    (values.size !== expectedIds.size ||
      [...expectedIds].some((id) => !values.has(id)))
  )
    invalid(code, `Checkpoint ${label} identity set changed`, [label]);
  return values;
}

function validateFluidState(state, compiledPartIds) {
  const code = "INVALID_MULTIBODY_CHECKPOINT_FLUID_STATE";
  if (state === null) return;
  exactKeys(state, FLUID_STATE_FIELDS, code, ["fluidState"]);
  if (
    state.active !== true ||
    typeof state.inWater !== "boolean" ||
    !Number.isSafeInteger(state.wetBodies) ||
    state.wetBodies < 0
  )
    invalid(code, "Checkpoint aggregate fluid state is invalid", [
      "fluidState",
    ]);
  for (const field of [
    "submergedFraction",
    "displacedVolumeM3",
    "buoyancyN",
    "hydrodynamicDragN",
    "waterDepth",
  ])
    finite(state[field], code, ["fluidState", field], { min: 0 });
  if (state.submergedFraction > 1)
    invalid(code, "Checkpoint submerged fraction exceeds unity", [
      "fluidState",
      "submergedFraction",
    ]);
  if (!Array.isArray(state.byPart))
    invalid(code, "Checkpoint per-part fluid state must be an array", [
      "fluidState",
      "byPart",
    ]);
  const ids = new Set();
  let previousId;
  for (const [index, record] of state.byPart.entries()) {
    const path = ["fluidState", "byPart", index];
    exactKeys(record, FLUID_PART_FIELDS, code, path);
    let partId;
    try {
      partId = canonicalId(record.partId);
    } catch (cause) {
      invalid(code, "Checkpoint fluid part identity is invalid", path, cause);
    }
    if (
      ids.has(partId) ||
      !compiledPartIds.has(partId) ||
      (index > 0 && compareCanonicalIds(previousId, partId) >= 0)
    )
      invalid(
        code,
        "Checkpoint fluid part identities are not exact and canonical",
        [...path, "partId"],
      );
    ids.add(partId);
    previousId = partId;
    for (const field of FLUID_PART_FIELDS.slice(1))
      finite(record[field], code, [...path, field], { min: 0 });
    if (record.submerged > 1)
      invalid(code, "Checkpoint part submerged fraction exceeds unity", [
        ...path,
        "submerged",
      ]);
  }
  if (ids.size !== compiledPartIds.size)
    invalid(code, "Checkpoint fluid state does not cover every physical part", [
      "fluidState",
      "byPart",
    ]);
}

/** Purely validates and detaches every direct multibody checkpoint field. */
export function validateMultibodyCheckpointState(
  state,
  {
    baseline,
    compiledPartIds,
    compiledBodyPartIds,
    compiledConnectionIds,
    bodyAuthorityFor,
    constraintValueFieldsById,
    collisionExclusionActiveFor,
    constraintKinematicsFor,
  },
) {
  const code = "INVALID_MULTIBODY_CHECKPOINT";
  state = requireInertPlainData(state, {
    code,
    message:
      "Multibody checkpoint must be serialized JSON or an exported immutable state",
    path: ["checkpoint"],
  });
  exactKeys(state, Object.keys(baseline), code, ["checkpoint"]);
  if (
    state.compiledPhysicalSemanticsFingerprint !==
    baseline.compiledPhysicalSemanticsFingerprint
  )
    invalid(
      "MULTIBODY_CHECKPOINT_PHYSICAL_SEMANTICS_MISMATCH",
      "Checkpoint physical semantics identity changed",
      ["compiledPhysicalSemanticsFingerprint"],
    );
  if (
    typeof state.axialEffortEnergyProjectionDigest !== "string" ||
    !/^axial-effort-energy-sha256-[0-9a-f]{64}$/.test(
      state.axialEffortEnergyProjectionDigest,
    )
  )
    invalid(
      "MULTIBODY_CHECKPOINT_AXIAL_ENERGY_PROJECTION_MISMATCH",
      "Checkpoint axial-effort energy projection changed",
      ["axialEffortEnergyProjectionDigest"],
    );
  if (
    state.version !== baseline.version ||
    state.fixedDt !== baseline.fixedDt ||
    state.sourceRevision !== baseline.sourceRevision ||
    state.solverStatePolicy !== baseline.solverStatePolicy
  )
    invalid(
      "MULTIBODY_CHECKPOINT_IDENTITY_MISMATCH",
      "Checkpoint runtime identities changed",
      ["checkpoint"],
    );
  exactKeys(state.world, ["time", "stepnumber"], code, ["world"]);
  finite(state.world.time, code, ["world", "time"], { min: 0 });
  finite(state.world.stepnumber, code, ["world", "stepnumber"], {
    min: 0,
    integer: true,
  });
  if (state.world.time !== state.world.stepnumber * state.fixedDt)
    invalid(
      "MULTIBODY_CHECKPOINT_WORLD_TIME_MISMATCH",
      "Checkpoint world time must derive exactly from step number and fixed timestep",
      ["world", "time"],
    );
  if (
    !Array.isArray(state.bodies) ||
    state.bodies.length !== baseline.bodies.length
  )
    invalid(
      "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
      "Checkpoint body set changed",
      ["bodies"],
    );
  const expectedBodies = new Map(
      baseline.bodies.map((record) => [record.partId, record]),
    ),
    bodyIds = new Set();
  for (const [index, record] of state.bodies.entries()) {
    const expected = expectedBodies.get(record?.partId);
    if (!expected || bodyIds.has(record.partId))
      invalid(
        "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
        "Checkpoint body identities are invalid",
        ["bodies", index, "partId"],
      );
    bodyIds.add(record.partId);
    validateBody(record, expected, index, bodyAuthorityFor);
  }
  if (bodyIds.size !== expectedBodies.size)
    invalid(
      "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
      "Checkpoint body set changed",
      ["bodies"],
    );

  if (
    !Array.isArray(state.entries) ||
    state.entries.length !== baseline.entries.length
  )
    invalid(
      "MULTIBODY_CHECKPOINT_CONSTRAINT_MISMATCH",
      "Checkpoint constraint set changed",
      ["entries"],
    );
  const expectedEntries = new Map(
      baseline.entries.map((record) => [record.id, record]),
    ),
    entryIds = new Set(),
    activeByConstraintId = new Map();
  for (const [index, record] of state.entries.entries()) {
    const expected = expectedEntries.get(record?.id);
    if (!expected || entryIds.has(record.id))
      invalid(
        "MULTIBODY_CHECKPOINT_CONSTRAINT_MISMATCH",
        "Checkpoint constraint identities are invalid",
        ["entries", index, "id"],
      );
    entryIds.add(record.id);
    validateConstraint(
      record,
      expected,
      index,
      constraintValueFieldsById,
      state.world.stepnumber,
      { kinematics: constraintKinematicsFor(record.id, state.bodies) },
    );
    activeByConstraintId.set(record.id, record.values.active);
  }

  if (!Array.isArray(state.exclusionStates))
    invalid(
      "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
      "Checkpoint exclusion set is missing",
      ["exclusionStates"],
    );
  const expectedExclusions = new Set(
      baseline.exclusionStates.map((record) => record.id),
    ),
    exclusionIds = new Set();
  if (state.exclusionStates.length !== expectedExclusions.size)
    invalid(
      "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
      "Checkpoint exclusion set changed",
      ["exclusionStates"],
    );
  for (const [index, record] of state.exclusionStates.entries()) {
    exactKeys(
      record,
      ["id", "active"],
      "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
      ["exclusionStates", index],
    );
    if (
      typeof record.id !== "string" ||
      !record.id ||
      typeof record.active !== "boolean"
    )
      invalid(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
        "Checkpoint exclusion state is invalid",
        ["exclusionStates", index],
      );
    if (exclusionIds.has(record.id) || !expectedExclusions.has(record.id))
      invalid(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
        "Checkpoint exclusion identities changed",
        ["exclusionStates", index, "id"],
      );
    exclusionIds.add(record.id);
    const required = collisionExclusionActiveFor(
      record.id,
      activeByConstraintId,
    );
    if (required === null || record.active !== required)
      invalid(
        "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_ACTIVITY_MISMATCH",
        "Checkpoint collision exclusions disagree with restored constraint topology",
        ["exclusionStates", index, "active"],
      );
  }

  validateIdentityNumberEntries(state.phaseByPart, "phaseByPart", {
    expectedIds: bodyIds,
  });
  validateIdentityNumberEntries(state.loadByConnection, "loadByConnection", {
    allowedIds: compiledConnectionIds,
    min: 0,
  });
  validateIdentityNumberEntries(
    state.torqueByConnection,
    "torqueByConnection",
    { allowedIds: compiledConnectionIds, min: 0 },
  );
  validateIdentityNumberEntries(
    state.motorElectricalWByPart,
    "motorElectricalWByPart",
    { allowedIds: compiledPartIds, min: 0 },
  );
  if (!Array.isArray(state.activeLuminairePartIds))
    invalid(code, "Checkpoint active luminaires must be an array", [
      "activeLuminairePartIds",
    ]);
  const activeLuminaires = new Set();
  for (const [index, value] of state.activeLuminairePartIds.entries()) {
    let id;
    try {
      id = canonicalId(value);
    } catch (cause) {
      invalid(
        code,
        "Checkpoint luminaire identity is invalid",
        ["activeLuminairePartIds", index],
        cause,
      );
    }
    if (activeLuminaires.has(id) || !compiledPartIds.has(id))
      invalid(code, "Checkpoint luminaire identities are invalid", [
        "activeLuminairePartIds",
        index,
      ]);
    activeLuminaires.add(id);
  }
  validateFluidState(state.fluidState, compiledBodyPartIds);
  finite(state.topologyRevision, code, ["topologyRevision"], {
    min: 0,
    integer: true,
  });
  return state;
}
