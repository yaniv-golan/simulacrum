import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import {
  AXIAL_EFFORT_SATURATION_CAUSES,
  axialEffortSaturationCauses,
  resolveAbsoluteAxialEffortDemand,
  settleAbsoluteAxialEffortDelivery,
} from "../src/simulation/axial-effort-settlement.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import {
  commandBusCurrentTick,
  CommandBus,
} from "../src/simulation/command-bus.js";
import {
  multibodyAxialEffortEnergyProjectionDigest,
  MultibodyRuntime,
  reconstructOwnedMultibodyMotorEnergy,
} from "../src/simulation/multibody-runtime.js";
import { validateAxialEffortEnergyOwnerConsistency } from "../src/simulation/runtime-checkpoints.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { ControllerSystem } from "../src/simulation/systems/controller-system.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120,
  FORCE_CHANNEL = "linear_force_n",
  CAPACITY = { ultimateForceN: 1_000_000, ultimateTorqueNm: 1_000_000 },
  near = (left, right, tolerance = 1e-8) =>
    Math.abs(left - right) <=
    Math.max(
      tolerance,
      tolerance * Math.max(1, Math.abs(left), Math.abs(right)),
    ),
  vector = (value) => [value.x, value.y, value.z],
  dot = (left, right) =>
    left.reduce((sum, value, index) => sum + value * right[index], 0),
  scale = (value, factor) => value.map((component) => component * factor),
  add = (left, right) => left.map((value, index) => value + right[index]),
  magnitude = (value) => Math.hypot(...value),
  part = (id, type, pos, extra = {}) => ({
    id,
    type,
    pos,
    orientation: [0, 0, 0, 1],
    ...extra,
  });

function forceMechanism({
  lengthRangeM = { lower: 0.4, upper: 1.4 },
  maximumForceN = 8_000,
  maximumExtendForceN = maximumForceN,
  maximumRetractForceN = maximumForceN,
  thermalLimits = null,
  unpoweredLaw = null,
  forceCommand = true,
} = {}) {
  const mechanism = structuredClone(
    mechanismComponentDefinition("linear-actuator"),
  );
  if (forceCommand) mechanism.config.commandLaw = { kind: "force-command-v1" };
  mechanism.config.lengthRangeM = { ...lengthRangeM };
  for (const point of mechanism.config.forceSpeedEnvelope.points) {
    const ratio = 1 - point.absSpeedMPerS;
    point.maxExtendForceN = Math.max(0, maximumExtendForceN * ratio);
    point.maxRetractForceN = Math.max(0, maximumRetractForceN * ratio);
  }
  if (thermalLimits) mechanism.config.thermalLimits = { ...thermalLimits };
  if (unpoweredLaw) mechanism.config.unpoweredLaw = { ...unpoweredLaw };
  return mechanism;
}

