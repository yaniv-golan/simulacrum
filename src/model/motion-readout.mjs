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

/** Bounded numeric readout. RMS is of 100ms-average vertical acceleration, not instantaneous peaks. */
export function createBodyMotionAccumulator() {
  let samples = [],
    startTick = null,
    endTick = null,
    origin = null,
    displacement = 0,
    accelerationSamples = 0,
    meanSquare = 0,
    reason = null;
  function reset() {
    samples = [];
    startTick = endTick = origin = null;
    displacement = 0;
    accelerationSamples = 0;
    meanSquare = 0;
    reason = null;
  }
  const invalidate = (message) => {
    reason ??= message;
  };
  return Object.freeze({
    reset,
    invalidate,
    add(sample) {
      if (reason) return;
      if (
        !sample ||
        !Number.isSafeInteger(sample.tick) ||
        sample.tick < 0 ||
        !Number.isFinite(sample.y) ||
        !Number.isFinite(sample.vy)
      ) {
        invalidate('Invalid completed sample');
        return;
      }
      const last = samples.at(-1);
      if (last && sample.tick === last.tick) {
        if (sample.y !== last.y || sample.vy !== last.vy)
          invalidate('Conflicting same-tick sample');
        return;
      }
      if (last && sample.tick !== last.tick + 1) {
        invalidate('Missing or out-of-order completed sample');
        return;
      }
      if (startTick === null) {
        startTick = sample.tick;
        origin = sample.y;
      }
      endTick = sample.tick;
      displacement = sample.y - origin;
      if (!Number.isFinite(displacement)) {
        invalidate('Measurement overflow');
        return;
      }
      samples.push({ tick: sample.tick, y: sample.y, vy: sample.vy });
      if (samples.length === 13) {
        const acceleration = (sample.vy - samples[0].vy) / 0.1;
        accelerationSamples++;
        meanSquare += (acceleration * acceleration - meanSquare) / accelerationSamples;
        if (!Number.isFinite(meanSquare) || !Number.isFinite(displacement))
          invalidate('Measurement overflow');
        samples.shift();
      }
    },
    read() {
      return Object.freeze({
        status: reason ? 'invalid' : accelerationSamples ? 'ready' : 'waiting',
        reason,
        startTick,
        endTick,
        displacement: reason ? null : displacement,
        accelerationSamples,
        accelerationRms: !reason && accelerationSamples ? Math.sqrt(meanSquare) : null,
      });
    },
  });
}
