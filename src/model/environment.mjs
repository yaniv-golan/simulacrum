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
