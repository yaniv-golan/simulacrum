// @ts-check
import { rotateVector } from './transforms.mjs';
/** Frozen collision resolution for every canonical local-X cylinder. */
export const CYLINDER_SEGMENTS = 64;
export const CYLINDER_MAX_RADIAL_ERROR_RATIO = 1 - Math.cos(Math.PI / CYLINDER_SEGMENTS);
import { CATALOG } from './catalog.mjs';
import { gearFacts } from './gear-geometry.mjs';
/** Authored dimensions override the canonical catalog geometry. */
/** @param {import('./generated/blueprint-types.js').Part} part @returns {readonly import('./boundaries.js').Primitive[]} */
export function partPrimitives(part) {
  const definition = CATALOG[part.type];
  if (definition.parameterDefinitions.length) {
    // Length runs along local X; the section is fixed by the canonical primitive.
    const length =
      ('length' in part.parameters ? part.parameters.length : undefined) ??
      definition.parameterDefinitions.length.default;
    return definition.primitives.map((primitive) =>
      primitive.kind === 'box'
        ? {
            ...primitive,
            halfExtents: [length / 2, primitive.halfExtents[1], primitive.halfExtents[2]],
          }
        : primitive,
    );
  }
  // A gear's collider is the root cylinder of its authored teeth and module. gearFacts resolves
  // exactly when the catalog declares the gear capability, so this is the same capability
  // dispatch as length and diameter above -- never a part type or name -- and it is what makes
  // mass, inertia and picking follow the teeth. The axial half-extent is the face width and is
  // not authored.
  const gear = gearFacts(part);
  if (gear) {
    const radius = gear.colliderRadius;
    return definition.primitives.map((primitive) =>
      primitive.kind === 'cylinder'
        ? { ...primitive, halfExtents: [primitive.halfExtents[0], radius, radius] }
        : primitive,
    );
  }
  if (!definition.parameterDefinitions.diameter) return definition.primitives;
  const radius =
    (('diameter' in part.parameters ? part.parameters.diameter : undefined) ??
      definition.parameterDefinitions.diameter.default) / 2;
  return definition.primitives.map((primitive) => ({
    ...primitive,
    halfExtents:
      primitive.kind === 'sphere'
        ? [radius, radius, radius]
        : [primitive.halfExtents[0], radius, radius],
  }));
}

/** Exposed socket-to-solid shafts, using ray/box entry along the authored axis. */
/** @param {import('./generated/blueprint-types.js').Part} part */
export function shaftSegments(part) {
  const half = partPrimitives(part)[0].halfExtents;
  return CATALOG[part.type].ports
    .filter((p) => p.kind === 'shaft')
    .flatMap((p) => {
      const axis = rotateVector(p.rotation, [1, 0, 0]);
      /** @param {number} sign */
      const entry = (sign) => {
        let near = -Infinity,
          far = Infinity;
        for (let i = 0; i < 3; i++) {
          const direction = axis[i] * sign;
          if (Math.abs(direction) < 1e-12) {
            if (Math.abs(p.position[i]) > half[i]) return null;
            continue;
          }
          const a = (-half[i] - p.position[i]) / direction,
            b = (half[i] - p.position[i]) / direction;
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
        }
        return far >= Math.max(0, near) ? Math.max(0, near) : null;
      };
      const options = [1, -1]
        .flatMap((sign) => {
          const length = entry(sign);
          return length === null ? [] : [{ sign, length }];
        })
        .sort((a, b) => a.length - b.length);
      const selected = options[0];
      if (!selected || selected.length <= 1e-12) return [];
      return [
        {
          port: p.id,
          length: selected.length,
          axis,
          rotation: [...p.rotation],
          position: p.position.map((v, i) => v + (axis[i] * selected.sign * selected.length) / 2),
        },
      ];
    });
}
