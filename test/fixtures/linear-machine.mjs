import { createPart, createEmptyBlueprint } from '../../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../../src/model/assembly.mjs';
export function machine() {
  let b = createEmptyBlueprint('linear-test', 'Linear test');
  b.parts = [
    createPart('linearActuator', 'drive', [0, 1, 0]),
    createPart('springCarriage', 'output', [0, 2, 0]),
    createPart('powerCell', 'cell', [2, 0.1, 0]),
    createPart('commandReceiver', 'keys', [3, 0.1, 0]),
  ];
  const a = { part: 'drive', port: 'slide' },
    c = { part: 'output', port: 'slide' };
  b = snapConnection(b, a, c);
  b.connections = [
    { id: 'slide', kind: 'spring', a, b: c },
    {
      id: 'power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'drive', port: 'power' },
    },
    {
      id: 'keys',
      kind: 'signal',
      a: { part: 'keys', port: 'signal' },
      b: { part: 'drive', port: 'signal' },
    },
  ];
  return b;
}
export function configuration({
  fixed = true,
  mass = 1,
  duty = 1,
  powered = true,
  gravity = -9.81,
} = {}) {
  const c = compileAssembly(machine()).configuration;
  c.gravity = [0, gravity, 0];
  c.bodies[0].fixed = fixed;
  c.bodies[1].mass = mass;
  c.power.receivers[0].duty = duty;
  if (!powered) c.power.wires = [];
  return c;
}
