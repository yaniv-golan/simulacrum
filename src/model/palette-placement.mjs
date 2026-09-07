import { createPart } from './blueprint.mjs';
import { findPlacementOverlap } from './surfaces.mjs';
/** Click-to-add searches ordinary authored poses; explicit player placement never uses this. */
export function palettePlacement(blueprint, type, id, start = 0) {
  for (let index = start; index < start + 100; index++) {
    const position = [((index % 5) - 2) * 0.45, 0.4, Math.floor(index / 5) * 0.4];
    if (!findPlacementOverlap([...blueprint.parts, createPart(type, id, position)]))
      return { position, index };
  }
  throw Object.assign(new Error('NO_FREE_PLACEMENT'), {
    reasonCode: 'SURFACE_OVERLAP',
    path: 'parts',
  });
}
