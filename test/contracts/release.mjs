import { createEmptyBlueprint, createPart } from '../../src/model/blueprint.mjs';
import { snapConnection } from '../../src/model/assembly.mjs';
export function couplerFixture() {
  let b = createEmptyBlueprint('cargo', 'Cargo');
  b.parts.push(
    createPart('releaseCoupler', 'latch', [0, 1, 0]),
    createPart('spacerBlock', 'cargo', [1, 1, 0]),
    createPart('powerCell', 'cell', [-1, 1, 0]),
    createPart('commandReceiver', 'keys', [-2, 1, 0]),
  );
  const a = { part: 'latch', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    c = { part: 'cargo', surface: { region: 'left', u: 0, v: 0, twist: 0 } };
  b = snapConnection(b, a, c);
  b.connections.push(
    { id: 'load', kind: 'fixed', a, b: c },
    {
      id: 'power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'latch', port: 'power' },
    },
    {
      id: 'control',
      kind: 'signal',
      a: { part: 'keys', port: 'signal' },
      b: { part: 'latch', port: 'signal' },
    },
  );
  return b;
}
