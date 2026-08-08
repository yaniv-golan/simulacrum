import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import { createProductionSimulationSystems } from "../src/application/simulation-system-composition.js";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { stableStringify } from "../src/model/primitives.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";

const DT = 1 / 120;
const CAPACITY = Object.freeze({
  ultimateForceN: 24_000,
  ultimateTorqueNm: 6_000,
});
const FORBIDDEN_MECHANICS =
  /\b(?:ArticulatedConstraintSystem|articulatedController|articulatedTarget|gait_speed|rigRole|Atlas|humanoid)\b/u;

for (const file of [
  "src/application/simulation-system-composition.js",
  "src/application/simulation-run-runtime.js",
  "src/application/workshop-run-composition.js",
  "src/model/challenge-binding-resolver.js",
  "src/model/physical-components.js",
  "src/simulation/multibody-runtime.js",
  "src/simulation/runtime-checkpoints.js",
  "src/simulation/systems/rigid-body-system.js",
])
  assert.doesNotMatch(
    fs.readFileSync(file, "utf8"),
    FORBIDDEN_MECHANICS,
    `${file} retained role-, demo-, or gait-conditioned mechanics`,
  );

for (const retiredFile of [
  "src/simulation/articulated-assembly-controller.js",
  "src/simulation/systems/articulated-constraint-system.js",
])
  assert.equal(
    fs.existsSync(retiredFile),
    false,
    `${retiredFile} retained privileged gait authority`,
  );

assert.equal(
  createProductionSimulationSystems().some(
    (system) => system.constructor.name === "ArticulatedConstraintSystem",
  ),
  false,
  "production still installs a privileged articulated controller",
);

function hingeMechanism(actuationOverrides = {}) {
  const mechanism = structuredClone(mechanismComponentDefinition("hinge")),
    lower = (-70 * Math.PI) / 180,
    upper = (70 * Math.PI) / 180;
  mechanism.config.angleRangeRad = { lower, upper };
  mechanism.config.friction.viscousNms = 5;
  mechanism.config.actuation.commandRangeRad = { lower, upper };
  mechanism.config.actuation.maximumTorqueNm = 180;
  Object.assign(
    mechanism.config.actuation,
    structuredClone(actuationOverrides),
  );
  return mechanism;
}

function assembly({
  idOffset = 0,
  roleLabels = null,
  storedEnergyWh = 100,
  actuation = {},
} = {}) {
  const id = (value) => value + idOffset,
    role = (index) =>
      roleLabels ? { rigRole: roleLabels[index] } : Object.freeze({});
  return {
    revision: 1,
    parts: [
      {
        id: id(1),
        type: "plate",
        pos: [-1.2, 2, 0],
        orientation: [0, 0, 0, 1],
        config: {},
        ...role(0),
      },
      {
        id: id(2),
        type: "hinge",
        pos: [0, 2, 0],
        orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        mechanism: hingeMechanism(actuation),
        ...role(1),
      },
      {
        id: id(3),
        type: "beam",
        pos: [1.2, 2, 0],
        orientation: [0, 0, 0, 1],
        config: {},
        ...role(2),
      },
      {
        id: id(4),
        type: "battery",
        pos: [-0.6, 2.5, 0],
        orientation: [0, 0, 0, 1],
        storedEnergyWh,
        config: { capacityWh: 100, dischargeEfficiency: 1 },
        ...role(3),
      },
    ],
    connections: [
      {
        id: `base-${idOffset}`,
        a: id(1),
        b: id(2),
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: [1.2, 0, 0],
        capacity: structuredClone(CAPACITY),
      },
      {
        id: `arm-${idOffset}`,
        a: id(2),
        b: id(3),
        kind: "mechanical",
        portA: "ARM",
        portB: "A",
        capacity: structuredClone(CAPACITY),
      },
      {
        id: `power-${idOffset}`,
        a: id(4),
        b: id(2),
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: `battery-${idOffset}`,
        a: id(1),
        b: id(4),
        kind: "mechanical",
        portA: "TOP",
        portB: "MOUNT",
        anchorA: [0.6, 0, 0],
        capacity: structuredClone(CAPACITY),
      },
    ],
  };
}

