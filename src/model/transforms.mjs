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

/** @typedef {{position: Vec3, rotation: Quaternion}} Pose */
/** Move an admitted authored pose between rigid frames. Returns fresh values;
 * this authoring helper never writes simulation bodies. Reflections are not rigid rotations.
 * @param {Pose} pose @param {Pose} from @param {Pose} to
 * @returns {{position: [number, number, number], rotation: [number, number, number, number]}}
 */
export function transformPoseBetweenFrames(pose, from, to) {
  const q = normalizeQuaternion(from.rotation);
  const delta = normalizeQuaternion(
    multiplyQuaternion(normalizeQuaternion(to.rotation), [-q[0], -q[1], -q[2], q[3]]),
  );
  const offset = rotateVector(delta, [
    pose.position[0] - from.position[0],
    pose.position[1] - from.position[1],
    pose.position[2] - from.position[2],
  ]);
  return {
    position: [to.position[0] + offset[0], to.position[1] + offset[1], to.position[2] + offset[2]],
    rotation: normalizeQuaternion(multiplyQuaternion(delta, normalizeQuaternion(pose.rotation))),
  };
}
