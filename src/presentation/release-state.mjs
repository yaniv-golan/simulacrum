import { CATALOG } from '../model/catalog.mjs';

export function releasedAttachment(connection, parts, couplers) {
  if (connection.kind !== 'fixed') return false;
  return [connection.a, connection.b].some((endpoint) => {
    const index = parts.findIndex((p) => p.id === endpoint.part);
    const part = parts[index];
    return (
      endpoint.surface?.region === CATALOG[part.type].releaseFace &&
      couplers?.some((c) => c.node === index && c.opened)
    );
  });
}
