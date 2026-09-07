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
        { own: edge.a, endpoint: edge.b, connectionId: edge.id },
        { own: edge.b, endpoint: edge.a, connectionId: edge.id },
      ])
      .filter(({ own }) => own.part === node && (!port || own.port === port))
      .filter(({ endpoint }) => parts.has(endpoint.part));
  const queue = parts.has(id) ? [id] : [];
  /** @type {Map<string, {part:string,connectionId:string} | null>} */
  const previous = new Map(queue.map((key) => [key, null]));
  const powerSources = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const part = parts.get(node);
    if (part?.type === 'powerCell') powerSources.push(part);
    for (const { endpoint: peer, connectionId } of peers(node, 'power', 'power')) {
      if (peer.port !== 'power' || previous.has(peer.part)) continue;
      previous.set(peer.part, { part: node, connectionId });
      queue.push(peer.part);
    }
  }
  const path = [];
  const powerConnectionIds = [];
  /** @type {string | undefined} */
  let key = powerSources[0]?.id;
  while (key != null) {
    const part = parts.get(key);
    if (part) path.unshift(part);
    const previousStep = previous.get(key);
    if (previousStep) powerConnectionIds.unshift(previousStep.connectionId);
    key = previousStep?.part;
  }
  const signalPeer = peers(id, 'signal', 'signal')[0];
  const signalEndpoint = signalPeer?.endpoint;
  const shaftConnections = peers(id, 'shaft');
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
    powerConnectionIds,
    signalConnectionIds: signalPeer ? [signalPeer.connectionId] : [],
    shaftConnectionIds: shaftConnections.map((peer) => peer.connectionId),
    signalOwner,
    manualReceiver,
    shaftPeers: shaftConnections.flatMap(({ endpoint: end }) => {
      const part = parts.get(end.part);
      return part ? [part] : [];
    }),
  };
}
