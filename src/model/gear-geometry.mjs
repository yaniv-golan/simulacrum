// @ts-check
import { CATALOG } from './catalog.mjs';

/** The one place a gear's authored tooth count and module become lengths.
 *
 * Nothing stores a pitch or collider radius: a stored radius would be a second writer of the
 * same quantity and could disagree with teeth x module / 2. Absent parameters fall back to the
 * definition's own defaults, which is the same rule the canonical primitive follows, so a gear
 * authored without parameters resolves to exactly the shipped disc.
 *
 * The collider is the root cylinder one module inside the pitch circle: a correctly spaced pair
 * therefore leaves a gap of two modules and the hulls never touch, which is why the mesh joint,
 * not contact, is what transmits.
 *
 * @param {import('./generated/blueprint-types.js').Part} part
 * @returns {{ teeth: number, module: number, pitchRadius: number, colliderRadius: number, stiffness: number, damping: number } | undefined}
 */
export function gearFacts(part) {
  const definition = CATALOG[part.type],
    gear = definition?.gear;
  if (!gear) return undefined;
  const definitions = definition.parameterDefinitions;
  const authored = part.parameters ?? {};
  const teeth = ('teeth' in authored ? authored.teeth : undefined) ?? definitions.teeth.default,
    module = ('module' in authored ? authored.module : undefined) ?? definitions.module.default;
  const pitchRadius = (module * teeth) / 2;
  return {
    teeth,
    module,
    pitchRadius,
    // m(z-2)/2 rather than mz/2 - m: the same number, but it lands on the canonical primitive
    // exactly at the default count instead of one unit in the last place below it.
    colliderRadius: (module * (teeth - 2)) / 2,
    stiffness: gear.stiffness,
    damping: gear.damping,
  };
}