function plantSnapshot({
  actuatorId = 2,
  axis = [0, 0, 1],
  orientation = [0, 0, 0, 1],
  lengthRangeM,
  maximumForceN,
  maximumExtendForceN,
  maximumRetractForceN,
  thermalLimits,
  unpoweredLaw,
  forceCommand,
  batteryMaxOutputWatts = 20_000,
} = {}) {
  const baseId = "plant-base",
    sliderId = "plant-slider",
    batteryId = "plant-battery",
    controllerBatteryId = "plant-controller-battery",
    controllerId = "plant-controller",
    basePosition = scale(axis, -0.55),
    sliderPosition = scale(axis, 0.55),
    actuator = part(actuatorId, "linear-actuator", [0, 0, 0], {
      orientation,
      mechanism: forceMechanism({
        lengthRangeM,
        maximumForceN,
        maximumExtendForceN,
        maximumRetractForceN,
        thermalLimits,
        unpoweredLaw,
        forceCommand,
      }),
    }),
    controlChannel =
      actuator.mechanism.config.commandLaw.kind === "force-command-v1"
        ? FORCE_CHANNEL
        : actuator.mechanism.config.commandLaw.kind === "position-impedance-v1"
          ? "linear_target"
          : "linear_velocity",
    controllerBindings = [
      {
        id: "axis.force",
        direction: "output",
        endpointPartId: actuatorId,
        endpointPortId: "CONTROL",
        channel: controlChannel,
      },
    ],
    controller = part(controllerId, "computer", [10, 0, 0], {
      controllerBindings,
    }),
    battery = part(batteryId, "battery", [12, 0, 0], {
      storedEnergyWh: 100,
      config: {
        capacityWh: 100,
        maxOutputWatts: batteryMaxOutputWatts,
        dischargeEfficiency: 1,
      },
    }),
    controllerBattery = part(controllerBatteryId, "battery", [14, 0, 0], {
      storedEnergyWh: 100,
      config: {
        capacityWh: 100,
        maxOutputWatts: 20_000,
        dischargeEfficiency: 1,
      },
    }),
    parts = [
      part(baseId, "plate", basePosition, {
        orientation,
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      actuator,
      part(sliderId, "plate", sliderPosition, {
        orientation,
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      battery,
      controllerBattery,
      controller,
    ],
    connections = [
      {
        id: "actuator-base",
        a: baseId,
        b: actuatorId,
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: [0, 0, 0],
        capacity: CAPACITY,
      },
      {
        id: "actuator-slider",
        a: actuatorId,
        b: sliderId,
        kind: "mechanical",
        portA: "ROD",
        portB: "TOP",
        anchorB: [0, 0, 0],
        capacity: CAPACITY,
      },
      {
        id: `power-${String(actuatorId)}`,
        a: batteryId,
        b: actuatorId,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: `power-${controllerId}`,
        a: controllerBatteryId,
        b: controllerId,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: `signal-${controllerId}`,
        a: controllerId,
        b: actuatorId,
        kind: "signal",
        portA: "OUT",
        portB: "CONTROL",
      },
    ];
  return {
    revision: 1,
    parts,
    connections,
    controlChannel,
    ids: {
      actuatorId,
      baseId,
      sliderId,
      batteryId,
      controllerBatteryId,
      controllerId,
      signalConnectionId: `signal-${controllerId}`,
    },
  };
}

function controllerSource(demandN) {
  return `interface ControlAPI {
  write(binding: string, value: number): void;
}
function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.write("axis.force", ${JSON.stringify(demandN)});
}`;
}

async function startPlant({
  demandN = 1_200,
  commandSource = "remote",
  catalog = TYPES,
  snapshotOptions = {},
} = {}) {
  const fixture = plantSnapshot(snapshotOptions),
    snapshot = { parts: fixture.parts, connections: fixture.connections },
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    adapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      catalog: catalog === TYPES ? TYPES : JSON.stringify(catalog),
      fixedDt: DT,
    }),
    outputs = new Map(),
    manager = new ControllerRuntimeManager({
      onCommands: (controllerId, commands) =>
        outputs.set(controllerId, new Map(commands)),
    }),
    motorEnergySettlement = new MotorEnergySettlementSystem();
  world.solver.iterations = 240;
  world.solver.tolerance = 1e-10;
  runtime.start(JSON.stringify(snapshot));
  const forceCommandEntry = runtime.constraintEntries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  );
  if (fixture.controlChannel === FORCE_CHANNEL)
    assert.equal(forceCommandEntry.constraint.effortEquation.enabled, false);
  if (commandSource === "script") {
    for (const controllerId of [fixture.ids.controllerId]) {
      const controller = fixture.parts.find((item) => item.id === controllerId),
        manifest = controllerBindingManifest(
          controller,
          fixture.parts,
          fixture.connections,
          catalog,
        ),
        prepared = await prepareTypeScriptController(
          controllerSource(demandN),
          manifest,
        );
      manager.attach(controllerId, prepared, `AXIAL ${String(controllerId)}`);
    }
  }

  let mode = "normal",
    remoteDemandN = demandN;
  const scriptCandidate = (controllerId) => {
      const value = outputs.get(controllerId)?.get("axis.force");
      if (!Number.isFinite(value)) return [];
      return [
        {
          controllerId,
          bindingId: "axis.force",
          targetId: fixture.ids.actuatorId,
          endpointPortId: mode === "binding-invalid" ? "POWER" : "CONTROL",
          channel: FORCE_CHANNEL,
          value,
        },
      ];
    },
    session = new SimulationSession({
      systems: [
        new ControllerSystem(),
        new PowerSystem(),
        new SignalSystem(),
        new CommandRoutingSystem(),
        new MechanismSystem(),
        new RigidBodySystem(),
        motorEnergySettlement,
        new StructureSystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter: adapter,
      catalog,
      multibodyRuntime: runtime,
      tickControllers: (dt) => {
        if (commandSource !== "script") return;
        manager.tick(fixture.ids.controllerId, dt, {});
      },
      controllerTelemetry: () => ({ onlineControllerIds: manager.ids() }),
      readCommandCandidates: () => ({
        remote:
          commandSource === "remote"
            ? [
                {
                  targetId: fixture.ids.actuatorId,
                  channel: fixture.controlChannel,
                  value: remoteDemandN,
                  active: mode !== "silent",
                },
              ]
            : [],
        scripts:
          commandSource === "script"
            ? scriptCandidate(fixture.ids.controllerId)
            : [],
      }),
    });

  const mechanismState = () =>
      session
        .telemetry()
        .systems.mechanisms.twoFrameMechanisms.find(
          (state) => state.sourcePartId === fixture.ids.actuatorId,
        ),
    step = ({ externalForceOnSliderN = 0 } = {}) => {
      if (externalForceOnSliderN) {
        const force = scale(
          snapshotOptions.axis || [0, 0, 1],
          externalForceOnSliderN,
        );
        runtime.bodyByPart
          .get(fixture.ids.sliderId)
          .applyForce(new CANNON.Vec3(...force));
      }
      session.stepFixed();
      return mechanismState();
    };
  return {
    fixture,
    snapshot,
    world,
    runtime,
    session,
    manager,
    motorEnergySettlement,
    step,
    state: mechanismState,
    setMode: (value) => {
      mode = value;
    },
    setDemand: (value) => {
      remoteDemandN = value;
    },
    dispose() {
      session.dispose();
      runtime.dispose();
      manager.disposeAll();
    },
  };
}

function assertLedger(state) {
  assert.ok(
    near(
      state.electricalEnergyJ - state.mechanicalWorkJ,
      state.dissipatedEnergyJ,
      1e-7,
    ),
    JSON.stringify(state),
  );
  assert.ok(state.dissipatedEnergyJ >= -1e-9, JSON.stringify(state));
}

const demandInput = (overrides = {}) => ({
    command: { value: 1_200, conflict: false, source: "script" },
    commandTick: 7,
    fixedTick: 7,
    minimumForceN: -1_000_000,
    maximumForceN: 1_000_000,
    speedExtendCapacityN: 8_000,
    speedRetractCapacityN: 8_000,
    thermalAvailability: 1,
    ...overrides,
  }),
  currentDemand = resolveAbsoluteAxialEffortDemand(demandInput());
assert.equal(currentDemand.commandValidity, "current");
assert.equal(currentDemand.capacityLimitedForceN, 1_200);
for (const tickPair of [
  { commandTick: 6, fixedTick: 7 },
  { commandTick: 7, fixedTick: -1 },
  { commandTick: 7, fixedTick: 0.5 },
  { commandTick: -1, fixedTick: 7 },
  { commandTick: 0.5, fixedTick: 7 },
  { commandTick: -1, fixedTick: -1 },
  { commandTick: 0.5, fixedTick: 0.5 },
])
  assert.equal(
    resolveAbsoluteAxialEffortDemand(demandInput(tickPair)).commandValidity,
    "stale",
  );
assert.equal(
  resolveAbsoluteAxialEffortDemand(
    demandInput({ commandTick: 0, fixedTick: 0 }),
  ).commandValidity,
  "current",
);
assert.equal(
  resolveAbsoluteAxialEffortDemand(
    demandInput({
      command: { value: 1_000_001, conflict: false, source: "remote" },
    }),
  ).commandValidity,
  "out-of-range",
);
for (const overrides of [
  { command: { value: Number.NaN, conflict: false, source: "remote" } },
  {
    command: {
      value: Number.POSITIVE_INFINITY,
      conflict: false,
      source: "remote",
    },
  },
  { minimumForceN: Number.NaN },
  { maximumForceN: Number.NaN },
  { minimumForceN: 2, maximumForceN: 1 },
  {
    minimumForceN: -100,
    maximumForceN: 100,
    command: { value: -101, conflict: false, source: "remote" },
  },
  {
    minimumForceN: -100,
    maximumForceN: 100,
    command: { value: 101, conflict: false, source: "remote" },
  },
  { speedExtendCapacityN: Number.NaN },
  { speedExtendCapacityN: -1 },
  { speedRetractCapacityN: Number.NaN },
  { speedRetractCapacityN: -1 },
  { thermalAvailability: Number.NaN },
  { thermalAvailability: -Number.EPSILON },
  { thermalAvailability: 1 + Number.EPSILON },
])
  assert.equal(
    resolveAbsoluteAxialEffortDemand(demandInput(overrides)).commandValidity,
    "out-of-range",
    JSON.stringify(overrides),
  );
for (const boundary of [-100, 100])
  assert.equal(
    resolveAbsoluteAxialEffortDemand(
      demandInput({
        minimumForceN: -100,
        maximumForceN: 100,
        command: { value: boundary, conflict: false, source: "remote" },
      }),
    ).commandValidity,
    "current",
  );
const equalRangeDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({
    minimumForceN: 5,
    maximumForceN: 5,
    command: { value: 5, conflict: false, source: "remote" },
  }),
);
assert.equal(equalRangeDemand.commandValidity, "current");
assert.equal(equalRangeDemand.requestedForceN, 5);
const zeroExtendDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({ speedExtendCapacityN: 0 }),
);
assert.equal(zeroExtendDemand.commandValidity, "current");
assert.equal(zeroExtendDemand.capacityLimitedForceN, 0);
const zeroRetractDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({
    command: { value: -1_200, conflict: false, source: "remote" },
    speedRetractCapacityN: 0,
  }),
);
assert.equal(zeroRetractDemand.commandValidity, "current");
assert.ok(near(zeroRetractDemand.capacityLimitedForceN, 0));
assert.equal(
  resolveAbsoluteAxialEffortDemand(demandInput({ thermalAvailability: 0 }))
    .capacityLimitedForceN,
  0,
);
const speedLimitedDemand = resolveAbsoluteAxialEffortDemand({
  command: { value: 10_000, conflict: false, source: "remote" },
  commandTick: 9,
  fixedTick: 9,
  minimumForceN: -1_000_000,
  maximumForceN: 1_000_000,
  speedExtendCapacityN: 8_000,
  speedRetractCapacityN: 8_000,
  thermalAvailability: 0.5,
});
assert.equal(speedLimitedDemand.capacityLimitedForceN, 4_000);
assert.deepEqual(
  axialEffortSaturationCauses(speedLimitedDemand.saturationCauseMask),
  ["force-speed-capacity", "thermal-derate"],
);
const retractThermalDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({
    command: { value: -6_000, conflict: false, source: "remote" },
    thermalAvailability: 0.5,
  }),
);
assert.equal(retractThermalDemand.capacityLimitedForceN, -4_000);
assert.deepEqual(
  axialEffortSaturationCauses(retractThermalDemand.saturationCauseMask),
  ["thermal-derate"],
);
const toleranceDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({
    command: { value: 1_000_000, conflict: false, source: "remote" },
    speedExtendCapacityN: 1_000_000 - 5e-7,
  }),
);
assert.deepEqual(
  axialEffortSaturationCauses(toleranceDemand.saturationCauseMask),
  [],
);
const noPowerSettlement = settleAbsoluteAxialEffortDelivery({
  demand: currentDemand,
  powerOperational: false,
  requestedElectricalW: 0,
  deliveredElectricalW: 0,
});
assert.equal(noPowerSettlement.appliedForceN, 0);
assert.equal(noPowerSettlement.residualForceN, 1_200);
assert.equal(noPowerSettlement.saturated, true);
assert.ok(
  noPowerSettlement.saturationCauseMask &
    AXIAL_EFFORT_SATURATION_CAUSES.POWER_UNAVAILABLE,
);
const partialPowerSettlement = settleAbsoluteAxialEffortDelivery({
  demand: currentDemand,
  powerOperational: true,
  requestedElectricalW: 100,
  deliveredElectricalW: 25,
});
assert.equal(partialPowerSettlement.appliedForceN, 300);
assert.equal(partialPowerSettlement.residualForceN, 900);
assert.equal(partialPowerSettlement.saturated, true);
assert.ok(
  partialPowerSettlement.saturationCauseMask &
    AXIAL_EFFORT_SATURATION_CAUSES.POWER_ALLOCATION,
);
assert.deepEqual(
  settleAbsoluteAxialEffortDelivery({
    demand: currentDemand,
    powerOperational: true,
    requestedElectricalW: 100,
    deliveredElectricalW: 100,
  }),
  {
    appliedForceN: 1_200,
    residualForceN: 0,
    saturationCauseMask: 0,
    saturated: false,
  },
);
const missingSettlement = settleAbsoluteAxialEffortDelivery({
  demand: { ...currentDemand, commandValidity: "missing" },
  powerOperational: true,
  requestedElectricalW: 100,
  deliveredElectricalW: 100,
});
assert.deepEqual(missingSettlement, {
  appliedForceN: 0,
  residualForceN: 0,
  saturationCauseMask: 0,
  saturated: false,
});
assert.doesNotThrow(() =>
  settleAbsoluteAxialEffortDelivery({
    demand: currentDemand,
    powerOperational: true,
    requestedElectricalW: 100,
    deliveredElectricalW: 100 + 1e-9,
  }),
);
for (const settlement of [
  { requestedElectricalW: Number.NaN, deliveredElectricalW: 0 },
  { requestedElectricalW: -1, deliveredElectricalW: 0 },
  { requestedElectricalW: -1e-12, deliveredElectricalW: 0 },
  { requestedElectricalW: 1, deliveredElectricalW: Number.NaN },
  { requestedElectricalW: 1, deliveredElectricalW: -1 },
  { requestedElectricalW: 1, deliveredElectricalW: 2 },
])
  assert.throws(
    () =>
      settleAbsoluteAxialEffortDelivery({
        demand: currentDemand,
        powerOperational: true,
        ...settlement,
      }),
    /electrical settlement is invalid/,
  );
const zeroDemand = resolveAbsoluteAxialEffortDemand(
  demandInput({
    command: { value: 0, conflict: false, source: "remote" },
  }),
);
assert.deepEqual(
  settleAbsoluteAxialEffortDelivery({
    demand: zeroDemand,
    powerOperational: false,
    requestedElectricalW: 0,
    deliveredElectricalW: 0,
  }),
  {
    appliedForceN: 0,
    residualForceN: 0,
    saturationCauseMask: 0,
    saturated: false,
  },
);
assert.deepEqual(axialEffortSaturationCauses(0), []);
for (const mask of [-1, 0.5, Number.NaN])
  assert.throws(() => axialEffortSaturationCauses(mask), /mask is invalid/);
assert.equal(
  resolveAbsoluteAxialEffortDemand(
    demandInput({
      command: { value: 1_200, conflict: true, source: "none" },
    }),
  ).commandValidity,
  "conflict",
);
assert.equal(
  resolveAbsoluteAxialEffortDemand(
    demandInput({ minimumForceN: 2, maximumForceN: 1 }),
  ).commandValidity,
  "out-of-range",
);

for (const ownerIds of [
  {},
  ["duplicate-owner", "duplicate-owner"],
  [""],
  [0.5],
  [{}],
])
  assert.throws(
    () => new MotorEnergySettlementSystem({ ownerIds }),
    (error) =>
      error?.code === "MOTOR_ENERGY_OWNER_AUTHORITY_REQUIRED" ||
      error?.code === "INVALID_MOTOR_ENERGY_OWNER_IDENTITIES",
    `invalid motor owner authority ${JSON.stringify(ownerIds)} was accepted`,
  );
{
  const settlement = new MotorEnergySettlementSystem();
  assert.throws(
    () => settlement.exportState(),
    (error) => error?.code === "MOTOR_ENERGY_OWNER_AUTHORITY_REQUIRED",
  );
  assert.deepEqual(settlement.bindOwnerIds(["owner-b", "owner-a"]), [
    "owner-a",
    "owner-b",
  ]);
  assert.deepEqual(
    settlement.exportState().totals.map(([partId]) => partId),
    ["owner-a", "owner-b"],
  );
  settlement.totals.get("owner-a").electricalEnergyJ = 2;
  settlement.bindOwnerIds(["owner-a", "owner-b"]);
  assert.equal(settlement.totals.get("owner-a").electricalEnergyJ, 2);
  assert.throws(
    () => settlement.bindOwnerIds(["owner-a"]),
    (error) => error?.code === "MOTOR_ENERGY_OWNER_IDENTITY_CHANGED",
  );
  settlement.totals.set("ghost-owner", {
    electricalEnergyJ: 0,
    positiveMechanicalWorkJ: 0,
    absorbedMechanicalWorkJ: 0,
    rejectedHeatJ: 0,
  });
  assert.throws(
    () => settlement.bindOwnerIds(["owner-a", "owner-b"]),
    (error) => error?.code === "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
  );
  settlement.dispose();
  assert.equal(settlement.totals.size, 0);
  assert.equal(settlement.lastSettledTick, 0);
  assert.equal(settlement.ownerIds, null);
}

