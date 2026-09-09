// Authored teaching copy, keyed by the model catalog. This is not admission policy.
const help = (purpose, explanation, needs, steps, examples = []) => ({
  purpose,
  explanation,
  needs,
  steps,
  examples,
});
export const PART_HELP = {
  springGuide: help(
    'A captured spring that guides a sliding carriage',
    'Slides along this axis; does not swivel. This open-rail mechanism resists both compression and extension. The coil is decorative: collision and mass use the solid pads and ordinary rail, not individual turns.',
    'A Spring carriage on the Slide port. Bolt the guide to a supported base. No power is needed. Up to eight guided springs per workshop.',
    [
      'Connect Slide to a Spring carriage. Bolt a platform to the carriage top.',
      'In Build, change stiffness (N/m), damping (N s/m), zero-force length and travel. Run applies gravity.',
      'Damping resists motion, not static weight. Upright resting length also includes carriage and platform weight: compression = moving mass × 9.81 / stiffness.',
      'Zero damping has bounded numerical energy error. Integration/contact residual includes stops and numerical error; it is not measured stop heat.',
    ],
    ['spring'],
  ),
  springCarriage: help(
    'The moving end of a guided spring',
    'This pad moves along the guide axis. Fixed mounts on it follow the moving end; it cannot swivel.',
    'Connect its Slide port to a Spring guide, then mount a platform to its top.',
    [
      'Choose the guide to change the spring settings. Disconnect Slide to remove the spring force.',
      'The carriage has its own weight even after you remove the extra load.',
    ],
    ['spring'],
  ),
  beam: help(
    'A narrow support for your machine',
    'Joins parts into a rigid frame. Use it for a rail or crossbar.',
    'Mount other parts to its surfaces.',
    [
      'Select a part and use Snap to surface to mount it to the beam. Fixed mounting prevents relative motion.',
    ],
  ),
  plate: help(
    'A flat surface for mounting parts',
    'Provides a broad, thin support. Use it for a platform or mounting panel.',
    'Join its surfaces to the parts it supports.',
    ['Use Snap to surface to join the plate and another part.'],
  ),
  chassis: help(
    'A base for a rolling machine',
    'Supports the parts of your machine. Use it to keep motors, cells and bearings together.',
    'Mount components to its surfaces and leave wheels free to rotate.',
    [
      'Mount a motor or bearing housing to the chassis.',
      'Attach wheels through shaft connections, leaving clearance from the chassis.',
    ],
  ),
  powerCell: help(
    'Stores energy for powered parts',
    'Supplies electrical energy until its charge runs down. Use it to power motors and hinges.',
    'Mount it to the machine and wire its Power port to powered parts. Wires do not hold parts together.',
    [
      'Connect one cell’s Power port to a motor, hinge or bus Power port.',
      'Several wires can share the cell port. Multiple cells on one circuit are unsupported.',
    ],
    ['power'],
  ),
  distributionBus: help(
    'A shared power connection',
    'Joins power wires at one point. Use it to organize connections between a cell and several powered parts.',
    'Mount it and connect power wires. It adds no energy; several wires can also connect directly to a cell.',
    [
      'Connect a cell Power port to the bus Power port.',
      'Connect the same bus port to each powered part.',
    ],
    ['power'],
  ),
  poweredMotor: help(
    'Uses power to spin an output',
    'Drives rotation relative to its housing. Use it to turn a wheel or axle.',
    'Mount the housing, wire a cell to Power and connect the moving part to Drive shaft. Load and available power limit motion.',
    [
      'Mount the motor housing to a support.',
      'Connect cell Power to motor Power.',
      'Attach wheel Wheel axle to motor Drive shaft. Do not bolt the wheel to the housing.',
      'Drive setting controls direction and strength without code. Optionally connect a receiver Control output to Control input.',
    ],
    ['drive'],
  ),
  poweredHinge: help(
    'Turns toward a chosen angle',
    'Uses electrical power to turn its output toward a chosen angle. Use it for steering or controlled pivoting.',
    'Mount its housing, connect power and attach the moving part to Steering output. Available torque limits angle holding.',
    [
      'Mount the hinge housing to a support and wire cell Power to hinge Power.',
      'Connect Steering output to the hub Steering input.',
      'Default target selects an angle within the configured limits. For keys, connect receiver Control output to hinge Control input and choose the Steering preset.',
    ],
    ['steer'],
  ),
  wheelHub: help(
    'Lets a wheel spin while steering',
    'Holds a wheel so it can spin freely while being steered. Use it between a powered hinge and a wheel.',
    'Connect its two distinct endpoints. The hub does not drive the wheel.',
    [
      'Connect hinge Steering output to hub Steering input.',
      'Connect hub Wheel axle to wheel Wheel axle. This holds the wheel while allowing independent spin.',
    ],
    ['steer'],
  ),
  steelAxle: help(
    'Extends a rotating shaft connection',
    'Connects rotating parts across a gap. Use it when a wheel needs to sit farther from an output.',
    'Connect its axle endpoints to compatible shaft ports; it supplies no power.',
    [
      'Connect one axle end to a motor Drive shaft or bearing Axle.',
      'Connect the other end to wheel Wheel axle. A motor can also attach directly to a wheel.',
    ],
    ['drive'],
  ),
  gripWheel: help(
    'Rolls against the ground for traction',
    'Transfers rotation into ground contact. Use it for rolling support or a driven wheel.',
    'Connect Wheel axle to a motor, bearing or hub and allow ground clearance around the housing.',
    [
      'Choose a motor for a driven wheel, a bearing for a free wheel, or a hub for steering.',
      'Join their shaft endpoint to Wheel axle. Bolting the wheel to the housing prevents independent spin.',
    ],
    ['drive', 'free', 'steer'],
  ),
  passiveBearing: help(
    'Supports a freely spinning wheel',
    'Allows rotation relative to its fixed housing. Use it for an unpowered wheel or axle support.',
    'Mount the housing and connect its Axle. It supplies neither electrical power nor propulsion.',
    ['Mount the bearing housing to a support.', 'Connect bearing Axle to wheel Wheel axle.'],
    ['free'],
  ),
  commandReceiver: help(
    'Turns your keys into control commands',
    'Sends a drive or steering command to connected actuators. Use it to control your machine with keys.',
    'Mount it and connect Control output to a motor or hinge Control input. The actuator still needs cell power.',
    [
      'Wire Control output to the actuator Control input.',
      'Choose a keyboard preset in the inspector, then Run and use the listed keys.',
      'A wired Logic Controller at Control input owns the receiver; keyboard and manual overrides are then unavailable.',
    ],
  ),
  rotationSensor: help(
    'Measures rotation about its own axis',
    'Reads angular speed of its own body along the selected local axis. Use it to supply rotation measurements to a controller.',
    'Mount it to the body whose rotation you want to measure. It does not measure a nearby wheel through space.',
    [
      'Mount the sensor to the rotating body and select X, Y or Z in its settings.',
      'Connect Control output to a Logic Controller Control input for a supplied controller program. Programming is not available in the workshop palette.',
    ],
  ),
  logicController: help(
    'Runs a supplied control program',
    'Receives connected sensor readings and can command connected receivers. Use it in a loaded machine with an externally supplied program.',
    'The workshop has no controller programming editor. Wiring alone does not create a control program.',
    [
      'Connect sensor Control output to controller Control input.',
      'Connect controller Control output to receiver Control input. A supplied program can command that receiver; it cannot command arbitrary parts.',
    ],
  ),
};
const end = (node, port) => ({ node, port });
const edge = (kind, a, b) => ({ kind, a, b });
// Schematic coordinates are deliberately separate from physical fixture transforms.
export const PART_EXAMPLES = {
  spring: {
    title: 'Guided spring',
    nodes: { guide: 'springGuide', carriage: 'springCarriage' },
    edges: [edge('spring', end('guide', 'slide'), end('carriage', 'slide'))],
    motions: { carriage: 'Slides along the axis; does not swivel' },
    notes: ['Mount the guide to a base and the carriage to a platform. The spring needs no power.'],
  },
  power: {
    title: 'Power branching',
    nodes: {
      cell: 'powerCell',
      bus: 'distributionBus',
      first: 'poweredMotor',
      second: 'poweredMotor',
    },
    edges: [
      edge('power', end('cell', 'power'), end('bus', 'power')),
      edge('power', end('bus', 'power'), end('first', 'power')),
      edge('power', end('bus', 'power'), end('second', 'power')),
    ],
    notes: [
      'Mount each part separately; wires are not supports.',
      'Direct branching at the cell also works. The bus adds no energy. Use one cell per circuit.',
    ],
  },
  drive: {
    title: 'Driven wheel',
    nodes: { support: 'chassis', motor: 'poweredMotor', cell: 'powerCell', wheel: 'gripWheel' },
    edges: [
      edge('mount', end('motor', 'bottom'), end('support', 'top')),
      edge('power', end('cell', 'power'), end('motor', 'power')),
      edge('shaft', end('motor', 'shaft'), end('wheel', 'axle')),
    ],
    notes: [
      'Mount the cell separately. The shaft connection supports the wheel; do not bolt the wheel to the motor housing.',
      'For extra reach, insert a Steel Axle between the motor and wheel.',
    ],
    motions: { wheel: 'Driven rotation' },
  },
  free: {
    title: 'Free-spinning wheel',
    nodes: { support: 'chassis', bearing: 'passiveBearing', wheel: 'gripWheel' },
    edges: [
      edge('mount', end('bearing', 'bottom'), end('support', 'top')),
      edge('shaft', end('bearing', 'shaft'), end('wheel', 'axle')),
    ],
    notes: [
      'Fixed mounting holds the housing. The shaft connection lets the wheel rotate.',
      'The bearing supplies no power or propulsion.',
    ],
    motions: { wheel: 'Free wheel spin' },
  },
  steer: {
    title: 'Steered wheel',
    nodes: {
      support: 'chassis',
      hinge: 'poweredHinge',
      cell: 'powerCell',
      hub: 'wheelHub',
      wheel: 'gripWheel',
    },
    edges: [
      edge('mount', end('hinge', 'bottom'), end('support', 'top')),
      edge('power', end('cell', 'power'), end('hinge', 'power')),
      edge('shaft', end('hinge', 'shaft'), end('hub', 'steering')),
      edge('shaft', end('hub', 'shaft'), end('wheel', 'axle')),
    ],
    notes: [
      'Mount the cell separately. Use hinge Default target, or wire a receiver with the Steering preset to hinge Control input.',
      'Steering and wheel spin are independent. This mechanism does not propel the wheel.',
    ],
    motions: { hub: 'Steering motion', wheel: 'Free wheel spin' },
  },
};
