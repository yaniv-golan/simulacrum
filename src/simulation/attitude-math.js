import { finiteOr as finite } from "../model/finite-or.js";

/**
 * Projects a quaternion into Simulacrum's intrinsic Y-X-Z aircraft convention.
 * Yaw is about +Y, pitch about +X, and roll about +Z. The implementation is
 * intentionally engine-neutral so sensors and completed telemetry cannot drift
 * behind Three.js-specific Euler conversion behavior.
 */
export function quaternionToAircraftDegrees(quaternion = {}) {
  const x = finite(quaternion.x),
    y = finite(quaternion.y),
    z = finite(quaternion.z),
    w = finite(quaternion.w, 1),
    m11 = 1 - 2 * (y * y + z * z),
    m13 = 2 * (x * z + w * y),
    m21 = 2 * (x * y + w * z),
    m22 = 1 - 2 * (x * x + z * z),
    m23 = 2 * (y * z - w * x),
    m31 = 2 * (x * z - w * y),
    m33 = 1 - 2 * (x * x + y * y),
    pitch = Math.asin(Math.max(-1, Math.min(1, -m23))),
    regular = Math.abs(m23) < 0.9999999,
    yaw = regular ? Math.atan2(m13, m33) : Math.atan2(-m31, m11),
    roll = regular ? Math.atan2(m21, m22) : 0,
    degrees = 180 / Math.PI;
  return {
    yaw: yaw * degrees,
    pitch: pitch * degrees,
    roll: roll * degrees,
  };
}
