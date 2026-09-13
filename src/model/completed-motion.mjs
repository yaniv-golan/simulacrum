import { rotateVector } from './transforms.mjs';
export const finiteVector = (value, size = 3) =>
  Array.isArray(value) && value.length === size && value.every(Number.isFinite);
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const subtract = (a, b) => a.map((x, i) => x - b[i]);
export const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const validMotion = (body) =>
  !!body &&
  ['position', 'velocity', 'angularVelocity'].every((k) => finiteVector(body[k])) &&
  finiteVector(body.rotation, 4) &&
  Math.hypot(...body.rotation) > 0;
/** Completed point velocity, not pre-impact velocity or dissipated energy. */
export function completedPoint(body, local) {
  if (!validMotion(body) || !finiteVector(local)) return null;
  const offset = rotateVector(body.rotation, local);
  return {
    position: add(body.position, offset),
    velocity: add(body.velocity, cross(body.angularVelocity, offset)),
  };
}
/** Derivative of the admitted guide-axis anchor coordinate, including rotating axis. */
export function linearCoordinateSpeed(bodies, joint) {
  if (!joint || !finiteVector(joint.axisA)) return null;
  const a = bodies[joint.a],
    b = bodies[joint.b];
  const A = completedPoint(a, joint.anchorA),
    B = completedPoint(b, joint.anchorB);
  if (!A || !B) return null;
  const axis = rotateVector(a.rotation, joint.axisA);
  const speed =
    dot(subtract(B.velocity, A.velocity), axis) +
    dot(subtract(B.position, A.position), cross(a.angularVelocity, axis));
  return Number.isFinite(speed) ? speed : null;
}

/** One completed sample's transform cache. Weak keys never retain past observations. */
export function createCompletedPointReader() {
  const cache = new WeakMap();
  function prepare(body) {
    if (!body || typeof body !== 'object') return null;
    if (cache.has(body)) return cache.get(body);
    if (!validMotion(body)) {
      cache.set(body, null);
      return null;
    }
    const norm = Math.hypot(...body.rotation),
      [x, y, z, w] = body.rotation.map((v) => v / norm);
    const matrix = [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y),
    ];
    cache.set(body, matrix);
    return matrix;
  }
  function read(body, local) {
    const m = prepare(body);
    if (!m || !finiteVector(local)) return null;
    const [x, y, z] = local,
      offset = [
        m[0] * x + m[1] * y + m[2] * z,
        m[3] * x + m[4] * y + m[5] * z,
        m[6] * x + m[7] * y + m[8] * z,
      ];
    return {
      position: add(body.position, offset),
      velocity: add(body.velocity, cross(body.angularVelocity, offset)),
    };
  }
  read.axis = (body) => {
    const m = prepare(body);
    return m ? [m[0], m[3], m[6]] : null;
  };
  return read;
}
