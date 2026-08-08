import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { componentDefinition } from "../model/component-contracts.js";
import {
  clonePlainMassPropertyData,
  validateRigidMemberMassProperties,
} from "../model/assembly-compiler-mass-properties.js";
import { isOwnedImmutable } from "../model/owned-immutable-value.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import {
  canonicalId,
  compiledId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteVector3,
  identitySetUsesTypedStrings,
  scopedIdentity,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";

const zeroVector = () => ({ x: 0, y: 0, z: 0 });
const identityQuaternion = () => ({ x: 0, y: 0, z: 0, w: 1 });
const loadTransactions = new WeakMap();
const bodyRecordReaders = new WeakMap();
const massPropertyCommitters = new WeakMap();
const checkpointRestoreValidators = new WeakMap();
const checkpointRestoreImporters = new WeakMap();
const frozenRevisionDigestCache = new WeakMap();
const BODY_CHECKPOINT_KEYS = Object.freeze([
  "bodyId",
  "acceleration",
  "contacts",
  "loads",
  "detached",
]);
const CONSTRAINT_CHECKPOINT_KEYS = Object.freeze(["constraintId", "detached"]);
const BODY_REGISTRY_AUTHORITY_FIELDS = Object.freeze([
  "partIds",
  "descriptors",
  "massProperties",
  "constraintIds",
  "bound",
  "thermal",
]);

function revisionGraphValue(value, path = [], ancestors = new Map()) {
  if (value === null) return ["null"];
  if (typeof value === "boolean" || typeof value === "string")
    return [typeof value, value];
  if (typeof value === "number")
    return [
      "number",
      Number.isNaN(value)
        ? "NaN"
        : value === Infinity
          ? "+Infinity"
          : value === -Infinity
            ? "-Infinity"
            : Object.is(value, -0)
              ? "-0"
              : String(value),
    ];
  if (typeof value === "undefined") return ["undefined"];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (typeof value === "symbol")
    return ["symbol", Symbol.keyFor(value) ?? null, value.description ?? null];
  if (typeof value === "function")
    return ["function", Function.prototype.toString.call(value)];
  const ancestorPath = ancestors.get(value);
  if (ancestorPath) return ["cycle-reference", ancestorPath];
  ancestors.set(value, path);
  try {
    if (Array.isArray(value))
      return [
        "array",
        value.map((child, index) =>
          revisionGraphValue(child, [...path, index], ancestors),
        ),
      ];
    if (value instanceof Date) return ["date", String(value.getTime())];
    if (value instanceof RegExp)
      return ["regexp", value.source, value.flags, value.lastIndex];
    if (value instanceof Map)
      return [
        "map",
        [...value].map(([key, child], index) => [
          revisionGraphValue(key, [...path, `map-key-${index}`], ancestors),
          revisionGraphValue(child, [...path, `map-value-${index}`], ancestors),
        ]),
      ];
    if (value instanceof Set)
      return [
        "set",
        [...value].map((child, index) =>
          revisionGraphValue(child, [...path, `set-${index}`], ancestors),
        ),
      ];
    if (value instanceof ArrayBuffer)
      return ["array-buffer", [...new Uint8Array(value)]];
    if (ArrayBuffer.isView(value))
      return [
        value.constructor.name,
        [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)],
      ];
    const prototype = Object.getPrototypeOf(value),
      prototypeName = prototype?.constructor?.name || null;
    return [
      "object",
      prototypeName,
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          revisionGraphValue(value[key], [...path, key], ancestors),
        ]),
    ];
  } finally {
    ancestors.delete(value);
  }
}

function revisionSerialization(value) {
  try {
    return `plain:${stableStringify(value)}`;
  } catch {
    // Live telemetry intentionally tolerates structured-clone graphs even
    // when they cannot cross a JSON checkpoint boundary. Preserve a stable
    // content identity for those snapshots without weakening checkpoint
    // validation, and expand non-cyclic aliases as stableStringify does.
    return `structured-graph:${stableStringify(revisionGraphValue(value))}`;
  }
}

function revisionDigest(value) {
  if (value && typeof value === "object" && Object.isFrozen(value)) {
    const cached = frozenRevisionDigestCache.get(value);
    if (cached) return cached;
    const digest = sha256Hex(revisionSerialization(value));
    frozenRevisionDigestCache.set(value, digest);
    return digest;
  }
  return sha256Hex(revisionSerialization(value));
}

function bodyRevisionRecord(body) {
  return {
    bodyId: body.bodyId,
    authorityDigests: {
      partIds: revisionDigest(body.partIds),
      descriptors: revisionDigest(body.descriptors),
      massProperties: revisionDigest(body.massProperties),
      constraintIds: revisionDigest(body.constraintIds),
    },
    pose: body.pose,
    velocity: body.velocity,
    angularVelocity: body.angularVelocity,
    acceleration: body.acceleration,
    contacts: body.contacts,
    loads: body.loads,
    thermal: body.thermal,
    detached: body.detached,
    bound: body.bound,
  };
}

function bodyRegistryStateRevision({
  tick,
  bodies,
  bodyByPart,
  constraints,
  constraintByPart,
}) {
  const typedKey = (value) => `${typeof value}:${String(value)}`,
    compareBy = (field) => (left, right) =>
      typedKey(left[field]).localeCompare(typedKey(right[field]), "en");
  return `body-registry-sha256-${sha256Hex(
    revisionSerialization({
      version: 2,
      tick,
      bodies: [...bodies].sort(compareBy("bodyId")).map(bodyRevisionRecord),
      bodyByPart: [...bodyByPart].sort((left, right) => {
        const partOrder = typedKey(left.partId).localeCompare(
          typedKey(right.partId),
          "en",
        );
        return (
          partOrder ||
          typedKey(left.bodyId).localeCompare(typedKey(right.bodyId), "en")
        );
      }),
      constraints: [...constraints].sort(compareBy("constraintId")),
      constraintByPart: [...constraintByPart].sort(compareBy("partId")),
    }),
  )}`;
}

function contentRevisionSequence(revision) {
  const digest = String(revision).replace(/^body-registry-sha256-/u, "");
  return Number.parseInt(digest.slice(0, 12), 16);
}

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function checkpointVectorIsFinite(value) {
  return Boolean(
    value &&
    checkpointKeysMatch(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    ),
  );
}

function freezeFreshBodyValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeFreshBodyValue(child, seen);
  return Object.freeze(value);
}

// Existing body members are already immutable. Freeze only the fresh patch
// before replacing the shallow record; recursively walking unchanged geometry
// and prior samples at 120 Hz is redundant and becomes quadratic.
function updateFrozenBody(body, patch) {
  return Object.freeze({ ...body, ...freezeFreshBodyValue(patch) });
}

/** Internal fixed-step batch boundary; intentionally absent from Core. */
export function recordBodyLoads(registry, id, loads) {
  const record = loadTransactions.get(registry);
  if (!record)
    throw new TypeError("BodyRegistry load transaction is unavailable");
  return record(id, loads);
}

/** Package-internal immutable body view; intentionally absent from Core. */
export function bodyRegistryBodyRecords(registry) {
  const read = bodyRecordReaders.get(registry);
  if (!read) throw new TypeError("BodyRegistry body view is unavailable");
  return read();
}

/** Package-internal owner port; intentionally absent from Core exports. */
export function commitBodyRegistryMassProperties(registry, records) {
  const commit = massPropertyCommitters.get(registry);
  if (!commit)
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_REQUIRED",
      "Body registry mass mutation requires its registered owner port",
    );
  return commit(records);
}