function normalizedProjection(runtime, graph, hingeId, batteryId) {
  const entry = runtime.constraintEntries.find(
      (candidate) => candidate.descriptor.sourcePartId === hingeId,
    ),
    body = runtime.bodyByPart.get(hingeId);
  return {
    angle: entry.angle,
    velocity: entry.velocity,
    reactionTorque: entry.reactionTorque,
    mechanicalWorkJ: entry.actuatorMechanicalWorkJ,
    electricalEnergyJ: entry.actuatorElectricalEnergyJ,
    dissipatedEnergyJ: entry.actuatorDissipatedEnergyJ,
    temperatureK: entry.temperatureK,
    powered: entry.powered,
    saturated: entry.saturated,
    thermalDerate: entry.thermalDerate,
    thermalShutdown: entry.thermalShutdown,
    hingePosition: {
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
    },
    hingeQuaternion: {
      x: body.quaternion.x,
      y: body.quaternion.y,
      z: body.quaternion.z,
      w: body.quaternion.w,
    },
    batteryEnergyJ: graph.part(batteryId).energyJ,
  };
}

function runScenario(input) {
  const snapshot = assembly(input),
    hingeId = 2 + (input.idOffset || 0),
    batteryId = 4 + (input.idOffset || 0),
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    runtime = new MultibodyRuntime({
      world,
      material: new CANNON.Material("generic-articulation"),
      catalog: TYPES,
    }),
    graph = new RunAssemblyGraph(snapshot),
    power = new PowerNetwork(TYPES),
    motorEnergySettlement = new MotorEnergySettlementSystem(),
    commandBus = new CommandBus(),
    heatInputs = [],
    context = {
      runGraph: graph,
      powerNetwork: power,
      commandBus,
      clock: { tick: 0 },
      telemetry: {},
      services: {
        multibodyRuntime: runtime,
        worldAdapter: runtime.worldAdapter,
        heatInputCollector: {
          submit: (record) => heatInputs.push(structuredClone(record)),
        },
      },
    },
    commandAt = (tick) =>
      input.commandAt?.(tick) ??
      (tick < 100 ? 0.65 : tick < 200 ? -0.35 : tick < 260 ? 0.2 : 0);
  runtime.start(JSON.stringify(snapshot));
  if (input.initialAngularSpeedRadS) {
    const entry = runtime.constraintEntries.find(
        (candidate) => candidate.descriptor.sourcePartId === hingeId,
      ),
      body = runtime.bodyByPart.get(entry.descriptor.b),
      axis = body.quaternion.vmult(entry.axisB);
    body.angularVelocity.copy(axis.scale(input.initialAngularSpeedRadS));
  }
  const samples = [],
    energyRecords = [];
  let peakReactionTorque = 0;
  for (let tick = 1; tick <= (input.ticks || 320); tick++) {
    context.clock.tick = tick;
    context.telemetry = {};
    commandBus.clearTick();
    commandBus.writeRemote(hingeId, "joint_target", commandAt(tick));
    power.resolve(graph, DT);
    runtime.stepActuators(context, DT);
    runtime.worldAdapter.integrate(DT, { tick });
    const pending =
      runtime.worldAdapter.transaction.motorEnergyRecordsForTick(tick);
    if (pending) energyRecords.push(...pending.records);
    motorEnergySettlement.step(context, DT);
    runtime.afterIntegration(DT);
    const projection = normalizedProjection(runtime, graph, hingeId, batteryId);
    peakReactionTorque = Math.max(
      peakReactionTorque,
      Math.abs(projection.reactionTorque),
    );
    if (tick % 20 === 0) samples.push(projection);
  }
  const result = {
    samples,
    final: normalizedProjection(runtime, graph, hingeId, batteryId),
    energyRecords,
    motorEnergy: motorEnergySettlement.telemetry(),
    motorEnergyState: motorEnergySettlement.exportState(),
    heatInputs,
    peakReactionTorque,
  };
  motorEnergySettlement.dispose();
  runtime.dispose();
  return result;
}

const unlabelled = runScenario({}),
  misleadingRoles = runScenario({
    roleLabels: ["pelvis", "reactionWheel", "footL", "controller"],
  }),
  renamed = runScenario({ idOffset: 10_000 });

