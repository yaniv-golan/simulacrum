// Cannon orientations have infinitely many near-unit floating representations,
// including the sign-equivalent q and -q forms. Persist one algebraically
// closed representation so checkpoint validation never grants authority via a
// numerical tolerance.

function componentsFor(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 4 ||
    !["x", "y", "z", "w"].every(
      (field) =>
        Object.hasOwn(value, field) &&
        typeof value[field] === "number" &&
        Number.isFinite(value[field]),
    )
  )
    return null;
  return [value.x, value.y, value.z, value.w];
}

function assignComponents(target, value) {
  target.set(value.x, value.y, value.z, value.w);
  return target;
}

function canonicalSign(components) {
  const firstNonzero = [3, 2, 1, 0]
    .map((index) => components[index])
    .find((component) => component !== 0);
  return firstNonzero < 0 ? -1 : 1;
}

function pivotIndex(components) {
  let pivot = 0;
  for (let index = 1; index < components.length; index++)
    if (Math.abs(components[index]) > Math.abs(components[pivot]))
      pivot = index;
  return pivot;
}

function exactPivot(components, pivot) {
  const remainder = components.reduce(
    (sum, component, index) =>
      index === pivot ? sum : sum + component * component,
    0,
  );
  if (!(remainder >= 0 && remainder <= 1)) return null;
  return (components[pivot] < 0 ? -1 : 1) * Math.sqrt(1 - remainder);
}

function componentsAreCanonical(components) {
  if (
    canonicalSign(components) < 0 ||
    components.some((component) => Object.is(component, -0))
  )
    return false;
  const pivot = pivotIndex(components),
    canonicalPivot = exactPivot(components, pivot);
  return canonicalPivot != null && components[pivot] === canonicalPivot;
}

/**
 * Projects any finite nonzero Cannon quaternion onto the canonical checkpoint
 * representation. Returns null when no physical orientation can be projected.
 */
export function canonicalCannonCheckpointQuaternion(value) {
  const source = componentsFor(value);
  if (!source) return null;
  for (let index = 0; index < source.length; index++)
    if (source[index] === 0) source[index] = 0;
  if (componentsAreCanonical(source))
    return { x: source[0], y: source[1], z: source[2], w: source[3] };
  const norm = Math.hypot(...source);
  if (!(norm > 0) || !Number.isFinite(norm)) return null;
  const components = source.map((component) => component / norm);
  if (canonicalSign(components) < 0)
    for (let index = 0; index < components.length; index++)
      components[index] = -components[index];
  const pivot = pivotIndex(components),
    canonicalPivot = exactPivot(components, pivot);
  if (canonicalPivot == null) return null;
  components[pivot] = canonicalPivot;
  return {
    x: components[0] === 0 ? 0 : components[0],
    y: components[1] === 0 ? 0 : components[1],
    z: components[2] === 0 ? 0 : components[2],
    w: components[3] === 0 ? 0 : components[3],
  };
}

/** Exact validator for an already-detached Cannon checkpoint quaternion. */
export function isCanonicalCannonCheckpointQuaternion(value) {
  const components = componentsFor(value);
  return Boolean(components && componentsAreCanonical(components));
}

/** Canonicalizes one trusted live Cannon quaternion in place. */
export function canonicalizeLiveCannonQuaternion(value) {
  const canonical = canonicalCannonCheckpointQuaternion(value);
  if (!canonical) return false;
  assignComponents(value, canonical);
  return true;
}