{
  const settlement = new MotorEnergySettlementSystem(),
    shortfallRecord = {
      partId: "shortfall-probe",
      idleElectricalW: 1,
      positiveMechanicalWorkJ: 0.4,
      absorbedMechanicalWorkJ: 0,
      electricalEfficiency: 0.5,
      mechanicalBudgetJ: 1,
    };
  assert.throws(
    () =>
      settlement.step(
        {
          clock: { tick: 1 },
          services: {
            motorEnergyOwnerIds: ["shortfall-probe"],
            multibodyRuntime: null,
            worldAdapter: {
              transaction: {
                motorEnergyRecordsForTick: () => ({
                  records: [shortfallRecord],
                }),
              },
            },
          },
          powerNetwork: { drawPower: () => 2 },
          telemetry: {},
        },
        0.5,
      ),
    (error) =>
      error?.code === "MOTOR_ENERGY_SETTLEMENT_SHORTFALL" &&
      near(error.details.shortfallJ, 0.15),
  );
}
{
  const settlement = new MotorEnergySettlementSystem();
  assert.throws(
    () =>
      settlement.step(
        {
          clock: { tick: 1 },
          services: {
            motorEnergyOwnerIds: ["known-owner"],
            multibodyRuntime: null,
            worldAdapter: {
              transaction: {
                motorEnergyRecordsForTick: () => ({
                  records: [
                    {
                      partId: "ghost-owner",
                      idleElectricalW: 0,
                      positiveMechanicalWorkJ: 0,
                      absorbedMechanicalWorkJ: 0,
                      electricalEfficiency: 1,
                      mechanicalBudgetJ: 0,
                    },
                  ],
                }),
              },
            },
          },
          powerNetwork: { drawPower: () => 0 },
          telemetry: {},
        },
        0.5,
      ),
    (error) => error?.code === "MOTOR_ENERGY_RECORD_OWNER_MISMATCH",
  );
}
{
  const settlement = new MotorEnergySettlementSystem(),
    mechanicalBudgetJ = 1,
    deliveredElectricalW = 2,
    dt = 0.5,
    idleElectricalW = 1,
    electricalEfficiency = 0.5,
    deliveredMechanicalCapacityJ =
      (deliveredElectricalW * dt - idleElectricalW * dt) * electricalEfficiency,
    positiveMechanicalWorkJ =
      deliveredMechanicalCapacityJ + Math.max(1e-9, mechanicalBudgetJ * 1e-10),
    records = [
      {
        partId: "settlement-boundary-probe",
        mode: "absolute-axial-effort",
        idleElectricalW,
        positiveMechanicalWorkJ,
        absorbedMechanicalWorkJ: 0,
        electricalEfficiency,
        mechanicalBudgetJ,
        saturated: false,
      },
    ],
    transaction = {
      motorEnergyRecordsForTick: () => ({ records, recordDigest: "boundary" }),
      acknowledgeMotorEnergySettlement: () => {},
    },
    runtime = {
      motorElectricalWByPart: new Map(),
      constraintEntries: [],
      telemetry: () => ({ ok: true }),
      lastTelemetry: null,
    },
    context = {
      clock: { tick: 1 },
      services: {
        motorEnergyOwnerIds: ["settlement-boundary-probe"],
        multibodyRuntime: runtime,
        worldAdapter: { transaction },
      },
      powerNetwork: {
        drawPower: () => deliveredElectricalW,
        telemetry: () => ({ ok: true }),
      },
      telemetry: {},
    };
  assert.doesNotThrow(() => settlement.step(context, dt));
  assert.ok(
    near(
      settlement.exportState().totals[0][1].positiveMechanicalWorkJ,
      positiveMechanicalWorkJ,
    ),
  );
}
for (const probe of [
  {
    partId: "force-mechanism-thermal-owner",
    commandLawKind: "force-command-v1",
    authoredThermalOwner: true,
    rejectedHeatJ: 0.5,
  },
  {
    partId: "force-assembly-thermal-owner",
    commandLawKind: "force-command-v1",
    authoredThermalOwner: false,
    rejectedHeatJ: 0.5,
  },
  {
    partId: "position-mechanism-thermal-owner",
    commandLawKind: "position-impedance-v1",
    authoredThermalOwner: true,
    rejectedHeatJ: 0.5,
  },
  {
    partId: "zero-heat-unclaimed",
    commandLawKind: "force-command-v1",
    authoredThermalOwner: false,
    rejectedHeatJ: 0,
  },
]) {
  const { partId, commandLawKind, authoredThermalOwner, rejectedHeatJ } = probe,
    dt = 0.5,
    thermalMassJPerK = 100,
    thermalLimits = {
      ambientConductanceWPerK: 0,
      thermalMassJPerK,
      derateTemperatureK: 350,
      shutdownTemperatureK: 400,
    },
    heatSubmissions = [],
    entry = {
      descriptor: {
        sourcePartId: partId,
        controlled: commandLawKind !== "force-command-v1",
        mechanism: {
          commandLaw: { kind: commandLawKind },
          ...(authoredThermalOwner
            ? commandLawKind === "force-command-v1"
              ? { thermalLimits }
              : { actuation: { thermalLimits } }
            : commandLawKind === "force-command-v1"
              ? {}
              : { actuation: {} }),
        },
      },
      actuatorMechanicalWorkJ: 0,
      actuatorElectricalEnergyJ: 0,
      actuatorDissipatedEnergyJ: 0,
      requestedForceN:
        commandLawKind === "position-impedance-v1"
          ? 1
          : authoredThermalOwner
            ? 2
            : 1,
      capacityLimitedForceN: authoredThermalOwner ? 1 : 0,
      appliedForceN: 0,
      residualForceN: 1,
      saturationCauseMask: 0,
      saturated: false,
      temperatureK: 300,
      thermalDerate: 1,
      thermalShutdown: false,
      powered: true,
    },
    decoyEntry = structuredClone(entry),
    record = {
      partId,
      mode:
        commandLawKind === "force-command-v1"
          ? "absolute-axial-effort"
          : "position-impedance",
      idleElectricalW: 0,
      positiveMechanicalWorkJ: rejectedHeatJ ? 0.5 : 0,
      absorbedMechanicalWorkJ: 0,
      electricalEfficiency: 0.5,
      mechanicalBudgetJ: rejectedHeatJ ? 0.5 : 0,
      acceptedImpulseNs: authoredThermalOwner ? 0.5 : 0,
      thermalLimitedImpulseNs: authoredThermalOwner ? 0.5 : 0,
      forceSpeedSaturated: false,
      thermalSaturated:
        authoredThermalOwner && commandLawKind === "force-command-v1",
      energySaturated: false,
      saturated: commandLawKind !== "force-command-v1",
    },
    runtime = {
      motorElectricalWByPart: new Map(),
      constraintEntries: [decoyEntry, entry],
      telemetry: () => ({ ok: true }),
      lastTelemetry: null,
    },
    settlement = new MotorEnergySettlementSystem({ ownerIds: [partId] }),
    transaction = {
      motorEnergyRecordsForTick: () => ({
        records: [record],
        recordDigest: `thermal-owner-${String(authoredThermalOwner)}`,
      }),
      acknowledgeMotorEnergySettlement: () => {},
    },
    context = {
      clock: { tick: 1 },
      services: {
        motorEnergyOwnerIds: [partId],
        multibodyRuntime: runtime,
        worldAdapter: { transaction },
        heatInputCollector: {
          submit: (submission) => heatSubmissions.push(submission),
        },
      },
      powerNetwork: {
        drawPower: () => (rejectedHeatJ ? 2 : 0),
        telemetry: () => ({ ok: true }),
      },
      telemetry: {},
    };
  decoyEntry.descriptor.sourcePartId = `decoy-${partId}`;
  decoyEntry.descriptor.controlled = true;
  if (commandLawKind === "force-command-v1") {
    if (authoredThermalOwner)
      delete decoyEntry.descriptor.mechanism.thermalLimits;
    else decoyEntry.descriptor.mechanism.thermalLimits = thermalLimits;
  } else if (authoredThermalOwner)
    decoyEntry.descriptor.mechanism.actuation = {};
  else
    decoyEntry.descriptor.mechanism.actuation = {
      thermalLimits,
    };
  settlement.step(context, dt);
  assert.ok(near(entry.actuatorDissipatedEnergyJ, rejectedHeatJ));
  assert.equal(decoyEntry.actuatorDissipatedEnergyJ, 0);
  assert.equal(decoyEntry.temperatureK, 300);
  if (authoredThermalOwner && rejectedHeatJ > 0) {
    assert.ok(near(entry.temperatureK, 300 + rejectedHeatJ / thermalMassJPerK));
  } else {
    assert.equal(entry.temperatureK, 300);
  }
  assert.deepEqual(
    heatSubmissions,
    !authoredThermalOwner && rejectedHeatJ > 0
      ? [
          {
            tick: 1,
            partId,
            source: "motor-energy-settlement",
            directHeatPowerW: rejectedHeatJ / dt,
          },
        ]
      : [],
    "rejected heat was not assigned to exactly one thermal owner",
  );
  if (commandLawKind === "position-impedance-v1")
    assert.equal(entry.saturated, true);
  if (authoredThermalOwner && commandLawKind === "force-command-v1") {
    assert.equal(entry.saturated, true);
    assert.ok(
      entry.saturationCauseMask & AXIAL_EFFORT_SATURATION_CAUSES.THERMAL_DERATE,
    );
  }
}