function invarianceProjection(result) {
  const withoutIdentity = (record) => {
    const projected = { ...record };
    delete projected.partId;
    delete projected.constraintId;
    return projected;
  };
  return {
    samples: result.samples,
    final: result.final,
    energyRecords: result.energyRecords.map(withoutIdentity),
    motorEnergyTotals: result.motorEnergy.totals.map(withoutIdentity),
  };
}

assert.equal(
  stableStringify(invarianceProjection(misleadingRoles)),
  stableStringify(invarianceProjection(unlabelled)),
  "role metadata changed generic articulated mechanics",
);
assert.equal(
  stableStringify(invarianceProjection(renamed)),
  stableStringify(invarianceProjection(unlabelled)),
  "authored part identities changed generic articulated mechanics",
);
assert.ok(
  Math.abs(unlabelled.samples[4].angle) > 0.2,
  "generic powered hinge did not respond to joint_target",
);
assert.ok(
  unlabelled.samples.some((sample) => sample.reactionTorque > 0),
  "generic powered hinge never produced measured reaction torque",
);
assert.ok(
  unlabelled.final.batteryEnergyJ < 100 * 3600,
  "generic powered hinge consumed no source energy",
);
assert.ok(
  unlabelled.energyRecords.every(
    (record) =>
      record.positiveMechanicalWorkJ <= record.mechanicalBudgetJ + 1e-9,
  ),
  "generic position actuator exceeded a solver-owned mechanical-energy budget",
);
assert.deepEqual(
  unlabelled.heatInputs,
  [],
  "position actuator deposited rejected heat in both internal and assembly thermal owners",
);
assert.ok(
  Math.abs(
    unlabelled.final.dissipatedEnergyJ -
      (unlabelled.final.electricalEnergyJ - unlabelled.final.mechanicalWorkJ),
  ) <= 1e-8,
  "position actuator energy ledger does not conserve electrical input as net mechanical work plus dissipation",
);

const highAuthorityLaw = Object.freeze({
    stiffnessNmPerRad: 1_000,
    dampingNmsPerRad: 50,
    maximumTorqueNm: 600,
    maximumSpeedRadPerS: 4,
  }),
  narrowRange = runScenario({
    ticks: 180,
    commandAt: () => 1,
    actuation: {
      ...highAuthorityLaw,
      commandRangeRad: { lower: -0.12, upper: 0.12 },
    },
  }),
  wideRange = runScenario({
    ticks: 180,
    commandAt: () => 1,
    actuation: {
      ...highAuthorityLaw,
      commandRangeRad: { lower: -1, upper: 1 },
    },
  });
assert.ok(
  Math.abs(wideRange.final.angle) > Math.abs(narrowRange.final.angle) + 0.3,
  "authored rotary command range did not change the physical target",
);

const slowServo = runScenario({
    ticks: 40,
    commandAt: () => 1,
    actuation: {
      ...highAuthorityLaw,
      commandRangeRad: { lower: -1, upper: 1 },
      maximumSpeedRadPerS: 0.1,
    },
  }),
  fastServo = runScenario({
    ticks: 40,
    commandAt: () => 1,
    actuation: {
      ...highAuthorityLaw,
      commandRangeRad: { lower: -1, upper: 1 },
      maximumSpeedRadPerS: 4,
    },
  });
assert.ok(
  Math.abs(fastServo.final.angle) > Math.abs(slowServo.final.angle) + 0.15,
  "authored rotary maximum speed did not bound joint motion",
);

const softServo = runScenario({
    ticks: 20,
    commandAt: () => 1,
    actuation: {
      commandRangeRad: { lower: -1, upper: 1 },
      stiffnessNmPerRad: 10,
      dampingNmsPerRad: 0,
      maximumTorqueNm: 600,
      maximumSpeedRadPerS: 4,
    },
  }),
  stiffServo = runScenario({
    ticks: 20,
    commandAt: () => 1,
    actuation: {
      commandRangeRad: { lower: -1, upper: 1 },
      stiffnessNmPerRad: 1_000,
      dampingNmsPerRad: 0,
      maximumTorqueNm: 600,
      maximumSpeedRadPerS: 4,
    },
  });
