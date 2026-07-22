import {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteVector3,
} from "./primitives.js";

export const ENVIRONMENT_BODY_FRAMES = Object.freeze([
  "local-world-v1",
  "earth-tangent-global-v1",
]);
export const ENVIRONMENT_BODY_QUERY_KINDS = Object.freeze([
  "collision",
  "sensing",
]);

const DESCRIPTOR_KEYS = Object.freeze([
  "frame",
  "geometry",
  "id",
  "pose",
  "queryKinds",
  "velocityMps",
]);

function assertExactKeys(value, expected, path) {
  const actual = Object.keys(value || {}).sort(),
    required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  )
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_FIELDS",
      `Environment body fields must be exactly ${required.join(", ")}`,
      { path, details: { actual, expected: required } },
    );
}

function canonicalQuaternion(value, path) {
  assertExactKeys(value, ["w", "x", "y", "z"], path);
  const quaternion = {
      x: finiteNumber(value.x, { path: [...path, "x"] }),
      y: finiteNumber(value.y, { path: [...path, "y"] }),
      z: finiteNumber(value.z, { path: [...path, "z"] }),
      w: finiteNumber(value.w, { path: [...path, "w"] }),
    },
    magnitude = Math.hypot(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    );
  if (Math.abs(magnitude - 1) > 1e-9)
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_ORIENTATION",
      "Environment body orientation must be a unit quaternion",
      { path },
    );
  return quaternion;
}

/** Strict, engine-neutral physical descriptor for a queryable world body. */
export function environmentBodyDescriptor(input) {
  assertExactKeys(input, DESCRIPTOR_KEYS, ["environmentBody"]);
  const id = canonicalId(input.id),
    frame = String(input.frame || "");
  if (!ENVIRONMENT_BODY_FRAMES.includes(frame))
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_FRAME",
      `Environment body ${String(id)} has an unsupported frame`,
      { path: ["environmentBody", "frame"], details: { frame } },
    );
  assertExactKeys(
    input.geometry,
    ["kind", "radiusM"],
    ["environmentBody", "geometry"],
  );
  if (input.geometry.kind !== "sphere-v1")
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_GEOMETRY",
      "Environment body geometry must use sphere-v1",
      { path: ["environmentBody", "geometry", "kind"] },
    );
  const queryKinds = [...new Set(input.queryKinds || [])].sort();
  if (
    !queryKinds.length ||
    queryKinds.some((kind) => !ENVIRONMENT_BODY_QUERY_KINDS.includes(kind))
  )
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_QUERY_KIND",
      "Environment bodies require one or more supported query kinds",
      { path: ["environmentBody", "queryKinds"] },
    );
  assertExactKeys(
    input.pose,
    ["orientation", "positionM"],
    ["environmentBody", "pose"],
  );
  return deepFreeze({
    schemaVersion: 1,
    id,
    frame,
    geometry: {
      kind: "sphere-v1",
      radiusM: finiteNumber(input.geometry.radiusM, {
        min: Number.EPSILON,
        path: ["environmentBody", "geometry", "radiusM"],
      }),
    },
    queryKinds,
    pose: {
      positionM: finiteVector3(input.pose.positionM, {
        path: ["environmentBody", "pose", "positionM"],
      }),
      orientation: canonicalQuaternion(input.pose.orientation, [
        "environmentBody",
        "pose",
        "orientation",
      ]),
    },
    velocityMps: finiteVector3(input.velocityMps, {
      path: ["environmentBody", "velocityMps"],
    }),
  });
}