/** Package-internal coordinator port; intentionally absent from Core exports. */
export function validateBodyRegistryCheckpointStateForRestore(registry, state) {
  const validate = checkpointRestoreValidators.get(registry);
  if (!validate)
    throw new DomainValidationError(
      "BODY_REGISTRY_CHECKPOINT_OWNER_REQUIRED",
      "Body-registry checkpoint reconstruction requires its live owner",
    );
  return validate(state);
}

/** Package-internal coordinator port; intentionally absent from Core exports. */
export function importBodyRegistryCheckpointStateForRestore(registry, state) {
  const restore = checkpointRestoreImporters.get(registry);
  if (!restore)
    throw new DomainValidationError(
      "BODY_REGISTRY_CHECKPOINT_OWNER_REQUIRED",
      "Body-registry checkpoint reconstruction requires its live owner",
    );
  return restore(state);
}

function vector(value, path) {
  const source = Array.isArray(value)
    ? value
    : [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
  const [x, y, z] = finiteVector3(source, { path });
  return { x, y, z };
}

function evidenceValidity(value, fallback = "unavailable") {
  return ["measured", "derived", "unavailable", "truncated"].includes(value)
    ? value
    : fallback;
}

function quaternion(value, path) {
  const result = {
    x: finiteNumber(value?.x ?? 0, { path: [...path, "x"] }),
    y: finiteNumber(value?.y ?? 0, { path: [...path, "y"] }),
    z: finiteNumber(value?.z ?? 0, { path: [...path, "z"] }),
    w: finiteNumber(value?.w ?? 1, { path: [...path, "w"] }),
  };
  const length = Math.hypot(result.x, result.y, result.z, result.w);
  if (length < 1e-9)
    throw new DomainValidationError(
      "INVALID_QUATERNION",
      "Body orientation quaternion cannot be zero length",
      { path },
    );
  return {
    x: result.x / length,
    y: result.y / length,
    z: result.z / length,
    w: result.w / length,
  };
}

const BODY_CHECKPOINT_FIELDS = Object.freeze([
  "bodyId",
  "partIds",
  "descriptors",
  "pose",
  "velocity",
  "angularVelocity",
  "acceleration",
  "contacts",
  "loads",
  "thermal",
  "massProperties",
  "constraintIds",
  "detached",
  "bound",
]);
const CONSTRAINT_CHECKPOINT_FIELDS = Object.freeze([
  "constraintId",
  "partId",
  "sourceConnectionIds",
  "pose",
  "angle",
  "angularVelocity",
  "reactionTorque",
  "detached",
  "bound",
]);
const CONTACT_CHECKPOINT_FIELDS = Object.freeze([
  "tick",
  "contactId",
  "point",
  "normal",
  "forceN",
  "impulseNs",
  "relativeVelocity",
  "forceWorldN",
  "otherBodyId",
  "otherMaterialKey",
  "otherShapeId",
  "supportShapeId",
  "surfaceRegionId",
  "featureId",
  "featureValidity",
  "tireEvidence",
  "validity",
  "surface",
]);
const TIRE_EVIDENCE_CHECKPOINT_FIELDS = Object.freeze([
  "wheelIsA",
  "contactNormalWorld",
  "tirePartId",
  "rawPointWorldM",
  "correctedPointWorldM",
  "correctionWorldM",
  "requiredCorrectionM",
  "appliedCorrectionM",
  "geometricToleranceM",
  "withinGeometricTolerance",
  "validity",
  "manifoldId",
  "supportFeatureId",
  "supportValidity",
  "tireForceRowIds",
]);
const EVIDENCE_VALIDITIES = Object.freeze([
  "measured",
  "derived",
  "unavailable",
  "truncated",
]);

function checkpointFailure(message, path, cause) {
  throw new DomainValidationError(
    "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
    message,
    { path, cause },
  );
}

function checkpointKeys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    checkpointFailure(
      "Body registry checkpoint record must be an object",
      path,
    );
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    checkpointFailure(
      "Body registry checkpoint record must be a plain object",
      path,
    );
  const actual = Object.keys(value).sort(),
    required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  )
    checkpointFailure(
      "Body registry checkpoint record has an invalid field set",
      path,
    );
  return value;
}

function checkpointFinite(
  value,
  path,
  { min = -Infinity, integer = false } = {},
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isSafeInteger(value))
  )
    checkpointFailure("Body registry checkpoint number is invalid", path);
  return value;
}

function checkpointVector(value, path) {
  checkpointKeys(value, ["x", "y", "z"], path);
  for (const field of ["x", "y", "z"])
    checkpointFinite(value[field], [...path, field]);
  return value;
}

function checkpointQuaternion(value, path) {
  checkpointKeys(value, ["x", "y", "z", "w"], path);
  for (const field of ["x", "y", "z", "w"])
    checkpointFinite(value[field], [...path, field]);
  if (Math.abs(Math.hypot(value.x, value.y, value.z, value.w) - 1) > 1e-9)
    checkpointFailure(
      "Body registry checkpoint quaternion must have unit length",
      path,
    );
  return value;
}

function checkpointJson(value, path, ancestors = new WeakSet()) {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return checkpointFinite(value, path);
  if (typeof value !== "object")
    checkpointFailure("Body registry checkpoint must contain JSON data", path);
  if (ancestors.has(value))
    checkpointFailure("Body registry checkpoint cannot be cyclic", path);
  ancestors.add(value);
  if (Array.isArray(value))
    for (const [index, child] of value.entries())
      checkpointJson(child, [...path, index], ancestors);
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      checkpointFailure(
        "Body registry checkpoint must contain plain JSON data",
        path,
      );
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined)
        checkpointFailure("Body registry checkpoint cannot contain undefined", [
          ...path,
          key,
        ]);
      checkpointJson(child, [...path, key], ancestors);
    }
  }
  ancestors.delete(value);
  return value;
}

function checkpointCanonicalId(value, path) {
  try {
    return canonicalId(value, { path });
  } catch (cause) {
    checkpointFailure(
      "Body registry checkpoint part ID is invalid",
      path,
      cause,
    );
  }
}

function checkpointCompiledId(value, path) {
  try {
    return compiledId(value, { path });
  } catch (cause) {
    checkpointFailure(
      "Body registry checkpoint compiled ID is invalid",
      path,
      cause,
    );
  }
}

function checkpointPose(value, path) {
  checkpointKeys(value, ["position", "quaternion"], path);
  checkpointVector(value.position, [...path, "position"]);
  checkpointQuaternion(value.quaternion, [...path, "quaternion"]);
}

function checkpointMassProperties(value, bodyId, path) {
  if (value === null) return;
  try {
    validateRigidMemberMassProperties(value, bodyId);
  } catch (cause) {
    checkpointFailure(
      "Body registry checkpoint mass properties are invalid",
      path,
      cause,
    );
  }
  if (
    !(value.massKg > 0) ||
    value.principalMomentsKgM2.some((moment) => !(moment > 0))
  )
    checkpointFailure(
      "Body registry checkpoint mass properties are nonphysical",
      path,
    );
}

function checkpointNullableString(value, path) {
  if (value !== null && (typeof value !== "string" || value.length === 0))
    checkpointFailure(
      "Body registry checkpoint identity must be null or a non-empty string",
      path,
    );
  return value;
}

function checkpointEntityId(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!(
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ))
    checkpointFailure("Body registry checkpoint entity ID is invalid", path);
  return value;
}

function checkpointEvidenceValidity(value, path) {
  if (!EVIDENCE_VALIDITIES.includes(value))
    checkpointFailure(
      "Body registry checkpoint evidence validity is invalid",
      path,
    );
  return value;
}

