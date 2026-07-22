export const G0 = 9.80665;
export const EARTH_RADIUS_M = 6_371_000;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const plainVector = (value) => ({
  x: value.x,
  y: value.y,
  z: value.z,
});

export const plainQuaternion = (value) => ({
  x: value.x,
  y: value.y,
  z: value.z,
  w: value.w,
});

export function setVector(target, x = 0, y = 0, z = 0) {
  target.x = x;
  target.y = y;
  target.z = z;
  return target;
}

export function addScaled(target, source, scale) {
  target.x += source.x * scale;
  target.y += source.y * scale;
  target.z += source.z * scale;
  return target;
}

export function vectorLength(value) {
  return Math.hypot(value.x, value.y, value.z);
}

export function normalized(target, value, fallback = { x: 0, y: 1, z: 0 }) {
  const length = vectorLength(value);
  return length > 1e-9
    ? setVector(target, value.x / length, value.y / length, value.z / length)
    : setVector(target, fallback.x, fallback.y, fallback.z);
}

export function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function cross(target, left, right) {
  return setVector(
    target,
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );
}

export function rotateVector(target, quaternion, vector) {
  const ix =
      quaternion.w * vector.x +
      quaternion.y * vector.z -
      quaternion.z * vector.y,
    iy =
      quaternion.w * vector.y +
      quaternion.z * vector.x -
      quaternion.x * vector.z,
    iz =
      quaternion.w * vector.z +
      quaternion.x * vector.y -
      quaternion.y * vector.x,
    iw =
      -quaternion.x * vector.x -
      quaternion.y * vector.y -
      quaternion.z * vector.z;
  return setVector(
    target,
    ix * quaternion.w +
      iw * -quaternion.x +
      iy * -quaternion.z -
      iz * -quaternion.y,
    iy * quaternion.w +
      iw * -quaternion.y +
      iz * -quaternion.x -
      ix * -quaternion.z,
    iz * quaternion.w +
      iw * -quaternion.z +
      ix * -quaternion.y -
      iy * -quaternion.x,
  );
}

export function inverseRotateVector(target, quaternion, vector) {
  return rotateVector(
    target,
    {
      x: -quaternion.x,
      y: -quaternion.y,
      z: -quaternion.z,
      w: quaternion.w,
    },
    vector,
  );
}
