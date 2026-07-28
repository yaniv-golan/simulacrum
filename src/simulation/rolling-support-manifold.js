import { DomainValidationError } from "../model/primitives.js";

const EPSILON = 1e-9;

function vector(value, path) {
  const result = {
    x: Number(value?.x),
    y: Number(value?.y),
    z: Number(value?.z),
  };
  if (!Object.values(result).every(Number.isFinite))
    throw new DomainValidationError(
      "INVALID_ROLLING_SUPPORT_VECTOR",
      `Rolling-support ${path} must contain three finite coordinates`,
      { path: [path] },
    );
  return result;
}

const dot = (left, right) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const scale = (value, amount) => ({
  x: value.x * amount,
  y: value.y * amount,
  z: value.z * amount,
});
const add = (left, right) => ({
  x: left.x + right.x,
  y: left.y + right.y,
  z: left.z + right.z,
});
const subtract = (left, right) => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});
const length = (value) => Math.hypot(value.x, value.y, value.z);

function normalize(value, path) {
  const magnitude = length(value);
  if (!(magnitude > EPSILON))
    throw new DomainValidationError(
      "DEGENERATE_ROLLING_SUPPORT_VECTOR",
      `Rolling-support ${path} must have nonzero length`,
      { path: [path] },
    );
  return scale(value, 1 / magnitude);
}

/** Chord bound for a circular envelope at the authored maximum deflection. */
export function rollingContactPatchHalfLength({ radiusM, maximumDeflectionM }) {
  const radius = Number(radiusM),
    deflection = Number(maximumDeflectionM);
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(deflection) ||
    deflection < 0 ||
    deflection > radius
  )
    throw new DomainValidationError(
      "INVALID_ROLLING_SUPPORT_ENVELOPE",
      "Rolling-support radius and deflection must describe a finite circular envelope",
    );
  return Math.sqrt(Math.max(0, 2 * radius * deflection - deflection ** 2));
}

/**
 * Pure geometry cut: remove only the point component that creates an
 * arbitrary moment about the rolling axle. Both body-relative points receive
 * the same shift, so the signed normal gap is preserved exactly.
 */
export function buildCanonicalRollingSupportPoint({
  wheelOffsetWorld,
  supportOffsetWorld,
  supportNormalWorld,
  axleWorld,
  maximumShiftM,
}) {
  const wheelOffset = vector(wheelOffsetWorld, "wheelOffsetWorld"),
    supportOffset = vector(supportOffsetWorld, "supportOffsetWorld"),
    normal = normalize(
      vector(supportNormalWorld, "supportNormalWorld"),
      "supportNormalWorld",
    ),
    axle = normalize(vector(axleWorld, "axleWorld"), "axleWorld"),
    maximumShift = Number(maximumShiftM);
  if (!Number.isFinite(maximumShift) || maximumShift < 0)
    throw new DomainValidationError(
      "INVALID_ROLLING_SUPPORT_SHIFT_BOUND",
      "Rolling-support shift bound must be finite and non-negative",
    );
  const radialProjection = subtract(normal, scale(axle, dot(normal, axle))),
    radialMagnitude = length(radialProjection);
  if (!(radialMagnitude > EPSILON))
    return Object.freeze({
      accepted: false,
      reasonCode: "AXLE_NORMAL_CONTACT",
    });
  const radial = scale(radialProjection, 1 / radialMagnitude),
    correctedWheelOffset = add(
      scale(radial, dot(wheelOffset, radial)),
      scale(axle, dot(wheelOffset, axle)),
    ),
    shift = subtract(correctedWheelOffset, wheelOffset),
    requiredShiftM = length(shift),
    accepted = requiredShiftM <= maximumShift + EPSILON;
  return Object.freeze({
    accepted,
    reasonCode: accepted ? null : "OUTSIDE_AUTHORED_CONTACT_PATCH",
    wheelOffsetWorld: Object.freeze(
      accepted ? correctedWheelOffset : { ...wheelOffset },
    ),
    supportOffsetWorld: Object.freeze(
      accepted ? add(supportOffset, shift) : { ...supportOffset },
    ),
    correctionWorldM: Object.freeze(accepted ? shift : { x: 0, y: 0, z: 0 }),
    requiredCorrectionM: requiredShiftM,
    appliedCorrectionM: accepted ? requiredShiftM : 0,
    geometricToleranceM: maximumShift,
    signedNormalGapM: dot(normal, subtract(supportOffset, wheelOffset)),
  });
}

export function rollingSupportManifoldId({
  wheelId,
  supportBodyId,
  supportShapeId,
  featureId,
  role = "tire-envelope",
  ordinal = 0,
}) {
  const fields = [wheelId, supportBodyId, supportShapeId, featureId, role];
  if (fields.some((value) => value == null || String(value).length === 0))
    throw new DomainValidationError(
      "INCOMPLETE_ROLLING_SUPPORT_IDENTITY",
      "Rolling-support identity requires wheel, body, shape, feature, and role",
    );
  return `rolling-support:${fields.map(String).join(":")}:${Number(ordinal) || 0}`;
}
