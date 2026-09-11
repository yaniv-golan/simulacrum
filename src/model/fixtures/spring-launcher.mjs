import { rotateVector, multiplyQuaternion } from '../transforms.mjs';
import { createEmptyBlueprint, createPart } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';
import { DEFAULT_CONTROL_BINDING } from '../control-bindings.mjs';

/** An overhead gate releases a ball using an authored undamped spring. */
export function createSpringLauncher({
  projectile: projectileType = 'ball',
  catcher: withCatcher = true,
} = {}) {
  let blueprint = createEmptyBlueprint('spring-launcher', 'Spring launcher');
  const add = (type, id) => {
    const part = createPart(type, id, [blueprint.parts.length * 2, 2, 0]);
    // Explicit player-selectable materials keep the frame light; the aluminium drop
    // stabilizes gate motion. Projectile material is authored explicitly below.
    part.authoredMaterial.body = 'rubber';
    blueprint.parts.push(part);
    return part;
  };
  const face = (part, region, u = 0, v = 0, twist = 0) => ({
    part,
    surface: { region, u, v, twist },
  });
  const port = (part, port) => ({ part, port });
  const connect = (a, b, kind) => {
    blueprint = snapConnection(blueprint, a, b);
    blueprint.connections.push({ id: `joint-${blueprint.connections.length}`, kind, a, b });
  };
  add('chassis', 'base');
  Object.assign(add('springGuide', 'guide').parameters, {
    stiffness: 300,
    damping: 0,
    restLength: 0.175,
    minLength: 0.08,
    maxLength: 0.4,
  });
  add('springCarriage', 'carriage');
  add('plate', 'support');
  connect(face('base', 'top'), face('support', 'left'), 'fixed');
  connect(face('support', 'top', 0.02), face('guide', 'bottom'), 'fixed');
  connect(port('guide', 'slide'), port('carriage', 'slide'), 'spring');
  add('plate', 'pusher-plate');
  add('shaftMount', 'pusher-spacer');
  add('passiveBearing', 'pusher-bearing');
  Object.assign(add('gripWheel', 'pusher-roller').parameters, { diameter: 0.1 });
  connect(face('carriage', 'top'), face('pusher-plate', 'bottom'), 'fixed');
  connect(
    face('pusher-plate', 'top', 0.04, 0.065, Math.PI / 2),
    face('pusher-spacer', 'bottom'),
    'fixed',
  );
  connect(face('pusher-spacer', 'top'), face('pusher-bearing', 'bottom'), 'fixed');
  connect(port('pusher-bearing', 'shaft'), port('pusher-roller', 'axle'), 'shaft');
  // Ordinary Build sequence: assemble at 175 mm, then set the zero-force length
  // to 385 mm. With 300 N/m stiffness, the authored preload stores 6.615 J.
  blueprint.parts.find((p) => p.id === 'guide').parameters.restLength = 0.385;
  add('chassis', 'side-bed');
  connect(face('base', 'front'), face('side-bed', 'back'), 'fixed');
  let previous = 'side-bed';
  for (let i = 1; i <= 3; i++) {
    const id = `side-extension-${i}`;
    add('chassis', id);
    connect(face(previous, 'left'), face(id, 'right'), 'fixed');
    previous = id;
  }
  add('plate', 'motor-support');
  connect(face(previous, 'top', 0.08), face('motor-support', 'left'), 'fixed');
  add('plate', 'motor-support-high');
  connect(face('motor-support', 'right'), face('motor-support-high', 'left'), 'fixed');
  add('plate', 'crossbar');
  connect(face('motor-support-high', 'back'), face('crossbar', 'left'), 'fixed');
  add('plate', 'crossbar-end');
  connect(face('crossbar', 'right'), face('crossbar-end', 'left'), 'fixed');
  add('plate', 'motor-platform');
  connect(face('motor-platform', 'bottom'), face('crossbar-end', 'front'), 'fixed');
  Object.assign(add('poweredHinge', 'gate-motor').parameters, {
    upperLimit: 0.4,
    lowerLimit: -0.4,
    torqueConstant: 8,
    resistance: 2,
    currentLimit: 2,
    proportionalGain: 100,
    dampingGain: 100,
    integralGain: 0,
  });
  add('shaftMount', 'gate-adapter');
  add('beam', 'gate');
  connect(
    face('motor-platform', 'top', -0.055, -0.04, Math.PI),
    face('gate-motor', 'bottom'),
    'fixed',
  );
  connect(port('gate-motor', 'shaft'), port('gate-adapter', 'shaft'), 'shaft');
  connect(face('gate', 'bottom', -0.18), face('gate-adapter', 'right'), 'fixed');
  add('beam', 'gate-drop').authoredMaterial.body = 'aluminium';
  add('plate', 'gate-drop-plate');
  add('spacerBlock', 'gate-drop-spacer');
  add('spacerBlock', 'gate-bearing-spacer');
  add('passiveBearing', 'gate-roller-bearing');
  Object.assign(add('gripWheel', 'gate-roller').parameters, { diameter: 0.1 });
  connect(face('gate', 'bottom', 0.14), face('gate-drop', 'left'), 'fixed');
  connect(face('gate-drop-plate', 'top'), face('gate-drop', 'right'), 'fixed');
  connect(face('gate-drop-plate', 'bottom'), face('gate-drop-spacer', 'top'), 'fixed');
  connect(face('gate-drop-spacer', 'bottom'), face('gate-bearing-spacer', 'top'), 'fixed');
  connect(face('gate-roller-bearing', 'left'), face('gate-bearing-spacer', 'bottom'), 'fixed');
  connect(port('gate-roller-bearing', 'shaft'), port('gate-roller', 'axle'), 'shaft');
  add('chassis', 'power-bed');
  connect(face('base', 'right'), face('power-bed', 'left'), 'fixed');
  const ball = add(projectileType, 'projectile');
  ball.parameters.diameter = 0.2;
  ball.authoredMaterial.body = 'steel';
  add('powerCell', 'cell');
  const receiver = add('commandReceiver', 'release');
  receiver.name = 'Hold L to open gate';
  receiver.controlBinding = structuredClone(DEFAULT_CONTROL_BINDING);
  receiver.controlBinding.drive.positiveKeys = ['KeyL'];
  receiver.controlBinding.drive.negativeKeys = [];
  connect(face('power-bed', 'top'), face('cell', 'bottom'), 'fixed');
  connect(face('base', 'top', -0.09), face('release', 'bottom'), 'fixed');
  blueprint.connections.push(
    { id: 'power', kind: 'power', a: port('cell', 'power'), b: port('gate-motor', 'power') },
    {
      id: 'release-signal',
      kind: 'signal',
      a: port('release', 'signal'),
      b: port('gate-motor', 'signal'),
    },
  );
  const origin = blueprint.parts.find((p) => p.id === 'base');
  const at = [...origin.position],
    inverse = origin.rotation.map((v, k) => (k < 3 ? -v : v));
  for (const part of blueprint.parts) {
    part.position = rotateVector(
      inverse,
      part.position.map((v, k) => v - at[k]),
    );
    part.position[1] += 0.02;
    part.rotation = multiplyQuaternion(inverse, part.rotation);
  }
  const projectile = blueprint.parts.find((p) => p.id === 'projectile');
  const roller = blueprint.parts.find((p) => p.id === 'pusher-roller');
  projectile.position = [roller.position[0] - 0.15, 0.1, roller.position[2]];
  projectile.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  if (projectileType === 'ball') {
    // Low ordinary guide blocks clear the moving plate and prevent sideways escape.
    for (const [side, z] of [
      ['left', -0.165],
      ['right', 0.165],
    ]) {
      for (let level = 0; level < 2; level++) {
        const id = `ball-guide-${side}-${level}`;
        const block = createPart('shaftMount', id, [-0.505, 0.04 + level * 0.08, z]);
        block.name = `Ball guide ${side}`;
        block.authoredMaterial.body = 'steel';
        blueprint.parts.push(block);
        if (level) connect(face(`ball-guide-${side}-0`, 'top'), face(id, 'bottom'), 'fixed');
      }
    }
  }
  if (!withCatcher) return blueprint;
  // An ordinary U-shaped catcher; its mass and contact retain the moving ball.
  const catcher = (id, position, rotation) => {
    const part = createPart('chassis', id, position);
    part.name = 'Catcher ' + id.split('-').at(-1);
    part.rotation = rotation;
    part.authoredMaterial.body = 'aluminium';
    blueprint.parts.push(part);
    return part;
  };
  const qz = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  catcher('catcher-back', [-1.8, 0.14, -0.05], qz);
  // The wall thickness becomes vertical support height after rotation.
  catcher('catcher-left', [-1.56, 0.14, -0.31], [0.5, 0.5, 0.5, 0.5]);
  catcher('catcher-right', [-1.56, 0.14, 0.21], [0.5, 0.5, 0.5, 0.5]);
  blueprint.assemblies = [
    {
      id: 'catcher',
      name: 'Catcher',
      ids: ['catcher-back', 'catcher-left', 'catcher-right'],
      ports: [],
    },
  ];
  return blueprint;
}
