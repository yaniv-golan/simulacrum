import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import {
  TYPES,
  compileAssembly,
  geometryDescriptorForPart,
  resolveWireComponentConfig,
  rotorAerodynamicPerformance,
  validateRotorConfig,
} from "../src/core/index.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { BodyRegistry } from "../src/simulation/body-registry.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { rotorAerodynamicContract } from "../src/model/rotor-aerodynamics-contracts.js";
import { RotorForceOwner } from "../src/simulation/rotor-force-owner.js";
import { RotorPropulsionSystem } from "../src/simulation/systems/rotor-propulsion-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";

const identityScale = { x: 1, y: 1, z: 1 },
  part = {
    id: 1,
    type: "rotor",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: identityScale,
    config: resolveWireComponentConfig({ type: "rotor", scale: identityScale }),
  },
  config = validateRotorConfig(part.config, part.scale, part.id),
  geometry = geometryDescriptorForPart(part),
  compiled = compileAssembly(
    { revision: 1, parts: [part], connections: [] },
    TYPES,
  ),
  capability = compiled.bodies[0].capabilities.propulsion;

assert.equal(compiled.stats.errorCount, 0);
assert.equal(capability.kind, "shaft-rotor-aerodynamics-v1");
assert.equal(geometry.collisionPrimitives.length, 1);
assert.equal(
  geometry.collisionPrimitives[0].geometry.radiusM,
  config.hubRadiusM,
);
assert.equal(
  geometry.collisionPrimitives[0].approximationOf,
  "rotor-blade-contact-unsupported-v1",
);
assert.equal(geometry.bodyPrimitives.length, config.bladeCount + 1);
assert.deepEqual(
  geometry.bodyPrimitives.map(({ id }) => id),
  [
    "hub",
    ...Array.from(
      { length: config.bladeCount },
      (_, index) => `blade-${index}`,
    ),
  ],
);
assert.equal(
  geometry.portFrames.SHAFT.framePart.positionM[2],
  -config.hubThicknessM / 2,
);
assert.ok(
  geometry.selectionBoundsPartM.maximumM[0] > config.hubRadiusM,
  "rotor selection bounds did not include its canonical blade bodies",
);
assert.ok(
  geometry.aerodynamicSurfaces[0].areaM2 < Math.PI * config.radiusM ** 2,
  "rotor disk leaked into ordinary box drag",
);

const speed = (config.ratedRpm * 2 * Math.PI) / 60,
  clockwise = rotorAerodynamicPerformance(capability, {
    airDensityKgM3: 1.225,
    axialInflowMps: 0,
    angularSpeedRadS: speed,
  }),
  mirrored = rotorAerodynamicPerformance(
    { ...capability, handedness: -1 },
    {
      airDensityKgM3: 1.225,
      axialInflowMps: 0,
      angularSpeedRadS: -speed,
    },
  );
assert.ok(clockwise.thrustN > 0, clockwise);
assert.ok(clockwise.aerodynamicTorqueNm < 0, clockwise);
assert.ok(clockwise.aerodynamicPowerW > 0, clockwise);
assert.ok(Math.abs(clockwise.thrustN - mirrored.thrustN) < 1e-9);
assert.ok(
  Math.abs(clockwise.aerodynamicTorqueNm + mirrored.aerodynamicTorqueNm) < 1e-9,
);
assert.deepEqual(Object.keys(clockwise), [
  "thrustN",
  "aerodynamicTorqueNm",
  "aerodynamicPowerW",
  "inducedVelocityMps",
  "rpm",
  "tipMach",
  "valid",
  "reason",
]);
assert.ok(Math.abs(clockwise.thrustN - 984.6501370191468) < 1e-9);
assert.ok(Math.abs(clockwise.aerodynamicTorqueNm + 88.32579064956138) < 1e-9);
assert.ok(Math.abs(clockwise.aerodynamicPowerW - 16649.019301630324) < 1e-9);
assert.ok(Math.abs(clockwise.inducedVelocityMps - 12.567241652510832) < 1e-9);
assert.equal(clockwise.rpm, 1800);
assert.ok(Math.abs(clockwise.tipMach - 0.498533613370504) < 1e-12);
assert.equal(clockwise.valid, true);
assert.equal(clockwise.reason, "in-envelope");

