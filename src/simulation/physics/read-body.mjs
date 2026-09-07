// @ts-check
/** The reader admits only the methods needed for a numeric completed body sample.
 * No physics-library object is returned across the door.
 * @typedef {{ x: number, y: number, z: number }} XYZ
 * @typedef {{ translation(): XYZ, rotation(): XYZ & {w: number}, linvel(): XYZ,
 * angvel(): XYZ, mass(): number }} BodyReader
 */
/** @param {BodyReader} body @returns {import('../../model/boundaries.js').BodyObservation} */
export function readBody(body) {
  const p = body.translation(),
    q = body.rotation(),
    v = body.linvel(),
    w = body.angvel();
  return {
    position: [p.x, p.y, p.z],
    rotation: [q.x, q.y, q.z, q.w],
    velocity: [v.x, v.y, v.z],
    angularVelocity: [w.x, w.y, w.z],
    mass: body.mass(),
  };
}
