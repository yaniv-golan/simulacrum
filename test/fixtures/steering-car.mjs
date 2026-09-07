import { createEmptyBlueprint, createPart } from '../../src/model/blueprint.mjs';
import { snapConnection } from '../../src/model/assembly.mjs';
export function createSteeringCar() {
  let b = createEmptyBlueprint('ordinary-steering', 'Rear drive and front steering');
  b.parts = [
    ['chassis', 'frame'],
    ['powerCell', 'cell'],
    ['commandReceiver', 'drive'],
    ['commandReceiver', 'steer'],
    ...['left', 'right'].flatMap((side) => [
      ['poweredMotor', `${side}-motor`],
      ['gripWheel', `${side}-rear`],
      ['poweredHinge', `${side}-hinge`],
      ['wheelHub', `${side}-hub`],
      ['gripWheel', `${side}-front`],
    ]),
  ].map(([t, id]) => createPart(t, id, [0, 0.105, 0]));
  b.parts.find((p) => p.id === 'left-motor').parameters.inputPolarity = -1;
  const face = (part, region, u = 0, v = 0) => ({ part, surface: { region, u, v, twist: 0 } });
  const wire = (a, bb, kind) => {
    if (['shaft', 'fixed'].includes(kind)) b = snapConnection(b, a, bb);
    b.connections.push({ id: `c${b.connections.length}`, kind, a, b: bb });
  };
  wire(face('frame', 'top'), face('cell', 'bottom'), 'fixed');
  wire(face('frame', 'top', 0.07, 0.15), face('drive', 'bottom'), 'fixed');
  wire(face('frame', 'top', -0.07, 0.15), face('steer', 'bottom'), 'fixed');
  for (const side of ['left', 'right']) {
    wire(
      face('frame', side, 0, side === 'left' ? 0.15 : -0.15),
      face(`${side}-motor`, 'left'),
      'fixed',
    );
    wire({ part: `${side}-motor`, port: 'shaft' }, { part: `${side}-rear`, port: 'axle' }, 'shaft');
    wire(
      face('frame', side, 0, side === 'left' ? -0.15 : 0.15),
      face(`${side}-hinge`, 'left'),
      'fixed',
    );
    wire(
      { part: `${side}-hinge`, port: 'shaft' },
      { part: `${side}-hub`, port: 'steering' },
      'shaft',
    );
    wire({ part: `${side}-hub`, port: 'shaft' }, { part: `${side}-front`, port: 'axle' }, 'shaft');
    for (const suffix of ['motor', 'hinge'])
      wire({ part: 'cell', port: 'power' }, { part: `${side}-${suffix}`, port: 'power' }, 'power');
    wire({ part: 'steer', port: 'signal' }, { part: `${side}-hinge`, port: 'signal' }, 'signal');
  }
  for (const side of ['left', 'right'])
    wire({ part: 'drive', port: 'signal' }, { part: `${side}-motor`, port: 'signal' }, 'signal');
  return b;
}
