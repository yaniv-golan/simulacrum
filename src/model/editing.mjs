import { mechanicalGroup } from './connection-graph.mjs';
import { transformPoseBetweenFrames } from './transforms.mjs';
import { validateBlueprint } from './blueprint.mjs';
function reject(reasonCode, path) {
  throw Object.assign(Error(reasonCode), { reasonCode, path });
}
// Authoring transforms operate on the mechanical component, never on live physics.
export function transformGroup(blueprint, id, position, rotation) {
  const original = blueprint.parts.find((part) => part.id === id);
  if (!original) reject('UNKNOWN_PART', 'id');
  const next = structuredClone(blueprint),
    target = next.parts.find((part) => part.id === id);
  target.position = position;
  target.rotation = rotation;
  const validation = validateBlueprint(next);
  if (!validation.ok) reject(validation.reasonCode, validation.path);
  const group = new Set(mechanicalGroup(blueprint, id));
  for (const part of next.parts)
    if (part.id !== id && group.has(part.id)) {
      Object.assign(part, transformPoseBetweenFrames(part, original, { position, rotation }));
    }
  return next;
}