const climb = rotorAerodynamicPerformance(capability, {
    airDensityKgM3: 1.225,
    axialInflowMps: 5,
    angularSpeedRadS: speed,
  }),
  descent = rotorAerodynamicPerformance(capability, {
    airDensityKgM3: 1.225,
    axialInflowMps: -5,
    angularSpeedRadS: speed,
  }),
  idle = rotorAerodynamicPerformance(capability, {
    airDensityKgM3: 1.225,
    angularSpeedRadS: 0,
  }),
  vacuum = rotorAerodynamicPerformance(capability, {
    airDensityKgM3: 0,
    angularSpeedRadS: speed,
  });
assert.ok(Math.abs(climb.thrustN - 769.6620433567219) < 1e-9);
assert.ok(Math.abs(descent.thrustN - 1207.0633740460871) < 1e-9);
for (const inactive of [idle, vacuum]) {
  assert.equal(inactive.thrustN, 0);
  assert.equal(inactive.aerodynamicTorqueNm, 0);
  assert.equal(inactive.aerodynamicPowerW, 0);
  assert.equal(inactive.inducedVelocityMps, 0);
  assert.equal(inactive.valid, true);
  assert.equal(inactive.reason, "idle");
}

const overspeed = rotorAerodynamicPerformance(capability, {
  airDensityKgM3: 1.225,
  axialInflowMps: 0,
  angularSpeedRadS: (config.maximumRpm * 2 * Math.PI * 1.1) / 60,
});
assert.equal(overspeed.valid, false);
assert.equal(overspeed.thrustN, 0);
assert.ok(overspeed.aerodynamicTorqueNm < 0, overspeed);
assert.ok(overspeed.aerodynamicPowerW > 0, overspeed);
assert.equal(overspeed.reason, "overspeed");
const tipMachExceeded = rotorAerodynamicPerformance(
  { ...capability, maximumRpm: 100_000 },
  {
    airDensityKgM3: 1.225,
    angularSpeedRadS: (0.83 * 340.29) / capability.radiusM,
  },
);
assert.equal(tipMachExceeded.valid, false);
assert.equal(tipMachExceeded.reason, "tip-mach");
assert.equal(tipMachExceeded.thrustN, 0);
assert.ok(tipMachExceeded.aerodynamicTorqueNm < 0);

assert.equal(rotorAerodynamicContract(part, { flight: {} }, geometry), null);
assert.throws(
  () =>
    rotorAerodynamicContract(
      part,
      { flight: { propulsion: { kind: "unknown" } } },
      geometry,
    ),
  /Unknown propulsion contract/,
);
const directContract = rotorAerodynamicContract(part, TYPES.rotor, geometry);
assert.deepEqual(directContract, capability);

const drone = builtInDemo("drone").blueprint,
  rotorPart = drone.parts.find((candidate) => candidate.type === "rotor"),
  shaftConnection = drone.connections.find(
    (connection) =>
      (connection.a === rotorPart.id || connection.b === rotorPart.id) &&
      connection.portA === "SHAFT" &&
      connection.portB === "SHAFT",
  ),
  runGraph = new RunAssemblyGraph(drone),
  fakeRuntime = {
    compiled: {},
    bodyByPart: new Map(
      drone.parts.map((candidate) => [
        candidate.id,
        { mass: candidate.config?.mass || 1 },
      ]),
    ),
    constraintEntries: [
      {
        active: true,
        descriptor: {
          id: "overspeed-shaft",
          kind: "revolute",
          a: shaftConnection.a,
          b: shaftConnection.b,
          sourceConnectionIds: [shaftConnection.id],
        },
      },
    ],
    loadByConnection: new Map(),
    torqueByConnection: new Map(),
    applyConnectionFailures() {
      return [];
    },
  },
  structure = new StructureSystem(),
  structureContext = {
    clock: { tick: 7 },
    time: 7 / 120,
    runGraph,
    bodyRegistry: new BodyRegistry(),
    services: { multibodyRuntime: fakeRuntime },
    telemetry: {
      propulsion: {
        tick: 7,
        engines: [
          {
            partId: rotorPart.id,
            shaftConstraintId: "overspeed-shaft",
            validity: "overspeed",
            failureInput: "rotor-operating-envelope-exceeded",
          },
        ],
      },
    },
  };
