import { NEAR_SPACE_BODY_ID } from "../simulation/environment/earth-environment-bodies.js";
export { CONTROLLER_CHANNELS } from "../model/controller-policy.js";

export const DEFAULT_WAT_SOURCE = `(module
  (func (export "tick") (param $dt f32)
    ;; Add read_binding / write_binding imports after creating named bindings.
    (drop (local.get $dt))
  )
)`;
export const DEFAULT_TS_SOURCE = `type Binding = string;
interface ControlAPI {
  read(binding: Binding): number;
  write(binding: Binding, value: number): void;
}

function tick(api: ControlAPI, dt: number): void {
  // Read and write controller-local named bindings here.
  void api;
  void dt;
}`;

export const DRONE_TS_SOURCE = `type InputBinding =
  | 'pilot.collective' | 'pilot.yaw' | 'pilot.pitch' | 'pilot.roll'
  | 'pilot.altitude_hold' | 'nav.altitude'
  | 'imu.roll' | 'imu.pitch' | 'imu.yaw'
  | 'imu.rate_x' | 'imu.rate_y' | 'imu.rate_z';
type OutputBinding =
  | 'motor.0.throttle' | 'motor.1.throttle'
  | 'motor.2.throttle' | 'motor.3.throttle';

interface ControlAPI {
  read(binding: InputBinding): number;
  write(binding: OutputBinding, value: number): void;
}

let holdAltitude = 0;
let previousAltitude = 0;
let holdWasEnabled = 0;
let pitchIntegral = 0;
let rollIntegral = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function maximum4(a: number, b: number, c: number, d: number): number {
  return Math.max(Math.max(a, b), Math.max(c, d));
}

function minimum4(a: number, b: number, c: number, d: number): number {
  return Math.min(Math.min(a, b), Math.min(c, d));
}

const attitudeProportionalPerDeg = 0.02;
const attitudeIntegralPerDegS = 0.018;
const attitudeIntegralLimit = 0.65;
const angularDampingPerRadS = 1.1;
const mixerAuthority = 0.35;

// This is ordinary player-editable controller code. It reads only bound
// receivers and sensors and writes each physical shaft motor independently.
function tick(api: ControlAPI, dt: number): void {
  const altitude = api.read('nav.altitude');
  const holdEnabled = api.read('pilot.altitude_hold');
  if (holdEnabled > 0.5 && holdWasEnabled <= 0.5) {
    holdAltitude = altitude;
  }

  const verticalSpeed = dt > 0 ? (altitude - previousAltitude) / dt : 0;
  let base = clamp01(api.read('pilot.collective'));
  if (holdEnabled > 0.5) {
    base = clamp01(
      0.63 + (holdAltitude - altitude) * 0.04 - verticalSpeed * 0.08,
    );
  }

  const pitchError =
    api.read('pilot.pitch') * 20 - api.read('imu.pitch');
  const rollError = api.read('pilot.roll') * 20 - api.read('imu.roll');
  const pitchMix = clampSigned(
    pitchError * attitudeProportionalPerDeg +
      pitchIntegral -
      api.read('imu.rate_x') * angularDampingPerRadS,
  ) * mixerAuthority;
  const rollMix = clampSigned(
    rollError * attitudeProportionalPerDeg +
      rollIntegral -
      api.read('imu.rate_z') * angularDampingPerRadS,
  ) * mixerAuthority;
  const yawMix = clampSigned(
    api.read('pilot.yaw') - api.read('imu.rate_y') * 0.35,
  );

  let attitude0 = pitchMix - rollMix;
  let attitude1 = pitchMix + rollMix;
  let attitude2 = -pitchMix - rollMix;
  let attitude3 = -pitchMix + rollMix;
  const attitudeSpan =
    maximum4(attitude0, attitude1, attitude2, attitude3) -
    minimum4(attitude0, attitude1, attitude2, attitude3);
  if (attitudeSpan > 1) {
    const attitudeScale = 1 / attitudeSpan;
    attitude0 *= attitudeScale;
    attitude1 *= attitudeScale;
    attitude2 *= attitudeScale;
    attitude3 *= attitudeScale;
  }

  const positiveYawMaximum = Math.max(attitude0, attitude3);
  const positiveYawMinimum = Math.min(attitude0, attitude3);
  const negativeYawMaximum = Math.max(attitude1, attitude2);
  const negativeYawMinimum = Math.min(attitude1, attitude2);
  let yawCorrection = yawMix * 0.08;
  if (yawCorrection > 0) {
    yawCorrection = Math.min(
      yawCorrection,
      Math.max(0, (1 - positiveYawMaximum + negativeYawMinimum) * 0.5),
    );
  } else if (yawCorrection < 0) {
    yawCorrection = -Math.min(
      -yawCorrection,
      Math.max(0, (1 - negativeYawMaximum + positiveYawMinimum) * 0.5),
    );
  }

  let correction0 = attitude0 + yawCorrection;
  let correction1 = attitude1 - yawCorrection;
  let correction2 = attitude2 - yawCorrection;
  let correction3 = attitude3 + yawCorrection;
  const minimumCorrection = minimum4(
    correction0,
    correction1,
    correction2,
    correction3,
  );
  if (minimumCorrection < -base) {
    const correctionScale = base / -minimumCorrection;
    correction0 *= correctionScale;
    correction1 *= correctionScale;
    correction2 *= correctionScale;
    correction3 *= correctionScale;
  }
  base = Math.min(
    base,
    1 - maximum4(correction0, correction1, correction2, correction3),
  );

  api.write('motor.0.throttle', clamp01(base + correction0));
  api.write('motor.1.throttle', clamp01(base + correction1));
  api.write('motor.2.throttle', clamp01(base + correction2));
  api.write('motor.3.throttle', clamp01(base + correction3));

  if (base > 0.15) {
    pitchIntegral = Math.max(
      -attitudeIntegralLimit,
      Math.min(
        attitudeIntegralLimit,
        pitchIntegral + pitchError * attitudeIntegralPerDegS * dt,
      ),
    );
    rollIntegral = Math.max(
      -attitudeIntegralLimit,
      Math.min(
        attitudeIntegralLimit,
        rollIntegral + rollError * attitudeIntegralPerDegS * dt,
      ),
    );
  } else {
    pitchIntegral *= Math.max(0, 1 - dt * 4);
    rollIntegral *= Math.max(0, 1 - dt * 4);
  }

  previousAltitude = altitude;
  holdWasEnabled = holdEnabled;
}`;

