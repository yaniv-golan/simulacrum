import { mechanicalGroup } from './connection-graph.mjs';
import { transformPoseBetweenFrames } from './transforms.mjs';
import { validateBlueprint } from './blueprint.mjs';
import { resolveSurfaceEndpoint } from './surfaces.mjs';
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
/** A dimension edit may not move a surface attachment of any connection kind: the peer
 * keeps its pose, so the pair would compile misaligned and separate in Run. Bindings the
 * new geometry cannot host are left to blueprint validation (SURFACE_OUT_OF_BOUNDS). */
export function resizeMovesMount(blueprint, id, parameters) {
  const part = blueprint.parts.find((p) => p.id === id);
  if (!part) reject('UNKNOWN_PART', 'id');
  const resized = { ...part, parameters };
  const local = (subject, endpoint) => {
    try {
      return resolveSurfaceEndpoint(subject, endpoint).position;
    } catch {
      return null;
    }
  };
  return blueprint.connections.some((connection) =>
    [connection.a, connection.b].some((endpoint) => {
      if (endpoint.part !== id || !endpoint.surface) return false;
      const before = local(part, endpoint),
        after = local(resized, endpoint);
      return !!before && !!after && before.some((x, i) => Math.abs(x - after[i]) > 1e-9);
    }),
  );
}
