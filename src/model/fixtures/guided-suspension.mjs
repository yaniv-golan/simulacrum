import { DEFAULT_CONTROL_BINDING } from '../control-bindings.mjs';
import { captureAssembly } from '../reusable-assemblies.mjs';
import { createEmptyBlueprint, createPart } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';
import { multiplyQuaternion, rotateVector } from '../transforms.mjs';
export function createPassiveSuspensionCart() {
  let b = createEmptyBlueprint('suspension-cart', 'Suspension cart');
  const add = (t, id) => {
    const p = createPart(t, id, [b.parts.length * 2, 2, 0]);
    const corner = /^(left|right)(-1|1)/.exec(id);
    if (corner)
      p.name = `${corner[1] === 'left' ? 'Left' : 'Right'} ${corner[2] === '-1' ? 'front' : 'rear'} ${p.name.toLowerCase()}`;
    b.parts.push(p);
    return p;
  };
  const f = (part, region, u = 0, v = 0, twist = 0) => ({ part, surface: { region, u, v, twist } }),
    p = (part, port) => ({ part, port });
  const c = (a, z, kind) => {
    b = snapConnection(b, a, z);
    b.connections.push({ id: 'j' + b.connections.length, kind, a, b: z });
  };
  for (const side of ['left', 'right']) for (const z of [-1, 1]) add('chassis', side + z + 'base');
  c(f('left-1base', 'right'), f('right-1base', 'left'), 'fixed');
  // Ordinary longitudinal beams increase axle spacing to 0.84 m. The raised
  // sprung mass needs this pitch leverage to remain stable on its four springs.
  for (const side of ['left', 'right']) {
    const bridge = add('beam', `${side}-bridge`);
    bridge.name = `${side === 'left' ? 'Left' : 'Right'} chassis bridge`;
    bridge.authoredMaterial.body = 'rubber';
    c(f(`${side}-1base`, 'front'), f(bridge.id, 'left'), 'fixed');
    c(f(`${side}1base`, 'back'), f(bridge.id, 'right'), 'fixed');
  }
  for (const side of ['left', 'right'])
    for (const z of [-1, 1]) {
      const id = side + z;
      for (const [t, s] of [
        ['springGuide', 'g'],
        ['springCarriage', 'c'],
        ['passiveBearing', 'b'],
        ['steelAxle', 'a'],
        ['gripWheel', 'w'],
      ]) {
        const q = add(t, id + s);
        if (t === 'springGuide')
          Object.assign(q.parameters, { stiffness: 300, damping: 40, restLength: 0.4 });
        if (t !== 'gripWheel') q.authoredMaterial.body = 'aluminium';
      }
      c(
        f(id + 'base', 'bottom', 0, 0, side === 'right' ? Math.PI : 0),
        f(id + 'g', 'bottom'),
        'fixed',
      );
      c(p(id + 'g', 'slide'), p(id + 'c', 'slide'), 'spring');
      c(f(id + 'c', 'top'), f(id + 'b', 'bottom'), 'fixed');
      c(p(id + 'b', 'shaft'), p(id + 'a', 'left'), 'shaft');
      c(p(id + 'a', 'right'), p(id + 'w', 'axle'), 'shaft');
    }
  for (const p of b.parts) if (p.type === 'chassis') p.authoredMaterial.body = 'rubber';
  // Author ordinary initial height with tires just touching the plane.
  const wheel = b.parts.find((p) => p.id === 'left-1w');
  const dy = 0.1 - wheel.position[1];
  for (const p of b.parts) p.position[1] += dy;

  return b;
}
export function createPoweredSuspensionCart() {
  let b = createEmptyBlueprint('suspension-cart', 'Suspension cart');
  const add = (t, id) => {
    const p = createPart(t, id, [b.parts.length * 2, 2, 0]);
    const corner = /^(left|right)(-1|1)/.exec(id);
    if (corner)
      p.name = `${corner[1] === 'left' ? 'Left' : 'Right'} ${corner[2] === '-1' ? 'front' : 'rear'} ${p.name.toLowerCase()}`;
    b.parts.push(p);
    return p;
  };
  const f = (part, region, u = 0, v = 0, twist = 0) => ({ part, surface: { region, u, v, twist } }),
    p = (part, port) => ({ part, port });
  const c = (a, z, kind) => {
    b = snapConnection(b, a, z);
    b.connections.push({ id: 'j' + b.connections.length, kind, a, b: z });
  };
  for (const side of ['left', 'right']) for (const z of [-1, 1]) add('chassis', side + z + 'base');
  c(f('left-1base', 'right'), f('right-1base', 'left'), 'fixed');
  // Ordinary longitudinal beams increase axle spacing to 0.84 m. The raised
  // sprung mass needs this pitch leverage to remain stable on its four springs.
  for (const side of ['left', 'right']) {
    const bridge = add('beam', `${side}-bridge`);
    bridge.name = `${side === 'left' ? 'Left' : 'Right'} chassis bridge`;
    bridge.authoredMaterial.body = 'rubber';
    c(f(`${side}-1base`, 'front'), f(bridge.id, 'left'), 'fixed');
    c(f(`${side}1base`, 'back'), f(bridge.id, 'right'), 'fixed');
  }
  for (const side of ['left', 'right'])
    for (const z of [-1, 1]) {
      const id = side + z;
      for (const [t, s] of [
        ['springGuide', 'g'],
        ['springCarriage', 'c'],
        ['plate', 'pad'],
        ['poweredMotor', 'b'],
        ['steelAxle', 'a'],
        ['gripWheel', 'w'],
      ]) {
        const q = add(t, id + s);
        if (t === 'springGuide')
          Object.assign(q.parameters, { stiffness: 300, damping: 40, restLength: 0.4 });
        if (t !== 'gripWheel') q.authoredMaterial.body = 'aluminium';
      }
      c(
        f(id + 'base', 'bottom', 0, 0, side === 'right' ? Math.PI : 0),
        f(id + 'g', 'bottom'),
        'fixed',
      );
      c(p(id + 'g', 'slide'), p(id + 'c', 'slide'), 'spring');
      c(f(id + 'c', 'top'), f(id + 'pad', 'bottom'), 'fixed');
      c(f(id + 'pad', 'top', 0, 0, Math.PI), f(id + 'b', 'bottom'), 'fixed');
      c(p(id + 'b', 'shaft'), p(id + 'a', 'left'), 'shaft');
      c(p(id + 'a', 'right'), p(id + 'w', 'axle'), 'shaft');
    }
  for (const p of b.parts) if (p.type === 'chassis') p.authoredMaterial.body = 'rubber';
  add('powerCell', 'cell').authoredMaterial.body = 'rubber';
  const receiver = add('commandReceiver', 'receiver');
  receiver.controlBinding = structuredClone(DEFAULT_CONTROL_BINDING);
  receiver.controlBinding.drive.gain = 0.02;
  c(f('left-1base', 'top', 0, 0.15), f('cell', 'bottom'), 'fixed');
  c(f('right-1base', 'top', 0, 0.15), f('receiver', 'bottom'), 'fixed');
  for (const side of ['left', 'right'])
    for (const z of [-1, 1]) {
      const id = side + z;
      b.parts.find((p) => p.id === id + 'b').parameters.inputPolarity = side === 'right' ? -1 : 1;
      b.connections.push(
        { id: 'power-' + id, kind: 'power', a: p('cell', 'power'), b: p(id + 'b', 'power') },
        {
          id: 'signal-' + id,
          kind: 'signal',
          a: p('receiver', 'signal'),
          b: p(id + 'b', 'signal'),
        },
      );
    }
  // Author ordinary initial height with tires just touching the plane.
  const wheel = b.parts.find((p) => p.id === 'left-1w');
  const dy = 0.1 - wheel.position[1];
  for (const p of b.parts) p.position[1] += dy;

  return b;
}

