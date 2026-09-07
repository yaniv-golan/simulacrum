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
      visible: true,
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
