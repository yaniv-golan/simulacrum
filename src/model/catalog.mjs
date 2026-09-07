// @ts-check
/** @typedef {import('./boundaries.js').CatalogDefinition} CatalogDefinition */
/** @typedef {import('./boundaries.js').Port} Port */
/** @typedef {import('./boundaries.js').Vec3} Vec3 */
import { DEFAULT_CONTROL_BINDING } from './control-bindings.mjs';
// Geometry dimensions are in metres. Material values are explicit selectable
// workshop parameters; friction values are nominal, not measured surface pairs.
/** @template T @param {T} value @returns {T} */
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const MATERIALS = freeze({
  aluminium: { handle: 0, density: 2700, friction: 0.5, restitution: 0.1, selectable: true },
  steel: { handle: 1, density: 7850, friction: 0.4, restitution: 0.1, selectable: true },
  rubber: { handle: 2, density: 1100, friction: 0.9, restitution: 0.2, selectable: true },
});

/** @param {number} defaultValue @param {number} minimum @param {number} maximum @param {string} unit @returns {import('./boundaries.js').ParameterDefinition} */
function rating(defaultValue, minimum, maximum, unit) {
  return { type: 'number', default: defaultValue, minimum, maximum, unit };
}
/** @param {string} id @param {Port['kind']} kind @param {Vec3} position @returns {Port} */
function port(id, kind, position) {
  return {
    id,
    kind,
    multiplicity: 'one',
    direction: 'bidirectional',
    position,
    rotation: [0, 0, 0, 1],
  };
}
/** @returns {Port} */
function power() {
  return { ...port('power', 'power', [0, 0, 0]), multiplicity: 'many' };
}
/** @param {string} id @param {Port['direction']} direction @returns {Port} */
function signal(id, direction) {
  return {
    ...port(id, 'signal', [0, 0, 0]),
    direction,
    multiplicity: direction === 'output' ? 'many' : 'one',
  };
}
/**
 * @param {CatalogDefinition['type']} type
 * @param {string} name
 * @param {Vec3} halfExtents
 * @param {import('./generated/blueprint-types.js').MaterialKey} materialKey
 * @param {Port[]} ports
 * @param {CatalogDefinition['parameterDefinitions']} parameterDefinitions
 * @param {'box' | 'cylinder'} [kind]
 * @returns {CatalogDefinition}
 */
function component(
  type,
  name,
  halfExtents,
  materialKey,
  ports,
  parameterDefinitions,
  kind = 'box',
) {
  // Wiring endpoints are authored surface positions, shared by compiler and view.
  const surfaced = ports.map(
    /** @returns {Port} */ (p) => {
      if (!['power', 'signal'].includes(p.kind)) return p;
      const face = p.kind === 'power' ? 'top' : p.direction === 'input' ? 'back' : 'front';
      const peers = ports.filter(
        (other) => other.kind === p.kind && (p.kind === 'power' || other.direction === p.direction),
      );
      const x = halfExtents[0] * ((2 * (peers.indexOf(p) + 1)) / (peers.length + 1) - 1);
      return {
        ...p,
        position:
          face === 'top'
            ? [x, halfExtents[1], 0]
            : [x, 0, face === 'back' ? -halfExtents[2] : halfExtents[2]],
      };
    },
  );
  return {
    type,
    name,
    milestone: 'M3',
    parameterDefinitions,
    mountingFaces: kind === 'box' ? ['bottom', 'left'] : ['right'],
    primitives: [
      { id: 'body', kind, halfExtents, position: [0, 0, 0], rotation: [0, 0, 0, 1], materialKey },
    ],
    ports: surfaced,
  };
}

// Fixed-port local +X points outward. Mating opposes the two normals via a
// half-turn around port Y. Shaft frames instead coincide along local +X.
// A single solid steering arm slopes down from its input bearing to the wheel
// axle. Port frames express the same authored tilt as the collision cuboid.
const hubTilt = Math.atan2(0.07, 0.1),
  hubHalfLength = Math.hypot(0.1, 0.07) / 2;
