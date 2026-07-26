import { canonicalQuaternion, rotateVectorByQuaternion } from "./primitives.js";

const BASIS = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, 0, 1]),
]);

const dot = (left, right) =>
  left.reduce((sum, value, axis) => sum + value * right[axis], 0);
const length = (vector) => Math.hypot(...vector);
const normalize = (vector) => {
  const magnitude = length(vector);
  return magnitude > 1e-9
    ? vector.map((value) => value / magnitude)
    : [0, 0, 0];
};

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/** Builds one DOM-free oriented bound from canonical authored geometry. */
export function orientedBoundsFor(part, geometry) {
  const bounds = geometry.selectionBoundsPartM;
  if (!bounds)
    throw new Error(`Component ${part.type} has no canonical selection bounds`);
  const localCenter = [0, 1, 2].map(
      (axis) => (bounds.minimumM[axis] + bounds.maximumM[axis]) / 2,
    ),
    half = [0, 1, 2].map((axis) =>
      Math.max(0.01, (bounds.maximumM[axis] - bounds.minimumM[axis]) / 2),
    ),
    orientation = canonicalQuaternion(part.orientation),
    centerOffset = rotateVectorByQuaternion(localCenter, orientation);
  return {
    id: part.id,
    center: [0, 1, 2].map(
      (axis) => Number(part.pos?.[axis] || 0) + centerOffset[axis],
    ),
    half,
    axes: BASIS.map((axis) =>
      normalize(rotateVectorByQuaternion(axis, orientation)),
    ),
  };
}

export function translateOrientedBounds(bounds, offset) {
  return {
    ...bounds,
    center: bounds.center.map((value, axis) => value + offset[axis]),
  };
}

export function orientedBoundsProjectionRadius(bounds, axis) {
  return bounds.axes.reduce(
    (sum, basis, index) =>
      sum + bounds.half[index] * Math.abs(dot(basis, axis)),
    0,
  );
}

export function orientedBoundsProjection(bounds, axis) {
  const center = dot(bounds.center, axis),
    radius = orientedBoundsProjectionRadius(bounds, axis);
  return { minimum: center - radius, maximum: center + radius };
}

/**
 * Separating-axis overlap for authored oriented bounds. Engineering analysis
 * may allow a small penetration tolerance; placement instead requests a
 * positive minimum separation.
 */
export function orientedBoundsOverlap(
  left,
  right,
  { allowedPenetrationM = 0.025, minimumSeparationM = 0 } = {},
) {
  const delta = right.center.map((value, axis) => value - left.center[axis]),
    axes = [...left.axes, ...right.axes];
  for (const leftAxis of left.axes)
    for (const rightAxis of right.axes) {
      const candidate = cross(leftAxis, rightAxis);
      if (length(candidate) > 1e-7) axes.push(normalize(candidate));
    }
  return axes.every((axis) => {
    const distance = Math.abs(dot(delta, axis)),
      occupiedRadius =
        orientedBoundsProjectionRadius(left, axis) +
        orientedBoundsProjectionRadius(right, axis) +
        minimumSeparationM -
        allowedPenetrationM;
    return distance < occupiedRadius - 1e-9;
  });
}
