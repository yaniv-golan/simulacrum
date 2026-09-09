// @ts-check
/** @typedef {import('./generated/blueprint-types.js').Part} Part */
/** @typedef {import('./generated/blueprint-types.js').Connection} Connection */
/** @typedef {import('./boundaries.js').DeepReadonly<Connection>} ReadonlyConnection */
/** @typedef {{parts: readonly Pick<Part,'id'>[], connections: readonly ReadonlyConnection[]}} ConnectionGraph */

/** Preserve authored scan order; callers own any geometric eligibility policy.
 * @param {ConnectionGraph} blueprint
 * @param {string} id
 * @param {{omitConnectionIds?: readonly string[], eligible?: (connection: ReadonlyConnection) => boolean}} options
 * @returns {string[]}
 */
export function mechanicalGroup(
  blueprint,
  id,
  { omitConnectionIds = [], eligible = () => true } = {},
) {
  if (!blueprint.parts.some((part) => part.id === id)) return [];
  const group = new Set([id]),
    omitted = new Set(omitConnectionIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of blueprint.connections)
      if (
        (edge.kind === 'fixed' || edge.kind === 'shaft' || edge.kind === 'spring') &&
        !omitted.has(edge.id) &&
        eligible(edge) &&
        (group.has(edge.a.part) || group.has(edge.b.part))
      )
        for (const member of [edge.a.part, edge.b.part])
          if (!group.has(member)) {
            group.add(member);
            changed = true;
          }
  }
  return [...group];
}
/** Classify authored edges without assigning attachment, copying, or wiring policy.
 * @param {ConnectionGraph} blueprint
 * @param {readonly string[]} ids
 * @returns {{connection: ReadonlyConnection, classification:'internal'|'boundary'|'external'}[]}
 */
export function classifySelectionConnections(blueprint, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw Object.assign(Error('INVALID_COMMAND'), { reasonCode: 'INVALID_COMMAND', path: 'ids' });
  const known = new Set(blueprint.parts.map((part) => part.id));
  if (ids.some((id) => !known.has(id)))
    throw Object.assign(Error('UNKNOWN_PART'), { reasonCode: 'UNKNOWN_PART', path: 'ids' });
  const selected = new Set(ids);
  return blueprint.connections.map((connection) => {
    const a = selected.has(connection.a.part),
      b = selected.has(connection.b.part);
    return { connection, classification: a && b ? 'internal' : a || b ? 'boundary' : 'external' };
  });
}