/** @param {number} angle @returns {import('./boundaries.js').Quaternion} */
const aboutZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
/** @type {Readonly<Record<import('./generated/blueprint-types.js').PartType, CatalogDefinition>>} */
export const CATALOG = freeze({
  beam: {
    mountingFaces: ['right', 'left', 'top', 'bottom', 'front', 'back'],
    type: 'beam',
    name: 'Beam',
    milestone: 'M2',
    parameterDefinitions: {},
    primitives: [
      {
        id: 'body',
        kind: 'box',
        halfExtents: [0.2, 0.02, 0.02],
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        materialKey: 'aluminium',
      },
    ],
    ports: [],
  },
  plate: {
    mountingFaces: ['right', 'left', 'top', 'bottom', 'front', 'back'],
    type: 'plate',
    name: 'Plate',
    milestone: 'M2',
    parameterDefinitions: {},
    primitives: [
      {
        id: 'body',
        kind: 'box',
        halfExtents: [0.12, 0.01, 0.12],
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        materialKey: 'aluminium',
      },
    ],
    ports: [],
  },
  powerCell: component('powerCell', 'Power Cell', [0.1, 0.05, 0.06], 'steel', [power()], {
    voltage: rating(24, 0.1, 240, 'V'),
    capacityJ: rating(36000, 1, 1e9, 'J'),
    internalResistance: rating(0.1, 0.001, 100, 'ohm'),
    currentLimit: rating(20, 0.01, 1000, 'A'),
  }),
  distributionBus: component(
    'distributionBus',
    'Distribution Bus',
    [0.04, 0.02, 0.03],
    'aluminium',
    [power()],
    {},
  ),
  poweredMotor: {
    ...component(
      'poweredMotor',
      'Powered Motor',
      [0.08, 0.06, 0.06],
      'steel',
      [port('shaft', 'shaft', [0.12, 0, 0]), power(), signal('signal', 'input')],
      {
        torqueConstant: rating(0.4, 0.001, 100, 'N m/A'),
        resistance: rating(1, 0.001, 1000, 'ohm'),
        currentLimit: rating(10, 0.01, 1000, 'A'),
        defaultDuty: rating(1, -1, 1, 'ratio'),
        inputPolarity: {
          ...rating(1, -1, 1, 'sign'),
          type: 'integer',
          enum: [-1, 1],
          optional: true,
        },
      },
    ),
    mountingFaces: ['bottom', 'left'],
    mountingPads: { left: [0.02, 0.04] },
  },
  poweredHinge: {
    ...component(
      'poweredHinge',
      'Powered Hinge',
      [0.025, 0.025, 0.05],
      'aluminium',
      [
        { ...port('shaft', 'shaft', [0, 0.05, 0]), rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
        power(),
        signal('signal', 'input'),
      ],
      {
        torqueConstant: rating(0.6, 0.001, 100, 'N m/A'),
        resistance: rating(2, 0.001, 1000, 'ohm'),
        currentLimit: rating(8, 0.01, 1000, 'A'),
        defaultTarget: rating(0, -1, 1, 'ratio'),
        inputPolarity: {
          ...rating(1, -1, 1, 'sign'),
          type: 'integer',
          enum: [-1, 1],
          optional: true,
        },
        lowerLimit: rating(-0.6, -3, -0.01, 'rad'),
        upperLimit: rating(0.6, 0.01, 3, 'rad'),
        proportionalGain: rating(10, 0.01, 100, '1/rad'),
        dampingGain: rating(0.1, 0, 100, 's/rad'),
        integralGain: { ...rating(3, 0, 100, '1/(rad s)'), optional: true },
      },
    ),
    milestone: 'M3b',
    mountingPads: { left: [0.02, 0.04] },
  },
  wheelHub: {
    ...component(
      'wheelHub',
      'Wheel Hub',
      [hubHalfLength, 0.0075, 0.07],
      'aluminium',
      [
        {
          ...port('steering', 'shaft', [
            -hubHalfLength + 0.02 * Math.sin(hubTilt),
            -0.02 * Math.cos(hubTilt),
            0,
          ]),
          rotation: aboutZ(Math.PI / 2 + hubTilt),
        },
        {
          ...port('shaft', 'shaft', [
            hubHalfLength + 0.008 * Math.cos(hubTilt),
            0.008 * Math.sin(hubTilt),
            0,
          ]),
          rotation: aboutZ(hubTilt),
          joint: 'revolute',
        },
      ],
      {},
    ),
    milestone: 'M3b',
  },
  steelAxle: {
    ...component(
      'steelAxle',
      'Steel Axle',
      [0.06, 0.015, 0.015],
      'steel',
      [port('left', 'shaft', [-0.06, 0, 0]), port('right', 'shaft', [0.06, 0, 0])],
      {},
    ),
    mountingFaces: [],
  },
  gripWheel: {
    ...component(
      'gripWheel',
      'Grip Wheel',
      [0.025, 0.1, 0.1],
      'rubber',
      [port('axle', 'shaft', [-0.025, 0, 0])],
      { diameter: { ...rating(0.2, 0.1, 1, 'm'), optional: true } },
      'cylinder',
    ),
    mountingPads: { right: [0.02, 0.02] },
  },
  rotationSensor: component(
    'rotationSensor',
    'Axis Rotation Sensor',
    [0.025, 0.015, 0.025],
    'aluminium',
    [signal('signal', 'output')],
    { axis: { ...rating(0, 0, 2, '0=X, 1=Y, 2=Z'), type: 'integer' } },
  ),
  commandReceiver: {
    ...component(
      'commandReceiver',
      'Command Receiver',
      [0.04, 0.02, 0.03],
      'aluminium',
      [signal('command', 'input'), signal('signal', 'output')],
      { duty: rating(0, -1, 1, 'ratio') },
    ),
    controlBindingDefault: DEFAULT_CONTROL_BINDING,
    controlBindingMilestone: 'M3b',
  },
  logicController: component(
    'logicController',
    'Logic Controller',
    [0.04, 0.02, 0.03],
    'aluminium',
    [signal('signal', 'input'), signal('out', 'output')],
    { duty: rating(0, -1, 1, 'ratio') },
  ),
  chassis: {
    ...component('chassis', 'Chassis', [0.14, 0.02, 0.22], 'aluminium', [], {}),
    milestone: 'M3b',
    mountingFaces: ['right', 'left', 'top', 'bottom', 'front', 'back'],
  },
  passiveBearing: {
    ...component(
      'passiveBearing',
      'Passive Bearing',
      [0.02, 0.03, 0.03],
      'steel',
      [{ ...port('shaft', 'shaft', [0.04, 0, 0]), joint: 'revolute' }],
      {},
    ),
    milestone: 'M3b',
    mountingPads: { left: [0.02, 0.03] },
  },
});
