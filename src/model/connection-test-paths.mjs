// @ts-check
/** @typedef {import('./generated/blueprint-types.js').Blueprint} Blueprint */
/** @typedef {import('./generated/blueprint-types.js').Part} Part */
/** @typedef {import('./generated/blueprint-types.js').Endpoint} Endpoint */
/** An incoming command wire gives the receiver's control to its authored upstream source.
 * @param {import('./boundaries.js').DeepReadonly<Blueprint>} blueprint @param {string} id
 */
export function receiverControlOwner(blueprint, id) {
  const edge = blueprint.connections.find(
    (edge) =>
      edge.kind === 'signal' &&
      [edge.a, edge.b].some((end) => end.part === id && end.port === 'command'),
  );
  if (!edge) return null;
  const peer = edge.a.part === id ? edge.b : edge.a;
  return blueprint.parts.find((part) => part.id === peer.part) ?? null;
}

/** Read authored connectivity only; this graph grants no actuator authority.
 * @param {import('./boundaries.js').DeepReadonly<Blueprint>} blueprint @param {string} id
 */
export function connectionTestPaths(blueprint, id) {
  const parts = new Map(blueprint.parts.map((part) => [part.id, part]));
  const edges = blueprint.connections;
  /** @param {string} node @param {Blueprint['connections'][number]['kind']} kind @param {string} [port] */
  const peers = (node, kind, port) =>
    edges
      .filter((edge) => edge.kind === kind)
      .flatMap((edge) => [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ])
      .filter(([own]) => own.part === node && (!port || own.port === port))
      .map(([, other]) => other)
      .filter((end) => parts.has(end.part));
  const queue = parts.has(id) ? [id] : [];
  /** @type {Map<string, string | null>} */
  const previous = new Map(queue.map((key) => [key, null]));
  const powerSources = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const part = parts.get(node);
    if (part?.type === 'powerCell') powerSources.push(part);
    for (const peer of peers(node, 'power', 'power')) {
      if (peer.port !== 'power' || previous.has(peer.part)) continue;
      previous.set(peer.part, node);
      queue.push(peer.part);
    }
  }
  const path = [];
  /** @type {string | undefined} */
  let key = powerSources[0]?.id;
  for (; key != null; key = previous.get(key) ?? undefined) {
    const part = parts.get(key);
    if (part) path.unshift(part);
  }
  const signalEndpoint = peers(id, 'signal', 'signal')[0];
  const signalOwner = (signalEndpoint ? parts.get(signalEndpoint.part) : null) ?? null;
  const manualReceiver =
    signalOwner?.type === 'commandReceiver' &&
    signalEndpoint?.port === 'signal' &&
    !receiverControlOwner(blueprint, signalOwner.id)
      ? signalOwner
      : null;
  return {
    powerSources,
    powerPath: path,
    signalOwner,
    manualReceiver,
    shaftPeers: peers(id, 'shaft').flatMap((end) => {
      const part = parts.get(end.part);
      return part ? [part] : [];
    }),
  };
}
