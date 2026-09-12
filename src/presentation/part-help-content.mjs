// Authored teaching copy, keyed by the model catalog. This is not admission policy.
const help = (purpose, explanation, needs, steps, examples = []) => ({
  purpose,
  explanation,
  needs,
  steps,
  examples,
});
const gearHelp = (teeth, pitchRadius) =>
  help(
    'Trades rotation speed for available torque',
    `A ${teeth}-tooth spur gear with a ${pitchRadius} mm pitch radius. A 12T gear driving a 24T gear gives roughly half the speed in the opposite direction and greater available torque. Tooth marks show actual body rotation. The smaller solid root cylinder supplies collision and mass; the explicit mesh models compliant tooth engagement, not individual tooth collisions.`,
    'A motor or bearing for each shaft, fixed to the same rigid support. Gear centres must be 120 mm apart for 12T/12T, 180 mm for 12T/24T, or 240 mm for 24T/24T, with aligned axes and gear faces.',
    [
      'Attach each gear to its own supported shaft using either axle port. The other axle port can carry an output arm or wheel.',
      'Select Gear mesh, then Mesh with the aligned gear. Connecting does not move either gear or create a bearing. Disconnecting stops torque transfer through that mesh.',
      'Open Learn & examples → Lift with gears for an editable loaded mechanism. Predict which way the large gear turns before pressing Run.',
      'A mesh flexes slightly under load. This model does not include backlash or tooth breakage. Up to eight mesh edges are supported; closed mesh loops and moving shaft supports are rejected.',
    ],
  );