const nominal = await startPlant();
const baseBody = nominal.runtime.bodyByPart.get(nominal.fixture.ids.baseId),
  sliderBody = nominal.runtime.bodyByPart.get(nominal.fixture.ids.sliderId),
  baseVelocityBefore = vector(baseBody.velocity),
  sliderVelocityBefore = vector(sliderBody.velocity),
  state = nominal.step(),
  baseDeltaVelocity = add(
    vector(baseBody.velocity),
    scale(baseVelocityBefore, -1),
  ),
  sliderDeltaVelocity = add(
    vector(sliderBody.velocity),
    scale(sliderVelocityBefore, -1),
  ),
  axis = [0, 0, 1];
assert.equal(state.commandValidity, "current");
assert.equal(state.commandSource, "remote");
assert.equal(state.commandTick, 1);
assert.equal(state.tick, 1);
assert.equal(state.demandUnit, "N");
assert.ok(near(state.requestedForceN, 1_200));
assert.ok(near(state.capacityLimitedForceN, 1_200));
assert.ok(near(state.appliedForceN, 1_200), JSON.stringify(state));
assert.ok(near(state.passiveForceN, 0));
assert.ok(near(state.residualForceN, 0));
assert.deepEqual(state.saturationCauses, []);
assert.ok(
  near(
    dot(baseDeltaVelocity, axis),
    (-state.appliedForceN * DT) / baseBody.mass,
  ),
  JSON.stringify({ state, mass: baseBody.mass, baseDeltaVelocity }),
);
assert.ok(
  near(
    dot(sliderDeltaVelocity, axis),
    (state.appliedForceN * DT) / sliderBody.mass,
  ),
  JSON.stringify({ state, mass: sliderBody.mass, sliderDeltaVelocity }),
);
assert.ok(
  magnitude(
    add(
      scale(baseDeltaVelocity, baseBody.mass),
      scale(sliderDeltaVelocity, sliderBody.mass),
    ),
  ) <= 1e-8,
  JSON.stringify({ baseDeltaVelocity, sliderDeltaVelocity }),
);
const nominalKineticEnergyGainJ =
  0.5 * baseBody.mass * magnitude(baseDeltaVelocity) ** 2 +
  0.5 * sliderBody.mass * magnitude(sliderDeltaVelocity) ** 2;
assert.ok(
  near(state.mechanicalWorkJ, nominalKineticEnergyGainJ, 1e-7),
  JSON.stringify({ state, nominalKineticEnergyGainJ }),
);
const nominalPowerLaw = nominal.fixture.parts.find(
  (candidate) => candidate.id === nominal.fixture.ids.actuatorId,
).mechanism.config.powerLaw;
assert.ok(
  near(
    state.electricalEnergyJ,
    state.mechanicalWorkJ / nominalPowerLaw.electricalMotoringEfficiency +
      nominalPowerLaw.idlePowerW * DT,
    1e-7,
  ),
  JSON.stringify(state),
);
assertLedger(state);

const checkpoint = structuredClone(nominal.runtime.exportState()),
  checkpointEntry = checkpoint.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  );
assert.equal(checkpointEntry.values.requestedForceN, 1_200);
assert.equal(checkpointEntry.values.commandSource, "remote");
for (const digest of [
  undefined,
  "axial-effort-energy-sha256-not-a-digest",
  `${checkpoint.axialEffortEnergyProjectionDigest}forged`,
  `forged${checkpoint.axialEffortEnergyProjectionDigest}`,
]) {
  const candidate = structuredClone(checkpoint);
  candidate.axialEffortEnergyProjectionDigest = digest;
  assert.throws(
    () => nominal.runtime.validateState(JSON.stringify(candidate)),
    (error) =>
      error?.code === "INVALID_MULTIBODY_CHECKPOINT" ||
      error?.code === "MULTIBODY_CHECKPOINT_AXIAL_ENERGY_PROJECTION_MISMATCH",
    `invalid axial-effort energy digest ${String(digest)} was accepted`,
  );
}
for (const [label, mutate] of [
  ["residual", (values) => values.residualForceN++],
  ["capacity", (values) => (values.capacityLimitedForceN = 1_201)],
  ["source", (values) => (values.commandSource = "forged")],
  ["current default source", (values) => (values.commandSource = "default")],
  ["current none source", (values) => (values.commandSource = "none")],
  ["tick", (values) => (values.commandTick = -1)],
  ["fractional tick", (values) => (values.commandTick = 1.5)],
  ["null current tick", (values) => (values.commandTick = null)],
  ["future tick", (values) => (values.commandTick = 999)],
  ["mask", (values) => (values.saturationCauseMask = 16)],
  ["saturation", (values) => (values.saturated = true)],
]) {
  const candidate = structuredClone(checkpoint),
    values = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  mutate(values);
  assert.throws(
    () => nominal.runtime.validateState(JSON.stringify(candidate)),
    /Checkpoint axial-effort|Checkpoint constraint string|command tick/,
    label,
  );
}
const missingCommandCheckpoint = structuredClone(checkpoint),
  missingCommandValues = missingCommandCheckpoint.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  ).values;
Object.assign(missingCommandValues, {
  requestedForceN: 0,
  capacityLimitedForceN: 0,
  appliedForceN: 0,
  residualForceN: 0,
  commandTick: checkpoint.world.stepnumber,
  commandSource: "none",
  commandValidity: "missing",
  saturationCauseMask: 0,
  powered: false,
  saturated: false,
});
assert.doesNotThrow(() =>
  nominal.runtime.validateState(JSON.stringify(missingCommandCheckpoint)),
);
for (const [label, mutate] of [
  ["missing requested", (values) => (values.requestedForceN = 1)],
  ["missing capacity", (values) => (values.capacityLimitedForceN = 1)],
  ["missing applied", (values) => (values.appliedForceN = 1)],
  ["missing residual", (values) => (values.residualForceN = 1)],
  ["missing powered", (values) => (values.powered = true)],
]) {
  const candidate = structuredClone(missingCommandCheckpoint),
    values = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  mutate(values);
  assert.throws(
    () => nominal.runtime.validateState(JSON.stringify(candidate)),
    /Checkpoint axial-effort/,
    label,
  );
}
for (const [label, values] of [
  [
    "missing internally consistent applied demand",
    {
      requestedForceN: 1,
      capacityLimitedForceN: 1,
      appliedForceN: 1,
      residualForceN: 0,
      saturationCauseMask: 0,
      saturated: false,
    },
  ],
  [
    "missing internally consistent residual demand",
    {
      requestedForceN: 1,
      capacityLimitedForceN: 1,
      appliedForceN: 0,
      residualForceN: 1,
      saturationCauseMask: AXIAL_EFFORT_SATURATION_CAUSES.POWER_UNAVAILABLE,
      saturated: true,
    },
  ],
]) {
  const candidate = structuredClone(missingCommandCheckpoint),
    checkpointValues = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  Object.assign(checkpointValues, values);
  assert.throws(
    () => nominal.runtime.validateState(JSON.stringify(candidate)),
    /Checkpoint axial-effort command authority/,
    label,
  );
}
const saturatedCheckpoint = structuredClone(checkpoint),
  saturatedValues = saturatedCheckpoint.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  ).values;
Object.assign(saturatedValues, {
  appliedForceN: 1_000,
  residualForceN: 200,
  saturationCauseMask: AXIAL_EFFORT_SATURATION_CAUSES.POWER_ALLOCATION,
  saturated: true,
});
assert.doesNotThrow(() =>
  nominal.runtime.validateState(JSON.stringify(saturatedCheckpoint)),
);
for (const [label, mutate] of [
  ["residual without saturated", (values) => (values.saturated = false)],
  ["residual without cause", (values) => (values.saturationCauseMask = 0)],
]) {
  const candidate = structuredClone(saturatedCheckpoint),
    values = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  mutate(values);
  assert.throws(
    () => nominal.runtime.validateState(JSON.stringify(candidate)),
    /Checkpoint axial-effort/,
    label,
  );
}
const motorEnergyState = structuredClone(
  nominal.motorEnergySettlement.exportState(),
);
assert.equal(motorEnergyState.lastSettledTick, 1);
assert.equal(motorEnergyState.totals.length, 1);
const nominalMotorTotals = motorEnergyState.totals[0][1];
assert.ok(near(nominalMotorTotals.electricalEnergyJ, state.electricalEnergyJ));
assert.ok(
  near(nominalMotorTotals.positiveMechanicalWorkJ, state.mechanicalWorkJ),
);
assert.equal(nominalMotorTotals.absorbedMechanicalWorkJ, 0);
assert.ok(near(nominalMotorTotals.rejectedHeatJ, state.dissipatedEnergyJ));
const validatedMotorEnergy = nominal.motorEnergySettlement.validateState(
  JSON.stringify(motorEnergyState),
);
{
  const exactOwners = new MotorEnergySettlementSystem({
      ownerIds: ["owner-b", "owner-a"],
    }),
    exactState = structuredClone(exactOwners.exportState());
  assert.deepEqual(exactState.ownerIds, ["owner-a", "owner-b"]);
  assert.doesNotThrow(() =>
    exactOwners.validateState(JSON.stringify(exactState)),
  );
  for (const [label, mutate] of [
    ["reordered owner declaration", (state) => state.ownerIds.reverse()],
    ["missing owner declaration", (state) => state.ownerIds.pop()],
    ["duplicate owner declaration", (state) => (state.ownerIds[1] = "owner-a")],
    ["ghost owner declaration", (state) => (state.ownerIds[1] = "owner-c")],
    ["reordered owner totals", (state) => state.totals.reverse()],
    ["missing owner total", (state) => state.totals.pop()],
    ["ghost owner total", (state) => (state.totals[1][0] = "owner-c")],
  ]) {
    const candidate = structuredClone(exactState);
    mutate(candidate);
    assert.throws(
      () => exactOwners.validateState(JSON.stringify(candidate)),
      (error) =>
        error?.code === "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH" ||
        error?.code === "INVALID_MOTOR_ENERGY_OWNER_IDENTITIES",
      label,
    );
  }
}
for (const [label, candidate] of [
  [
    "missing live owner",
    { version: 2, lastSettledTick: 0, ownerIds: [], totals: [] },
  ],
  [
    "ghost owner",
    {
      version: 2,
      lastSettledTick: 0,
      ownerIds: ["string-part"],
      totals: [
        [
          "string-part",
          {
            electricalEnergyJ: 0,
            positiveMechanicalWorkJ: 0,
            absorbedMechanicalWorkJ: 1,
            rejectedHeatJ: 1,
          },
        ],
      ],
    },
  ],
])
  assert.throws(
    () =>
      nominal.motorEnergySettlement.validateState(JSON.stringify(candidate)),
    (error) => error?.code === "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
    label,
  );