structure.initialize(structureContext);
structure.step(structureContext, 1 / 120);
assert.equal(runGraph.connection(shaftConnection.id).failed, true);
assert.equal(runGraph.events().at(-1).mode, "operating-envelope");
assert.deepEqual(structureContext.telemetry.structures.failureInputs, [
  {
    connectionId: shaftConnection.id,
    partId: rotorPart.id,
    input: "rotor-operating-envelope-exceeded",
    validity: "overspeed",
  },
]);

assert.throws(
  () => validateRotorConfig(config, { x: 2, y: 2, z: 2 }, 1),
  /requires portable scale/i,
);
assert.throws(
  () =>
    validateRotorConfig(
      { ...config, ratedRpm: config.maximumRpm + 1 },
      identityScale,
      1,
    ),
  /ratedRpm/i,
);
assert.throws(
  () =>
    validateRotorConfig({ ...config, profileId: "unknown" }, identityScale, 1),
  /Unknown rotor profile/,
);
for (const field of [
  "mass",
  "hubRadiusM",
  "hubThicknessM",
  "radiusM",
  "bladeChordM",
  "ratedRpm",
  "maximumRpm",
]) {
  for (const value of [0, -1, Number.NaN])
    assert.throws(
      () =>
        validateRotorConfig({ ...config, [field]: value }, identityScale, 1),
      new RegExp(field),
    );
}
for (const bladeCount of [1, 9, 2.5, Number.NaN])
  assert.throws(
    () => validateRotorConfig({ ...config, bladeCount }, identityScale, 1),
    /bladeCount/,
  );
for (const fixedPitchDeg of [1.9, 35.1, Number.NaN])
  assert.throws(
    () => validateRotorConfig({ ...config, fixedPitchDeg }, identityScale, 1),
    /fixedPitchDeg/,
  );
assert.equal(validateRotorConfig({ ...config, bladeCount: 8 }).bladeCount, 8);
assert.equal(
  validateRotorConfig({ ...config, fixedPitchDeg: 2 }).fixedPitchDeg,
  2,
);
assert.equal(
  validateRotorConfig({ ...config, fixedPitchDeg: 35 }).fixedPitchDeg,
  35,
);
assert.throws(
  () => validateRotorConfig({ ...config, handedness: 0 }, identityScale, 1),
  /handedness/,
);
assert.throws(
  () =>
    validateRotorConfig(
      { ...config, hubRadiusM: config.radiusM },
      identityScale,
      1,
    ),
  /hubRadiusM/,
);
assert.throws(
  () =>
    validateRotorConfig(
      {
        ...config,
        bladeChordM: config.radiusM - config.hubRadiusM,
      },
      identityScale,
      1,
    ),
  /bladeChordM/,
);
assert.equal(
  validateRotorConfig(
    { ...config, ratedRpm: config.maximumRpm },
    identityScale,
    1,
  ).ratedRpm,
  config.maximumRpm,
);

function rotorBody(position, velocity = new CANNON.Vec3()) {
  const body = new CANNON.Body({ mass: 18, position, velocity });
  body.userData = {
    massFrame: {
      principalToPart: new CANNON.Quaternion(),
      comPart: new CANNON.Vec3(),
    },
  };
  return body;
}

const activeBody = rotorBody(
    new CANNON.Vec3(2, 100, 3),
    new CANNON.Vec3(1, 2, 3),
  ),
  invalidBody = rotorBody(new CANNON.Vec3(-2, 50, -3)),
  states = new Map([
    [
      1,
      {
        valid: true,
        reason: "connected",
        constraintId: "shaft:1",
        motorId: 4,
        absoluteAngularSpeedRadS: speed,
        relativeAngularSpeedRadS: speed - 1,
      },
    ],
    [
      2,
      {
        valid: false,
        reason: "shaft-disconnected",
        constraintId: null,
        motorId: null,
        absoluteAngularSpeedRadS: 0,
        relativeAngularSpeedRadS: 0,
      },
    ],
  ]),
  forceModel = {
    parts: [
      { id: 2, propulsion: capability, body: invalidBody },
      { id: 99, propulsion: null, body: invalidBody },
      { id: 1, propulsion: capability, body: activeBody },
    ],
    runtime: { rotaryStateForPart: (partId) => states.get(partId) },
  },
  forceOwner = new RotorForceOwner({
    physicalFlightModel: forceModel,
    windAt: () => ({ x: 0.5, y: 1, z: 1.5 }),
  }),
  forceContext = {
    clock: { tick: 12 },
    time: 0.1,
    runGraph: { part: () => ({ detached: false }) },
    powerNetwork: {
      sourceIdsFor: (motorId) => (motorId === 4 ? [3] : []),
      allocationFor: (motorId) =>
        motorId === 4 ? { allocationId: "allocation:12:4" } : null,
    },
    commandBus: {
      read: () => ({ source: "controller:5", value: 0.75 }),
    },
    telemetry: {
      propulsion: { engines: [{ kind: "pressure-nozzle-v1", partId: 50 }] },
    },
  };
