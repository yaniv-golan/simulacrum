/** @typedef {{path?: Array<string | number>, details?: unknown, cause?: unknown}} ValidationOptions */

const compiledIdCollator = new Intl.Collator("en-US", { numeric: true });

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

/**
 * Detaches strict JSON-like data without reading through accessors. Repeated
 * identities are expanded into independent values, while cycles are rejected
 * because persisted tree data cannot encode them.
 */
export function detachPlainData(
  value,
  {
    code = "INVALID_PLAIN_DATA",
    cycleCode = code,
    depthCode = code,
    finiteNumberCode = code,
    finiteNumbers = false,
    maximumDepth = Infinity,
    maximumNodes = Infinity,
    message = "Expected accessor-free acyclic plain data",
    nodeCode = code,
    path = [],
  } = {},
) {
  const ancestors = new WeakSet();
  let nodes = 0;
  const fail = (failurePath, cause, failureCode = code) => {
    const location = failurePath.length
      ? failurePath.map(String).join(".")
      : "<root>";
    throw new DomainValidationError(failureCode, `${message} at ${location}`, {
      path: failurePath,
      cause,
    });
  };
  const visit = (candidate, candidatePath, depth) => {
    nodes++;
    if (nodes > maximumNodes) fail(candidatePath, null, nodeCode);
    if (depth > maximumDepth) fail(candidatePath, null, depthCode);
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    )
      return candidate;
    if (typeof candidate === "number") {
      if (finiteNumbers && !Number.isFinite(candidate))
        fail(candidatePath, null, finiteNumberCode);
      return candidate;
    }
    if (typeof candidate !== "object") fail(candidatePath);
    if (ancestors.has(candidate)) fail(candidatePath, null, cycleCode);
    ancestors.add(candidate);

    let prototype, keys;
    try {
      prototype = Object.getPrototypeOf(candidate);
      keys = Reflect.ownKeys(candidate);
    } catch (cause) {
      fail(candidatePath, cause);
    }
    const array = Array.isArray(candidate);
    if (
      (array && prototype !== Array.prototype) ||
      (!array && prototype !== Object.prototype && prototype !== null)
    )
      fail(candidatePath);
    if (keys.some((key) => typeof key === "symbol")) fail(candidatePath);

    const descriptorFor = (key, keyPath) => {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      } catch (cause) {
        fail(keyPath, cause);
      }
      if (
        !descriptor ||
        !("value" in descriptor) ||
        (key !== "length" && descriptor.enumerable !== true)
      )
        fail(keyPath);
      return descriptor;
    };

    if (array) {
      const lengthDescriptor = descriptorFor("length", [
          ...candidatePath,
          "length",
        ]),
        length = lengthDescriptor.value,
        keySet = new Set(keys);
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        keys.length !== length + 1 ||
        !keySet.has("length")
      )
        fail(candidatePath);
      const result = [];
      for (let index = 0; index < length; index++) {
        const key = String(index);
        if (!keySet.has(key)) fail([...candidatePath, index]);
        result.push(
          visit(
            descriptorFor(key, [...candidatePath, index]).value,
            [...candidatePath, index],
            depth + 1,
          ),
        );
      }
      ancestors.delete(candidate);
      return result;
    }

    const result = {};
    for (const key of keys) {
      if (typeof key !== "string") fail(candidatePath);
      result[key] = visit(
        descriptorFor(key, [...candidatePath, key]).value,
        [...candidatePath, key],
        depth + 1,
      );
    }
    ancestors.delete(candidate);
    return result;
  };
  const detached = visit(value, path, 0);
  // ECMAScript does not expose a portable `isProxy` predicate. The structured
  // clone algorithm does, however, reject Proxy exotic objects without
  // invoking their `get` trap. Run it only after the descriptor walk above has
  // rejected accessors without reading them. A proxy may observe the
  // descriptor inspection used for structural validation, but it can never be
  // accepted as data authority or supply a lazily-read property value.
  try {
    structuredClone(value);
  } catch (cause) {
    fail(path, cause);
  }
  return detached;
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

/**
 * Validates a runtime/compiler-owned identity. These projections may be longer
 * than their bounded authored source after deterministic namespace prefixes
 * are added, but remain exact non-empty strings or safe integers.
 */
export function compiledId(value, { path = [] } = {}) {
  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0)
  )
    return value;
  throw new DomainValidationError(
    "INVALID_COMPILED_ID",
    "Compiled IDs must be safe integers or non-empty strings",
    { path, details: { value } },
  );
}

/**
 * Total ordering for canonical authored IDs and their longer compiled string
 * projections. Generated IDs may exceed the authored 160-character limit, so
 * compiled surfaces share this comparator without re-validating source limits.
 */
export function compareCompiledIds(left, right) {
  const validLeft = compiledId(left),
    validRight = compiledId(right);
  if (validLeft === validRight) return 0;
  const legacyOrder = compiledIdCollator.compare(
    String(validLeft),
    String(validRight),
  );
  if (legacyOrder) return legacyOrder;
  if (typeof validLeft !== typeof validRight)
    return typeof validLeft === "number" ? -1 : 1;
  if (typeof validLeft === "number" && typeof validRight === "number")
    return validLeft - validRight;
  return validLeft < validRight ? -1 : 1;
}

/**
 * Total ordering for canonical authored identities. Preserve the compiler's
 * historical numeric collation first, then resolve collation-equivalent
 * values by type and exact value so authored insertion order can never decide.
 */
export function compareCanonicalIds(leftValue, rightValue) {
  const left = canonicalId(leftValue),
    right = canonicalId(rightValue);
  return compareCompiledIds(left, right);
}

/**
 * Compiled string identifiers can normally retain their legacy projection.
 * If a namespace contains both a number and its exact string form, every
 * string in that namespace is length-prefixed so the projection remains
 * injective without depending on authored array order.
 */
export function identitySetUsesTypedStrings(values) {
  const numericTokens = new Set(
    values
      .filter((value) => typeof value === "number")
      .map((value) => String(value)),
  );
  return values.some(
    (value) => typeof value === "string" && numericTokens.has(value),
  );
}

export function identityToken(value, { typedStrings = false } = {}) {
  const id = canonicalId(value);
  return typedStrings && typeof id === "string"
    ? `string:${id.length}:${id}`
    : String(id);
}

export function scopedIdentity(scope, value, options = {}) {
  const token = identityToken(value, options);
  if (typeof scope !== "string" || !scope)
    throw new TypeError("identity scope must be a non-empty string");
  return `${scope}:${token}`;
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