assert.throws(
  () =>
    nominal.motorEnergySettlement.validateState(
      '{"version":1,"lastSettledTick":0,"totals":[["infinite",{"electricalEnergyJ":1e309,"positiveMechanicalWorkJ":1e309,"absorbedMechanicalWorkJ":1e309,"rejectedHeatJ":1e309}]]}',
    ),
  (error) => error?.code === "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
);
assert.equal(validatedMotorEnergy.lastSettledTick, 1);
assert.deepEqual(
  Object.fromEntries(validatedMotorEnergy.totals),
  Object.fromEntries(motorEnergyState.totals),
);
{
  const importedSettlement = new MotorEnergySettlementSystem({
    ownerIds: motorEnergyState.ownerIds,
  });
  importedSettlement.importState(JSON.stringify(motorEnergyState));
  assert.deepEqual(importedSettlement.exportState(), motorEnergyState);
}
for (const [label, candidate] of [
  ["null", null],
  ["array", []],
  ["missing version", { ...motorEnergyState, version: undefined }],
  ["wrong version", { ...motorEnergyState, version: 1 }],
  ["fractional tick", { ...motorEnergyState, lastSettledTick: 0.5 }],
  ["negative tick", { ...motorEnergyState, lastSettledTick: -1 }],
  ["non-array totals", { ...motorEnergyState, totals: {} }],
  ["extra top-level field", { ...motorEnergyState, forged: true }],
])
  assert.throws(
    () =>
      nominal.motorEnergySettlement.validateState(JSON.stringify(candidate)),
    (error) =>
      error?.code === "INVALID_MOTOR_ENERGY_CHECKPOINT_INPUT" ||
      error?.code === "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
    label,
  );
for (const [label, mutate] of [
  ["record is not a pair", (candidate) => (candidate.totals[0] = {})],
  ["pair is too long", (candidate) => candidate.totals[0].push("forged")],
  ["empty string identity", (candidate) => (candidate.totals[0][0] = "")],
  ["fractional identity", (candidate) => (candidate.totals[0][0] = 0.5)],
  ["unsafe identity", (candidate) => (candidate.totals[0][0] = 2 ** 54)],
  ["object identity", (candidate) => (candidate.totals[0][0] = {})],
  [
    "duplicate identity",
    (candidate) => candidate.totals.push(structuredClone(candidate.totals[0])),
  ],
  [
    "missing total field",
    (candidate) => delete candidate.totals[0][1].rejectedHeatJ,
  ],
  ["extra total field", (candidate) => (candidate.totals[0][1].forged = 0)],
  [
    "non-finite total",
    (candidate) => (candidate.totals[0][1].electricalEnergyJ = Number.NaN),
  ],
  [
    "negative total",
    (candidate) =>
      Object.assign(candidate.totals[0][1], {
        electricalEnergyJ: -1,
        positiveMechanicalWorkJ: 0,
        absorbedMechanicalWorkJ: 1,
        rejectedHeatJ: 0,
      }),
  ],
  [
    "electrical conservation",
    (candidate) => (candidate.totals[0][1].electricalEnergyJ += 1),
  ],
  [
    "positive-work conservation",
    (candidate) => (candidate.totals[0][1].positiveMechanicalWorkJ += 1),
  ],
  [
    "absorbed-work conservation",
    (candidate) => (candidate.totals[0][1].absorbedMechanicalWorkJ += 1),
  ],
  [
    "rejected-heat conservation",
    (candidate) => (candidate.totals[0][1].rejectedHeatJ += 1),
  ],
]) {
  const candidate = structuredClone(motorEnergyState);
  mutate(candidate);
  assert.throws(
    () =>
      nominal.motorEnergySettlement.validateState(JSON.stringify(candidate)),
    (error) =>
      error?.code === "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT" ||
      error?.code === "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH" ||
      error?.code === "INVALID_MOTOR_ENERGY_OWNER_IDENTITIES",
    label,
  );
}
for (const field of [
  "actuatorMechanicalWorkJ",
  "actuatorElectricalEnergyJ",
  "actuatorDissipatedEnergyJ",
])
  assert.equal(
    Object.hasOwn(checkpointEntry.values, field),
    false,
    "physics checkpoint duplicated motor-energy owner field " + field,
  );
assert.doesNotThrow(() =>
  validateAxialEffortEnergyOwnerConsistency(
    nominal.runtime,
    checkpoint,
    motorEnergyState,
  ),
);
for (const [label, mutate] of [
  ["wrong owner state version", (state) => (state.version = 1)],
  ["missing declared owner", (state) => state.ownerIds.pop()],
  ["ghost declared owner", (state) => (state.ownerIds[0] = "ghost-owner")],
  ["missing owner total", (state) => state.totals.pop()],
  ["ghost owner total", (state) => (state.totals[0][0] = "ghost-owner")],
]) {
  const candidate = structuredClone(motorEnergyState);
  mutate(candidate);
  assert.throws(
    () =>
      validateAxialEffortEnergyOwnerConsistency(
        nominal.runtime,
        checkpoint,
        candidate,
      ),
    (error) =>
      error?.code === "CHECKPOINT_MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
    label,
  );
}
const projectionMismatchedMotorTotals = structuredClone(motorEnergyState);
projectionMismatchedMotorTotals.totals[0][1].electricalEnergyJ += 100;
projectionMismatchedMotorTotals.totals[0][1].positiveMechanicalWorkJ += 100;
assert.throws(
  () =>
    validateAxialEffortEnergyOwnerConsistency(
      nominal.runtime,
      checkpoint,
      projectionMismatchedMotorTotals,
    ),
  (error) =>
    error?.code === "CHECKPOINT_AXIAL_EFFORT_ENERGY_PROJECTION_MISMATCH",
  "settlement totals changed without the physics projection were accepted",
);
assert.throws(
  () =>
    validateAxialEffortEnergyOwnerConsistency(nominal.runtime, checkpoint, {
      kind: "no-motor-energy-settlement-runtime-v1",
    }),
  (error) => error?.code === "CHECKPOINT_AXIAL_EFFORT_ENERGY_OWNER_MISSING",
);
const absentOwnerDuplicate = structuredClone(checkpoint);
Object.assign(
  absentOwnerDuplicate.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  ).values,
  {
    actuatorMechanicalWorkJ: 0,
    actuatorElectricalEnergyJ: 0,
    actuatorDissipatedEnergyJ: 0,
  },
);
assert.throws(
  () =>
    validateAxialEffortEnergyOwnerConsistency(
      nominal.runtime,
      absentOwnerDuplicate,
      { kind: "no-motor-energy-settlement-runtime-v1" },
    ),
  (error) => error?.code === "CHECKPOINT_AXIAL_EFFORT_ENERGY_OWNER_MISSING",
);
assert.doesNotThrow(() =>
  validateAxialEffortEnergyOwnerConsistency(
    { constraintEntries: [] },
    { entries: [] },
    { kind: "no-motor-energy-settlement-runtime-v1" },
  ),
);
assert.doesNotThrow(() =>
  validateAxialEffortEnergyOwnerConsistency(
    { constraintEntries: [] },
    {
      entries: [],
      axialEffortEnergyProjectionDigest:
        multibodyAxialEffortEnergyProjectionDigest({ constraintEntries: [] }),
    },
    { version: 2, lastSettledTick: 0, ownerIds: [], totals: [] },
  ),
);
assert.doesNotThrow(() =>
  validateAxialEffortEnergyOwnerConsistency(
    {
      constraintEntries: [
        {
          descriptor: {
            id: "ordinary-position",
            sourcePartId: "ordinary-position-part",
            mechanism: { commandLaw: { kind: "position-impedance-v1" } },
          },
        },
      ],
    },
    {
      entries: [
        {
          id: "ordinary-position",
          values: {
            actuatorMechanicalWorkJ: 1,
            actuatorElectricalEnergyJ: 2,
            actuatorDissipatedEnergyJ: 1,
          },
        },
      ],
      axialEffortEnergyProjectionDigest:
        multibodyAxialEffortEnergyProjectionDigest({ constraintEntries: [] }),
    },
    { version: 2, lastSettledTick: 0, ownerIds: [], totals: [] },
  ),
);
assert.throws(
  () =>
    validateAxialEffortEnergyOwnerConsistency(
      nominal.runtime,
      { ...checkpoint, entries: [] },
      motorEnergyState,
    ),
  /serialized only by the motor-settlement owner/,
);
const duplicatedEnergyCheckpoint = structuredClone(checkpoint),
  duplicatedEnergyValues = duplicatedEnergyCheckpoint.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  ).values;