assert.equal(forceOwner.active(), true);
forceOwner.step(forceContext);
const forceRecords = forceOwner.records();
assert.equal(forceRecords.length, 2);
assert.deepEqual(
  forceRecords.map((record) => record.partId),
  [1, 2],
);
const activeRecord = forceRecords[0],
  invalidRecord = forceRecords[1];
assert.equal(activeRecord.tick, 12);
assert.equal(activeRecord.bodyId, "body:1");
assert.equal(activeRecord.shaftConstraintId, "shaft:1");
assert.equal(activeRecord.motorPartId, 4);
assert.deepEqual(activeRecord.powerSourceIds, [3]);
assert.equal(activeRecord.allocationId, "allocation:12:4");
assert.equal(activeRecord.active, true);
assert.equal(activeRecord.valid, true);
assert.equal(activeRecord.validity, "in-envelope");
assert.deepEqual(activeRecord.worldDirection, { x: 0, y: 0, z: 1 });
assert.deepEqual(activeRecord.applicationPointWorldM, { x: 2, y: 100, z: 3 });
assert.equal(activeRecord.absoluteAngularSpeedRadS, speed);
assert.equal(activeRecord.relativeAngularSpeedRadS, speed - 1);
assert.equal(activeRecord.rpm, 1800);
assert.equal(activeRecord.handedness, 1);
assert.ok(activeRecord.densityKgM3 > 0);
assert.equal(activeRecord.axialInflowMps, 1.5);
assert.ok(activeRecord.inducedVelocityMps > 0);
assert.ok(activeRecord.thrustN > 0);
assert.ok(activeRecord.reactionTorqueNm < 0);
assert.ok(activeRecord.mechanicalPowerW > 0);
assert.ok(activeRecord.tipMach > 0);
assert.equal(activeRecord.thermalLossW, 0);
assert.equal(activeRecord.commandSource, "controller:5");
assert.equal(activeRecord.throttle, 0.75);
assert.equal(activeRecord.failureInput, null);
assert.ok(activeBody.force.z > 0);
assert.ok(activeBody.torque.z < 0);
assert.equal(invalidRecord.active, false);
assert.equal(invalidRecord.valid, false);
assert.equal(invalidRecord.validity, "shaft-disconnected");
assert.equal(invalidRecord.thrustN, 0);
assert.equal(invalidRecord.reactionTorqueNm, 0);
assert.equal(forceContext.telemetry.propulsion.version, 2);
assert.equal(forceContext.telemetry.propulsion.tick, 12);
assert.equal(forceContext.telemetry.propulsion.engines.length, 3);
assert.equal(forceContext.telemetry.propulsion.engines[0].partId, 50);

const rotorSystem = new RotorPropulsionSystem();
assert.equal(rotorSystem.phase, "environment");
let stepped = 0,
  disposed = 0;
rotorSystem.step({ services: { rotorForceOwner: { step: () => stepped++ } } });
rotorSystem.dispose({
  services: { rotorForceOwner: { dispose: () => disposed++ } },
});
assert.equal(stepped, 1);
assert.equal(disposed, 1);
forceOwner.dispose();
assert.ok(!forceOwner.active());
assert.deepEqual(forceOwner.records(), []);

console.log(
  `rotor aerodynamic contracts passed (${clockwise.thrustN.toFixed(1)} N at ${config.ratedRpm} rpm)`,
);
