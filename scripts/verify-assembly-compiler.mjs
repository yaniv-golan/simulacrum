import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";
import { HeatInputCollector } from "../src/simulation/heat-input-collector.js";

const TEST_CAPACITY = {
  ultimateForceN: 24_000,
  ultimateTorqueNm: 6_000,
};

function mechanism(type, configure = () => {}) {
  const definition = structuredClone(mechanismComponentDefinition(type));
  configure(definition);
  return definition;
}

function assertNear(actual, expected, message, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

const expectedBuiltInTopology = {
    gearbox: {
      constraints: { fixed: 6, gear: 1, measurement: 1, revolute: 2 },
      power: 2,
      signal: 2,
      resource: 0,
    },
    cart: {
      constraints: {
        damper: 4,
        fixed: 16,
        "linear-guide": 4,
        revolute: 6,
        spring: 4,
      },
      power: 13,
      signal: 12,
      resource: 0,
    },
    humanoid: {
      constraints: { fixed: 17, revolute: 10 },
      power: 14,
      signal: 13,
      resource: 0,
    },
    drone: {
      constraints: { fixed: 17, revolute: 4 },
      power: 12,
      signal: 11,
      resource: 0,
    },
    mission: {
      constraints: { fixed: 30 },
      power: 12,
      signal: 18,
      resource: 5,
    },
  },
  gearbox = builtInDemo("gearbox").blueprint,
  runtimeGearbox = decodeBlueprintOrThrow(gearbox).assembly,
  compiledGearbox = compileAssembly(gearbox, TYPES);

for (const kind of ["gearbox", "cart", "drone", "humanoid", "mission"]) {
  const blueprint = builtInDemo(kind).blueprint,
    compiled = compileAssembly(blueprint, TYPES),
    constraintCounts = Object.fromEntries(
      [...new Set(compiled.constraints.map((item) => item.kind))]
        .sort()
        .map((constraintKind) => [
          constraintKind,
          compiled.constraints.filter((item) => item.kind === constraintKind)
            .length,
        ]),
    );
  assert.ok(
    blueprint.connections.every(
      (connection) => connection.portA && connection.portB,
    ),
    `${kind} entered compiler endpoint inference`,
  );
  assert.equal(
    compiled.stats.errorCount,
    0,
    `${kind} built-in blueprint does not compile`,
  );
  assert.ok(
    compiled.collisionExclusions.every(
      (exclusion) =>
        exclusion.kinds.length > 0 &&
        exclusion.sourceConstraintIds.length > 0 &&
        exclusion.sourceConnectionIds.length > 0,
    ),
    `${kind} collision exclusion lost topology provenance`,
  );
  assert.deepEqual(
    constraintCounts,
    expectedBuiltInTopology[kind].constraints,
    `${kind} compiled constraint topology changed`,
  );
  assert.equal(
    compiled.networks.power.length,
    expectedBuiltInTopology[kind].power,
    `${kind} power topology changed`,
  );
  assert.equal(
    compiled.networks.signal.length,
    expectedBuiltInTopology[kind].signal,
    `${kind} signal topology changed`,
  );
  assert.equal(
    compiled.networks.resource.length,
    expectedBuiltInTopology[kind].resource,
    `${kind} resource topology changed`,
  );
}

assert.equal(
  compiledGearbox.stats.errorCount,
  0,
  "gearbox topology has errors",
);
assert.equal(
  compiledGearbox.bodies.length,
  gearbox.parts.length,
  "solid gearbox parts were omitted from the body graph",
);
assert.equal(
  compiledGearbox.constraints.filter((item) => item.kind === "fixed").length,
  6,
  "mounted gearbox components did not compile to fixed constraints",
);
assert.equal(
  compiledGearbox.constraints.filter((item) => item.kind === "revolute").length,
  2,
  "gear shafts did not compile to revolute constraints",
);
assert.equal(
  compiledGearbox.constraints.filter((item) => item.kind === "gear").length,
  1,
  "gear tooth mesh did not compile to a ratio coupling",
);
assert.equal(
  compiledGearbox.constraints.filter((item) => item.kind === "measurement")
    .length,
  1,
  "rotation sensor became a load-bearing attachment",
);

const connectorAssembly = {
    revision: 4,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [-1, 1, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 2,
        type: "hinge",
        pos: [0, 1, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("hinge"),
      },
      {
        id: 3,
        type: "beam",
        pos: [1, 1, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 4,
        type: "plate",
        pos: [-1, 3, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 5,
        type: "spring",
        pos: [0, 3, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("spring", (definition) => {
          definition.config.referenceLaw.freeLengthM = 2;
          definition.config.elasticLaw.stiffnessNPerM = 240;
          definition.config.dampingLaw.dampingNsPerM = 12;
        }),
      },
      {
        id: 6,
        type: "beam",
        pos: [1, 3, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
    ],
    connections: [
      {
        id: "hinge-base",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: [0, 0, 0],
        capacity: TEST_CAPACITY,
      },
      {
        id: "hinge-arm",
        a: 2,
        b: 3,
        kind: "mechanical",
        portA: "ARM",
        portB: "A",
        capacity: TEST_CAPACITY,
      },
      {
        id: "spring-a",
        a: 4,
        b: 5,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        capacity: TEST_CAPACITY,
      },
      {
        id: "spring-b",
        a: 5,
        b: 6,
        kind: "mechanical",
        portA: "END_B",
        portB: "A",
        capacity: TEST_CAPACITY,
      },
    ],
  },
  compiledConnectors = compileAssembly(connectorAssembly, TYPES);

assert.equal(
  compiledConnectors.stats.forceElementPartCount,
  1,
  "force-element parts were not compiled as topology",
);
assert.equal(
  compiledConnectors.bodies.length,
  5,
  "the hinge housing must remain a physical body while the ideal spring must not",
);
assert.equal(
  compiledConnectors.stats.totalMass,
  89,
  "the hinge body mass or ideal spring mass contract changed",
);
assert.ok(
  compiledConnectors.constraints.some(
    (item) => item.kind === "revolute" && item.sourcePartId === 2,
  ),
  "two-ended hinge did not become a revolute joint",
);
assert.deepEqual(
  compiledConnectors.collisionExclusions.map(({ a, b }) => [a, b]),
  [
    [1, 3],
    [2, 3],
  ],
  "rigid-cluster and coordinate collision exclusions changed",
);
assert.deepEqual(
  compiledConnectors.constraints.find(
    (item) => item.kind === "revolute" && item.sourcePartId === 2,
  ).anchor,
  [0, 1, 0],
  "hinge coordinate drifted from the authored mechanism frame to a catalog snap frame",
);
assert.ok(
  compiledConnectors.constraints.some(
    (item) => item.kind === "spring" && item.sourcePartId === 5,
  ),
  "two-ended spring did not become a force element",
);
const compiledSpring = compiledConnectors.constraints.find(
  (item) => item.kind === "spring" && item.sourcePartId === 5,
);
assert.deepEqual(
  compiledSpring.anchorA,
  [-2.2, 3, 0],
  "spring endpoint A did not use the neighbor's authored attachment frame",
);
assert.deepEqual(
  compiledSpring.anchorB,
  [-0.19999999999999996, 3, 0],
  "spring endpoint B did not use the neighbor's authored attachment frame",
);

const damperAssembly = {
    revision: 4,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 2,
        type: "damper",
        pos: [2, 0, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("damper"),
      },
      {
        id: 3,
        type: "plate",
        pos: [4, 0, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
    ],
    connections: [
      {
        id: "damper-a",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        capacity: TEST_CAPACITY,
      },
      {
        id: "damper-b",
        a: 2,
        b: 3,
        kind: "mechanical",
        portA: "END_B",
        portB: "TOP",
        capacity: TEST_CAPACITY,
      },
    ],
  },
  compiledDamper = compileAssembly(damperAssembly, TYPES),
  damperEndpointBody = compiledDamper.bodies.find((body) => body.partId === 1);
assert.equal(compiledDamper.stats.totalMass, 50);
assert.equal(damperEndpointBody.massProperties.massKg, 25);
assertNear(
  damperEndpointBody.massProperties.comPositionPartM[0],
  -0.144,
  "endpoint-lumped damper mass did not shift center of mass",
);
assertNear(
  damperEndpointBody.massProperties.inertiaTensorAtComPartKgM2.yy,
  24.9216,
  "endpoint-lumped damper mass did not apply the parallel-axis theorem",
);
assert.deepEqual(
  damperEndpointBody.massProperties.endpointPointMasses,
  [
    {
      sourcePartId: 2,
      sourceConnectionId: "damper-a",
      endpointPort: "END_A",
      massKg: 3,
      positionPartM: [-1.2, 0, 0],
    },
  ],
  "endpoint mass provenance changed",
);
const massFrameWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  massFrameRuntime = new MultibodyRuntime({
    world: massFrameWorld,
    catalog: TYPES,
  }),
  massFrameTelemetry = massFrameRuntime.start(damperAssembly),
  compiledMassBody = massFrameRuntime.compiled.bodies.find(
    (body) => body.partId === 1,
  ),
  engineMassBody = massFrameRuntime.bodyByPart.get(1),
  visibleMassPose = massFrameTelemetry.poses.find((pose) => pose.id === 1);
assertNear(
  engineMassBody.position.x,
  -0.144,
  "Cannon body origin is not the compiled center of mass",
);
assertNear(
  visibleMassPose.position.x,
  0,
  "runtime telemetry leaked the internal center-of-mass frame as the part frame",
);
for (const [axis, actual] of [
  [0, engineMassBody.inertia.x],
  [1, engineMassBody.inertia.y],
  [2, engineMassBody.inertia.z],
])
  assertNear(
    actual,
    compiledMassBody.massProperties.principalMomentsKgM2[axis],
    `Cannon principal inertia ${axis} diverged from the compiler`,
  );
massFrameRuntime.dispose();

const exclusionWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0),
  }),
  exclusionRuntime = new MultibodyRuntime({
    world: exclusionWorld,
    catalog: TYPES,
  });
exclusionRuntime.start(connectorAssembly);
assert.equal(
  exclusionRuntime.collisionExclusionConstraints.length,
  compiledConnectors.collisionExclusions.length,
  "runtime did not install every compiler-owned collision exclusion",
);
assert.ok(
  exclusionRuntime.collisionExclusionConstraints.every(
    (entry) =>
      entry.active === true &&
      entry.constraint.collideConnected === false &&
      entry.constraint.equations.length === 0,
  ),
  "collision exclusions gained solver equations or allowed adjacent contact",
);
exclusionRuntime.dispose();

const incomplete = compileAssembly(
  {
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
      },
      {
        id: 2,
        type: "spring",
        pos: [0, 1, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("spring"),
      },
      {
        id: 3,
        type: "gear12",
        pos: [2, 1, 0],
        orientation: [0, 0, 0, 1],
      },
    ],
    connections: [
      {
        id: "one-end",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        capacity: TEST_CAPACITY,
      },
    ],
  },
  TYPES,
);
assert.ok(
  incomplete.diagnostics.some((item) => item.code === "INCOMPLETE_CONNECTOR"),
  "incomplete spring gained a hidden attachment",
);
assert.ok(
  incomplete.diagnostics.some(
    (item) => item.code === "UNSUPPORTED_ROTARY_PART",
  ),
  "unsupported gear gained a hidden world bearing",
);

const axleDrivetrain = compileAssembly(
  {
    parts: [
      {
        id: 31,
        type: "motor",
        pos: [0, 1, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 32,
        type: "axle",
        pos: [1, 1, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("axle"),
      },
      {
        id: 33,
        type: "wheel",
        pos: [2, 1, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("wheel"),
      },
    ],
    connections: [
      {
        id: "motor-axle",
        a: 31,
        b: 32,
        kind: "mechanical",
        portA: "SHAFT",
        portB: "LEFT",
        capacity: TEST_CAPACITY,
      },
      {
        id: "axle-wheel",
        a: 32,
        b: 33,
        kind: "mechanical",
        portA: "RIGHT",
        portB: "AXLE",
        capacity: TEST_CAPACITY,
      },
    ],
  },
  TYPES,
);
assert.ok(
  axleDrivetrain.constraints.some(
    (constraint) => constraint.kind === "revolute" && constraint.motorId === 31,
  ),
  "motor output did not compile to an explicit rotary actuator coordinate",
);
assert.ok(
  axleDrivetrain.constraints.some(
    (constraint) =>
      constraint.kind === "fixed" &&
      constraint.sourceConnectionIds.includes("axle-wheel"),
  ),
  "rotary coupling did not lock the wheel to its authored axle",
);

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  groundMaterial = new CANNON.Material("compiler-test-ground"),
  assemblyMaterial = new CANNON.Material("compiler-test-assembly"),
  ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    material: groundMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(20, 0.25, 20)),
    position: new CANNON.Vec3(0, -0.25, 0),
  });
world.solver.iterations = 24;
world.solver.tolerance = 0.0005;
world.addBody(ground);
world.addContactMaterial(
  new CANNON.ContactMaterial(assemblyMaterial, groundMaterial, {
    friction: 0.7,
    restitution: 0.02,
  }),
);

const runtime = new MultibodyRuntime({
    world,
    material: assemblyMaterial,
    catalog: TYPES,
  }),
  battery = runtimeGearbox.parts.find((part) => part.type === "battery"),
  motor = runtimeGearbox.parts.find((part) => part.type === "motor"),
  input = runtimeGearbox.parts.find((part) => part.type === "gear12"),
  output = runtimeGearbox.parts.find((part) => part.type === "gear24"),
  runGraph = new RunAssemblyGraph(runtimeGearbox),
  powerNetwork = new PowerNetwork(TYPES),
  motorEnergySettlement = new MotorEnergySettlementSystem(),
  heatInputCollector = new HeatInputCollector(),
  commandBus = new CommandBus(),
  initialBatteryJ = runGraph.part(battery.id).energyJ;
runtime.start(runtimeGearbox);
commandBus.writeRemote(motor.id, "throttle", 0.55);
const context = {
  runGraph,
  powerNetwork,
  commandBus,
  clock: { tick: 0 },
  telemetry: {},
  services: {
    multibodyRuntime: runtime,
    worldAdapter: runtime.worldAdapter,
    heatInputCollector,
  },
};
let telemetry = null;
for (let step = 0; step < 1_440; step++) {
  context.clock.tick = step + 1;
  context.telemetry = {};
  powerNetwork.resolve(runGraph, 1 / 120);
  runtime.stepActuators(context, 1 / 120);
  runtime.worldAdapter.integrate(1 / 120, { tick: step + 1 });
  motorEnergySettlement.step(context, 1 / 120);
  telemetry = runtime.afterIntegration(1 / 120);
}

const inputPose = telemetry.poses.find((pose) => pose.id === input.id),
  outputPose = telemetry.poses.find((pose) => pose.id === output.id),
  observedRatio = inputPose.phase / outputPose.phase;
assert.ok(
  Math.abs(inputPose.phase) > 0.2 && Math.abs(outputPose.phase) > 0.1,
  "powered compiled drivetrain did not rotate",
);
assert.ok(
  observedRatio < -1.65 && observedRatio > -2.35,
  `physical mesh ratio drifted outside compliance tolerance: ${observedRatio}`,
);
assert.ok(
  telemetry.joints.every(
    (joint) =>
      Number.isFinite(joint.angle) && Number.isFinite(joint.reactionTorque),
  ),
  "compiled joint telemetry contains non-finite physical state",
);
assert.ok(
  runGraph.part(battery.id).energyJ < initialBatteryJ,
  "compiled motor consumed no electrical energy",
);
assert.ok(
  telemetry.connectionLoads["demo-gearbox-11"] > 0,
  "gear contact produced no physical attachment load",
);
assert.ok(
  telemetry.connectionTorques["demo-gearbox-11"] > 0,
  "powered gear contact produced no physical reaction torque",
);
const motorEntry = runtime.constraintEntries.find(
    (entry) => entry.descriptor.motorId === motor.id,
  ),
  motorConnectionId = motorEntry.descriptor.sourceConnectionIds[0],
  ratedStallTorqueNm =
    (motorEntry.descriptor.driveLaw.maximumElectricalPowerW /
      motorEntry.descriptor.driveLaw.noLoadSpeedRadPerS) *
    2.2;
commandBus.clearTick();
commandBus.writeRemote(motor.id, "throttle", 0.0001);
context.clock.tick++;
context.telemetry = {};
powerNetwork.resolve(runGraph, 1 / 120);
const lowCommandTelemetry = runtime.stepActuators(context, 1 / 120);
assert.ok(
  lowCommandTelemetry.connectionTorques[motorConnectionId] <=
    ratedStallTorqueNm * (1 + 1e-12),
  "near-zero throttle increased motor torque beyond the rated stall torque",
);
runtime.worldAdapter.integrate(1 / 120, { tick: context.clock.tick });
motorEnergySettlement.step(context, 1 / 120);
runtime.afterIntegration(1 / 120);
assert.ok(
  heatInputCollector
    .recordsForTick(context.clock.tick)
    .some(
      (record) =>
        record.partId === motor.id &&
        record.source === "motor-energy-settlement",
    ),
  "settled motor loss did not enter the shared current-tick heat collector",
);
const fixedConnection = gearbox.connections.find(
    (connection) => connection.id === "demo-gearbox-4",
  ),
  failedConstraintEntry = runtime.constraintEntries.find((entry) =>
    entry.descriptor.sourceConnectionIds?.includes(fixedConnection.id),
  ),
  constraintsBeforeFailure = world.constraints.length;
fixedConnection.failed = true;
const detached = runtime.applyConnectionFailures(gearbox.connections);
assert.ok(
  detached.includes("fixed:demo-gearbox-4"),
  "failed model connection left its compiled constraint active",
);
assert.equal(failedConstraintEntry.active, false);
assert.ok(
  !world.constraints.includes(failedConstraintEntry.constraint),
  "failed fixed connection was not removed from Cannon",
);
assert.ok(
  world.constraints.length < constraintsBeforeFailure,
  "failure did not remove any runtime topology",
);
assert.ok(
  runtime.collisionExclusionConstraints.every((entry) =>
    entry.active
      ? world.constraints.includes(entry.constraint)
      : !world.constraints.includes(entry.constraint),
  ),
  "collision exclusions did not follow the post-failure topology",
);
runtime.dispose();
assert.equal(
  runtime.bodyByPart.size,
  0,
  "compiled bodies leaked after dispose",
);

const unpoweredAssembly = structuredClone(runtimeGearbox);
unpoweredAssembly.connections = unpoweredAssembly.connections.filter(
  (connection) => connection.kind !== "power",
);
const unpoweredRuntime = new MultibodyRuntime({
    world,
    material: assemblyMaterial,
    catalog: TYPES,
  }),
  unpoweredGraph = new RunAssemblyGraph(unpoweredAssembly),
  unpoweredNetwork = new PowerNetwork(TYPES),
  unpoweredBus = new CommandBus(),
  unpoweredMotor = unpoweredAssembly.parts.find(
    (part) => part.type === "motor",
  ),
  unpoweredBattery = unpoweredAssembly.parts.find(
    (part) => part.type === "battery",
  ),
  unpoweredInitialEnergy = unpoweredGraph.part(unpoweredBattery.id).energyJ;
unpoweredRuntime.start(unpoweredAssembly);
unpoweredBus.writeRemote(unpoweredMotor.id, "throttle", 1);
let unpoweredTelemetry;
for (let step = 0; step < 120; step++) {
  unpoweredNetwork.resolve(unpoweredGraph, 1 / 120);
  unpoweredRuntime.stepActuators(
    {
      runGraph: unpoweredGraph,
      powerNetwork: unpoweredNetwork,
      commandBus: unpoweredBus,
      services: {},
    },
    1 / 120,
  );
  unpoweredRuntime.worldAdapter.integrate(1 / 120, { tick: 361 + step });
  unpoweredTelemetry = unpoweredRuntime.afterIntegration(1 / 120);
}
assert.equal(
  unpoweredTelemetry.activeMotors,
  0,
  "disconnected motor was reported as physically active",
);
assert.equal(
  unpoweredGraph.part(unpoweredBattery.id).energyJ,
  unpoweredInitialEnergy,
  "disconnected motor consumed electrical energy",
);
assert.equal(
  unpoweredRuntime.constraintEntries.find(
    (entry) => entry.descriptor.motorId === unpoweredMotor.id,
  ).constraint.motorEquation.enabled,
  false,
  "disconnected motor applied actuator torque",
);
unpoweredRuntime.dispose();

const servoAssembly = {
    parts: [
      {
        id: 201,
        type: "plate",
        pos: [-1.2, 2, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 202,
        type: "hinge",
        pos: [0, 2, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("hinge", (definition) => {
          const lower = (-70 * Math.PI) / 180,
            upper = (70 * Math.PI) / 180;
          definition.config.angleRangeRad = { lower, upper };
          definition.config.friction.viscousNms = 5;
          definition.config.actuation.commandRangeRad = { lower, upper };
          definition.config.actuation.maximumTorqueNm = 180;
        }),
      },
      {
        id: 203,
        type: "beam",
        pos: [1.2, 2, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 204,
        type: "battery",
        pos: [-1.2, 2.7, 0],
        orientation: [0, 0, 0, 1],
        storedEnergyWh: 100,
        config: { capacityWh: 100, dischargeEfficiency: 1 },
      },
    ],
    connections: [
      {
        id: "servo-base",
        a: 201,
        b: 202,
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: [0, 0, 0],
        capacity: TEST_CAPACITY,
      },
      {
        id: "servo-arm",
        a: 202,
        b: 203,
        kind: "mechanical",
        portA: "ARM",
        portB: "A",
        capacity: TEST_CAPACITY,
      },
      {
        id: "servo-power",
        a: 204,
        b: 202,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: "battery-mount",
        a: 201,
        b: 204,
        kind: "mechanical",
        portA: "TOP",
        portB: "MOUNT",
        anchorA: [0.6, 0, 0],
        capacity: TEST_CAPACITY,
      },
    ],
  },
  servoWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0),
  }),
  servoRuntime = new MultibodyRuntime({
    world: servoWorld,
    material: assemblyMaterial,
    catalog: TYPES,
  }),
  servoGraph = new RunAssemblyGraph(servoAssembly),
  servoPower = new PowerNetwork(TYPES),
  servoBus = new CommandBus(),
  servoContext = {
    runGraph: servoGraph,
    powerNetwork: servoPower,
    commandBus: servoBus,
    services: {},
  };
servoRuntime.start(servoAssembly);
servoBus.writeRemote(202, "joint_target", 0.65);
let servoTelemetry = null;
for (let step = 0; step < 180; step++) {
  servoPower.resolve(servoGraph, 1 / 120);
  servoRuntime.stepActuators(servoContext, 1 / 120);
  servoRuntime.worldAdapter.integrate(1 / 120, { tick: step + 1 });
  servoTelemetry = servoRuntime.afterIntegration(1 / 120);
}
const servoJoint = servoTelemetry.joints.find(
    (joint) => joint.sourcePartId === 202,
  ),
  servoEntry = servoRuntime.constraintEntries.find(
    (entry) => entry.descriptor.sourcePartId === 202,
  );
assert.ok(
  Math.abs(servoJoint.angle) > 0.2 && servoJoint.reactionTorque > 0,
  `powered hinge did not create torque-limited physical articulation: ${JSON.stringify({ joint: servoJoint, descriptor: servoEntry.descriptor, constraints: servoRuntime.constraintEntries.map((entry) => entry.descriptor), contacts: servoWorld.contacts.map((contact) => [contact.bi.userData?.partId, contact.bj.userData?.partId]), failures: servoTelemetry.failures, loads: servoTelemetry.connectionLoads })}`,
);
servoRuntime.dispose();

const springRuntime = new MultibodyRuntime({
  world,
  material: assemblyMaterial,
  catalog: TYPES,
});
springRuntime.start(connectorAssembly);
const relaxedSpring = springRuntime.stepActuators({ services: {} }, 1 / 120);
assert.ok(
  Math.abs(relaxedSpring.connectionLoads["spring-a"] || 0) < 1e-8,
  "relaxed spring was preloaded by inconsistent anchor geometry",
);
springRuntime.bodyByPart.get(6).position.x += 0.45;
const springTelemetry = springRuntime.stepActuators({ services: {} }, 1 / 120);
assert.ok(
  springTelemetry.connectionLoads["spring-a"] > 0 &&
    springTelemetry.connectionLoads["spring-b"] > 0,
  "spring displacement produced no equal-and-opposite physical load",
);
springRuntime.dispose();

console.log(
  `assembly compiler passed (${compiledGearbox.stats.bodyCount} bodies, ${compiledGearbox.stats.constraintCount} constraints, ratio ${observedRatio.toFixed(3)})`,
);