export const MISSION_TS_SOURCE = `type InputBinding =
  | 'nav.position_x' | 'nav.position_z'
  | 'nav.velocity_x' | 'nav.velocity_z'
  | 'nav.wind_x' | 'nav.wind_z'
  | 'nav.altitude'
  | 'pilot.arm' | 'pilot.launch' | 'pilot.throttle'
  | 'pilot.target_altitude' | 'pilot.target_x' | 'pilot.target_z'
  | 'pilot.stage' | 'pilot.abort'
  | 'air.dynamic_pressure' | 'thermal.temperature'
  | 'target.detected' | 'target.range' | 'target.range_rate';
type OutputBinding =
  | 'engine.throttle' | 'engine.gimbal'
  | 'coupler.release'
  | 'rcs.0.throttle' | 'rcs.1.throttle'
  | 'rcs.2.throttle' | 'rcs.3.throttle';

interface ControlAPI {
  read(binding: InputBinding): number;
  write(binding: OutputBinding, value: number): void;
}

const clamp = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value));

const positive = (value: number): number => Math.max(0, value);

let launched = 0;
let launchWasPressed = 0;
let stageWasPressed = 0;

// Guidance creates endpoint-addressed commands only. Physics applies forces at
// the actual engine mounting points and never reads this program's identity.
function tick(api: ControlAPI, dt: number): void {
  const launch = api.read('pilot.launch');
  if (api.read('pilot.abort') > 0.5) {
    launched = 0;
  } else if (
    api.read('pilot.arm') > 0.5 &&
    launch > 0.5 &&
    launchWasPressed <= 0.5
  ) {
    launched = 1;
  }

  const errorX = api.read('pilot.target_x') - api.read('nav.position_x');
  const errorZ = api.read('pilot.target_z') - api.read('nav.position_z');
  const desiredVX = clamp(errorX * 0.035, 18);
  const desiredVZ = clamp(errorZ * 0.035, 18);
  const correctionX = clamp(
    (desiredVX - api.read('nav.velocity_x')) * 0.07 - api.read('nav.wind_x') * 0.018,
    1,
  );
  const correctionZ = clamp(
    (desiredVZ - api.read('nav.velocity_z')) * 0.07 - api.read('nav.wind_z') * 0.018,
    1,
  );

  let throttle = launched > 0.5 ? api.read('pilot.throttle') : 0;
  if (api.read('nav.altitude') >= api.read('pilot.target_altitude')) {
    throttle = Math.min(throttle, 0.12);
  }
  if (api.read('air.dynamic_pressure') > 34000) {
    throttle = Math.min(throttle, 0.55);
  }
  if (api.read('thermal.temperature') > 800) {
    throttle = 0;
  }
  if (api.read('target.detected') > 0.5 && api.read('target.range') < 30) {
    const closingSpeed = -api.read('target.range_rate');
    throttle = Math.min(throttle, Math.max(0, closingSpeed * 0.04));
  }

  const guidanceX = launched > 0.5 ? correctionX : 0;
  const guidanceZ = launched > 0.5 ? correctionZ : 0;
  api.write('engine.throttle', Math.max(0, Math.min(1, throttle)));
  api.write('engine.gimbal', guidanceX);
  api.write('rcs.0.throttle', positive(guidanceX));
  api.write('rcs.1.throttle', positive(-guidanceX));
  api.write('rcs.2.throttle', positive(guidanceZ));
  api.write('rcs.3.throttle', positive(-guidanceZ));

  const stage = api.read('pilot.stage');
  api.write(
    'coupler.release',
    stage > 0.5 && stageWasPressed <= 0.5 ? 1 : 0,
  );

  launchWasPressed = launch;
  stageWasPressed = stage;
  void dt;
}`;