export function createGuidedSuspensionModule({ driven = false } = {}) {
  const powered = driven;
  const blueprint = powered ? createPoweredSuspensionCart() : createPassiveSuspensionCart();
  const ids = powered
    ? ['left-1g', 'left-1c', 'left-1pad', 'left-1b', 'left-1a']
    : ['left-1g', 'left-1c', 'left-1b', 'left-1a'];
  const ports = [
    {
      name: 'Chassis mount',
      endpoint: { part: 'left-1g', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
    },
    { name: 'Wheel axle', endpoint: { part: 'left-1a', port: 'right' } },
  ];
  if (powered)
    ports.push(
      { name: 'Drive power', endpoint: { part: 'left-1b', port: 'power' } },
      { name: 'Drive command', endpoint: { part: 'left-1b', port: 'signal' } },
    );
  return captureAssembly(blueprint, {
    name: powered ? 'Driven guided wheel suspension' : 'Guided wheel suspension',
    ids,
    ports,
  }).definition;
}

/** A rigid comparison adds only four ordinary surface fasteners to the same hardware. */
export function createSuspensionComparison({
  driven = true,
  rigid = false,
  lengths = [0.101, 0.171],
} = {}) {
  if (
    !Array.isArray(lengths) ||
    lengths.length !== 2 ||
    lengths.some((length) => !Number.isFinite(length) || length < 0.08 || length > 0.4)
  )
    throw new RangeError('Two initial spring lengths must be within 0.08–0.40 m');
  if (rigid && lengths.some((length) => length > 0.36))
    throw new RangeError('This brace cannot be fastened beyond 0.36 m');
  let blueprint = driven ? createPoweredSuspensionCart() : createPassiveSuspensionCart();
  blueprint.id = rigid ? 'rigid-suspension-cart' : 'guided-suspension-cart';
  blueprint.name = rigid ? 'Rigid comparison cart' : 'Guided suspension cart';
  const surface = (part, region, u = 0, v = 0, twist = 0) => ({
    part,
    surface: { region, u, v, twist },
  });
  const fasten = (a, b) => {
    blueprint = snapConnection(blueprint, a, b);
    blueprint.connections.push({
      id: `brace-${blueprint.connections.length}`,
      kind: 'fixed',
      a,
      b,
    });
  };
  for (const side of ['left', 'right'])
    for (const row of [-1, 1]) {
      const id = side + row;
      const length = lengths[row < 0 ? 0 : 1];
      const guide = blueprint.parts.find((part) => part.id === `${id}g`);
      // These are initial authored poses. A player can construct them by connecting
      // at this length and then setting the zero-force length to 0.40 m in Build.
      const shift = rotateVector(guide.rotation, [0, length - 0.4, 0]);
      for (const suffix of driven ? ['c', 'pad', 'b', 'a', 'w'] : ['c', 'b', 'a', 'w']) {
        const part = blueprint.parts.find((part) => part.id === id + suffix);
        part.position = part.position.map((value, axis) => value + shift[axis]);
      }
      for (const [suffix, name] of [
        ['gb', 'Guide brace mount'],
        ['cb', 'Carriage brace mount'],
      ]) {
        const block = createPart('mountingBlock', id + suffix, [5, 5, 5]);
        block.name = `${side === 'left' ? 'Left' : 'Right'} ${row < 0 ? 'front' : 'rear'} ${name.toLowerCase()}`;
        blueprint.parts.push(block);
      }
      const face = rotateVector(guide.rotation, [0, 0, 1])[2] * row > 0 ? 'front' : 'back';
      fasten(surface(`${id}g`, face), surface(`${id}gb`, 'back'));
      fasten(surface(`${id}c`, face), surface(`${id}cb`, 'back'));
      const carriageMount = blueprint.parts.find((part) => part.id === `${id}cb`);
      const offset = rotateVector(carriageMount.rotation, [0, -0.19, 0.1]);
      const beam = createPart(
        'beam',
        `${id}brace`,
        carriageMount.position.map((value, axis) => value + offset[axis]),
      );
      beam.name = `${side === 'left' ? 'Left' : 'Right'} ${row < 0 ? 'front' : 'rear'} suspension brace`;
      beam.authoredMaterial.body = 'rubber';
      beam.rotation = multiplyQuaternion(carriageMount.rotation, [
        0,
        0,
        Math.SQRT1_2,
        Math.SQRT1_2,
      ]);
      blueprint.parts.push(beam);
      // The beam travels with the wheel. Its upper end clears the chassis because
      // the two solid offset mounts place it outside the chassis footprint.
      fasten(surface(beam.id, 'back', 0, 0.19, Math.PI / 2), surface(`${id}cb`, 'front'));
      if (rigid)
        fasten(
          surface(beam.id, 'back', 0, 0.17 - length, Math.PI / 2),
          surface(`${id}gb`, 'front'),
        );
    }
  // Unequal front/rear static lengths imply an ordinary pitched chassis. Rotate
  // the authored mechanism so all four tire centres start at the same height.
  const angle = Math.atan2(lengths[0] - lengths[1], 0.84);
  const pitch = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  for (const part of blueprint.parts) {
    part.position = rotateVector(pitch, part.position);
    part.rotation = multiplyQuaternion(pitch, part.rotation);
    if (part.type === 'poweredMotor')
      Object.assign(part.parameters, { torqueConstant: 2, currentLimit: 10 });
    if (part.type === 'commandReceiver') part.controlBinding.drive.gain = 0.8;
  }
  const wheels = blueprint.parts.filter((part) => part.type === 'gripWheel');
  const offset = [
    0.14 - wheels.reduce((sum, part) => sum + part.position[0], 0) / 4,
    0.1 - wheels[0].position[1],
    -Math.min(...wheels.map((part) => part.position[2])),
  ];
  for (const part of blueprint.parts)
    part.position = part.position.map((value, axis) => value + offset[axis]);
  blueprint.environment = 'rounded-bump';
  return blueprint;
}
