import { createEmptyBlueprint, createPart } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';
import { controlBindingPreset } from '../control-bindings.mjs';

/** Ordinary editable four-wheel machine; +Z is its authored forward direction. */
export function createDrivingMachine() {
  let blueprint = createEmptyBlueprint('driving-machine', 'Drive and steer');
  blueprint.parts = [
    ['chassis', 'frame'],
    ['powerCell', 'cell'],
    ['poweredMotor', 'left-motor'],
    ['gripWheel', 'left-wheel'],
    ['poweredMotor', 'right-motor'],
    ['gripWheel', 'right-wheel'],
    ['passiveBearing', 'left-bearing'],
    ['gripWheel', 'left-support'],
    ['passiveBearing', 'right-bearing'],
    ['gripWheel', 'right-support'],
    ['commandReceiver', 'left-control'],
    ['commandReceiver', 'right-control'],
  ].map(([type, id]) => createPart(type, id, [0, 0.105, 0]));
  for (const part of blueprint.parts)
    if (part.type === 'poweredMotor') {
      part.parameters.torqueConstant = 0.4;
      part.authoredMaterial.body = 'aluminium';
    }
  blueprint.parts.find((p) => p.id === 'cell').authoredMaterial.body = 'aluminium';
  const face = (part, region, u = 0, v = 0) => ({ part, surface: { region, u, v, twist: 0 } });
  function connect(a, b, kind) {
    if (kind === 'fixed' || kind === 'shaft') blueprint = snapConnection(blueprint, a, b);
    blueprint.connections.push({ id: `connection-${blueprint.connections.length}`, kind, a, b });
  }
  for (const side of ['left', 'right']) {
    connect(face('frame', side, 0, 0), face(`${side}-motor`, 'left'), 'fixed');
    connect(
      { part: `${side}-motor`, port: 'shaft' },
      { part: `${side}-wheel`, port: 'axle' },
      'shaft',
    );
    connect(
      face('frame', side, 0, side === 'left' ? -0.18 : 0.18),
      face(`${side}-bearing`, 'left'),
      'fixed',
    );
    connect(
      { part: `${side}-bearing`, port: 'shaft' },
      { part: `${side}-support`, port: 'axle' },
      'shaft',
    );
    connect({ part: 'cell', port: 'power' }, { part: `${side}-motor`, port: 'power' }, 'power');
    connect(
      face('frame', 'top', side === 'left' ? 0.07 : -0.07, 0.15),
      face(`${side}-control`, 'bottom'),
      'fixed',
    );
    connect(
      { part: `${side}-control`, port: 'signal' },
      { part: `${side}-motor`, port: 'signal' },
      'signal',
    );
  }
  connect(face('frame', 'top'), face('cell', 'bottom'), 'fixed');
  for (const side of ['left', 'right']) {
    const control = blueprint.parts.find((p) => p.id === `${side}-control`);
    control.controlBinding = controlBindingPreset(`${side}Drive`);
    control.controlBinding.drive.gain *= 0.4;
    control.controlBinding.steer.gain *= 0.4;
    if (side === 'left') {
      control.controlBinding.drive.gain *= -1;
      control.controlBinding.steer.gain *= -1;
    }
  }
  const names = {
    frame: 'Chassis',
    cell: 'Shared cell',
    'left-motor': 'Left motor',
    'right-motor': 'Right motor',
    'left-wheel': 'Left drive wheel',
    'right-wheel': 'Right drive wheel',
    'left-bearing': 'Left support bearing',
    'right-bearing': 'Right support bearing',
    'left-support': 'Left support wheel',
    'right-support': 'Right support wheel',
    'left-control': 'Left drive',
    'right-control': 'Right drive',
  };
  for (const part of blueprint.parts) part.name = names[part.id];
  return blueprint;
}