export const PART_HELP = {
  releaseCoupler: help(
    'Releases cargo or a tool using electrical power',
    'The right face is the latch. Its one attachment can open during Run; attachments on the other faces stay bolted. Opening adds no push, so cargo moves only under its existing motion, gravity and other forces.',
    'Mount the coupler by another face. Snap a tool onto Latch · Right, wire Power to a cell, and wire Control input to a Command Receiver. Hold W or Up with the receiver’s default keys.',
    [
      'Hold the key until the coil has enough energy. Releasing early or losing operating voltage resets progress; spent energy is not refunded. Once ready, opening occurs on the next tick and cannot be cancelled.',
      'The latch stays open for this run. Return to Build or Try again to restore the starting attachments. Other bolts or hinges can still hold the load. Wires remain connected and do not act as ropes.',
      'If opening would leave gears without their shared shaft support, or change a locked spring into an active one, it stays latched. Inspect the selected status, return to Build and repair those connections.',
    ],
  ),
  gear12: gearHelp(12, 60),
  gear24: gearHelp(24, 120),
  ball: help(
    'Rolls, falls and receives pushes',
    'A solid sphere. Diameter and material determine mass; the surface it hits also affects bounce. The stripe shows real rotation.',
    'A slope to roll down, or a spring-driven plate to push it.',
    [
      'Place above a beam or beside a launcher.',
      'Run and watch it move.',
      'Return to Build to change its material or diameter.',
    ],
  ),
  spacerBlock: help(
    'Separates nearby mounted hardware',
    'A solid 40 × 30 × 40 mm block. Its 30 mm thickness provides clearance between two mounting faces, with ordinary material mass and fixed connections.',
    'Mount its bottom face to a support, then mount hardware on its top face.',
    ['Check clearance throughout the motion of connected arms and bearings.'],
  ),
  mountingBlock: help(
    'Offsets a mounting face past nearby hardware',
    'A solid 20 × 20 × 160 mm block with small mounting faces. It carries loads through ordinary fixed connections; it is not a sliding joint or an invisible brace.',
    'Mount one end to a narrow guide or carriage face, then attach an ordinary beam at the other end.',
    [
      'Check clearance over the full spring travel. A brace attached to the carriage moves with it.',
      'Closing a fixed connection from the brace to the guide makes the suspension rigid. Leaving that fastener open preserves spring travel; all hardware still has mass.',
    ],
  ),
  shaftMount: help(
    'Bolts an ordinary arm onto an axle',
    'A solid block with one shaft connection and flat mounting faces. It turns with the connected axle; the motor or bearing supplies the pivot.',
    'Connect Shaft to a motor or bearing, then mount a beam to a flat face.',
    [
      'Mount a beam end to the top or side for a crank or gate. Check its full swing for collisions.',
      'Its material and solid size determine its mass. It is not a hollow clamp or an invisible hinge.',
    ],
  ),
  rangeSensor: help(
    'Measures first-hit distance and closing speed',
    'Its local +Z ray stops at the first physical surface within range. No return and the first derivative sample are explicit states.',
    'Mount the part, wire Power to a cell, then connect the desired channel to either controller.',
    [
      'Select the sensor to inspect its completed readings and direction.',
      'Missing power makes the measurement invalid; it never becomes a false zero.',
    ],
  ),
  linearMotionSensor: help(
    'Measures local linear velocity',
    'Measures the sensor origin’s velocity relative to the stationary world, including motion caused by rotation.',
    'Mount the part, wire Power to a cell, then connect the desired channel to either controller.',
    [
      'Select the sensor to inspect its completed readings and direction.',
      'Missing power makes the measurement invalid; it never becomes a false zero.',
    ],
  ),
  tiltSensor: help(
    'Measures tilt and angular velocity',
    'Tilt is relative to gravity. Angular velocity is reported around local X, Y and Z, without absolute heading or position.',
    'Mount the part, wire Power to a cell, then connect the desired channel to either controller.',
    [
      'Select the sensor to inspect its completed readings and direction.',
      'Missing power makes the measurement invalid; it never becomes a false zero.',
    ],
  ),
  jointAngleSensor: help(
    'Measures one axle’s angle and rate',
    'An explicit axle binding, zero and sign define this measurement. The sensor applies no control or force.',
    'Mount the part, wire Power to a cell, then connect the desired channel to either controller.',
    [
      'Select the sensor to inspect its completed readings and direction.',
      'Missing power makes the measurement invalid; it never becomes a false zero.',
    ],
  ),
  contactSensor: help(
    'Measures contact on its front pad',
    'Only the exposed +Z face reports touch and interval-average normal load. Contacts on other casing faces do not count.',
    'Mount the part, wire Power to a cell, then connect the desired channel to either controller.',
    [
      'Select the sensor to inspect its completed readings and direction.',
      'Missing power makes the measurement invalid; it never becomes a false zero.',
    ],
  ),
  travelSensor: help(
    'Measures one spring’s length and speed',
    'Reports the distance along a selected spring guide and how quickly that distance changes. It does not measure chassis height or tilt.',
    'Connect Power to a cell, select a spring connection in Build, then wire Signal to a Position Regulator or controller.',
    [
      'An unbound or missing spring gives an invalid reading. Automatic control switches Off until you repair the binding and rearm it.',
      'Copy the sensor with its spring to remap the binding. A sensor copied alone starts unbound.',
    ],
  ),
  positionRegulator: help(
    'Adjusts a powered mechanism toward a chosen spring length',
    'Uses the wired Travel Sensor’s previous completed reading. Proportional correction responds to length error; damping responds to length-change speed. Rate limiting bounds changes in the hinge target.',
    'Wire Travel Sensor → Position Regulator → Command Receiver → Powered Hinge. The hinge still needs a charged Power Cell.',
    [
      'Start in Manual and check which direction changes spring length. Set polarity accordingly.',
      'Choose Automatic explicitly. A deliberate key or test command takes over in Manual.',
      'Off disconnects active drive; it is not a brake or a centered hinge target. Springs and gravity can still move the mechanism.',
    ],
  ),
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
      'Automatic and learned commands require explicit enable. Your keys always take over immediately.',
    ],
  ),
  learningController: help(
    'Learns bounded receiver commands from your driving examples',
    'A small frozen neural network reads only explicitly wired sensor channels. Teaching captures manual commands and the prior-tick observations they accompany. Training happens between runs.',
    'Wire Target Distance Sensor distance and speed to separate inputs; wire outputs to Command Receiver inputs. Select this controller and choose Teach a controller.',
    [
      'Teach briefly using normal keys. Stop and return to Build to train a candidate.',
      'Install explicitly, then Try it. Keys take over; Teach starts a correction interval.',
      'Save the machine to keep the executable model. The learning workspace separately retains and exports examples and attempts.',
    ],
  ),
  targetSensor: help(
    'Measures distance and approach speed to a selected part',
    'Measures centre-to-centre separation and relative speed along that line. Positive speed means approaching. This is a paired measurement: intervening objects do not occlude it, and it does not sense obstacles.',
    'Connect Power to a cell and mount the sensor on your machine. In Build select its measured target, then wire its distance and speed outputs to controller inputs.',
    [
      'Range is measured in metres. A missing target or out-of-range measurement disables learned driving.',
      'Measurements are sampled at t and used by commands at t+1. Copying a sensor alone leaves its target unbound.',
    ],
  ),
  rotationSensor: help(
    'Measures rotation about its own axis',
    'Reads angular speed of its own body along the selected local axis. Use it to supply rotation measurements to a controller.',
    'Connect Power to a cell and mount it to the body whose rotation you want to measure. It does not measure a nearby wheel through space.',
    [
      'Mount the sensor to the rotating body and select X, Y or Z in its settings.',
      'Connect Control output to a Logic Controller Control input for a supplied controller program. Use the Rules and Code editor in the selected Logic Controller.',
    ],
  ),
  logicController: help(
    'Runs rules or edited TypeScript',
    'Receives connected sensor readings and commands connected receivers. Rules and edited TypeScript use the same bounded execution path.',
    'Select this part to edit Rules or TypeScript, then Apply in Build. Wiring alone does not create a program.',
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