assert.ok(
  stiffServo.peakReactionTorque > softServo.peakReactionTorque + 100,
  `authored rotary stiffness did not change available impedance torque: ${JSON.stringify({ soft: softServo.peakReactionTorque, stiff: stiffServo.peakReactionTorque })}`,
);

const undampedServo = runScenario({
    ticks: 20,
    initialAngularSpeedRadS: 2,
    commandAt: () => 0,
    actuation: {
      commandRangeRad: { lower: -1, upper: 1 },
      stiffnessNmPerRad: 1,
      dampingNmsPerRad: 0,
      maximumTorqueNm: 600,
      maximumSpeedRadPerS: 4,
    },
  }),
  dampedServo = runScenario({
    ticks: 20,
    initialAngularSpeedRadS: 2,
    commandAt: () => 0,
    actuation: {
      commandRangeRad: { lower: -1, upper: 1 },
      stiffnessNmPerRad: 1,
      dampingNmsPerRad: 120,
      maximumTorqueNm: 600,
      maximumSpeedRadPerS: 4,
    },
  });
assert.ok(
  dampedServo.peakReactionTorque > undampedServo.peakReactionTorque * 20,
  `authored rotary damping did not oppose measured joint velocity: ${JSON.stringify({ undamped: undampedServo.peakReactionTorque, damped: dampedServo.peakReactionTorque })}`,
);

const thermalShutdown = runScenario({
  ticks: 5,
  commandAt: () => 1,
  actuation: {
    thermalLimits: {
      thermalMassJPerK: 0.01,
      ambientConductanceWPerK: 0,
      derateTemperatureK: 293.16,
      shutdownTemperatureK: 293.17,
    },
  },
});
assert.equal(
  thermalShutdown.final.thermalShutdown,
  true,
  "authored rotary thermal shutdown did not remove actuator authority",
);
assert.equal(
  thermalShutdown.final.powered,
  false,
  "thermally shut down rotary actuator remained powered",
);

const lowEnergyInitialJ = 2,
  lowEnergy = runScenario({
    storedEnergyWh: lowEnergyInitialJ / 3600,
    ticks: 1,
    commandAt: () => 1,
    actuation: {
      stiffnessNmPerRad: 100_000,
      dampingNmsPerRad: 0,
      maximumTorqueNm: 6_000,
      maximumSpeedRadPerS: 100,
    },
  }),
  lowEnergyRecord = lowEnergy.energyRecords[0],
  lowEnergyTotal = lowEnergy.motorEnergy.totals[0],
  lowEnergyDebitJ = lowEnergyInitialJ - lowEnergy.final.batteryEnergyJ;
assert.ok(
  lowEnergyRecord,
  "low-energy actuator produced no solver work record",
);
assert.ok(
  lowEnergyRecord.saturated,
  `low-energy actuator did not saturate at its exact mechanical-work ceiling: ${JSON.stringify(lowEnergyRecord)}`,
);
assert.ok(
  lowEnergyRecord.positiveMechanicalWorkJ <=
    lowEnergyRecord.mechanicalBudgetJ + 1e-9,
  "low-energy actuator exceeded its registered mechanical-work budget",
);
assert.ok(
  lowEnergyTotal?.positiveMechanicalWorkJ > 0,
  "low-energy actuator work bypassed post-solve settlement",
);
assert.ok(
  lowEnergyTotal.positiveMechanicalWorkJ <=
    lowEnergyDebitJ * lowEnergyRecord.electricalEfficiency + 1e-9,
  "solved positive work exceeded energy debited from the physical source",
);
{
  const hostile = structuredClone(lowEnergy.motorEnergyState);
  hostile.totals[0][1].electricalEnergyJ += 1;
  assert.throws(
    () =>
      new MotorEnergySettlementSystem().validateState(JSON.stringify(hostile)),
    (error) => error?.code === "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
    "motor-energy checkpoint accepted a non-conserving cumulative ledger",
  );
}

console.log(
  `generic articulation authority passed (${unlabelled.samples.length} samples, final angle ${unlabelled.final.angle})`,
);