function checkpointFeatureId(value, path) {
  if (value === null) return value;
  if (typeof value === "string" && value.length > 0) return value;
  checkpointKeys(value, ["cellX", "cellZ", "triangle"], path);
  checkpointFinite(value.cellX, [...path, "cellX"], {
    min: 0,
    integer: true,
  });
  checkpointFinite(value.cellZ, [...path, "cellZ"], {
    min: 0,
    integer: true,
  });
  if (!new Set(["upper", "lower"]).has(value.triangle))
    checkpointFailure("Body registry checkpoint terrain feature is invalid", [
      ...path,
      "triangle",
    ]);
  return value;
}

function checkpointTireEvidence(value, path) {
  if (value === null) return value;
  checkpointKeys(value, TIRE_EVIDENCE_CHECKPOINT_FIELDS, path);
  if (typeof value.wheelIsA !== "boolean")
    checkpointFailure("Tire evidence side is invalid", [...path, "wheelIsA"]);
  for (const field of [
    "contactNormalWorld",
    "rawPointWorldM",
    "correctedPointWorldM",
    "correctionWorldM",
  ])
    checkpointVector(value[field], [...path, field]);
  checkpointEntityId(value.tirePartId, [...path, "tirePartId"], {
    nullable: true,
  });
  for (const field of [
    "requiredCorrectionM",
    "appliedCorrectionM",
    "geometricToleranceM",
  ])
    checkpointFinite(value[field], [...path, field], { min: 0 });
  if (
    typeof value.withinGeometricTolerance !== "boolean" ||
    value.appliedCorrectionM > value.requiredCorrectionM ||
    value.withinGeometricTolerance !==
      value.requiredCorrectionM <= value.geometricToleranceM ||
    (value.withinGeometricTolerance &&
      value.appliedCorrectionM !== value.requiredCorrectionM)
  )
    checkpointFailure("Tire evidence correction state is unreachable", path);
  checkpointEvidenceValidity(value.validity, [...path, "validity"]);
  checkpointEvidenceValidity(value.supportValidity, [
    ...path,
    "supportValidity",
  ]);
  checkpointNullableString(value.manifoldId, [...path, "manifoldId"]);
  if (value.manifoldId === null)
    checkpointFailure("Tire evidence manifold identity is required", [
      ...path,
      "manifoldId",
    ]);
  checkpointFeatureId(value.supportFeatureId, [...path, "supportFeatureId"]);
  if (
    !Array.isArray(value.tireForceRowIds) ||
    value.tireForceRowIds.some(
      (rowId) => typeof rowId !== "string" || rowId.length === 0,
    ) ||
    new Set(value.tireForceRowIds).size !== value.tireForceRowIds.length
  )
    checkpointFailure("Tire evidence row identities are invalid", [
      ...path,
      "tireForceRowIds",
    ]);
  return value;
}

function checkpointContact(contact, path, expectedTick = null) {
  checkpointKeys(contact, CONTACT_CHECKPOINT_FIELDS, path);
  checkpointFinite(contact.tick, [...path, "tick"], {
    min: 0,
    integer: true,
  });
  if (expectedTick !== null && contact.tick !== expectedTick)
    checkpointFailure(
      "Body contact evidence must belong to the checkpoint tick",
      [...path, "tick"],
    );
  for (const field of ["point", "normal", "relativeVelocity", "forceWorldN"])
    checkpointVector(contact[field], [...path, field]);
  checkpointFinite(contact.forceN, [...path, "forceN"], { min: 0 });
  checkpointFinite(contact.impulseNs, [...path, "impulseNs"], { min: 0 });
  checkpointNullableString(contact.contactId, [...path, "contactId"]);
  checkpointNullableString(contact.otherBodyId, [...path, "otherBodyId"]);
  for (const field of [
    "otherMaterialKey",
    "otherShapeId",
    "supportShapeId",
    "surfaceRegionId",
    "surface",
  ])
    checkpointNullableString(contact[field], [...path, field]);
  checkpointFeatureId(contact.featureId, [...path, "featureId"]);
  checkpointEvidenceValidity(contact.featureValidity, [
    ...path,
    "featureValidity",
  ]);
  checkpointTireEvidence(contact.tireEvidence, [...path, "tireEvidence"]);
  checkpointEvidenceValidity(contact.validity, [...path, "validity"]);
  for (const axis of ["x", "y", "z"])
    if (contact.forceWorldN[axis] !== contact.normal[axis] * contact.forceN)
      checkpointFailure(
        "Body contact force vector contradicts its normal and magnitude",
        [...path, "forceWorldN", axis],
      );
  return contact;
}

function checkpointLoad(load, path, knownConnectionIds = null) {
  checkpointKeys(load, ["connectionId", "forceN", "torqueNm"], path);
  checkpointEntityId(load.connectionId, [...path, "connectionId"]);
  if (knownConnectionIds && !knownConnectionIds.has(load.connectionId))
    checkpointFailure(
      "Body load refers to a connection outside the running topology",
      [...path, "connectionId"],
    );
  checkpointFinite(load.forceN, [...path, "forceN"], { min: 0 });
  checkpointFinite(load.torqueNm, [...path, "torqueNm"], { min: 0 });
  return load;
}

function checkpointBody(body, expected, index, knownConnectionIds) {
  const path = ["checkpoint", "bodies", index];
  checkpointKeys(body, BODY_CHECKPOINT_FIELDS, path);
  if (body.bodyId !== expected.bodyId)
    checkpointFailure("Body registry checkpoint body ID changed", path);
  if (
    !Array.isArray(body.partIds) ||
    body.partIds.some(
      (partId, partIndex) =>
        checkpointCanonicalId(partId, [...path, "partIds", partIndex]) == null,
    ) ||
    new Set(body.partIds).size !== body.partIds.length ||
    stableStringify(body.partIds) !== stableStringify(expected.partIds) ||
    stableStringify(body.descriptors) !== stableStringify(expected.descriptors)
  )
    checkpointFailure("Body registry checkpoint body authority changed", path);
  checkpointPose(body.pose, [...path, "pose"]);
  for (const field of ["velocity", "angularVelocity", "acceleration"])
    checkpointVector(body[field], [...path, field]);
  if (!Array.isArray(body.contacts) || !Array.isArray(body.loads))
    checkpointFailure("Body registry checkpoint samples must be arrays", path);
  for (const [contactIndex, contact] of body.contacts.entries())
    checkpointContact(contact, [...path, "contacts", contactIndex]);
  for (const [loadIndex, load] of body.loads.entries())
    checkpointLoad(load, [...path, "loads", loadIndex], knownConnectionIds);
  checkpointJson(body.thermal, [...path, "thermal"]);
  checkpointMassProperties(body.massProperties, body.bodyId, [
    ...path,
    "massProperties",
  ]);
  if (
    stableStringify(body.massProperties) !==
    stableStringify(expected.massProperties)
  )
    checkpointFailure(
      "Body registry checkpoint mass authority disagrees with the reconstructed physics projection",
      [...path, "massProperties"],
    );
  if (!Array.isArray(body.constraintIds))
    checkpointFailure(
      "Body registry checkpoint constraint IDs must be an array",
      [...path, "constraintIds"],
    );
  const constraintIds = new Set();
  for (const [constraintIndex, constraintId] of body.constraintIds.entries()) {
    const id = checkpointCompiledId(constraintId, [
      ...path,
      "constraintIds",
      constraintIndex,
    ]);
    if (constraintIds.has(id))
      checkpointFailure(
        "Body registry checkpoint constraint IDs must be unique",
        [...path, "constraintIds", constraintIndex],
      );
    constraintIds.add(id);
  }
  if (
    stableStringify(body.constraintIds) !==
    stableStringify(expected.constraintIds)
  )
    checkpointFailure(
      "Body registry checkpoint physical constraint linkage changed",
      [...path, "constraintIds"],
    );
  if (typeof body.detached !== "boolean" || typeof body.bound !== "boolean")
    checkpointFailure("Body registry checkpoint body flags are invalid", path);
  return deepFreeze(structuredClone(body));
}

