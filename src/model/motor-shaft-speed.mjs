// @ts-check
import { CATALOG } from './catalog.mjs';
import { rotateVector } from './transforms.mjs';
/** @typedef {import('./boundaries.js').DeepReadonly<{
 * metadata: {blueprint: import('./generated/blueprint-types.js').Blueprint},
 * physics: import('./boundaries.js').BodyObservation[]
 * }>} MotionFrame */
/** Reads only completed numeric observations and authored socket geometry.
 * @param {MotionFrame} frame @param {number} node @returns {number | null}
 */
export function motorShaftSpeed(frame, node) {
  const bp = frame.metadata.blueprint,
    part = bp.parts[node],
    edge = bp.connections.find(
      (c) => c.kind === 'shaft' && (c.a.part === part?.id || c.b.part === part?.id),
    );
  if (!edge) return null;
  const other = edge.a.part === part.id ? edge.b.part : edge.a.part,
    rotor = frame.physics[bp.parts.findIndex((p) => p.id === other)],
    housing = frame.physics[node];
  if (!rotor || !housing) return null;
  const own = edge.a.part === part.id ? edge.a : edge.b;
  const socket = CATALOG[part.type]?.ports.find((p) => p.id === own.port);
  if (!socket) return null;
  const axis = rotateVector(housing.rotation, rotateVector(socket.rotation, [1, 0, 0]));
  return axis.reduce(
    (sum, value, i) => sum + (rotor.angularVelocity[i] - housing.angularVelocity[i]) * value,
    0,
  );
}
