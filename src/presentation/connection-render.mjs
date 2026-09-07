// @ts-check
/** @param {import('./connection-render.js').ConnectionRenderInputs} input
 * @returns {import('./connection-render.js').ConnectionRenderSpec[]} */
export function connectionRenderSpecs(input) {
  const diagnostics = new Map(input.diagnostics.map((row) => [row.id, row.reasonCode]));
  /** @type {import('./connection-render.js').ConnectionRenderSpec[]} */
  const specs = [];
  for (const connection of input.connections) {
    const a = input.resolveEndpoint(connection.a),
      b = input.resolveEndpoint(connection.b);
    if (!a || !b) continue;
    specs.push({
      id: connection.id,
      kind: connection.kind,
      ends: [a, b],
      visible:
        !['power', 'signal'].includes(connection.kind) ||
        input.wiringVisible ||
        input.exploded ||
        connection.id === input.tracedConnectionId ||
        input.revealedConnectionIds.has(connection.id) ||
        [connection.a, connection.b].some(
          (endpoint) =>
            endpoint.part === input.sourceEndpoint?.part &&
            endpoint.port === input.sourceEndpoint?.port,
        ),
      failed: diagnostics.get(connection.id) !== 'OK',
      exploded: input.exploded,
      highlighted:
        input.testConnectionIds.has(connection.id) ||
        connection.id === input.tracedConnectionId ||
        (!input.tracedConnectionId &&
          [connection.a.part, connection.b.part].includes(input.selectedPartId ?? '')),
    });
  }
  return specs;
}

/** View-session preferences only; paused and stepping share the Run preference. */
export function createWiringPreferences() {
  const preferences = { build: true, run: false };
  return {
    /** @param {string} mode */
    read: (mode) => preferences[mode === 'build' ? 'build' : 'run'],
    /** @param {string} mode @param {boolean} visible */
    set(mode, visible) {
      preferences[mode === 'build' ? 'build' : 'run'] = visible;
    },
  };
}