function checkpointConstraint(constraint, expected, index) {
  const path = ["checkpoint", "constraints", index];
  checkpointKeys(constraint, CONSTRAINT_CHECKPOINT_FIELDS, path);
  if (
    constraint.constraintId !== expected.constraintId ||
    constraint.partId !== expected.partId ||
    stableStringify(constraint.sourceConnectionIds) !==
      stableStringify(expected.sourceConnectionIds)
  )
    checkpointFailure(
      "Body registry checkpoint constraint authority changed",
      path,
    );
  checkpointPose(constraint.pose, [...path, "pose"]);
  checkpointFinite(constraint.angle, [...path, "angle"]);
  checkpointFinite(constraint.angularVelocity, [...path, "angularVelocity"]);
  checkpointFinite(constraint.reactionTorque, [...path, "reactionTorque"], {
    min: 0,
  });
  if (
    typeof constraint.detached !== "boolean" ||
    typeof constraint.bound !== "boolean"
  )
    checkpointFailure(
      "Body registry checkpoint constraint flags are invalid",
      path,
    );
  return deepFreeze(structuredClone(constraint));
}

function initialBody(bodyId, partIds, descriptors) {
  return {
    bodyId,
    partIds: [...partIds],
    descriptors: structuredClone(descriptors),
    pose: { position: zeroVector(), quaternion: identityQuaternion() },
    velocity: zeroVector(),
    angularVelocity: zeroVector(),
    acceleration: zeroVector(),
    contacts: [],
    loads: [],
    thermal: {},
    massProperties: null,
    constraintIds: [],
    detached: false,
    bound: false,
  };
}

/**
 * Engine-neutral registry mapping every physical part ID to exactly one body.
 * Cannon references are private adapter handles and never enter telemetry.
 */
export class BodyRegistry {
  #bodies = new Map();
  #bodyByPart = new Map();
  #engineBodies = new Map();
  #constraints = new Map();
  #constraintByPart = new Map();
  #knownConnectionIds = new Set();
  #revision = 0;
  #tick = 0;
  #snapshotRevision = -1;
  #snapshotTick = -1;
  #snapshot = null;

