/** @typedef {{path?: Array<string | number>, details?: unknown, cause?: unknown}} ValidationOptions */

/** Structured validation failure used by model and persistence boundaries. */
export class DomainValidationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ValidationOptions} [options]
   */
  constructor(code, message, { path = [], details = null, cause } = {}) {
    super(message, { cause });
    this.name = "DomainValidationError";
    this.code = code;
    this.path = [...path];
    this.details = details == null ? null : immutableClone(details);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: [...this.path],
      details: this.details == null ? null : immutableClone(this.details),
    };
  }
}

/** Convert an arbitrary thrown value into a stable user-facing message. */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Recursively freezes JSON-like domain values. */
export function deepFreeze(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object" || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/** Returns a detached immutable value suitable for public model reads. */
export function immutableClone(value) {
  return deepFreeze(structuredClone(value));
}

export function finiteNumber(
  value,
  { path = [], min = -Infinity, max = Infinity } = {},
) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new DomainValidationError(
      "INVALID_FINITE_NUMBER",
      `Expected a finite number between ${min} and ${max}`,
      { path, details: { value, min, max } },
    );
  return Number(value);
}

/**
 * @param {unknown} value
 * @param {{path?: Array<string | number>, fallback?: number[]}} [options]
 */
export function finiteVector3(value, { path = [], fallback } = {}) {
  const source = value == null && fallback ? fallback : value;
  if (!Array.isArray(source) || source.length !== 3)
    throw new DomainValidationError(
      "INVALID_VECTOR3",
      "Expected a three-element vector",
      { path, details: { value } },
    );
  return source.map((entry, index) =>
    finiteNumber(entry, { path: [...path, index] }),
  );
}

const QUATERNION_NORM_TOLERANCE = 1e-9;

function unitQuaternion(value, { path = [] } = {}) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new DomainValidationError(
      "INVALID_QUATERNION",
      "Expected a four-element quaternion",
      { path, details: { value } },
    );
  const result = value.map((entry, index) => {
      const component = finiteNumber(entry, { path: [...path, index] });
      return component === 0 ? 0 : component;
    }),
    normSquared = result.reduce(
      (total, component) => total + component * component,
      0,
    );
  if (Math.abs(normSquared - 1) > QUATERNION_NORM_TOLERANCE)
    throw new DomainValidationError(
      "NON_UNIT_QUATERNION",
      "Quaternion must have unit length",
      {
        path,
        details: { normSquared, tolerance: QUATERNION_NORM_TOLERANCE },
      },
    );
  return result;
}

/** Produces canonical persisted orientation from a live unit quaternion. */
export function canonicalizeQuaternion(value, { path = [] } = {}) {
  const result = unitQuaternion(value, { path }),
    [x, y, z, w] = result,
    firstNonzero = [w, z, y, x].find(
      (component) => Math.abs(component) > Number.EPSILON,
    );
  return firstNonzero < 0
    ? result.map((component) => (component === 0 ? 0 : -component))
    : result;
}

/** Validates the canonical local-to-world quaternion persisted by wire data. */
export function canonicalQuaternion(value, { path = [] } = {}) {
  const result = unitQuaternion(value, { path }),
    [x, y, z, w] = result,
    firstNonzero = [w, z, y, x].find(
      (component) => Math.abs(component) > Number.EPSILON,
    );
  if (firstNonzero < 0)
    throw new DomainValidationError(
      "NONCANONICAL_QUATERNION",
      "Quaternion sign must make the first nonzero [w,z,y,x] component positive",
      { path },
    );
  return result;
}

/** Converts an internal XYZ Euler editor pose to canonical wire orientation. */
export function quaternionFromEulerXYZ(value, { path = [] } = {}) {
  const [x, y, z] = finiteVector3(value, { path }),
    sx = Math.sin(x / 2),
    cx = Math.cos(x / 2),
    sy = Math.sin(y / 2),
    cy = Math.cos(y / 2),
    sz = Math.sin(z / 2),
    cz = Math.cos(z / 2),
    quaternion = [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    ];
  return canonicalizeQuaternion(quaternion, { path });
}

/** Rotates a vector by a unit local-to-world quaternion. */
export function rotateVectorByQuaternion(vector, orientation) {
  const [vx, vy, vz] = finiteVector3(vector),
    [x, y, z, w] = unitQuaternion(orientation),
    tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/**
 * @param {unknown} value
 * @param {{path?: Array<string | number>, fallback?: number[]}} [options]
 */
export function finiteScale3(value, { path = [], fallback = [1, 1, 1] } = {}) {
  const record = /** @type {any} */ (value);
  const vector = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [record.x, record.y, record.z]
      : fallback;
  const result = finiteVector3(vector, { path });
  for (let index = 0; index < result.length; index++)
    if (result[index] <= 0)
      throw new DomainValidationError(
        "INVALID_SCALE",
        "Scale components must be greater than zero",
        { path: [...path, index], details: { value: result[index] } },
      );
  return result;
}

export function normalizeTransform(value = {}, { path = [] } = {}) {
  if (Object.hasOwn(value, "rotation"))
    throw new DomainValidationError(
      "UNSUPPORTED_EULER_ROTATION",
      "Transforms require a canonical quaternion orientation",
      { path: [...path, "rotation"] },
    );
  return deepFreeze({
    position: finiteVector3(value.position ?? value.pos, {
      path: [...path, "position"],
      fallback: [0, 0, 0],
    }),
    orientation: canonicalQuaternion(value.orientation ?? [0, 0, 0, 1], {
      path: [...path, "orientation"],
    }),
    scale: finiteScale3(value.scale, {
      path: [...path, "scale"],
      fallback: [1, 1, 1],
    }),
  });
}

export function canonicalId(value, { path = [] } = {}) {
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0 && value.length <= 160)
  )
    return value;
  throw new DomainValidationError(
    "INVALID_ID",
    "IDs must be safe integers or non-empty strings up to 160 characters",
    { path, details: { value } },
  );
}

function canonicalize(value, path, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") return finiteNumber(value, { path });
  if (Array.isArray(value)) {
    if (ancestors.has(value))
      throw new DomainValidationError(
        "CYCLIC_VALUE",
        "Cannot serialize a cyclic value",
        { path },
      );
    ancestors.add(value);
    const result = value.map((entry, index) =>
      canonicalize(entry, [...path, index], ancestors),
    );
    ancestors.delete(value);
    return result;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value))
      throw new DomainValidationError(
        "CYCLIC_VALUE",
        "Cannot serialize a cyclic value",
        { path },
      );
    ancestors.add(value);
    const result = {};
    for (const key of Object.keys(value).sort())
      result[key] = canonicalize(value[key], [...path, key], ancestors);
    ancestors.delete(value);
    return result;
  }
  throw new DomainValidationError(
    "UNSERIALIZABLE_VALUE",
    "Only JSON-compatible domain values may be serialized",
    { path, details: { type: typeof value } },
  );
}

/** Deterministic JSON encoding with sorted object keys and finite numbers. */
export function stableStringify(value) {
  return JSON.stringify(canonicalize(value, [], new WeakSet()));
}
