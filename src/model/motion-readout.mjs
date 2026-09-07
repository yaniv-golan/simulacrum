import { BUILD_ENVIRONMENT } from './environment.mjs';
// Completed telemetry only. Fixed terrain after the authored body mapping is
// excluded. The readout measures the whole machine, including detached parts.
export function machineMotion(frame) {
  const bodies = frame.physics.slice(0, frame.metadata.blueprint.parts.length);
  const mass = bodies.reduce((sum, body) => sum + body.mass, 0);
  if (!mass) return null;
  const average = (key) =>
    [0, 1, 2].map(
      (axis) => bodies.reduce((sum, body) => sum + body[key][axis] * body.mass, 0) / mass,
    );
  return { center: average('position'), speed: Math.hypot(...average('velocity')) };
}

/** Boundary diagnostics use the configured workshop ground, never a support force. */
export function machineBoundary(frame, ground = BUILD_ENVIRONMENT.ground) {
  if (!ground) return null;
  const bodies = frame.physics.slice(0, frame.metadata.blueprint.parts.length);
  if (!bodies.length) return null;
  const surface = ground.position[1] + ground.halfExtents[1];
  if (bodies.some((b) => b.position[1] < surface - 2))
    return {
      kind: 'fallen',
      message:
        'A machine part has fallen below the workshop floor. Choose Return to Build to recover.',
    };
  const distance = Math.min(
    ...bodies.flatMap((b) =>
      [0, 2].map(
        (axis) => ground.halfExtents[axis] - Math.abs(b.position[axis] - ground.position[axis]),
      ),
    ),
  );
  if (distance < 0)
    return {
      kind: 'outside',
      message:
        'The machine has reached beyond the workshop floor. Choose Return to Build to recover.',
    };
  if (distance <= 10)
    return {
      kind: 'near',
      message: `Workshop edge ${distance.toFixed(1)} m away. Turn back or choose Return to Build.`,
    };
  return null;
}
