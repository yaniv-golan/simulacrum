// @ts-check
/** @typedef {import('./boundaries.js').Quaternion} Quaternion */
/** @typedef {import('./boundaries.js').Vec3} Vec3 */
// Authored rotations may contain admitted rounding error. Geometry readers use
// the same normalized representation as the compiler and physical body poses.
/** @param {Quaternion} q @returns {[number, number, number, number]} */
export function normalizeQuaternion(q) {
  const norm = Math.hypot(...q);
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}
/** @param {Quaternion} a @param {Quaternion} b @returns {[number, number, number, number]} */
export function multiplyQuaternion(a, b) {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return [
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ];
}
/** @param {Quaternion} rotation @param {Vec3} v @returns {[number, number, number]} */
export function rotateVector(rotation, v) {
  const q = normalizeQuaternion(rotation);
  const result = multiplyQuaternion(multiplyQuaternion(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [result[0], result[1], result[2]];
}