Object.assign(duplicatedEnergyValues, {
  actuatorMechanicalWorkJ: 100,
  actuatorElectricalEnergyJ: 100,
  actuatorDissipatedEnergyJ: 0,
});
assert.throws(
  () =>
    validateAxialEffortEnergyOwnerConsistency(
      nominal.runtime,
      duplicatedEnergyCheckpoint,
      {
        ...motorEnergyState,
        totals: motorEnergyState.totals.map(([partId, totals]) => [
          partId,
          {
            ...totals,
            electricalEnergyJ: totals.electricalEnergyJ + 100,
            positiveMechanicalWorkJ: totals.positiveMechanicalWorkJ + 100,
          },
        ]),
      },
    ),
  /serialized only by the motor-settlement owner/,
  "duplicated checkpoint energy owners were accepted",
);
{
  let activeMotorArgument = null;
  const forceEntry = {
      descriptor: {
        sourcePartId: nominal.fixture.ids.actuatorId,
        mechanism: { commandLaw: { kind: "force-command-v1" } },
      },
      actuatorMechanicalWorkJ: -1,
      actuatorElectricalEnergyJ: -1,
      actuatorDissipatedEnergyJ: -1,
    },
    ordinaryEntry = {
      descriptor: {
        sourcePartId: "ordinary",
        mechanism: { commandLaw: { kind: "position-impedance-v1" } },
      },
      actuatorMechanicalWorkJ: 7,
      actuatorElectricalEnergyJ: 8,
      actuatorDissipatedEnergyJ: 1,
    },
    reconstructionRuntime = {
      constraintEntries: [forceEntry, ordinaryEntry],
      lastTelemetry: { activeMotors: 4 },
      telemetry(activeMotors) {
        activeMotorArgument = activeMotors;
        return { activeMotors };
      },
    },
    reconstructed = reconstructOwnedMultibodyMotorEnergy(
      reconstructionRuntime,
      motorEnergyState,
    );
  assert.ok(
    near(
      forceEntry.actuatorMechanicalWorkJ,
      nominalMotorTotals.positiveMechanicalWorkJ -
        nominalMotorTotals.absorbedMechanicalWorkJ,
    ),
  );
  assert.ok(
    near(
      forceEntry.actuatorElectricalEnergyJ,
      nominalMotorTotals.electricalEnergyJ,
    ),
  );
  assert.ok(
    near(
      forceEntry.actuatorDissipatedEnergyJ,
      nominalMotorTotals.rejectedHeatJ,
    ),
  );
  assert.deepEqual(
    [
      ordinaryEntry.actuatorMechanicalWorkJ,
      ordinaryEntry.actuatorElectricalEnergyJ,
      ordinaryEntry.actuatorDissipatedEnergyJ,
    ],
    [7, 8, 1],
  );
  assert.equal(activeMotorArgument, 4);
  assert.deepEqual(reconstructed, { activeMotors: 4 });
  forceEntry.actuatorMechanicalWorkJ = 9;
  forceEntry.actuatorElectricalEnergyJ = 9;
  forceEntry.actuatorDissipatedEnergyJ = 9;
  assert.throws(
    () => reconstructOwnedMultibodyMotorEnergy(reconstructionRuntime),
    (error) => error?.code === "MULTIBODY_MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
  );
  assert.deepEqual(
    [
      forceEntry.actuatorMechanicalWorkJ,
      forceEntry.actuatorElectricalEnergyJ,
      forceEntry.actuatorDissipatedEnergyJ,
    ],
    [9, 9, 9],
  );
}
const restoredWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  restoredAdapter = new CannonWorldAdapter(restoredWorld),
  restoredRuntime = new MultibodyRuntime({
    world: restoredWorld,
    worldAdapter: restoredAdapter,
    catalog: TYPES,
    fixedDt: DT,
  });
restoredRuntime.start(JSON.stringify(nominal.snapshot));
const contaminatedRestoredEntry = restoredRuntime.constraintEntries.find(
  (entry) => entry.kind === "axial-actuator-v1",
);
contaminatedRestoredEntry.actuatorMechanicalWorkJ = 9;
contaminatedRestoredEntry.actuatorElectricalEnergyJ = 9;
contaminatedRestoredEntry.actuatorDissipatedEnergyJ = 9;
restoredRuntime.importState(JSON.stringify(checkpoint));
const restoredEntry = restoredRuntime.constraintEntries.find(
  (entry) => entry.kind === "axial-actuator-v1",
);
for (const field of [
  "requestedForceN",
  "capacityLimitedForceN",
  "appliedForceN",
  "residualForceN",
  "commandTick",
  "commandSource",
  "commandValidity",
  "saturationCauseMask",
])
  assert.deepEqual(restoredEntry[field], checkpointEntry.values[field], field);
restoredRuntime.dispose();
const restoredCommandBus = new CommandBus();
restoredCommandBus.importState(
  nominal.session.context.commandBus.exportState(),
);
assert.equal(
  commandBusCurrentTick(restoredCommandBus),
  null,
  "checkpoint restore retained stale command authority",
);
assert.deepEqual(
  [
    restoredEntry.actuatorMechanicalWorkJ,
    restoredEntry.actuatorElectricalEnergyJ,
    restoredEntry.actuatorDissipatedEnergyJ,
  ],
  [0, 0, 0],
);
nominal.dispose();

const disturbed = await startPlant({ demandN: 1_200 }),
  disturbedSlider = disturbed.runtime.bodyByPart.get(
    disturbed.fixture.ids.sliderId,
  ),
  disturbedBefore = vector(disturbedSlider.velocity),
  disturbedState = disturbed.step({ externalForceOnSliderN: -200 }),
  disturbedDelta = add(
    vector(disturbedSlider.velocity),
    scale(disturbedBefore, -1),
  );
assert.ok(
  near(
    dot(disturbedDelta, [0, 0, 1]),
    ((disturbedState.appliedForceN - 200) * DT) / disturbedSlider.mass,
  ),
  JSON.stringify({
    disturbedState,
    disturbedDelta,
    mass: disturbedSlider.mass,
  }),
);
disturbed.dispose();

const capacityLimited = await startPlant({ demandN: 10_000 });
const capacityState = capacityLimited.step();
assert.ok(
  capacityState.capacityLimitedForceN > 0 &&
    capacityState.capacityLimitedForceN < 8_000,
  JSON.stringify(capacityState),
);
assert.ok(
  near(
    capacityState.capacityLimitedForceN,
    8_000 * (1 - Math.abs(capacityState.rateMPerS)),
    1e-7,
  ),
  JSON.stringify(capacityState),
);
assert.ok(
  near(capacityState.appliedForceN, capacityState.capacityLimitedForceN),
);
assert.ok(Math.abs(capacityState.rateMPerS) < 1);
assert.deepEqual(capacityState.saturationCauses, ["force-speed-capacity"]);
capacityLimited.dispose();

const implicitOnlyLimited = await startPlant({ demandN: 5_000 }),
  implicitOnlyState = implicitOnlyLimited.step();
assert.ok(implicitOnlyState.capacityLimitedForceN < 5_000);
assert.ok(implicitOnlyState.capacityLimitedForceN > 0);
assert.ok(
  near(
    implicitOnlyState.appliedForceN,
    implicitOnlyState.capacityLimitedForceN,
  ),
);
assert.deepEqual(implicitOnlyState.saturationCauses, ["force-speed-capacity"]);
implicitOnlyLimited.dispose();

const retractLimited = await startPlant({
  demandN: -10_000,
  snapshotOptions: {
    maximumExtendForceN: 8_000,
    maximumRetractForceN: 4_000,
  },
});
const retractLimitedState = retractLimited.step();
assert.ok(retractLimitedState.appliedForceN < 0);
assert.ok(
  near(
    retractLimitedState.capacityLimitedForceN,
    -4_000 * (1 - Math.abs(retractLimitedState.rateMPerS)),
    1e-7,
  ),
  JSON.stringify(retractLimitedState),
);
assert.ok(
  near(
    retractLimitedState.appliedForceN,
    retractLimitedState.capacityLimitedForceN,
  ),
);
retractLimited.dispose();

const overflow = await startPlant({ demandN: 1_000_001 });
const overflowState = overflow.step();
assert.equal(overflowState.commandValidity, "missing");
assert.equal(overflowState.appliedForceN, 0);
assert.ok(
  overflow.session
    .telemetry()
    .systems.commands.rejections.some(
      (entry) => entry.reason === "command is outside target channel range",
    ),
);
overflow.dispose();

const scriptOverflow = await startPlant({
  demandN: 1_000_001,
  commandSource: "script",
});
const scriptOverflowState = scriptOverflow.step();
assert.equal(scriptOverflowState.commandValidity, "missing");
assert.equal(scriptOverflowState.appliedForceN, 0);
assert.ok(
  scriptOverflow.session
    .telemetry()
    .systems.commands.rejections.some(
      (entry) => entry.reason === "command is outside target channel range",
    ),
);
scriptOverflow.dispose();

const passive = await startPlant({
  snapshotOptions: {
    unpoweredLaw: { kind: "viscous-drag-v1", dampingNsPerM: 100 },
  },
});
passive.session.context.runGraph.setPartState(passive.fixture.ids.batteryId, {
  energyJ: 0,
});
passive.runtime.bodyByPart
  .get(passive.fixture.ids.sliderId)
  .velocity.set(0, 0, 0.25);
const passiveSlider = passive.runtime.bodyByPart.get(
    passive.fixture.ids.sliderId,
  ),
  passiveVelocityBefore = passiveSlider.velocity.z;
const passiveState = passive.step();
assert.equal(passiveState.commandValidity, "current");
assert.equal(passiveState.requestedForceN, 1_200);
assert.ok(near(passiveState.appliedForceN, 0));
assert.ok(near(passiveState.passiveForceN, -25));
assert.ok(near(passiveState.forceN, passiveState.passiveForceN));
assert.equal(passiveState.residualForceN, 1_200);
assert.ok(passiveState.saturationCauses.includes("power-unavailable"));
assert.ok(passiveSlider.velocity.z < passiveVelocityBefore);
assert.ok(passiveState.frictionWorkJ < 0);
assert.ok(near(passiveState.frictionWorkJ, -25 * 0.25 * DT));
for (const connectionId of ["actuator-base", "actuator-slider"])
  assert.ok(
    near(passive.runtime.loadByConnection.get(connectionId), 25),
    connectionId,
  );
const passiveCheckpoint = structuredClone(passive.runtime.exportState()),
  passiveCheckpointValues = passiveCheckpoint.entries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  ).values;
assert.equal(Object.hasOwn(passiveCheckpointValues, "passiveForceN"), false);
assert.equal(
  Object.hasOwn(passiveCheckpointValues, "effortRateSampleMPerS"),
  false,
);
assert.doesNotThrow(() =>
  passive.runtime.validateState(JSON.stringify(passiveCheckpoint)),
);
for (const [label, mutate] of [
  ["negative command tick only", (values) => (values.commandTick = -1)],
  ["fractional command tick only", (values) => (values.commandTick = 0.5)],
  [
    "negative saturation mask only",
    (values) => (values.saturationCauseMask = -1),
  ],
  [
    "fractional saturation mask only",
    (values) => (values.saturationCauseMask = 0.5),
  ],
  [
    "unknown saturation bit only",
    (values) => (values.saturationCauseMask = 16),
  ],
]) {
  const candidate = structuredClone(passiveCheckpoint),
    values = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  mutate(values);
  assert.throws(
    () => passive.runtime.validateState(JSON.stringify(candidate)),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    label,
  );
}
const passiveRestoredWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0),
  }),
  passiveRestoredAdapter = new CannonWorldAdapter(passiveRestoredWorld),
  passiveRestoredRuntime = new MultibodyRuntime({
    world: passiveRestoredWorld,
    worldAdapter: passiveRestoredAdapter,
    catalog: TYPES,
    fixedDt: DT,
  });
