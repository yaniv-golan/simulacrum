import { readBody } from '../../src/simulation/physics/read-body.mjs';
readBody({
  translation: () => ({ x: 'one metre', y: 0, z: 0 }),
  rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  linvel: () => ({ x: 0, y: 0, z: 0 }),
  angvel: () => ({ x: 0, y: 0, z: 0 }),
  mass: () => 1,
});