export const CONTROL_TEMPLATES = {
  gearbox: [
    {
      label: "Motor throttle",
      channel: "throttle",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 1,
      targetTypes: ["motor"],
    },
    {
      label: "Shaft brake",
      channel: "brake",
      type: "hold",
      value: 0,
      targetTypes: ["motor"],
    },
  ],
  cart: [
    {
      label: "Drive throttle",
      channel: "throttle",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["motor"],
    },
    {
      label: "Steering",
      channel: "steering",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Brake",
      channel: "brake",
      type: "hold",
      value: 0,
      targetTypes: ["motor"],
    },
    {
      label: "Headlights",
      channel: "lights",
      type: "toggle",
      value: 0,
      targetTypes: ["headlight"],
    },
  ],
  humanoid: [
    {
      label: "Left hip",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Right hip",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Left knee",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Right knee",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Left ankle",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Right ankle",
      channel: "joint_target",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
  ],
  drone: [
    {
      label: "Collective thrust",
      channel: "collective",
      type: "range",
      min: 0,
      max: 1,
      step: 0.02,
      value: 0,
      targetTypes: ["rocket", "motor"],
    },
    {
      label: "Yaw",
      channel: "yaw",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Pitch",
      channel: "pitch",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Roll",
      channel: "roll",
      type: "range",
      min: -1,
      max: 1,
      step: 0.05,
      value: 0,
      targetTypes: ["hinge"],
    },
    {
      label: "Altitude hold",
      channel: "alt_hold",
      type: "toggle",
      value: 0,
      targetTypes: ["computer"],
    },
  ],
  mission: [
    {
      label: "Arm vehicle",
      channel: "armed",
      type: "toggle",
      value: 0,
      targetTypes: ["computer"],
    },
    {
      label: "Launch",
      channel: "launch",
      type: "pulse",
      value: 0,
      targetTypes: ["rocket"],
    },
    {
      label: "Main throttle",
      channel: "throttle",
      type: "range",
      min: 0,
      max: 1,
      step: 0.02,
      value: 0,
      targetTypes: ["rocket"],
    },
    {
      label: "Target altitude",
      channel: "target_altitude",
      type: "range",
      min: 100,
      max: 150000,
      step: 1000,
      value: 100000,
      targetTypes: ["computer"],
    },
    {
      label: "Target lateral X",
      channel: "target_x",
      type: "range",
      min: -200,
      max: 200,
      step: 5,
      value: -100,
      active: true,
      targetTypes: ["computer"],
    },
    {
      label: "Target lateral Z",
      channel: "target_z",
      type: "range",
      min: -200,
      max: 200,
      step: 5,
      value: 0,
      active: true,
      targetTypes: ["computer"],
    },
    {
      label: "Stage",
      channel: "stage",
      type: "pulse",
      value: 0,
      targetTypes: ["rocket"],
    },
    {
      label: "Abort mission",
      channel: "abort",
      type: "hold",
      value: 0,
      targetTypes: ["computer"],
    },
  ],
};
export const CHALLENGES = [
  {
    id: "power-transfer",
    stage: "01",
    icon: "⚙",
    demo: "gearbox",
    name: "Power Transfer",
    brief: "Produce a stable, opposite-direction 2:1 gear reduction.",
    target: "Ratio 2.00:1 for 1.5 seconds",
    category: "CALIBRATION",
    startModes: ["reference"],
    referenceInitialControls: [
      {
        profileId: "gearbox",
        controlId: "gearbox-1",
        value: 1,
        active: true,
      },
    ],
    objective: { kind: "gear-ratio", ratio: 2, holdS: 1.5 },
  },
  {
    id: "field-trial",
    stage: "02",
    icon: "◉",
    demo: "cart",
    name: "Field Trial",
    brief: "Drive beyond the plate and stay intact on natural terrain.",
    target: "Travel 30 m without falling",
    category: "CALIBRATION",
    startModes: ["reference"],
    objective: { kind: "delivery", distanceM: 30, finishGrounded: true },
  },
  {
    id: "precision-lift",
    stage: "03",
    icon: "✣",
    demo: "drone",
    name: "Precision Lift",
    brief: "Climb, then stabilize instead of blasting through the target.",
    target: "Hold 15+ m altitude below 3 m/s",
    category: "CALIBRATION",
    startModes: ["reference"],
    objective: {
      kind: "delivery",
      altitudeM: 15,
      maxSpeedMps: 3,
      holdS: 1.5,
    },
  },
  {
    id: "meteor-rendezvous",
    stage: "04",
    icon: "▲",
    demo: "mission",
    name: "Meteor Rendezvous",
    brief: "Survive ascent and guide the vehicle to the Kármán-line target.",
    target: "Reach and station-keep at the meteor",
    category: "CALIBRATION",
    startModes: ["reference"],
    objective: {
      kind: "target",
      targetBodyId: NEAR_SPACE_BODY_ID,
      maximumRangeM: 18,
      maximumRangeRateMps: 2,
      progressRangeM: 100000,
      holdS: 1.5,
    },
  },
  {
    id: "cargo-relay",
    stage: "06",
    icon: "▣",
    name: "Cargo Relay",
    brief: "Invent any machine that can secure and deliver a real payload.",
    target: "Carry 80 kg for 30 m and stop under control",
    category: "OPEN CONSTRUCTION",
    startModes: ["empty", "current"],
    approaches: ["WHEELS", "LEGS", "ROTOR", "HYBRID"],
    payload: { massKg: 80 },
    objective: {
      kind: "delivery",
      distanceM: 30,
      finishGrounded: true,
      holdS: 0.75,
    },
    constraints: { noDamage: true, maxFatigue: 0.85 },
  },
  {
    id: "water-haul",
    stage: "07",
    icon: "≈",
    name: "Water Haul",
    brief: "Cross the pond with cargo using any physically valid approach.",
    target: "Enter water, exit it, and deliver 80 kg over 55 m",
    category: "OPEN CONSTRUCTION",
    startModes: ["empty", "current"],
    approaches: ["AMPHIBIOUS", "WADER", "BOAT", "HYBRID"],
    payload: { massKg: 80 },
    objective: {
      kind: "delivery",
      distanceM: 55,
      requireWater: true,
      finishClearOfWater: true,
      finishGrounded: true,
      holdS: 0.75,
    },
    constraints: { noDamage: true, maxFatigue: 0.9 },
  },
  {
    id: "air-courier",
    stage: "08",
    icon: "◇",
    name: "Air Courier",
    brief:
      "Move cargo through the air; rotors, wings, rockets, and hybrids count.",
    target: "Carry 80 kg 25 m away at 18+ m altitude and stabilize",
    category: "OPEN CONSTRUCTION",
    startModes: ["empty", "current"],
    approaches: ["MULTIROTOR", "FIXED WING", "ROCKET", "HYBRID"],
    payload: { massKg: 80 },
    objective: {
      kind: "delivery",
      distanceM: 25,
      altitudeM: 18,
      maxSpeedMps: 5,
      holdS: 1.5,
    },
    constraints: { noDamage: true, maxFatigue: 0.8 },
  },
  {
    id: "up-and-home",
    stage: "09",
    icon: "↥",
    name: "Up and Home",
    brief: "Lift a payload and recover it without sacrificing the machine.",
    target: "Reach 30 m, return below 8 m/s, and remain intact",
    category: "OPEN CONSTRUCTION",
    startModes: ["empty", "current"],
    approaches: ["ROTOR", "ROCKET", "GLIDER", "HYBRID"],
    payload: { massKg: 80 },
    objective: {
      kind: "safe-return",
      altitudeM: 30,
      maxLandingSpeedMps: 8,
    },
    constraints: {
      noDamage: true,
      failOnDamage: true,
      maxFatigue: 0.75,
    },
  },
];
export const LEARN_TOPICS = [
  {
    id: "first-machine",
    category: "START HERE",
    icon: "01",
    title: "Build your first powered machine",
    summary: "Learn the complete place → connect → power → simulate loop.",
    why: "Machines only move when their physical and electrical paths make sense.",
    steps: [
      "Place components from the library onto the workbench.",
      "Select a component and click one exact connection port.",
      "Click a compatible target; shafts, wheels, and gears snap into physical alignment.",
      "Connect a charged Power Cell before expecting a motor to run.",
      "Start Simulation and watch status, stress, fatigue, and energy change live.",
    ],
    shortcuts: ["V SELECT", "G MOVE", "R ROTATE"],
    action: "tutorial",
    actionLabel: "START GUIDED BUILD",
  },
  {
    id: "build-edit",
    category: "BUILD",
    icon: "✥",
    title: "Place, select, move, and transform",
    summary: "Directly manipulate one component or a complete selection.",
    why: "Precise transforms and clear selection are the foundation of every machine.",
    steps: [
      "Click a library card, then click neutral workbench space to place it.",
      "Click a part to select it; click empty ground to clear selection.",
      "Hold and drag a part beyond the small click threshold to move the selection across the work plane.",
      "Ctrl/Cmd/Shift-click adds or removes parts from a group.",
      "Use the Move or Rotate gizmos for exact axes and height; translation snaps to 0.25 m and rotation to 15°.",
      "Duplicate, Mirror X, Delete, Undo, and Redo work on the complete selection.",
    ],
    shortcuts: [
      "⌘/CTRL+A ALL",
      "⌘/CTRL+D DUPLICATE",
      "SHIFT+M MIRROR",
      "⌘/CTRL+Z UNDO",
    ],
    action: "build",
    actionLabel: "RETURN TO BUILD MODE",
  },
  {
    id: "connections",
    category: "BUILD",
    icon: "⌁",
    title: "Connections are physical paths",
    summary: "Understand shafts, meshes, joints, power, and signal links.",
    why: "A cable cannot rotate a gear, and a nearby wheel is not mounted until its hub sits on a shaft.",
    steps: [
      "Select a component and click the exact named port you want to use.",
      "Compatible targets highlight while a preview line follows the pointer.",
      "Mechanical links snap parts into valid alignment; power and signal links draw distinct cables.",
      "Red links or MISALIGNED status mean torque will not transfer.",
      "Use Exploded View to reveal every part and connection without changing the build.",
    ],
    shortcuts: ["2 CONNECT", "ESC CANCEL", "X EXPLODE"],
    action: "gearbox",
    actionLabel: "LOAD POWERED GEARBOX",
  },
  {
    id: "part-reference",
    category: "BUILD",
    icon: "▦",
    title: "What every component is for",
    summary:
      "A practical reference for structure, motion, smart parts, and propulsion.",
    why: "Choosing the right physical component is more useful than hiding behavior inside an abstract connection.",
    steps: [
      "Beams and mounting plates form rigid load paths and reusable chassis structure.",
      "Steel Axles carry rotation; Grip Wheels mount on shaft ends; 12T and 24T gears mesh at real pitch distance and ratio.",
      "Hinges create torque-limited articulated joints; levers transmit motion around a pivot; springs and suspension store and dissipate energy.",
      "Power Cells store energy; Logic Controllers route commands; sensors, IMUs, and gyros measure motion and balance.",
      "Motors create shaft torque, thrusters create force, and rocket/aero parts determine thrust, drag, stability, and heat survival.",
      "Ablative Heat Shields absorb sensible heat, then consume real material mass using their heat of ablation once pyrolysis begins.",
    ],
    shortcuts: ["STRUCTURE", "MECHANICAL", "SMART", "CLICK PART TO INSPECT"],
    action: "build",
    actionLabel: "BROWSE COMPONENT LIBRARY",
  },
  {
    id: "power-control",
    category: "CONTROL",
    icon: "◆",
    title: "Power, logic, and command routing",
    summary: "Trace energy and commands from source to actuator.",
    why: "Smart behavior requires both energy and a valid signal network.",
    steps: [
      "POWER ports carry electrical energy only; they do not carry data, commands, or torque.",
      "A Logic Controller must be powered before remote commands can pass through it.",
      "SIGNAL and CONTROL ports carry data or commands only; blue links transmit no power or torque.",
      "A Rotation Sensor's SHAFT is a mechanical measurement input. Mount it coaxially, then connect SIGNAL to a controller to expose signed rotation_rpm.",
      "The inspector reports NO POWER, MISALIGNED, charge, and connection state.",
      "Simulation drains real stored energy according to the active load.",
    ],
    shortcuts: ["CLICK PORT", "REMOTE: CHANNEL STATUS"],
    action: "remote",
    actionLabel: "OPEN FIELD REMOTE",
  },
  {
    id: "remote",
    category: "CONTROL",
    icon: "⌁",
    title: "Build a custom remote control",
    summary: "Create controls, bind targets, and assign keyboard shortcuts.",
    why: "The same command-routing model exposes authored controls for rovers, articulated robots, drones, and missions.",
    steps: [
      "Choose the machine template that matches the current build.",
      "CUSTOMIZE lets you rename, reorder, duplicate, or delete controls.",
      "Pick range, toggle, pulse, or hold behavior and bind a target component.",
      "Capture a key: press it to increase, or Shift+key to decrease a range.",
      "PIN DIRECT PANEL turns the same editable controls into a compact always-available control surface for any machine.",
      "Each channel says LINKED or OFFLINE so broken routing is visible.",
    ],
    shortcuts: ["WASD ROVER", "SPACE BRAKE", "L LIGHTS", "SHIFT+KEY DECREASE"],
    action: "remote",
    actionLabel: "OPEN FIELD REMOTE",
  },
  {
    id: "simulation",
    category: "PHYSICS",
    icon: "▶",
    title: "Test, pause, slow down, and diagnose",
    summary: "Observe cause and effect without losing the editable build.",
    why: "Slow motion and exact reset turn failures into understandable engineering feedback.",
    steps: [
      "Start Simulation to activate rigid bodies, constraints, power draw, and control logic.",
      "Pause at any instant, or cycle from 0.1× slow motion up to 2× speed.",
      "Reset restores the exact pre-test build, energy, and connection state.",
      "Structural health shows stress and accumulated fatigue; overloaded links can fail.",
      "Terrain, water buoyancy, collision, gravity, drag, and heating arise from the simulated state.",
    ],
    shortcuts: ["K PAUSE", "[ / ] SPEED", "⌘/CTRL+R RESET"],
    action: "challenges",
    actionLabel: "OPEN PHYSICS CHALLENGES",
  },
  {
    id: "camera",
    category: "WORKSPACE",
    icon: "◎",
    title: "Orbit, pan, zoom, and inspect",
    summary:
      "Navigate like a modern 3D editor with mouse, keyboard, or visible buttons.",
    why: "Good engineering depends on seeing joints, ports, alignment, and clearance from every angle.",
    steps: [
      "Option/Alt-drag orbits; Space-drag pans; pinch or scroll zooms toward the pointer.",
      "The visible Orbit and Pan modes also turn an ordinary drag into the chosen camera gesture.",
      "Double-click a part or press F to frame the current selection.",
      "Use Numpad 1, 3, and 7 for front, side, and top views; Home resets the workshop.",
      "Shift+F follows a moving selected component during simulation.",
    ],
    shortcuts: [
      "⌥ / ALT + DRAG ORBIT",
      "SPACE + DRAG PAN",
      "PINCH / WHEEL ZOOM",
      "F FOCUS",
      "NUMPAD 1 / 3 / 7 VIEWS",
    ],
    action: "camera",
    actionLabel: "SHOW CAMERA CHEAT SHEET",
  },
  {
    id: "reusable",
    category: "CREATE",
    icon: "▱",
    title: "Reusable parts, assemblies, and blueprints",
    summary: "Save tuned components or complete machines for later use.",
    why: "Complex engineering becomes manageable when proven subsystems can be reused.",
    steps: [
      "Select a tuned component and press + in the Component Library to save it under MY PARTS.",
      "Blueprints preserve every part, transform, connection, fatigue state, remote, and script.",
      "Name and save a complete machine locally, then load it in one click.",
      "Export JSON to move a blueprint between machines; import validates size and format.",
      "Use multi-select Duplicate or Mirror X to make reusable symmetric subassemblies quickly.",
    ],
    shortcuts: ["MY PARTS", "BLUEPRINT JSON", "SHIFT+M MIRROR"],
    action: "blueprints",
    actionLabel: "OPEN BLUEPRINT LIBRARY",
  },
  {
    id: "scripting",
    category: "CREATE",
    icon: "{ }",
    title: "Script smart components safely",
    summary: "Control machines with TypeScript or WebAssembly/WAT.",
    why: "Scripts turn sensors and components into autopilots, stabilizers, sequencers, and mission logic.",
    steps: [
      "Select a powered Logic Controller and press PROGRAM THIS CONTROLLER; SCRIPT reopens the active controller.",
      "Start in Visual Logic: add typed nodes, connect their sockets, and choose only sensors wired to this controller.",
      "Use TypeScript or WebAssembly for advanced programs; every mode compiles into the same isolated runtime.",
      "Click sensor cards to watch them live, arm a breakpoint, then advance exactly one physics tick at a time.",
      "Programs can command only signal-connected actuators and cannot bypass power, conflicts, or physical limits.",
      "The graph, code, watches, and breakpoints live with that controller; deterministic fuel limits reject runaway code.",
    ],
    shortcuts: ["VISUAL LOGIC", "TYPESCRIPT", "WEBASSEMBLY", "STEP PHYSICS"],
    action: "script",
    actionLabel: "OPEN SCRIPT WORKBENCH",
  },
  {
    id: "demos-challenges",
    category: "EXPLORE",
    icon: "⚑",
    title: "Learn from demos, prove it in challenges",
    summary:
      "Study five editable reference machines, then solve measurable trials.",
    why: "Examples teach construction; objectives turn that knowledge into experimentation and mastery.",
    steps: [
      "Demos progress from a gearbox to rover, drone, humanoid, and orbital missile.",
      "Every demo is editable—select, explode, rewire, tune, and simulate it.",
      "Challenges measure real outcomes rather than checking a scripted button sequence.",
      "Retry restores the exact starting build while preserving your personal best score.",
      "Use slow motion and telemetry to improve a design instead of guessing.",
    ],
    shortcuts: ["DEMOS", "CHALLENGES", "RETRY"],
    action: "demos",
    actionLabel: "OPEN COMPLEXITY LADDER",
  },
  {
    id: "world-space",
    category: "EXPLORE",
    icon: "☀",
    title: "Explore the physical world and space",
    summary: "Test machines across terrain, ponds, atmosphere, and near space.",
    why: "A creation should face the environment it was designed for, not an infinite flat plane.",
    steps: [
      "Drive off the steel plate onto heightfield terrain with grass, soil, hills, rocks, and trees.",
      "Ponds have sloped basins, bottom collision, water depth, drag, and component-level buoyancy.",
      "Set local solar time to inspect real lighting, shadows, twilight, stars, Earth, and Moon.",
      "Every moving component experiences atmospheric pressure, drag, force-at-a-lever-arm, and material heating; the same solver applies to missiles and fast ground vehicles.",
      "A meteor waits 100 m left at the Kármán line for a complete rendezvous mission.",
    ],
    shortcuts: ["ENVIRONMENT", "MIDNIGHT", "METEOR 100 KM"],
    action: "environment",
    actionLabel: "OPEN WORLD CONTROLS",
  },
];
export const DISCOVERY_STEPS = [
  {
    topic: "camera",
    title: "Look around naturally",
    copy: "Option/Alt-drag to orbit, Space-drag to pan, and pinch or scroll to zoom toward the pointer. Visible camera buttons work too.",
  },
  {
    topic: "build-edit",
    title: "Everything is directly editable",
    copy: "Click a component to inspect it. Add modifiers for a group, then move, rotate, duplicate, mirror, or delete the selection.",
  },
  {
    topic: "connections",
    title: "Connections explain the machine",
    copy: "Choose one exact port, then a compatible target. Mechanical parts physically snap; power and signal use distinct paths.",
  },
  {
    topic: "remote",
    title: "Build the controls too",
    copy: "The Field Remote is editable: add controls, change behavior, bind targets, and capture keyboard shortcuts.",
  },
  {
    topic: "demos-challenges",
    title: "Study, test, and prove",
    copy: "Load editable reference machines, inspect them in Exploded View, then solve physics-based challenges for a score.",
  },
];