passiveRestoredRuntime.start(JSON.stringify(passive.snapshot));
passiveRestoredRuntime.importState(JSON.stringify(passiveCheckpoint));
const passiveRestoredEntry = passiveRestoredRuntime.constraintEntries.find(
  (entry) => entry.kind === "axial-actuator-v1",
);
assert.ok(
  near(
    passiveRestoredEntry.effortRateSampleMPerS,
    passiveCheckpointValues.rateMPerS,
  ),
);
assert.ok(
  near(
    passiveRestoredEntry.passiveForceN,
    -100 * passiveCheckpointValues.rateMPerS,
  ),
);
passiveRestoredRuntime.dispose();
for (const [label, mutate] of [
  ["forged rate sample", (values) => (values.effortRateSampleMPerS = 0.5)],
  ["forged passive force", (values) => (values.passiveForceN = -50)],
  ["rate disagrees with body kinematics", (values) => (values.rateMPerS = 0.5)],
]) {
  const candidate = structuredClone(passiveCheckpoint),
    values = candidate.entries.find(
      (entry) => entry.kind === "axial-actuator-v1",
    ).values;
  mutate(values);
  assert.throws(
    () => passive.runtime.validateState(JSON.stringify(candidate)),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    label,
  );
}
passive.dispose();

const idleOnly = await startPlant({ demandN: 0 }),
  idleOnlyState = idleOnly.step(),
  idleOnlyRecord = idleOnly.session
    .telemetry()
    .systems.motorEnergy.records.find(
      (record) => record.mode === "absolute-axial-effort",
    ),
  idleOnlyPowerLaw = idleOnly.fixture.parts.find(
    (candidate) => candidate.id === idleOnly.fixture.ids.actuatorId,
  ).mechanism.config.powerLaw;
assert.equal(idleOnlyState.requestedForceN, 0);
assert.equal(idleOnlyState.appliedForceN, 0);
assert.equal(idleOnlyState.mechanicalWorkJ, 0);
assert.ok(
  near(
    idleOnlyState.electricalEnergyJ,
    idleOnlyPowerLaw.idlePowerW * DT,
    1e-10,
  ),
  JSON.stringify(idleOnlyState),
);
assert.ok(
  near(idleOnlyState.dissipatedEnergyJ, idleOnlyState.electricalEnergyJ),
);
assert.equal(idleOnlyRecord.positiveMechanicalWorkJ, 0);
assert.equal(idleOnlyRecord.absorbedMechanicalWorkJ, 0);
assert.ok(
  near(idleOnlyRecord.requestedElectricalW, idleOnlyPowerLaw.idlePowerW),
);
assert.ok(
  near(idleOnlyRecord.deliveredElectricalW, idleOnlyPowerLaw.idlePowerW),
);
assert.ok(
  near(idleOnlyRecord.conversionLossJ, idleOnlyPowerLaw.idlePowerW * DT),
);
assert.ok(near(idleOnlyRecord.rejectedHeatJ, idleOnlyRecord.conversionLossJ));
idleOnly.dispose();

const ordinaryPosition = await startPlant({
  demandN: 0.75,
  snapshotOptions: { forceCommand: false },
});
const ordinaryPositionState = ordinaryPosition.step(),
  ordinaryPositionEntry = ordinaryPosition.runtime.constraintEntries.find(
    (entry) => entry.kind === "axial-actuator-v1",
  );
assert.ok(Math.abs(ordinaryPositionState.forceN) > 1e-9);
assert.equal(Object.hasOwn(ordinaryPositionState, "requestedForceN"), false);
assert.equal(Object.hasOwn(ordinaryPositionEntry, "passiveForceN"), false);
const ordinaryCheckpointEntry = ordinaryPosition.runtime
  .exportState()
  .entries.find((entry) => entry.kind === "axial-actuator-v1");
for (const field of [
  "actuatorMechanicalWorkJ",
  "actuatorElectricalEnergyJ",
  "actuatorDissipatedEnergyJ",
])
  assert.equal(Object.hasOwn(ordinaryCheckpointEntry.values, field), true);
ordinaryPosition.session.context.runGraph.setPartState(
  ordinaryPosition.fixture.ids.batteryId,
  { energyJ: 0 },
);
ordinaryPosition.step();
assert.equal(Object.hasOwn(ordinaryPositionEntry, "residualForceN"), false);
ordinaryPosition.dispose();

const lowPower = await startPlant({
  demandN: 1_000,
  snapshotOptions: { batteryMaxOutputWatts: 500 },
});
let lowPowerState, lowPowerTerminalState, lowPowerRecord;
const lowPowerSamples = [];
for (let tick = 0; tick < 20; tick++) {
  const candidate = lowPower.step();
  lowPowerTerminalState = candidate;
  lowPowerSamples.push({
    requested: candidate.requestedForceN,
    capacity: candidate.capacityLimitedForceN,
    applied: candidate.appliedForceN,
    residual: candidate.residualForceN,
    causes: candidate.saturationCauses,
    rate: candidate.rateMPerS,
    validity: candidate.commandValidity,
  });
  if (candidate.saturationCauses.includes("power-allocation")) {
    lowPowerState = candidate;
    lowPowerRecord = lowPower.session
      .telemetry()
      .systems.motorEnergy.records.find(
        (record) => record.mode === "absolute-axial-effort",
      );
  }
}
assert.ok(
  lowPowerState,
  `low-power fixture never exercised delivery limiting: ${JSON.stringify(lowPowerSamples)}`,
);
assert.ok(lowPowerState.appliedForceN < lowPowerState.capacityLimitedForceN);
assert.ok(lowPowerState.residualForceN > 0);
assert.ok(lowPowerState.saturationCauses.includes("power-allocation"));
const lowPowerBodies = [
  lowPower.runtime.bodyByPart.get(lowPower.fixture.ids.baseId),
  lowPower.runtime.bodyByPart.get(lowPower.fixture.ids.sliderId),
];
const lowPowerKineticEnergyJ = lowPowerBodies.reduce(
  (sum, body) => sum + 0.5 * body.mass * magnitude(vector(body.velocity)) ** 2,
  0,
);
assert.ok(
  near(lowPowerTerminalState.mechanicalWorkJ, lowPowerKineticEnergyJ, 1e-7),
  JSON.stringify({ lowPowerTerminalState, lowPowerKineticEnergyJ }),
);
assert.equal(lowPowerRecord.energySaturated, true);
assert.ok(
  lowPowerRecord.positiveMechanicalWorkJ <=
    lowPowerRecord.mechanicalBudgetJ + 1e-9,
);
assertLedger(lowPowerState);
lowPower.dispose();

const braking = await startPlant({ demandN: -200 }),
  brakingBase = braking.runtime.bodyByPart.get(braking.fixture.ids.baseId),
  brakingSlider = braking.runtime.bodyByPart.get(braking.fixture.ids.sliderId),
  brakingTotalMass = brakingBase.mass + brakingSlider.mass,
  brakingRelativeSpeed = 0.5;
brakingBase.velocity.set(
  0,
  0,
  (-brakingSlider.mass / brakingTotalMass) * brakingRelativeSpeed,
);
brakingSlider.velocity.set(
  0,
  0,
  (brakingBase.mass / brakingTotalMass) * brakingRelativeSpeed,
);
const brakingKineticBeforeJ =
    0.5 * brakingBase.mass * magnitude(vector(brakingBase.velocity)) ** 2 +
    0.5 * brakingSlider.mass * magnitude(vector(brakingSlider.velocity)) ** 2,
  brakingState = braking.step(),
  brakingKineticAfterJ =
    0.5 * brakingBase.mass * magnitude(vector(brakingBase.velocity)) ** 2 +
    0.5 * brakingSlider.mass * magnitude(vector(brakingSlider.velocity)) ** 2,
  brakingRecord = braking.session
    .telemetry()
    .systems.motorEnergy.records.find(
      (record) => record.mode === "absolute-axial-effort",
    );
assert.ok(brakingState.mechanicalWorkJ < 0, JSON.stringify(brakingState));
assert.ok(brakingRecord.absorbedMechanicalWorkJ > 0, brakingRecord);
assert.equal(brakingRecord.positiveMechanicalWorkJ, 0);
assert.ok(
  near(
    brakingState.mechanicalWorkJ,
    brakingKineticAfterJ - brakingKineticBeforeJ,
    1e-7,
  ),
);
assertLedger(brakingState);
const brakingMotorState = braking.motorEnergySettlement.exportState();
assert.ok(brakingMotorState.totals[0][1].absorbedMechanicalWorkJ > 0);
assert.doesNotThrow(() =>
  braking.motorEnergySettlement.validateState(
    JSON.stringify(brakingMotorState),
  ),
);
{
  const forceEntry = {
      descriptor: {
        sourcePartId: braking.fixture.ids.actuatorId,
        mechanism: { commandLaw: { kind: "force-command-v1" } },
      },
      actuatorMechanicalWorkJ: 0,
      actuatorElectricalEnergyJ: 0,
      actuatorDissipatedEnergyJ: 0,
    },
    reconstructionRuntime = {
      constraintEntries: [forceEntry],
      lastTelemetry: null,
      telemetry: () => ({}),
    };
  reconstructOwnedMultibodyMotorEnergy(
    reconstructionRuntime,
    brakingMotorState,
  );
  assert.ok(forceEntry.actuatorMechanicalWorkJ < 0);
  assert.ok(
    near(
      forceEntry.actuatorMechanicalWorkJ,
      brakingMotorState.totals[0][1].positiveMechanicalWorkJ -
        brakingMotorState.totals[0][1].absorbedMechanicalWorkJ,
    ),
  );
}
assert.doesNotThrow(() =>
  validateAxialEffortEnergyOwnerConsistency(
    braking.runtime,
    braking.runtime.exportState(),
    braking.motorEnergySettlement.exportState(),
  ),
);
braking.dispose();

const reversing = await startPlant({ demandN: 8_000 }),
  reversingBase = reversing.runtime.bodyByPart.get(
    reversing.fixture.ids.baseId,
  ),
  reversingSlider = reversing.runtime.bodyByPart.get(
    reversing.fixture.ids.sliderId,
  ),
  reversingTotalMass = reversingBase.mass + reversingSlider.mass,
  reversingRelativeSpeed = -0.05;
