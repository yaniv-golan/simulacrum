// @ts-check
import { MATERIALS } from './catalog.mjs';
/** Resolve ordinary authored contact choices; density always follows material.
 * @param {import('./generated/blueprint-types.js').Part} part
 * @param {import('./boundaries.js').Primitive} primitive
 */
export function contactProperties(part, primitive) {
  const material = MATERIALS[part.authoredMaterial[primitive.id] ?? primitive.materialKey];
  const custom = part.authoredContact?.[primitive.id];
  return {
    ...material,
    friction: custom?.friction ?? material.friction,
    restitution: custom?.restitution ?? material.restitution,
  };
}