  constructor(snapshot = {}, catalog) {
    const parts = snapshot.parts || [],
      connections = snapshot.connections || [],
      partIds = new Set();
    for (const [index, part] of parts.entries()) {
      const partId = canonicalId(part?.id, {
        path: ["parts", index, "id"],
      });
      if (partIds.has(partId))
        throw new DomainValidationError(
          "DUPLICATE_PART_ID",
          `Duplicate part ID ${String(partId)}`,
          {
            path: ["parts", index, "id"],
            details: { id: partId },
          },
        );
      partIds.add(partId);
    }
    for (const [index, connection] of connections.entries()) {
      const connectionId = canonicalId(connection?.id, {
        path: ["connections", index, "id"],
      });
      if (this.#knownConnectionIds.has(connectionId))
        throw new DomainValidationError(
          "DUPLICATE_CONNECTION_ID",
          `Duplicate connection ID ${String(connectionId)}`,
          {
            path: ["connections", index, "id"],
            details: { id: connectionId },
          },
        );
      this.#knownConnectionIds.add(connectionId);
    }
    const partIdsUseTypedStrings = identitySetUsesTypedStrings([...partIds]);
    for (const part of parts) {
      const bodyId = scopedIdentity("part", part.id, {
          typedStrings: partIdsUseTypedStrings,
        }),
        descriptor = componentDefinition(part, catalog)?.flexibleLine
          ? { kind: "flexible-line-source-v1", sourcePartId: part.id }
          : geometryDescriptorForPart(part, catalog);
      this.#bodies.set(
        bodyId,
        deepFreeze(initialBody(bodyId, [part.id], [descriptor])),
      );
      this.#bodyByPart.set(part.id, new Set([bodyId]));
    }
    loadTransactions.set(this, (id, loads) => this.#recordLoads(id, loads));
    bodyRecordReaders.set(this, () =>
      Object.freeze([...this.#bodies.values()]),
    );
    massPropertyCommitters.set(this, (records) =>
      this.#commitMassProperties(records),
    );
    checkpointRestoreValidators.set(this, (state) =>
      this.#validateCheckpointState(state),
    );
    checkpointRestoreImporters.set(this, (state) =>
      this.#importCheckpointState(state),
    );
  }

  /** Owner-issued runtime change token. Serialized state has a content digest. */
  get revision() {
    return this.#revision;
  }

  get tick() {
    return this.#tick;
  }

  beginTick(tick = this.#tick + 1) {
    this.#tick = finiteNumber(tick, { min: 0, path: ["tick"] });
    for (const [id, body] of this.#bodies)
      this.#bodies.set(id, updateFrozenBody(body, { contacts: [], loads: [] }));
  }

  registerBody(bodyId, partIds, options = {}) {
    const {
      engineBody = null,
      constraintIds = [],
      pose = null,
      massProperties = null,
    } = /** @type {any} */ (options);
    const id = compiledId(bodyId),
      ids = [...new Set(partIds || [])];
    if (!ids.length)
      throw new DomainValidationError(
        "EMPTY_BODY_MEMBERSHIP",
        "A body must own at least one component",
      );
    const existingTarget = this.#bodies.get(id);
    if (
      existingTarget &&
      existingTarget.partIds.some((partId) => !ids.includes(partId))
    )
      throw new DomainValidationError(
        "BODY_ID_ALREADY_BOUND",
        `Body ID ${String(id)} is already bound to different components`,
        { details: { bodyId: id, partIds: [...existingTarget.partIds] } },
      );
    const descriptors = [],
      sourceBodies = new Map();
    for (const partId of ids) {
      canonicalId(partId);
      const previousBodyId = this.#singleBodyIdForPart(partId);
      if (!previousBodyId)
        throw new DomainValidationError(
          "UNKNOWN_BODY_PART",
          `Part ${String(partId)} is not registered`,
        );
      const previousBody = this.#bodies.get(previousBodyId),
        index = previousBody.partIds.indexOf(partId);
      descriptors.push(previousBody.descriptors[index]);
      sourceBodies.set(previousBodyId, previousBody);
    }
    const body = initialBody(id, ids, descriptors);
    body.bound = true;
    body.constraintIds = [...new Set(constraintIds)];
    body.massProperties = massProperties
      ? structuredClone(massProperties)
      : null;
    if (pose)
      body.pose = {
        position: vector(pose.position, ["body", id, "position"]),
        quaternion: quaternion(pose.quaternion, ["body", id, "quaternion"]),
      };
    const nextBody = deepFreeze(body),
      selectedPartIds = new Set(ids),
      sourceReplacements = new Map();
    for (const [previousBodyId, previousBody] of sourceBodies) {
      const nextPartIds = [],
        nextDescriptors = [];
      for (let index = 0; index < previousBody.partIds.length; index++) {
        if (selectedPartIds.has(previousBody.partIds[index])) continue;
        nextPartIds.push(previousBody.partIds[index]);
        nextDescriptors.push(previousBody.descriptors[index]);
      }
      sourceReplacements.set(
        previousBodyId,
        nextPartIds.length
          ? deepFreeze({
              ...previousBody,
              partIds: nextPartIds,
              descriptors: nextDescriptors,
            })
          : null,
      );
    }
    for (const [previousBodyId, replacement] of sourceReplacements) {
      if (replacement) this.#bodies.set(previousBodyId, replacement);
      else {
        this.#bodies.delete(previousBodyId);
        this.#engineBodies.delete(previousBodyId);
      }
    }
    this.#bodies.set(id, nextBody);
    for (const partId of ids) this.#bodyByPart.set(partId, new Set([id]));
    if (engineBody) this.#engineBodies.set(id, engineBody);
    this.#revision++;
    return this.body(id);
  }

  registerPhysicalEntities(partId, entities) {
    const canonicalPartId = canonicalId(partId),
      currentIds = this.#bodyByPart.get(canonicalPartId);
    if (!currentIds)
      throw new DomainValidationError(
        "UNKNOWN_BODY_PART",
        `Part ${String(canonicalPartId)} is not registered`,
      );
    if (!Array.isArray(entities) || !entities.length)
      throw new DomainValidationError(
        "EMPTY_PHYSICAL_ENTITY_SET",
        `Part ${String(canonicalPartId)} requires at least one physical entity`,
      );
    for (const bodyId of currentIds) {
      const previous = this.#bodies.get(bodyId);
      if (
        previous &&
        (previous.partIds.length !== 1 ||
          previous.partIds[0] !== canonicalPartId)
      )
        throw new DomainValidationError(
          "PHYSICAL_ENTITY_PART_ALREADY_GROUPED",
          `Part ${String(canonicalPartId)} is already grouped with another part`,
        );
    }
    const nextIds = new Set(),
      nextRecords = [];
    for (const [index, entity] of entities.entries()) {
      const id = compiledId(entity?.bodyId);
      if ((this.#bodies.has(id) && !currentIds.has(id)) || nextIds.has(id))
        throw new DomainValidationError(
          "DUPLICATE_PHYSICAL_ENTITY",
          `Physical entity ${String(id)} is already registered`,
        );
      const record = initialBody(
        id,
        [canonicalPartId],
        [
          structuredClone(
            entity.descriptor || {
              kind: "physical-entity-v1",
              sourcePartId: canonicalPartId,
              entityIndex: index,
            },
          ),
        ],
      );
      record.bound = true;
      record.constraintIds = [...new Set(entity.constraintIds || [])];
      record.massProperties = entity.massProperties
        ? structuredClone(entity.massProperties)
        : null;
      if (entity.pose)
        record.pose = {
          position: vector(entity.pose.position, ["body", id, "position"]),
          quaternion: quaternion(entity.pose.quaternion, [
            "body",
            id,
            "quaternion",
          ]),
        };
      nextRecords.push({
        id,
        record: deepFreeze(record),
        engineBody: entity.engineBody || null,
      });
      nextIds.add(id);
    }
    for (const bodyId of currentIds) {
      this.#bodies.delete(bodyId);
      this.#engineBodies.delete(bodyId);
    }
    for (const { id, record, engineBody } of nextRecords) {
      this.#bodies.set(id, record);
      if (engineBody) this.#engineBodies.set(id, engineBody);
    }
    this.#bodyByPart.set(canonicalPartId, nextIds);
    this.#revision++;
    return this.bodiesForPart(canonicalPartId);
  }

  registerConstraint(constraintId, partId, options = {}) {
    const id = compiledId(constraintId),
      canonicalPartId = canonicalId(partId),
      previousBodyId = this.#singleBodyIdForPart(canonicalPartId);
    if (!previousBodyId)
      throw new DomainValidationError(
        "UNKNOWN_CONSTRAINT_PART",
        `Part ${String(canonicalPartId)} is not available for constraint binding`,
      );
    const existingConstraint = this.#constraints.get(id);
    if (existingConstraint && existingConstraint.partId !== canonicalPartId)
      throw new DomainValidationError(
        "CONSTRAINT_ID_ALREADY_BOUND",
        `Constraint ${String(id)} is already bound to another part`,
      );
    const previousBody = this.#bodies.get(previousBodyId),
      index = previousBody.partIds.indexOf(canonicalPartId),
      nextPartIds = previousBody.partIds.filter(
        (candidate) => candidate !== canonicalPartId,
      ),
      nextDescriptors = previousBody.descriptors.filter(
        (_, descriptorIndex) => descriptorIndex !== index,
      ),
      replacementBody = nextPartIds.length
        ? deepFreeze({
            ...previousBody,
            partIds: nextPartIds,
            descriptors: nextDescriptors,
          })
        : null,
      sourceConnectionIds = [
        ...new Set(
          (options.sourceConnectionIds || []).map((connectionId) =>
            canonicalId(connectionId),
          ),
        ),
      ],
      constraint = deepFreeze({
        constraintId: id,
        partId: canonicalPartId,
        sourceConnectionIds,
        pose: {
          position: vector(options.pose?.position, [
            "constraint",
            id,
            "position",
          ]),
          quaternion: quaternion(options.pose?.quaternion, [
            "constraint",
            id,
            "quaternion",
          ]),
        },
        angle: finiteNumber(options.angle || 0, {
          path: ["constraint", id, "angle"],
        }),
        angularVelocity: finiteNumber(options.angularVelocity || 0, {
          path: ["constraint", id, "angularVelocity"],
        }),
        reactionTorque: finiteNumber(options.reactionTorque || 0, {
          min: 0,
          path: ["constraint", id, "reactionTorque"],
        }),
        detached: false,
        bound: true,
      });
    if (replacementBody) this.#bodies.set(previousBodyId, replacementBody);
    else {
      this.#bodies.delete(previousBodyId);
      this.#engineBodies.delete(previousBodyId);
    }
    this.#bodyByPart.delete(canonicalPartId);
    this.#constraints.set(id, constraint);
    this.#constraintByPart.set(canonicalPartId, id);
    this.#revision++;
    return this.constraint(id);
  }

  body(id) {
    return this.#bodies.get(id) || null;
  }

  bodyForPart(partId) {
    const bodyIds = this.#bodyByPart.get(partId);
    if (!bodyIds || bodyIds.size !== 1) return null;
    return this.body(bodyIds.values().next().value);
  }

  bodiesForPart(partId) {
    return Object.freeze(
      [...(this.#bodyByPart.get(partId) || [])]
        .map((bodyId) => this.body(bodyId))
        .filter(Boolean),
    );
  }

  constraint(id) {
    return this.#constraints.get(id) || null;
  }

  constraintForPart(partId) {
    const constraintId = this.#constraintByPart.get(partId);
    return constraintId ? this.constraint(constraintId) : null;
  }

  /** Stable adapter bindings without cloning the complete per-tick registry. */
  constraintBindings() {
    return [...this.#constraints.values()].map(({ constraintId, partId }) => ({
      constraintId,
      partId,
    }));
  }

  updateConstraint(id, options = {}) {
    const canonical = compiledId(id),
      current = this.#constraints.get(canonical);
    if (!current)
      throw new DomainValidationError(
        "UNKNOWN_CONSTRAINT_BINDING",
        `Constraint ${String(canonical)} is not registered`,
      );
    this.#constraints.set(
      canonical,
      deepFreeze({
        ...current,
        pose: {
          position: vector(options.pose?.position ?? current.pose.position, [
            "constraint",
            canonical,
            "position",
          ]),
          quaternion: quaternion(
            options.pose?.quaternion ?? current.pose.quaternion,
            ["constraint", canonical, "quaternion"],
          ),
        },
        angle: finiteNumber(options.angle ?? current.angle, {
          path: ["constraint", canonical, "angle"],
        }),
        angularVelocity: finiteNumber(
          options.angularVelocity ?? current.angularVelocity,
          { path: ["constraint", canonical, "angularVelocity"] },
        ),
        reactionTorque: finiteNumber(
          options.reactionTorque ?? current.reactionTorque,
          { min: 0, path: ["constraint", canonical, "reactionTorque"] },
        ),
        detached: Boolean(options.detached ?? current.detached),
      }),
    );
    this.#revision++;
    return this.constraint(canonical);
  }

  engineBody(id) {
    return this.#engineBodies.get(id) || null;
  }

  bodyIdForEngineBody(engineBody) {
    for (const [id, candidate] of this.#engineBodies)
      if (candidate === engineBody) return id;
    return null;
  }

  engineEntries() {
    return [...this.#engineBodies].map(([bodyId, engineBody]) => ({
      bodyId,
      engineBody,
    }));
  }

  updateKinematics(id, options = {}, dt = 0) {
    const {
      position,
      quaternion: orientation,
      velocity,
      angularVelocity,
    } = /** @type {any} */ (options);
    const body = this.#requireBody(id),
      nextPosition = vector(position ?? body.pose.position, [
        "body",
        id,
        "position",
      ]),
      nextVelocity = vector(velocity ?? body.velocity, [
        "body",
        id,
        "velocity",
      ]),
      seconds = finiteNumber(dt, { min: 0, path: ["body", id, "dt"] }),
      acceleration = seconds
        ? {
            x: (nextVelocity.x - body.velocity.x) / seconds,
            y: (nextVelocity.y - body.velocity.y) / seconds,
            z: (nextVelocity.z - body.velocity.z) / seconds,
          }
        : body.acceleration;
    this.#bodies.set(
      id,
      updateFrozenBody(body, {
        pose: {
          position: nextPosition,
          quaternion: quaternion(orientation ?? body.pose.quaternion, [
            "body",
            id,
            "quaternion",
          ]),
        },
        velocity: nextVelocity,
        angularVelocity: vector(angularVelocity ?? body.angularVelocity, [
          "body",
          id,
          "angularVelocity",
        ]),
        acceleration,
      }),
    );
    this.#revision++;
    return this.body(id);
  }

  recordContact(id, contact) {
    const body = this.#requireBody(id),
      sample = freezeFreshBodyValue({
        tick: finiteNumber(contact?.tick ?? this.#tick, {
          min: 0,
          path: ["body", id, "contact", "tick"],
        }),
        contactId:
          typeof contact?.contactId === "string" && contact.contactId
            ? contact.contactId
            : null,
        point: vector(contact?.point, ["body", id, "contact", "point"]),
        normal: vector(contact?.normal, ["body", id, "contact", "normal"]),
        forceN: finiteNumber(contact?.forceN ?? contact?.force ?? 0, {
          min: 0,
          path: ["body", id, "contact", "forceN"],
        }),
        impulseNs: finiteNumber(contact?.impulseNs ?? 0, {
          min: 0,
          path: ["body", id, "contact", "impulseNs"],
        }),
        relativeVelocity: vector(contact?.relativeVelocity, [
          "body",
          id,
          "contact",
          "relativeVelocity",
        ]),
        forceWorldN: vector(contact?.forceWorldN, [
          "body",
          id,
          "contact",
          "forceWorldN",
        ]),
        otherBodyId: contact?.otherBodyId ?? null,
        otherMaterialKey: contact?.otherMaterialKey ?? null,
        otherShapeId: contact?.otherShapeId ?? null,
        supportShapeId: contact?.supportShapeId ?? null,
        surfaceRegionId: contact?.surfaceRegionId ?? null,
        featureId: contact?.featureId
          ? structuredClone(contact.featureId)
          : null,
        featureValidity: evidenceValidity(contact?.featureValidity),
        tireEvidence: contact?.tireEvidence
          ? structuredClone(contact.tireEvidence)
          : null,
        validity: evidenceValidity(contact?.validity),
        surface: contact?.surface ?? null,
      });
    this.#bodies.set(
      id,
      updateFrozenBody(body, { contacts: [...body.contacts, sample] }),
    );
    this.#revision++;
    return sample;
  }

  recordLoad(id, load) {
    return this.#recordLoads(id, [load])[0];
  }

  #recordLoads(id, loads) {
    const body = this.#requireBody(id);
    if (!Array.isArray(loads))
      throw new DomainValidationError(
        "INVALID_BODY_LOAD_TRANSACTION",
        `Body ${String(id)} loads must be an array`,
      );
    const samples = loads.map((load, index) =>
      deepFreeze({
        connectionId: load?.connectionId ?? null,
        forceN: finiteNumber(load?.forceN ?? 0, {
          min: 0,
          path: ["body", id, "loads", index, "forceN"],
        }),
        torqueNm: finiteNumber(load?.torqueNm ?? 0, {
          min: 0,
          path: ["body", id, "loads", index, "torqueNm"],
        }),
      }),
    );
    this.#bodies.set(
      id,
      updateFrozenBody(body, { loads: [...body.loads, ...samples] }),
    );
    if (samples.length) this.#revision++;
    return Object.freeze(samples);
  }

  setThermal(id, thermal) {
    const body = this.#requireBody(id);
    this.#bodies.set(
      id,
      updateFrozenBody(body, {
        thermal: isOwnedImmutable(thermal)
          ? thermal
          : structuredClone(thermal || {}),
      }),
    );
    this.#revision++;
    return this.body(id);
  }

  /** @returns {any} */
  setMassProperties(id, massProperties) {
    void id;
    void massProperties;
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_REQUIRED",
      "Direct body-registry mass mutation is unavailable; use the coordinated physical owner transaction",
    );
  }

  #commitMassProperties(records) {
    let detachedRecords;
    try {
      detachedRecords = clonePlainMassPropertyData(
        records,
        "body-registry mass transaction",
      );
    } catch (cause) {
      throw new DomainValidationError(
        "INVALID_BODY_MASS_PROPERTY_TRANSACTION",
        "Body-registry mass transaction must be detached plain finite data",
        { cause },
      );
    }
    if (!Array.isArray(detachedRecords))
      throw new DomainValidationError(
        "INVALID_BODY_MASS_PROPERTY_TRANSACTION",
        "Body-registry mass transaction requires records",
      );
    const plans = [],
      bodyIds = new Set();
    for (const [index, record] of detachedRecords.entries()) {
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        Object.keys(record).sort().join("\u0000") !==
          ["bodyId", "massProperties"].sort().join("\u0000")
      )
        throw new DomainValidationError(
          "INVALID_BODY_MASS_PROPERTY_TRANSACTION",
          "Body-registry mass records must be field-exact",
          { path: ["records", index] },
        );
      const bodyId = compiledId(record.bodyId),
        body = this.#bodies.get(bodyId);
      if (!body || bodyIds.has(bodyId))
        throw new DomainValidationError(
          "INVALID_BODY_MASS_PROPERTY_TRANSACTION",
          "Body-registry mass targets must be present and unique",
          { path: ["records", index, "bodyId"] },
        );
      try {
        validateRigidMemberMassProperties(record.massProperties, bodyId);
      } catch (cause) {
        throw new DomainValidationError(
          "INVALID_BODY_MASS_PROPERTIES",
          `Body ${String(bodyId)} requires complete physical mass properties`,
          { path: ["records", index, "massProperties"], cause },
        );
      }
      bodyIds.add(bodyId);
      plans.push({
        bodyId,
        nextBody: updateFrozenBody(body, {
          massProperties: record.massProperties,
        }),
      });
    }
    const nextBodies = new Map(this.#bodies);
    for (const { bodyId, nextBody } of plans) nextBodies.set(bodyId, nextBody);
    this.#bodies = nextBodies;
    this.#revision += plans.length;
    return Object.freeze(plans.map(({ bodyId }) => this.body(bodyId)));
  }

  setDetached(id, detached = true) {
    const body = this.#requireBody(id);
    if (body.detached === Boolean(detached)) return this.body(id);
    this.#bodies.set(
      id,
      updateFrozenBody(body, { detached: Boolean(detached) }),
    );
    this.#revision++;
    return this.body(id);
  }

  removeConstraint(constraintId) {
    let changed = false;
    for (const [id, body] of this.#bodies) {
      const next = body.constraintIds.filter(
        (candidate) => candidate !== constraintId,
      );
      if (next.length === body.constraintIds.length) continue;
      this.#bodies.set(id, updateFrozenBody(body, { constraintIds: next }));
      changed = true;
    }
    if (changed) this.#revision++;
    return changed;
  }

  snapshot() {
    if (
      this.#snapshotRevision === this.#revision &&
      this.#snapshotTick === this.#tick
    )
      return this.#snapshot;
    const projection = {
      schemaVersion: 1,
      tick: this.#tick,
      bodies: Object.freeze([...this.#bodies.values()]),
      bodyByPart: Object.freeze(
        [...this.#bodyByPart].flatMap(([partId, bodyIds]) =>
          [...bodyIds].map((bodyId) => Object.freeze({ partId, bodyId })),
        ),
      ),
      constraints: Object.freeze([...this.#constraints.values()]),
      constraintByPart: Object.freeze(
        [...this.#constraintByPart].map(([partId, constraintId]) =>
          Object.freeze({ partId, constraintId }),
        ),
      ),
    };
    this.#snapshot = Object.freeze({ ...projection, revision: this.#revision });
    this.#snapshotRevision = this.#revision;
    this.#snapshotTick = this.#tick;
    return this.#snapshot;
  }

  exportState() {
    const { revision: _runtimeRevision, ...projection } = this.snapshot();
    return issueInertPlainData({
      ...projection,
      revision: bodyRegistryStateRevision(projection),
    });
  }

  exportCheckpointState() {
    return issueInertPlainData({
      schemaVersion: 3,
      tick: this.#tick,
      bodies: [...this.#bodies.values()].map((body) => ({
        bodyId: body.bodyId,
        acceleration: body.acceleration,
        contacts: body.contacts,
        loads: body.loads,
        detached: body.detached,
      })),
      constraints: [...this.#constraints.values()].map((constraint) => ({
        constraintId: constraint.constraintId,
        detached: constraint.detached,
      })),
    });
  }

  #validateCheckpointState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
      message:
        "Body registry checkpoint must be serialized JSON or an exported immutable state",
      path: ["checkpoint"],
    });
    if (state?.schemaVersion !== 3 || !Array.isArray(state.bodies))
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_MASS_AUTHORITY_MISMATCH",
        "Body-registry checkpoint must not duplicate derived mass authority",
      );
    if (
      !checkpointKeysMatch(state, [
        "schemaVersion",
        "tick",
        "bodies",
        "constraints",
      ]) ||
      !Array.isArray(state.constraints)
    )
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_FIELD_MISMATCH",
        "Body-registry checkpoint contains fields outside its mutable projection",
      );
    const bodies = new Map(),
      constraints = new Map(),
      knownConnectionIds = this.#knownConnectionIds;
    for (const [bodyIndex, record] of state.bodies.entries()) {
      if (
        BODY_REGISTRY_AUTHORITY_FIELDS.some((field) =>
          Object.hasOwn(record || {}, field),
        )
      ) {
        const massAuthority = Object.hasOwn(record || {}, "massProperties");
        throw new DomainValidationError(
          massAuthority
            ? "BODY_REGISTRY_CHECKPOINT_MASS_AUTHORITY_MISMATCH"
            : "BODY_REGISTRY_CHECKPOINT_FIELD_MISMATCH",
          massAuthority
            ? "Body-registry checkpoint must not duplicate derived mass authority"
            : "Body-registry checkpoint must not restore topology, geometry, or projected owner state",
        );
      }
      if (
        !checkpointKeysMatch(record, BODY_CHECKPOINT_KEYS) ||
        typeof record.bodyId !== "string" ||
        !checkpointVectorIsFinite(record.acceleration) ||
        !Array.isArray(record.contacts) ||
        !Array.isArray(record.loads) ||
        typeof record.detached !== "boolean" ||
        bodies.has(record.bodyId)
      )
        throw new DomainValidationError(
          "INVALID_BODY_REGISTRY_CHECKPOINT_BODY_STATE",
          `Body-registry checkpoint contains invalid mutable state for ${String(record?.bodyId)}`,
        );
      const contactIds = new Set();
      for (const [contactIndex, contact] of record.contacts.entries()) {
        checkpointContact(
          contact,
          ["checkpoint", "bodies", bodyIndex, "contacts", contactIndex],
          state.tick,
        );
        if (contact.contactId !== null) {
          if (contactIds.has(contact.contactId))
            checkpointFailure("Body contact IDs must be unique per body", [
              "checkpoint",
              "bodies",
              bodyIndex,
              "contacts",
              contactIndex,
              "contactId",
            ]);
          contactIds.add(contact.contactId);
        }
      }
      const loadConnectionIds = new Set();
      for (const [loadIndex, load] of record.loads.entries()) {
        checkpointLoad(
          load,
          ["checkpoint", "bodies", bodyIndex, "loads", loadIndex],
          knownConnectionIds,
        );
        const token = stableStringify(load.connectionId);
        if (loadConnectionIds.has(token))
          checkpointFailure("Body loads must be unique per connection", [
            "checkpoint",
            "bodies",
            bodyIndex,
            "loads",
            loadIndex,
            "connectionId",
          ]);
        loadConnectionIds.add(token);
      }
      bodies.set(record.bodyId, structuredClone(record));
    }
    for (const record of state.constraints) {
      if (
        !checkpointKeysMatch(record, CONSTRAINT_CHECKPOINT_KEYS) ||
        typeof record.constraintId !== "string" ||
        typeof record.detached !== "boolean" ||
        constraints.has(record.constraintId)
      )
        throw new DomainValidationError(
          "INVALID_BODY_REGISTRY_CHECKPOINT_CONSTRAINT_STATE",
          `Body-registry checkpoint contains invalid mutable constraint state for ${String(record?.constraintId)}`,
        );
      constraints.set(record.constraintId, structuredClone(record));
    }
    if (
      bodies.size !== this.#bodies.size ||
      [...this.#bodies.keys()].some((bodyId) => !bodies.has(bodyId)) ||
      constraints.size !== this.#constraints.size ||
      [...this.#constraints.keys()].some(
        (constraintId) => !constraints.has(constraintId),
      )
    )
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
        "Body registry checkpoint does not match the running topology",
      );
    if (!Number.isSafeInteger(state.tick) || state.tick < 0)
      throw new DomainValidationError(
        "INVALID_BODY_REGISTRY_CHECKPOINT_COUNTER",
        "Body-registry state requires a non-negative safe-integer tick",
      );
    return {
      bodies,
      constraints,
      tick: state.tick,
    };
  }

  #importCheckpointState(state) {
    const validated = this.#validateCheckpointState(state);
    this.#bodies = new Map(
      [...this.#bodies].map(([id, body]) => [
        id,
        deepFreeze({ ...body, ...structuredClone(validated.bodies.get(id)) }),
      ]),
    );
    this.#constraints = new Map(
      [...this.#constraints].map(([id, constraint]) => [
        id,
        deepFreeze({
          ...constraint,
          ...structuredClone(validated.constraints.get(id)),
        }),
      ]),
    );
    this.#tick = validated.tick;
    const projection = {
      tick: this.#tick,
      bodies: [...this.#bodies.values()],
      bodyByPart: [...this.#bodyByPart].flatMap(([partId, bodyIds]) =>
        [...bodyIds].map((bodyId) => ({ partId, bodyId })),
      ),
      constraints: [...this.#constraints.values()],
      constraintByPart: [...this.#constraintByPart].map(
        ([partId, constraintId]) => ({ partId, constraintId }),
      ),
    };
    this.#revision = contentRevisionSequence(
      bodyRegistryStateRevision(projection),
    );
    this.#snapshotRevision = -1;
    this.#snapshotTick = -1;
    this.#snapshot = null;
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
      message:
        "Body registry checkpoint must be serialized JSON or an exported immutable state",
      path: ["checkpoint"],
    });
    if (state?.schemaVersion !== 1)
      throw new DomainValidationError(
        "INVALID_BODY_REGISTRY_CHECKPOINT",
        "Body registry checkpoint must use schema version 1",
      );
    checkpointKeys(
      state,
      [
        "schemaVersion",
        "revision",
        "tick",
        "bodies",
        "bodyByPart",
        "constraints",
        "constraintByPart",
      ],
      ["checkpoint"],
    );
    if (
      typeof state.revision !== "string" ||
      !/^body-registry-sha256-[0-9a-f]{64}$/u.test(state.revision) ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 0
    )
      throw new DomainValidationError(
        "INVALID_BODY_REGISTRY_CHECKPOINT_COUNTER",
        "Body-registry checkpoint counters must be non-negative safe integers",
      );
    const revision = state.revision,
      tick = state.tick;
    if (
      !Array.isArray(state.bodies) ||
      !Array.isArray(state.bodyByPart) ||
      !Array.isArray(state.constraints) ||
      !Array.isArray(state.constraintByPart)
    )
      checkpointFailure("Body registry checkpoint collections must be arrays", [
        "checkpoint",
      ]);
    const bodies = new Map();
    for (const [index, body] of state.bodies.entries()) {
      const id = checkpointCompiledId(body?.bodyId, [
          "checkpoint",
          "bodies",
          index,
          "bodyId",
        ]),
        expected = this.#bodies.get(id);
      if (!expected || bodies.has(id))
        throw new DomainValidationError(
          "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
          "Body registry checkpoint body identities are invalid",
        );
      bodies.set(
        id,
        checkpointBody(body, expected, index, this.#knownConnectionIds),
      );
    }
    const constraints = new Map();
    for (const [index, constraint] of state.constraints.entries()) {
      const id = checkpointCompiledId(constraint?.constraintId, [
          "checkpoint",
          "constraints",
          index,
          "constraintId",
        ]),
        expected = this.#constraints.get(id);
      if (!expected || constraints.has(id))
        throw new DomainValidationError(
          "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
          "Body registry checkpoint constraint identities are invalid",
        );
      constraints.set(id, checkpointConstraint(constraint, expected, index));
    }
    const bodyByPart = new Map();
    for (const [index, binding] of state.bodyByPart.entries()) {
      checkpointKeys(
        binding,
        ["partId", "bodyId"],
        ["checkpoint", "bodyByPart", index],
      );
      const partId = checkpointCanonicalId(binding.partId, [
          "checkpoint",
          "bodyByPart",
          index,
          "partId",
        ]),
        bodyId = checkpointCompiledId(binding.bodyId, [
          "checkpoint",
          "bodyByPart",
          index,
          "bodyId",
        ]),
        ids = bodyByPart.get(partId) || new Set(),
        body = bodies.get(bodyId);
      if (!body || ids.has(bodyId) || !body.partIds.includes(partId))
        throw new DomainValidationError(
          "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
          "Body registry checkpoint body bindings are contradictory",
        );
      ids.add(bodyId);
      bodyByPart.set(partId, ids);
    }
    const constraintByPart = new Map();
    for (const [index, binding] of state.constraintByPart.entries()) {
      checkpointKeys(
        binding,
        ["partId", "constraintId"],
        ["checkpoint", "constraintByPart", index],
      );
      const partId = checkpointCanonicalId(binding.partId, [
          "checkpoint",
          "constraintByPart",
          index,
          "partId",
        ]),
        constraintId = checkpointCompiledId(binding.constraintId, [
          "checkpoint",
          "constraintByPart",
          index,
          "constraintId",
        ]),
        constraint = constraints.get(constraintId);
      if (
        constraintByPart.has(partId) ||
        !constraint ||
        constraint.partId !== partId
      )
        throw new DomainValidationError(
          "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
          "Body registry checkpoint constraint bindings are contradictory",
        );
      constraintByPart.set(partId, constraintId);
    }
    const samePartBindings =
      bodyByPart.size === this.#bodyByPart.size &&
      [...this.#bodyByPart].every(([partId, expected]) => {
        const actual = bodyByPart.get(partId);
        return (
          actual?.size === expected.size &&
          [...expected].every((bodyId) => actual.has(bodyId))
        );
      });
    if (
      bodies.size !== this.#bodies.size ||
      [...this.#bodies.keys()].some((bodyId) => !bodies.has(bodyId)) ||
      constraints.size !== this.#constraints.size ||
      [...this.#constraints.keys()].some(
        (constraintId) => !constraints.has(constraintId),
      ) ||
      !samePartBindings ||
      constraintByPart.size !== this.#constraintByPart.size ||
      [...this.#constraintByPart].some(
        ([partId, constraintId]) =>
          constraintByPart.get(partId) !== constraintId,
      ) ||
      [...bodies.values()].some((body) =>
        body.partIds.some(
          (partId) => !bodyByPart.get(partId)?.has(body.bodyId),
        ),
      )
    )
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
        "Body registry checkpoint does not match the running topology",
      );
    const derivedRevision = bodyRegistryStateRevision({
      tick,
      bodies: [...bodies.values()],
      bodyByPart: [...bodyByPart].flatMap(([partId, bodyIds]) =>
        [...bodyIds].map((bodyId) => ({ partId, bodyId })),
      ),
      constraints: [...constraints.values()],
      constraintByPart: [...constraintByPart].map(([partId, constraintId]) => ({
        partId,
        constraintId,
      })),
    });
    if (revision !== derivedRevision)
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_REVISION_MISMATCH",
        "Body registry state revision does not match its owned content",
      );
    return {
      bodies,
      bodyByPart,
      constraints,
      constraintByPart,
      tick,
    };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.#bodies = validated.bodies;
    this.#bodyByPart = validated.bodyByPart;
    this.#constraints = validated.constraints;
    this.#constraintByPart = validated.constraintByPart;
    this.#tick = validated.tick;
    this.#revision = contentRevisionSequence(validated.revision);
    this.#snapshotRevision = -1;
    this.#snapshotTick = -1;
    this.#snapshot = null;
  }

  #singleBodyIdForPart(partId) {
    const bodyIds = this.#bodyByPart.get(partId);
    return bodyIds?.size === 1 ? bodyIds.values().next().value : null;
  }

  #requireBody(id) {
    const canonical = compiledId(id),
      body = this.#bodies.get(canonical);
    if (!body)
      throw new DomainValidationError(
        "UNKNOWN_BODY",
        `Body ${String(id)} is not registered`,
      );
    return body;
  }
}