reversingBase.velocity.set(
  0,
  0,
  (-reversingSlider.mass / reversingTotalMass) * reversingRelativeSpeed,
);
reversingSlider.velocity.set(
  0,
  0,
  (reversingBase.mass / reversingTotalMass) * reversingRelativeSpeed,
);
const reversingKineticBeforeJ =
    0.5 * reversingBase.mass * magnitude(vector(reversingBase.velocity)) ** 2 +
    0.5 *
      reversingSlider.mass *
      magnitude(vector(reversingSlider.velocity)) ** 2,
  reversingState = reversing.step(),
  reversingKineticAfterJ =
    0.5 * reversingBase.mass * magnitude(vector(reversingBase.velocity)) ** 2 +
    0.5 *
      reversingSlider.mass *
      magnitude(vector(reversingSlider.velocity)) ** 2,
  reversingRecord = reversing.session
    .telemetry()
    .systems.motorEnergy.records.find(
      (record) => record.mode === "absolute-axial-effort",
    );
assert.ok(reversingRecord.absorbedMechanicalWorkJ > 0, reversingRecord);
assert.ok(reversingRecord.positiveMechanicalWorkJ > 0, reversingRecord);
assert.ok(
  near(reversingRecord.absorbedMechanicalWorkJ, reversingKineticBeforeJ, 1e-7),
  JSON.stringify({ reversingRecord, reversingKineticBeforeJ }),
);
assert.ok(
  near(reversingRecord.positiveMechanicalWorkJ, reversingKineticAfterJ, 1e-7),
  JSON.stringify({ reversingRecord, reversingKineticAfterJ }),
);
assert.ok(
  near(
    reversingState.mechanicalWorkJ,
    reversingRecord.positiveMechanicalWorkJ -
      reversingRecord.absorbedMechanicalWorkJ,
    1e-7,
  ),
  JSON.stringify(reversingState),
);
assert.ok(
  near(
    reversingRecord.rejectedHeatJ,
    reversingRecord.conversionLossJ + reversingRecord.absorbedMechanicalWorkJ,
    1e-7,
  ),
  reversingRecord,
);
assertLedger(reversingState);
reversing.dispose();

const thermal = await startPlant({
  demandN: 2_000,
  snapshotOptions: {
    thermalLimits: {
      thermalMassJPerK: 0.02,
      ambientConductanceWPerK: 0,
      derateTemperatureK: 293.16,
      shutdownTemperatureK: 293.2,
    },
  },
});
let thermalState;
for (let tick = 0; tick < 4; tick++) thermalState = thermal.step();
assert.equal(thermalState.thermalShutdown, true);
assert.ok(near(thermalState.appliedForceN, 0));
assert.ok(near(thermalState.passiveForceN, 0));
assert.equal(thermalState.residualForceN, 2_000);
assert.ok(thermalState.saturationCauses.includes("thermal-derate"));
assert.equal(
  thermalState.saturationCauses.includes("force-speed-capacity"),
  false,
);
thermal.dispose();

const hotDerated = await startPlant({
  demandN: 10_000,
  snapshotOptions: {
    thermalLimits: {
      thermalMassJPerK: 1e12,
      ambientConductanceWPerK: 0,
      derateTemperatureK: 293,
      shutdownTemperatureK: 294,
    },
  },
});
const hotDeratedState = hotDerated.step(),
  initialHotAvailability = (294 - 293.15) / (294 - 293);
assert.ok(
  near(
    hotDeratedState.capacityLimitedForceN,
    8_000 * initialHotAvailability * (1 - Math.abs(hotDeratedState.rateMPerS)),
    1e-7,
  ),
  JSON.stringify(hotDeratedState),
);
assert.ok(hotDeratedState.saturationCauses.includes("thermal-derate"));
assert.ok(
  hotDeratedState.thermalDerate > 0 && hotDeratedState.thermalDerate < 1,
);
hotDerated.dispose();

const controllerRelay = await startPlant({
  demandN: 300,
  commandSource: "script",
  snapshotOptions: {
    unpoweredLaw: { kind: "viscous-drag-v1", dampingNsPerM: 0 },
  },
});
let relayState = controllerRelay.step();
assert.equal(relayState.commandSource, "script");
assert.equal(relayState.commandValidity, "current");
assert.ok(near(relayState.appliedForceN, 300));
controllerRelay.setMode("binding-invalid");
relayState = controllerRelay.step();
assert.equal(relayState.commandValidity, "missing");
assert.equal(relayState.appliedForceN, 0);
assert.ok(
  controllerRelay.session
    .telemetry()
    .systems.commands.rejections.some(
      (entry) =>
        entry.reason === "binding has no powered directed signal route",
    ),
);
controllerRelay.setMode("normal");
relayState = controllerRelay.step();
assert.equal(relayState.commandValidity, "current");
assert.ok(near(relayState.appliedForceN, 300));
const batteryBeforeLoss = controllerRelay.session.context.runGraph.part(
    controllerRelay.fixture.ids.batteryId,
  ).energyJ,
  relayBase = controllerRelay.runtime.bodyByPart.get(
    controllerRelay.fixture.ids.baseId,
  ),
  relaySlider = controllerRelay.runtime.bodyByPart.get(
    controllerRelay.fixture.ids.sliderId,
  ),
  relativeSpeedBeforeLoss = relaySlider.velocity.z - relayBase.velocity.z;
controllerRelay.session.context.runGraph.setPartState(
  controllerRelay.fixture.ids.batteryId,
  { energyJ: 0 },
);
relayState = controllerRelay.step();
assert.equal(relayState.commandValidity, "current");
assert.equal(relayState.requestedForceN, 300);
assert.equal(relayState.appliedForceN, 0);
assert.equal(relayState.residualForceN, 300);
assert.ok(relayState.saturationCauses.includes("power-unavailable"));
assert.ok(
  near(
    relaySlider.velocity.z - relayBase.velocity.z,
    relativeSpeedBeforeLoss,
    1e-8,
  ),
  JSON.stringify({
    relativeSpeedBeforeLoss,
    relativeSpeedAfterLoss: relaySlider.velocity.z - relayBase.velocity.z,
  }),
);
controllerRelay.session.context.runGraph.setPartState(
  controllerRelay.fixture.ids.batteryId,
  { energyJ: batteryBeforeLoss },
);
relayState = controllerRelay.step();
assert.equal(relayState.commandValidity, "current");
assert.ok(near(relayState.appliedForceN, 300));
assert.equal(
  controllerRelay.manager.status(controllerRelay.fixture.ids.controllerId)
    .ready,
  true,
  "power recovery required a controller restart",
);
controllerRelay.dispose();

const failedAuthoredRoute = await startPlant({
  demandN: 1_100,
  commandSource: "script",
});
assert.equal(failedAuthoredRoute.step().commandValidity, "current");
failedAuthoredRoute.session.context.runGraph.failConnection(
  failedAuthoredRoute.fixture.ids.signalConnectionId,
  { reason: "qualification route interruption", mode: "signal" },
);
const failedAuthoredRouteState = failedAuthoredRoute.step();
assert.equal(failedAuthoredRouteState.commandValidity, "missing");
assert.equal(failedAuthoredRouteState.appliedForceN, 0);
assert.ok(
  failedAuthoredRoute.session
    .telemetry()
    .systems.commands.rejections.some(
      (entry) =>
        entry.reason === "binding has no powered directed signal route",
    ),
);
failedAuthoredRoute.dispose();

const rotationY90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  variants = [
    { actuatorId: "axis-drive-variant" },
    {
      axis: [1, 0, 0],
      orientation: rotationY90,
      lengthRangeM: { lower: 0.2, upper: 1.8 },
    },
    { maximumForceN: 2_000 },
  ];
for (const snapshotOptions of variants) {
  const variant = await startPlant({ demandN: 1_200, snapshotOptions }),
    variantState = variant.step();
  assert.equal(variantState.commandValidity, "current");
  assert.equal(variantState.sourcePartId, snapshotOptions.actuatorId ?? 2);
  assert.ok(near(variantState.requestedForceN, 1_200));
  assert.ok(variantState.appliedForceN > 0);
  assertLedger(variantState);
  variant.dispose();
}
const heavyCatalog = structuredClone(TYPES);
heavyCatalog.plate.mass *= 3;
const ordinaryMass = await startPlant({ demandN: 1_200 }),
  heavyMass = await startPlant({ demandN: 1_200, catalog: heavyCatalog }),
  ordinarySlider = ordinaryMass.runtime.bodyByPart.get(
    ordinaryMass.fixture.ids.sliderId,
  ),
  heavySlider = heavyMass.runtime.bodyByPart.get(
    heavyMass.fixture.ids.sliderId,
  ),
  ordinaryVelocityBefore = vector(ordinarySlider.velocity),
  heavyVelocityBefore = vector(heavySlider.velocity),
  ordinaryState = ordinaryMass.step(),
  heavyState = heavyMass.step(),
  ordinaryAcceleration =
    dot(
      add(vector(ordinarySlider.velocity), scale(ordinaryVelocityBefore, -1)),
      axis,
    ) / DT,
  heavyAcceleration =
    dot(
      add(vector(heavySlider.velocity), scale(heavyVelocityBefore, -1)),
      axis,
    ) / DT;
assert.ok(near(ordinaryState.appliedForceN, heavyState.appliedForceN));
assert.ok(heavySlider.mass > ordinarySlider.mass);
assert.ok(heavyAcceleration < ordinaryAcceleration);
assert.ok(
  near(ordinaryAcceleration, ordinaryState.appliedForceN / ordinarySlider.mass),
);
assert.ok(near(heavyAcceleration, heavyState.appliedForceN / heavySlider.mass));
ordinaryMass.dispose();
heavyMass.dispose();

async function deterministicRun() {
  const run = await startPlant({ demandN: 900 });
  let terminal;
  for (let tick = 0; tick < 60; tick++) {
    terminal = run.step();
    assertLedger(terminal);
  }
  const result = {
    state: terminal,
    base: vector(run.runtime.bodyByPart.get(run.fixture.ids.baseId).position),
    slider: vector(
      run.runtime.bodyByPart.get(run.fixture.ids.sliderId).position,
    ),
    batteryEnergyJ: run.session.context.runGraph.part(run.fixture.ids.batteryId)
      .energyJ,
  };
  run.dispose();
  return result;
}
assert.deepEqual(await deterministicRun(), await deterministicRun());

console.log(
  "physical demand application passed (absolute N demand, F=ma force pair, capacity/power/thermal settlement, checkpoint validation, controller recovery, parameter covariance)",
);
