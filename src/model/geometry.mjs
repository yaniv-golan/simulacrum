import { rotateVector } from './transforms.mjs';
/** Frozen collision resolution for every canonical local-X cylinder. */
export const CYLINDER_SEGMENTS = 64;
export const CYLINDER_MAX_RADIAL_ERROR_RATIO = 1 - Math.cos(Math.PI / CYLINDER_SEGMENTS);
import { CATALOG } from './catalog.mjs';
/** Authored dimensions override the canonical catalog geometry. */
export function partPrimitives(part) {
  const definition = CATALOG[part.type];
  if (!definition.parameterDefinitions.diameter) return definition.primitives;
  const radius = (part.parameters.diameter ?? definition.parameterDefinitions.diameter.default) / 2;
  return definition.primitives.map((primitive) => ({
    ...primitive,
    halfExtents: [primitive.halfExtents[0], radius, radius],
  }));
}

/** Exposed socket-to-solid shafts, using ray/box entry along the authored axis. */
export function shaftSegments(part) {
  const half = partPrimitives(part)[0].halfExtents;
  return CATALOG[part.type].ports
    .filter((p) => p.kind === 'shaft')
    .flatMap((p) => {
      const axis = rotateVector(p.rotation, [1, 0, 0]);
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
        .map((sign) => ({ sign, length: entry(sign) }))
        .filter((x) => x.length !== null)
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
