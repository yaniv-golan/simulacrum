import { immutableCopy } from './observation.mjs';

/** Workshop floor in SI units. Terrain qualification uses its own frozen apparatus. */
export const BUILD_ENVIRONMENT = immutableCopy({
  gravity: [0, -9.81, 0],
  ground: {
    position: [0, -0.1, 0],
    halfExtents: [100, 0.1, 100],
    friction: 0.6,
    restitution: 0,
  },
});

/** Bounded saved workshop choices. The same preset applies to every machine. */
export const ENVIRONMENT_PRESETS = immutableCopy({
  flat: { label: 'Flat floor', obstacles: [] },
  'rounded-bump': {
    label: 'Rounded bump (1 cm)',
    obstacles: [
      {
        shape: 'cylinder',
        halfExtents: [1, 0.03, 0.03],
        position: [0.14, -0.02, -0.6],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        mass: 1,
        fixed: true,
        friction: 0.8,
        restitution: 0,
      },
    ],
  },
});
export function environmentObstacles(environment = 'flat') {
  if (typeof environment !== 'string' || !Object.hasOwn(ENVIRONMENT_PRESETS, environment))
    throw new TypeError('INVALID_BLUEPRINT');
  return ENVIRONMENT_PRESETS[environment].obstacles;
}
