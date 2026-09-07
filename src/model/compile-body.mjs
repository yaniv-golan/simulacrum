// @ts-check
import { MATERIALS } from './catalog.mjs';
import { partPrimitives } from './geometry.mjs';
import { normalizeQuaternion } from './transforms.mjs';

/** Compile only authored geometry and material into the numeric physics boundary.
 * @param {import('./generated/blueprint-types.js').Part} part
 * @returns {import('./boundaries.js').BodyConfiguration}
 */
export function compileBody(part) {
  const primitive = partPrimitives(part)[0];
  const material = MATERIALS[part.authoredMaterial[primitive.id] ?? primitive.materialKey];
  // Cylinders use local X: [half length, radius, radius].
  const volume =
    primitive.kind === 'cylinder'
      ? 2 * Math.PI * primitive.halfExtents[0] * primitive.halfExtents[1] ** 2
      : 8 * primitive.halfExtents.reduce((a, b) => a * b, 1);
  return {
    shape: primitive.kind,
    position: [...part.position],
    rotation: normalizeQuaternion(part.rotation),
    velocity: [0, 0, 0],
    mass: volume * material.density,
    halfExtents: [...primitive.halfExtents],
    fixed: false,
    friction: material.friction,
    restitution: material.restitution,
  };
}
