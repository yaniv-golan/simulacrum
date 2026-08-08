import assert from "node:assert/strict";
import { TYPES } from "../src/model/component-catalog.js";
import { readRemoteControlBinding } from "../src/application/remote-control-read-model.js";
import { routedControllerIdsForPart } from "../src/application/controller-route-read-model.js";
import {
  durableRemoteControlState,
  nextRemoteControlId,
  remoteProfilesFromTemplates,
  runtimeControlsFromProfiles,
  syncRemoteProfileDefinitions,
} from "../src/application/remote-control-state.js";
import {
  remoteActionTargetPartIds,
  resolveRemoteAction,
  resolveRemoteActionState,
  validateRemoteActionBindings,
} from "../src/model/remote-actions.js";
import {
  assertBlueprintAcquisition,
  BlueprintAcquisition,
} from "../src/model/blueprint-acquisition.js";
import { BodyRegistry } from "../src/simulation/body-registry.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import {
  acceptsActuatorChannel,
  actuatorChannels,
  actuatorChannel,
  clampActuatorCommand,
  powerContract,
  readActuatorCommand,
  sourcePowerContract,
  targetTypesForChannel,
} from "../src/model/actuator-contracts.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import {
  batteryEnergyReadModel,
  JOULES_PER_WATT_HOUR,
  joulesToWattHours,
  runtimeBatteryEnergy,
  wattHoursToJoules,
} from "../src/simulation/energy-ledger.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { SignalNetwork } from "../src/simulation/signal-network.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { InputTraceRecorder } from "../src/simulation/input-trace-recorder.js";
import { InputTracePlayer } from "../src/simulation/input-trace-player.js";
import { wheelDriveMotorIds } from "../src/simulation/wheel-drive-topology.js";
import {
  isMechanismComponentType,
  mechanismComponentDefinition,
} from "../src/model/mechanism-component-definitions.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";

const part = (id, type, config = {}, extra = {}) => ({
    id,
    type,
    ...(isMechanismComponentType(type)
      ? { mechanism: mechanismComponentDefinition(type) }
      : { config }),
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  connection = (id, a, b, kind, portA, portB, extra = {}) => ({
    id,
    a,
    b,
    kind,
    portA,
    portB,
    ...(["mechanical", "mesh"].includes(kind)
      ? {
          capacity: {
            ultimateForceN: 10_000,
            ultimateTorqueNm: 2_000,
          },
        }
      : {}),
    ...extra,
  });

const energy = runtimeBatteryEnergy({
  type: "battery",
  config: { capacityWh: 42 },
  storedEnergyWh: 21,
});
assert.equal(energy.capacityJ, 42 * JOULES_PER_WATT_HOUR);
assert.equal(energy.energyJ, 21 * JOULES_PER_WATT_HOUR);
assert.equal(energy.stateOfCharge, 0.5);
assert.equal(batteryEnergyReadModel(energy).energyWh, 21);
assert.equal(wattHoursToJoules(0.5), 1800);
assert.equal(joulesToWattHours(1800), 0.5);
assert.throws(() => wattHoursToJoules(-1), /finite non-negative/);
assert.throws(() => joulesToWattHours(Number.NaN), /finite non-negative/);
assert.throws(
  () => runtimeBatteryEnergy({ type: "battery" }),
  /battery capacity/,
);
assert.throws(
  () =>
    runtimeBatteryEnergy({
      type: "battery",
      config: { capacityWh: 1 },
      storedEnergyWh: 2,
    }),
  /cannot exceed/,
);
assert.equal(
  runtimeBatteryEnergy({
    type: "battery",
    config: { capacityWh: 0 },
    storedEnergyWh: 0,
  }).stateOfCharge,
  0,
);
assert.equal(
  batteryEnergyReadModel({ capacityJ: 3600, energyJ: 7200 }).energyJ,
  3600,
);
assert.equal(
  batteryEnergyReadModel({ capacityJ: 7200, energyJ: 1800 }).stateOfCharge,
  0.25,
);
assert.equal(batteryEnergyReadModel({}).stateOfCharge, 0);

assert.equal(actuatorChannel({ type: "motor" }, "throttle").fanout, true);
assert.equal(actuatorChannel(null, "throttle"), null);
assert.equal(acceptsActuatorChannel({ type: "plate" }, "throttle"), false);
for (const channel of ["yaw", "pitch", "roll"])
  assert.deepEqual(
    {
      minimum: actuatorChannel(part(1, "gyro"), channel).minimum,
      maximum: actuatorChannel(part(1, "gyro"), channel).maximum,
      fanout: actuatorChannel(part(1, "gyro"), channel).fanout,
    },
    { minimum: -1, maximum: 1, fanout: true },
  );
for (const channel of ["gimbal_x", "gimbal_z"])
  assert.deepEqual(
    {
      minimum: actuatorChannel(part(1, "rocket"), channel).minimum,
      maximum: actuatorChannel(part(1, "rocket"), channel).maximum,
      fanout: actuatorChannel(part(1, "rocket"), channel).fanout,
    },
    { minimum: -1, maximum: 1, fanout: true },
  );
for (const channel of ["target_x", "target_z"])
  assert.deepEqual(
    {
      minimum: actuatorChannel(part(1, "computer"), channel).minimum,
      maximum: actuatorChannel(part(1, "computer"), channel).maximum,
    },
    { minimum: -1_000_000, maximum: 1_000_000 },
  );
assert.equal(clampActuatorCommand({ type: "motor" }, "throttle", 2), 1);
assert.equal(clampActuatorCommand({ type: "hinge" }, "joint_target", NaN), 0);
assert.equal(clampActuatorCommand({ type: "plate" }, "throttle", 1), null);
const conflictBus = new CommandBus();
conflictBus.writeScript("a", "drive", 1, "throttle", 1);
conflictBus.writeScript("b", "drive", 1, "throttle", -1);
conflictBus.writeScript("a", "joint", 2, "joint_target", -1);
conflictBus.writeScript("b", "joint", 2, "joint_target", 1);
assert.equal(
  readActuatorCommand(conflictBus, part(1, "motor"), "throttle", 1).value,
  0,
);
assert.equal(
  readActuatorCommand(conflictBus, part(2, "hinge"), "joint_target", 0).value,
  0,
);
const idleBus = new CommandBus();
assert.equal(
  readActuatorCommand(idleBus, part(3, "motor"), "throttle").value,
  0,
);
assert.equal(
  readActuatorCommand(idleBus, part(3, "motor"), "throttle", 1).value,
  1,
);
assert.ok(targetTypesForChannel("yaw").includes("gyro"));
assert.equal(targetTypesForChannel("not-a-channel").length, 0);
assert.equal(powerContract(part(1, "plate")), null);
assert.equal(powerContract(part(1, "motor", { power: 0 })).requestW, 1);
assert.equal(
  powerContract(part(1, "motor"), {
    motor: { ...TYPES.motor, power: 2 },
  }).requestW,
  2000,
);
assert.equal(powerContract(part(1, "motor"), {}), null);
const hingePowerLaw = part(1, "hinge").mechanism.config.actuation.powerLaw;
assert.equal(
  powerContract(part(1, "hinge")).requestW,
  hingePowerLaw.maximumMechanicalMotoringPowerW /
    hingePowerLaw.electricalMotoringEfficiency +
    hingePowerLaw.idlePowerW,
);
assert.equal(powerContract(part(1, "gyro", { power: 3 })).requestW, 3000);
assert.equal(powerContract(part(1, "gyro"), {}), null);
assert.equal(
  powerContract(part(1, "headlight", { powerWatts: 12 })).requestW,
  12,
);
assert.equal(
  powerContract(part(1, "headlight"), {
    headlight: { ...TYPES.headlight, powerWatts: 14 },
  }).requestW,
  14,
);
assert.equal(powerContract(part(1, "headlight"), {}), null);
assert.equal(powerContract(part(1, "computer")).baselineW, 8);
assert.equal(powerContract(part(1, "computer")).requestW, 18);
assert.equal(
  powerContract(part(1, "computer", { electricalEfficiency: 0.5 })).efficiency,
  0.5,
);
assert.equal(sourcePowerContract(part(1, "plate")), null);
assert.equal(
  sourcePowerContract(
    part(1, "battery", { capacityWh: 2, dischargeEfficiency: 2 }),
  ).efficiency,
  1,
);
assert.equal(
  sourcePowerContract({ type: "battery", config: { capacityWh: 2 } })
    .maxOutputW,
  1000,
);
assert.equal(
  sourcePowerContract({
    type: "battery",
    config: { capacityWh: 4 },
  }).maxOutputW,
  2000,
);

const wheelTopologyParts = [
    part("drive", "motor"),
    part("accessory", "motor"),
    part("axle", "axle"),
    part("wheel", "wheel"),
    part("chassis", "plate"),
  ],
  wheelTopologyConnections = [
    connection("drive-axle", "drive", "axle", "mechanical", "SHAFT", "LEFT"),
    connection("axle-wheel", "axle", "wheel", "mechanical", "RIGHT", "AXLE"),
    connection(
      "accessory-mount",
      "accessory",
      "chassis",
      "mechanical",
      "MOUNT",
      "TOP",
    ),
  ];
assert.deepEqual(
  [...wheelDriveMotorIds(wheelTopologyParts, wheelTopologyConnections)],
  ["drive"],
  "structural mounts incorrectly claimed a motor for wheel propulsion",
);
wheelTopologyConnections[1].failed = true;
assert.equal(
  wheelDriveMotorIds(wheelTopologyParts, wheelTopologyConnections).size,
  0,
  "a failed driveline still owned its motor",
);
wheelTopologyConnections[1].failed = false;
for (const invalid of [
  connection("portless", "drive", "wheel", "mechanical"),
  connection("structural", "drive", "wheel", "mechanical", "MOUNT", "AXLE"),
  connection("wrong-kind", "drive", "wheel", "mesh", "SHAFT", "AXLE"),
])
  assert.equal(
    wheelDriveMotorIds(wheelTopologyParts, [invalid]).size,
    0,
    `${invalid.id} transmitted torque without compatible rotating ports`,
  );

const topology = {
    parts: [
      part(
        1,
        "battery",
        { capacityWh: 2, maxOutputWatts: 200, dischargeEfficiency: 1 },
        { storedEnergyWh: 2 },
      ),
      part(2, "powerbus"),
      part(3, "computer"),
      part(4, "motor", { power: 0.1 }),
      part(5, "sensor"),
      part(6, "gear12"),
    ],
    connections: [
      connection("p-in", 1, 2, "power", "POWER", "POWER IN"),
      connection("p-controller", 2, 3, "power", "POWER OUT", "POWER"),
      connection("p-motor", 2, 4, "power", "POWER OUT", "POWER"),
      connection("control", 3, 4, "signal", "OUT", "CONTROL"),
      connection("sense", 5, 3, "signal", "SIGNAL", "IN A"),
      connection("shaft", 6, 5, "mechanical", "AXLE", "SHAFT"),
    ],
  },
  editorBefore = structuredClone(topology),
  graph = new RunAssemblyGraph(topology),
  power = new PowerNetwork(TYPES).resolve(graph, 1),
  signals = new SignalNetwork(TYPES).resolve(graph, power);
assert.equal(new PowerNetwork(TYPES).evidenceIndex(), null);
assert.equal(new SignalNetwork(TYPES).evidenceIndex(), null);
const powerEvidence = power.evidenceIndex(),
  signalEvidence = signals.evidenceIndex();
assert.equal(powerEvidence.status, "available");
assert.equal(signalEvidence.status, "available");
assert.equal(power.evidenceIndex(), powerEvidence);
assert.equal(signals.evidenceIndex(), signalEvidence);
assert.equal(Object.isFrozen(powerEvidence), true);
assert.equal(Object.isFrozen(signalEvidence), true);
assert.equal(
  power.routeWitness(
    {
      version: 1,
      kind: "power",
      source: { partId: 1, portId: "POWER" },
      target: { partId: 4, portId: "POWER" },
    },
    powerEvidence.networkResultDigest,
  ).status,
  "resolved",
);
assert.equal(
  signals.routeWitness(
    {
      version: 1,
      kind: "signal",
      source: { partId: 3, portId: "OUT" },
      target: { partId: 4, portId: "CONTROL" },
    },
    signalEvidence.networkResultDigest,
  ).status,
  "resolved",
);
assert(power.isPowered(3), "transitive controller power was not resolved");
assert(power.isPowered(4), "transitive motor power was not resolved");
assert.deepEqual(power.sourceIdsFor(4), [1]);
assert.deepEqual(signals.controllersForTarget(4), [3]);
assert.deepEqual(signals.sensorsForController(3), [5]);
assert.equal(signals.hasRoute(3, 4, "CONTROL"), true);
assert.equal(signals.hasRoute(3, 4, "MISSING"), false);
assert.equal(signals.hasSensorRoute(3, 5, "SIGNAL"), true);
assert.equal(signals.hasSensorRoute(3, 5, "MISSING"), false);
assert.deepEqual(signals.telemetry().controllerSensors, [
  {
    controllerId: 3,
    endpoints: [{ partId: 5, portIds: ["SIGNAL"] }],
  },
]);
assert.deepEqual(
  routedControllerIdsForPart({
    part: topology.parts.find((candidate) => candidate.id === 4),
    liveSignals: signals.telemetry(),
    signalNetwork: null,
    catalog: TYPES,
  }),
  [3],
  "live actuator routes diverged from signal telemetry",
);
assert.deepEqual(
  routedControllerIdsForPart({
    part: topology.parts.find((candidate) => candidate.id === 4),
    signalNetwork: signals,
    catalog: TYPES,
  }),
  [3],
  "editor actuator routes diverged from the resolved signal network",
);
const customReceiverCatalog = {
    ...TYPES,
    "custom-receiver": {
      ...TYPES.receiver,
      controlContract: "command-sink-v1",
    },
  },
  customReceiver = part("receiver", "custom-receiver");
assert.deepEqual(
  routedControllerIdsForPart({
    part: customReceiver,
    liveSignals: {
      controllerSensors: [
        {
          controllerId: "controller",
          endpoints: [{ partId: "receiver", portIds: ["SIGNAL"] }],
        },
      ],
      routes: [],
    },
    signalNetwork: null,
    catalog: customReceiverCatalog,
  }),
  ["controller"],
  "live command-receiver routes ignored the supplied catalog",
);
assert.deepEqual(
  routedControllerIdsForPart({
    part: customReceiver,
    signalNetwork: {
      controllersForSensor: () => ["controller"],
      controllersForTarget: () => assert.fail("receiver used actuator routing"),
    },
    catalog: customReceiverCatalog,
  }),
  ["controller"],
  "editor command-receiver routes ignored sensor direction",
);
assert.deepEqual(
  routedControllerIdsForPart({
    part: null,
    signalNetwork: null,
    catalog: customReceiverCatalog,
  }),
  [],
);
const initialJ = graph.part(1).energyJ;
assert.equal(initialJ, 2 * 3600 - 8);
assert.equal(power.drawPower(4, 100, 1), 100);
assert.equal(initialJ - graph.part(1).energyJ, 100);
assert.deepEqual(
  topology,
  editorBefore,
  "SI energy mutated the wire/editor input",
);

graph.failConnection("p-motor", { time: 1 });
power.resolve(graph, 1);
signals.resolve(graph, power);
const failedPowerEvidence = power.evidenceIndex();
assert.deepEqual(failedPowerEvidence.blockingConnectionIds, ["p-motor"]);
assert.equal(failedPowerEvidence.blockerEvidence, "known");
assert.notEqual(
  failedPowerEvidence.networkResultDigest,
  powerEvidence.networkResultDigest,
);
assert.equal(
  power.isPowered(4),
  false,
  "failed power link still powered motor",
);
assert.deepEqual(
  signals.controllersForTarget(4),
  [],
  "signal route stayed online to an unpowered actuator",
);
assert.equal(
  signals.routeWitness(
    {
      version: 1,
      kind: "signal",
      source: { partId: 3, portId: "OUT" },
      target: { partId: 4, portId: "CONTROL" },
    },
    signals.evidenceIndex().networkResultDigest,
  ).status,
  "invalid",
  "signal evidence contradicted runtime target availability",
);

const shortageGraph = new RunAssemblyGraph({
    parts: [
      part(
        "battery",
        "battery",
        { capacityWh: 1, maxOutputWatts: 55, dischargeEfficiency: 1 },
        { storedEnergyWh: 1 },
      ),
      part("a", "headlight"),
      part("b", "headlight"),
    ],
    connections: [
      connection("pa", "battery", "a", "power", "POWER", "POWER"),
      connection("pb", "battery", "b", "power", "POWER", "POWER"),
    ],
  }),
  shortage = new PowerNetwork(TYPES).resolve(shortageGraph, 1);
assert.equal(shortage.allocationFor("a").allocatedW, 27.5);
assert.equal(shortage.allocationFor("b").allocatedW, 27.5);
const allocationBeforeDraw = shortage.allocationFor("a");
assert.strictEqual(shortage.allocationFor("a"), allocationBeforeDraw);
shortage.drawPower("a", 55, 1);
const allocationAfterDraw = shortage.allocationFor("a");
assert.notStrictEqual(allocationAfterDraw, allocationBeforeDraw);
assert.equal(allocationBeforeDraw.deliveredW, 0);
assert.equal(allocationAfterDraw.deliveredW, 27.5);
shortage.drawPower("b", 55, 1);
assert.equal(shortage.telemetry().deliveredW, 55);
assert.equal(shortage.telemetry().requestedW, 110);
assert.equal(shortage.telemetry().allocatedW, 55);
assert.equal(shortage.telemetry().unmetW, 55);
assert.equal(shortage.telemetry().sources[0].allocatedW, 55);
assert.equal(shortageGraph.part("battery").energyJ, 3600 - 55);

const commandAssembly = {
    parts: [
      part(1, "battery", { capacityWh: 10 }, { storedEnergyWh: 10 }),
      part(2, "computer"),
      part(3, "computer"),
      part(4, "motor", { power: 0.1 }),
      part(5, "hinge", { torque: 10 }),
      part(6, "motor", { power: 0.1 }),
    ],
    connections: [
      connection("p2", 1, 2, "power", "POWER", "POWER"),
      connection("p3", 1, 3, "power", "POWER", "POWER"),
      connection("p4", 1, 4, "power", "POWER", "POWER"),
      connection("p5", 1, 5, "power", "POWER", "POWER"),
      connection("p6", 1, 6, "power", "POWER", "POWER"),
      connection("c24", 2, 4, "signal", "OUT", "CONTROL"),
      connection("c36", 3, 6, "signal", "OUT", "CONTROL"),
      connection("c25", 2, 5, "signal", "OUT", "CONTROL"),
    ],
  },
  candidates = {
    remote: [
      { targetId: 4, channel: "throttle", value: 0.25, active: true },
      { targetId: 5, channel: "steering", value: -0.4, active: true },
      { targetId: 999, channel: "throttle", value: 0.8, active: true },
    ],
    scripts: [
      {
        controllerId: 2,
        bindingId: "drive",
        targetId: 4,
        endpointPortId: "CONTROL",
        channel: "throttle",
        value: 0.7,
      },
      {
        controllerId: 3,
        bindingId: "drive",
        targetId: 6,
        endpointPortId: "CONTROL",
        channel: "throttle",
        value: 0.9,
      },
    ],
  },
  inputTraceRecorder = new InputTraceRecorder(),
  disappearingInputTraceRecorder = new InputTraceRecorder(),
  replayabilityChanges = [],
  commandSession = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
    ],
  }).start(commandAssembly, {
    catalog: TYPES,
    readCommandCandidates: () => candidates,
    inputTraceRecorder,
    failureEvidenceRecorder: {
      setReplayability: (value) => replayabilityChanges.push(value),
      recordCommandStage: () => {},
    },
  });
commandSession.stepFixed();
assert.deepEqual(commandSession.context.commandBus.read(4, "throttle"), {
  value: 0.7,
  conflict: false,
  source: "script",
});
assert.deepEqual(commandSession.context.commandBus.read(6, "throttle"), {
  value: 0.9,
  conflict: false,
  source: "script",
});
assert.equal(commandSession.context.commandBus.read(5, "steering").value, -0.4);
assert.equal(
  commandSession.context.commandBus.read(5, "throttle").source,
  "default",
);
assert.ok(
  inputTraceRecorder
    .inputsThrough(1)
    .some((input) => input.targetId === 999 && input.value === 0.8),
  "external trace omitted a syntactically valid candidate rejected by routing",
);
candidates.remote[0].active = false;
candidates.scripts.pop();
commandSession.stepFixed();
assert.deepEqual(commandSession.context.commandBus.read(4, "throttle"), {
  value: 0.7,
  conflict: false,
  source: "script",
});
assert.ok(
  inputTraceRecorder
    .inputsThrough(2)
    .some(
      (input) =>
        input.targetId === 4 &&
        input.channelId === "throttle" &&
        input.value === 0 &&
        input.tick === 2,
    ),
  "inactive momentary command retained its non-zero UI value in the trace",
);
disappearingInputTraceRecorder.recordTick(1, [
  { targetId: 4, channel: "throttle", value: 1 },
]);
disappearingInputTraceRecorder.recordTick(2, []);
assert.deepEqual(
  disappearingInputTraceRecorder.inputsThrough(2).map((entry) => ({
    tick: entry.tick,
    targetId: entry.targetId,
    channelId: entry.channelId,
    value: entry.value,
  })),
  [
    { tick: 1, targetId: 4, channelId: "throttle", value: 1 },
    { tick: 2, targetId: 4, channelId: "throttle", value: 0 },
  ],
  "disappearing external candidate did not emit a replayable release",
);
const typedTraceRecorder = new InputTraceRecorder({
  sourceId: "typed-identity-probe",
});
typedTraceRecorder.recordTick(1, [
  { targetId: 1, channel: "throttle", value: 0.2 },
  { targetId: "1", channel: "throttle", value: 0.8 },
]);
const typedTraceInputs = typedTraceRecorder.inputsThrough(1);
assert.deepEqual(
  typedTraceInputs.map(({ targetId, value }) => ({ targetId, value })),
  [
    { targetId: 1, value: 0.2 },
    { targetId: "1", value: 0.8 },
  ],
  "input trace collapsed numeric and string target authorities",
);
const restoredTypedTraceRecorder = new InputTraceRecorder({
  sourceId: "typed-identity-probe",
});
restoredTypedTraceRecorder.restore(typedTraceRecorder.capture());
assert.deepEqual(
  restoredTypedTraceRecorder.inputsThrough(1),
  typedTraceInputs,
  "input-trace checkpoint restore collapsed typed target authorities",
);
const mismatchedSourceRecorder = new InputTraceRecorder({
  sourceId: "different-source-authority",
});
assert.throws(
  () => mismatchedSourceRecorder.restore(typedTraceRecorder.capture()),
  (error) => error?.code === "INVALID_INPUT_TRACE_CHECKPOINT",
  "input-trace checkpoint silently relabeled historical source authority",
);
assert.deepEqual(
  mismatchedSourceRecorder.inputsThrough(1),
  [],
  "source-identity rejection mutated the receiving input recorder",
);
const typedTraceCheckpoint = typedTraceRecorder.capture(),
  typedTraceBeforeRejection = restoredTypedTraceRecorder.capture();
let inputTraceCheckpointGetterReads = 0;
const accessorInputTraceCheckpoint = structuredClone(typedTraceCheckpoint);
Object.defineProperty(accessorInputTraceCheckpoint, "version", {
  enumerable: true,
  get() {
    inputTraceCheckpointGetterReads++;
    return 2;
  },
});
for (const [label, candidate] of [
  ["root accessor", accessorInputTraceCheckpoint],
  [
    "custom prototype",
    Object.setPrototypeOf(structuredClone(typedTraceCheckpoint), {
      forged: true,
    }),
  ],
]) {
  assert.throws(
    () => restoredTypedTraceRecorder.restore(candidate),
    (error) => error?.code === "INVALID_INPUT_TRACE_CHECKPOINT",
    `input trace accepted ${label}`,
  );
  assert.deepEqual(
    restoredTypedTraceRecorder.capture(),
    typedTraceBeforeRejection,
    `rejected ${label} changed input-trace state`,
  );
}
const nestedAccessorInputTraceCheckpoint =
  structuredClone(typedTraceCheckpoint);
Object.defineProperty(nestedAccessorInputTraceCheckpoint.records[0], "value", {
  enumerable: true,
  get() {
    inputTraceCheckpointGetterReads++;
    return 0.2;
  },
});
assert.throws(
  () => restoredTypedTraceRecorder.restore(nestedAccessorInputTraceCheckpoint),
  (error) => error?.code === "INVALID_INPUT_TRACE_CHECKPOINT",
  "input trace accepted a nested record accessor",
);
assert.equal(
  inputTraceCheckpointGetterReads,
  0,
  "input-trace checkpoint rejection invoked an accessor",
);
let inputTraceProxyReads = 0;
const proxiedInputTraceCheckpoint = new Proxy(
  structuredClone(typedTraceCheckpoint),
  {
    get(target, key, receiver) {
      inputTraceProxyReads++;
      return Reflect.get(target, key, receiver);
    },
  },
);
assert.throws(
  () => restoredTypedTraceRecorder.restore(proxiedInputTraceCheckpoint),
  (error) => error?.code === "INVALID_INPUT_TRACE_CHECKPOINT",
  "input trace accepted Proxy checkpoint state",
);
assert.equal(
  inputTraceProxyReads,
  0,
  "input-trace Proxy rejection invoked a data getter",
);
const cyclicInputTraceCheckpoint = structuredClone(typedTraceCheckpoint);
cyclicInputTraceCheckpoint.loop = cyclicInputTraceCheckpoint;
assert.throws(
  () => restoredTypedTraceRecorder.restore(cyclicInputTraceCheckpoint),
  (error) => error?.code === "INVALID_INPUT_TRACE_CHECKPOINT",
  "input trace accepted cyclic checkpoint state",
);
assert.deepEqual(
  restoredTypedTraceRecorder.capture(),
  typedTraceBeforeRejection,
  "hostile input-trace rejection changed release-command authority",
);
restoredTypedTraceRecorder.recordTick(2, []);
assert.deepEqual(
  restoredTypedTraceRecorder.inputsThrough(2).slice(-2),
  [
    {
      tick: 2,
      sequence: 2,
      sourceId: "typed-identity-probe",
      targetId: 1,
      channelId: "throttle",
      value: 0,
    },
    {
      tick: 2,
      sequence: 3,
      sourceId: "typed-identity-probe",
      targetId: "1",
      channelId: "throttle",
      value: 0,
    },
  ],
  "rejected input-trace checkpoint changed subsequent release commands",
);
const typedTraceWire = {
    format: "simulacrum-input-trace",
    version: 3,
    sourceId: "typed-identity-probe",
    runConfigurationFingerprint: `sim-sha256-${"0".repeat(64)}`,
    startTick: 1,
    endTick: 1,
    inputs: typedTraceInputs,
  },
  typedTracePlayback = new InputTracePlayer(typedTraceWire, {
    targetIds: ["1", 1],
  }).readCommandCandidates(1).remote;
assert.deepEqual(
  typedTracePlayback.map(({ targetId, value }) => ({ targetId, value })),
  [
    { targetId: 1, value: 0.2 },
    { targetId: "1", value: 0.8 },
  ],
  "input-trace playback made typed target identity depend on targetIds order",
);
candidates.hardware = [{ value: 1 }];
commandSession.stepFixed();
assert.deepEqual(replayabilityChanges.at(-1), {
  supported: false,
  reasonCode: "UNREGISTERED_EXTERNAL_INPUT_SOURCE",
});
delete candidates.hardware;
commandSession.context.runGraph.failConnection("c24");
commandSession.stepFixed();
assert.equal(
  commandSession.context.commandBus.read(4, "throttle").value,
  0,
  "failed controller route still accepted a script or remote command",
);
commandSession.dispose();

const sensorAssembly = {
    parts: [
      part(1, "plate"),
      part(2, "navsensor"),
      part(
        3,
        "computer",
        {},
        {
          controllerBindings: [
            {
              id: "altitude",
              direction: "input",
              endpointPartId: 2,
              endpointPortId: "SIGNAL",
              reading: "altitude",
            },
            {
              id: "speed",
              direction: "input",
              endpointPartId: 2,
              endpointPortId: "SIGNAL",
              reading: "speed",
            },
          ],
        },
      ),
      part(4, "plate"),
      part(5, "navsensor"),
      part(
        6,
        "computer",
        {},
        {
          controllerBindings: [
            {
              id: "altitude",
              direction: "input",
              endpointPartId: 5,
              endpointPortId: "SIGNAL",
              reading: "altitude",
            },
            {
              id: "speed",
              direction: "input",
              endpointPartId: 5,
              endpointPortId: "SIGNAL",
              reading: "speed",
            },
          ],
        },
      ),
    ],
    connections: [
      connection("mount-a", 1, 2, "mechanical", "TOP", "MOUNT"),
      connection("mount-b", 4, 5, "mechanical", "TOP", "MOUNT"),
      connection("signal-a", 2, 3, "signal", "SIGNAL", "IN A"),
      connection("signal-b", 5, 6, "signal", "SIGNAL", "IN A"),
    ],
  },
  registry = new BodyRegistry(sensorAssembly, TYPES);
registry.registerBody("static", [1, 2], {
  pose: { position: { x: 0, y: 5, z: 0 }, quaternion: { w: 1 } },
});
registry.registerBody("moving", [4, 5], {
  pose: { position: { x: 20, y: 50, z: 0 }, quaternion: { w: 1 } },
});
registry.updateKinematics("static", { velocity: { x: 0, y: 0, z: 0 } }, 1);
registry.updateKinematics("moving", { velocity: { x: 10, y: 0, z: 0 } }, 1);
const sensorBank = new ControllerSensorBank(),
  readings = sensorBank.capture({
    parts: sensorAssembly.parts,
    connections: sensorAssembly.connections,
    bodies: registry.snapshot(),
    signals: {
      controllerSensors: [
        {
          controllerId: 3,
          endpoints: [{ partId: 2, portIds: ["SIGNAL"] }],
        },
        {
          controllerId: 6,
          endpoints: [{ partId: 5, portIds: ["SIGNAL"] }],
        },
      ],
    },
    fixedDt: 1,
  });
assert.equal(readings[3].speed, 0);
assert.equal(readings[3].altitude, 5);
assert.equal(readings[6].speed, 10);
assert.equal(readings[6].altitude, 50);
registry.setDetached("moving", true);
const detachedReadings = sensorBank.capture({
  parts: sensorAssembly.parts,
  connections: sensorAssembly.connections,
  bodies: registry.snapshot(),
  signals: {
    controllerSensors: [
      {
        controllerId: 6,
        endpoints: [{ partId: 5, portIds: ["SIGNAL"] }],
      },
    ],
  },
  fixedDt: 1,
});
assert.equal(detachedReadings[6].__bindings[0].bound, false);
assert.equal(detachedReadings[6].speed, 0);

const remoteParts = [part(7, "headlight"), part(3, "computer")],
  binding = (control, powered = true, routed = true) =>
    readRemoteControlBinding({
      control,
      parts: remoteParts,
      isPowered: () => powered,
      routedControllerIds: () => (routed ? [3] : []),
      commandChannels: (candidate) => actuatorChannels(candidate),
    });
for (const [control, expected, powered, routed] of [
  [{ channel: "lights", targetId: null }, "unbound", true, true],
  [{ channel: "lights", targetId: 99 }, "missing-target", true, true],
  [{ channel: "lights", targetId: 3 }, "incompatible-target", true, true],
  [{ channel: "lights", targetId: 7 }, "unpowered", false, true],
  [{ channel: "lights", targetId: 7 }, "no-signal-route", true, false],
  [{ channel: "lights", targetId: 7 }, "online", true, true],
]) {
  const before = structuredClone(control),
    result = binding(control, powered, routed);
  assert.equal(result.status, expected);
  assert.equal(result.online, expected === "online");
  assert.deepEqual(control, before, "binding diagnostics mutated the control");
}
assert.deepEqual(
  binding({ channel: "lights", targetId: 7 }).compatiblePartIds,
  [7],
);
assert.equal(
  readRemoteControlBinding({
    control: { channel: "lights", targetId: 7 },
    parts: remoteParts,
    commandChannels: (candidate) => actuatorChannels(candidate),
  }).status,
  "unpowered",
);
assert.equal(
  readRemoteControlBinding({
    control: { channel: "throttle", targetId: 8 },
    parts: [part(8, "rocket")],
    commandChannels: (candidate) => actuatorChannels(candidate),
  }).status,
  "no-signal-route",
);

assert.equal(
  assertBlueprintAcquisition(BlueprintAcquisition.FILE_IMPORT),
  BlueprintAcquisition.FILE_IMPORT,
);
assert.throws(
  () => assertBlueprintAcquisition(undefined),
  /explicit acquisition boundary/,
);
const portableProfiles = {
    rig: {
      design: {
        title: "Rig",
        style: "compact-grid",
        accent: "#70e0c4",
      },
      controls: [
        {
          id: "range",
          label: "Range",
          channel: "throttle",
          type: "range",
          targetId: null,
          defaultValue: 0,
          hotkey: null,
          min: -1,
          max: 1,
          step: 0.1,
        },
        {
          id: "toggle",
          label: "Toggle",
          channel: "lights",
          type: "toggle",
          targetId: null,
          defaultValue: 0,
          hotkey: null,
        },
        {
          id: "hold",
          label: "Hold",
          channel: "brake",
          type: "hold",
          targetId: null,
          defaultValue: 0,
          hotkey: null,
        },
        {
          id: "pulse",
          label: "Pulse",
          channel: "launch",
          type: "pulse",
          targetId: null,
          defaultValue: 0,
          hotkey: null,
        },
      ],
      extensions: { "simulacrum.test": "profile" },
    },
  },
  runtimeControls = runtimeControlsFromProfiles(portableProfiles, {
    rig: { range: 0.7, toggle: 1 },
  });
runtimeControls.rig.find((control) => control.id === "hold").value = 1;
runtimeControls.rig.find((control) => control.id === "pulse").value = 1;
assert.deepEqual(
  durableRemoteControlState(portableProfiles, runtimeControls),
  { rig: { range: 0.7, toggle: 1 } },
  "momentary activation leaked into workspace state",
);
const editorState = {
  remoteProfiles: structuredClone(portableProfiles),
  remoteControls: runtimeControls,
  controllerLayouts: {},
};
syncRemoteProfileDefinitions(editorState);
assert.equal(editorState.remoteProfiles.rig.controls[0].defaultValue, 0);
assert.equal(editorState.remoteProfiles.rig.controls[1].defaultValue, 0);
assert.equal(
  Object.hasOwn(editorState.remoteProfiles.rig.controls[0], "value"),
  false,
  "runtime control value contaminated the portable definition",
);
assert.deepEqual(remoteProfilesFromTemplates(), {});
const templateProfiles = remoteProfilesFromTemplates({
  cart: [
    {
      id: "throttle.control",
      label: "Throttle",
      channel: "throttle",
      type: "range",
      targetId: 4,
      defaultValue: 0.25,
      hotkey: "KeyW",
      min: -1,
      max: 1,
      step: 0.05,
    },
  ],
  rig: [
    {
      label: "",
      channel: " bad channel ",
      type: "toggle",
      targetId: "not-an-id",
      value: 1,
    },
    { type: "hold" },
  ],
});
assert.equal(templateProfiles.cart.design.style, "compact-grid");
assert.equal(templateProfiles.cart.design.title, "Direct Control");
assert.equal(templateProfiles.cart.controls[0].id, "throttle.control");
assert.equal(templateProfiles.cart.controls[0].targetId, 4);
assert.equal(templateProfiles.cart.controls[0].hotkey, "KeyW");
assert.deepEqual(
  {
    min: templateProfiles.cart.controls[0].min,
    max: templateProfiles.cart.controls[0].max,
    step: templateProfiles.cart.controls[0].step,
  },
  { min: -1, max: 1, step: 0.05 },
);
assert.equal(templateProfiles.rig.design.style, "compact-grid");
assert.equal(templateProfiles.rig.design.title, "Direct Control");
assert.equal(templateProfiles.rig.controls[0].id, "rig-1");
assert.equal(templateProfiles.rig.controls[0].label, "Untitled control");
assert.equal(templateProfiles.rig.controls[0].channel, "bad-channel");
assert.equal(templateProfiles.rig.controls[0].targetId, null);
assert.equal(templateProfiles.rig.controls[0].defaultValue, 1);
assert.equal(templateProfiles.rig.controls[1].defaultValue, 0);
assert.equal(templateProfiles.rig.controls[1].channel, "aux-2");
assert.equal(Object.hasOwn(templateProfiles.rig.controls[0], "min"), false);
assert.equal(
  remoteProfilesFromTemplates({
    edge: [{ channel: "---trim-me---", type: "hold" }],
  }).edge.controls[0].channel,
  "trim-me",
);
assert.deepEqual(runtimeControlsFromProfiles(), {});
assert.equal(runtimeControlsFromProfiles(templateProfiles).cart[0].value, 0.25);
assert.equal(
  runtimeControlsFromProfiles(templateProfiles).cart[0].active,
  false,
);
const incompleteRuntime = structuredClone(runtimeControls);
incompleteRuntime.rig = incompleteRuntime.rig.filter(
  (control) => control.id !== "range",
);
incompleteRuntime.rig.find((control) => control.id === "toggle").value = NaN;
assert.deepEqual(
  durableRemoteControlState(portableProfiles, incompleteRuntime),
  {
    rig: { range: 0 },
  },
);
assert.deepEqual(durableRemoteControlState(), {});
assert.deepEqual(
  durableRemoteControlState(
    { empty: { controls: [portableProfiles.rig.controls[2]] } },
    {},
  ),
  {},
);
const layoutOnly = {
  remoteControls: {
    test: [
      {
        label: "",
        channel: "",
        type: "toggle",
        targetId: "bad",
        hotkey: "KeyT",
        extensions: { "simulacrum.test": true },
      },
    ],
  },
  controllerLayouts: {
    test: {
      title: "Test",
      style: "compact-grid",
      accent: "#ffffff",
    },
  },
};
syncRemoteProfileDefinitions(layoutOnly);
assert.equal(layoutOnly.remoteProfiles.test.design.title, "Test");
assert.equal(layoutOnly.remoteProfiles.test.controls[0].id, "test-1");
assert.equal(
  layoutOnly.remoteProfiles.test.controls[0].label,
  "Untitled control",
);
assert.equal(layoutOnly.remoteProfiles.test.controls[0].channel, "aux-1");
assert.equal(layoutOnly.remoteProfiles.test.controls[0].targetId, null);
assert.equal(layoutOnly.remoteProfiles.test.controls[0].hotkey, "KeyT");
assert.equal(layoutOnly.remoteProfiles.test.controls[0].defaultValue, 0);
assert.equal(
  Object.hasOwn(layoutOnly.remoteProfiles.test.controls[0], "min"),
  false,
);
assert.deepEqual(layoutOnly.remoteProfiles.test.controls[0].extensions, {
  "simulacrum.test": true,
});
assert.equal(editorState.remoteProfiles.rig.controls[0].min, -1);
assert.equal(
  Object.hasOwn(editorState.remoteProfiles.rig.controls[1], "min"),
  false,
);
assert.equal(
  nextRemoteControlId("rig", [{ id: "x" }, { id: "rig-3" }]),
  "rig-4",
);

const expeditionProfile = {
    design: {
      title: "Expedition machine",
      style: "drive-pad",
      accent: "#70e0c4",
    },
    controls: [
      {
        id: "traction",
        label: "Traction",
        channel: "command",
        type: "range",
        targetId: 31,
        defaultValue: 0,
        min: -1,
        max: 1,
        step: 0.05,
        hotkey: null,
      },
      {
        id: "steer",
        label: "Steer",
        channel: "command",
        type: "range",
        targetId: 32,
        defaultValue: 0,
        min: -1,
        max: 1,
        step: 0.05,
        hotkey: null,
      },
      {
        id: "lamp",
        label: "Lamp",
        channel: "command",
        type: "toggle",
        targetId: 33,
        defaultValue: 0,
        hotkey: null,
      },
    ],
    actionBindings: {
      forward: {
        controlId: "traction",
        pressedValue: 0.75,
        releasedValue: 0,
      },
      reverse: {
        controlId: "traction",
        pressedValue: -0.5,
        releasedValue: 0,
      },
      left: {
        controlId: "steer",
        pressedValue: -0.4,
        releasedValue: 0,
      },
      right: {
        controlId: "steer",
        pressedValue: 0.6,
        releasedValue: 0,
      },
      lights: { controlId: "lamp" },
    },
  },
  expeditionControls = runtimeControlsFromProfiles({
    expedition: expeditionProfile,
  }).expedition;
assert.equal(validateRemoteActionBindings(expeditionProfile), true);
assert.deepEqual(
  remoteActionTargetPartIds(expeditionProfile, expeditionControls),
  [31, 32, 33],
  "semantic actions did not expose their exact persistent target anchors",
);
assert.deepEqual(
  {
    targetId: resolveRemoteAction(
      expeditionProfile,
      expeditionControls,
      "forward",
      true,
    ).control.targetId,
    value: resolveRemoteAction(
      expeditionProfile,
      expeditionControls,
      "forward",
      true,
    ).value,
  },
  { targetId: 31, value: 0.75 },
  "semantic input depended on a cart profile name or lost its exact target",
);
assert.deepEqual(
  resolveRemoteActionState(expeditionProfile, expeditionControls, {
    reverse: true,
    left: true,
  }).map(({ control, value }) => ({ id: control.id, value })),
  [
    { id: "traction", value: -0.5 },
    { id: "steer", value: -0.4 },
  ],
  "independent semantic axes did not preserve their authored signs",
);
assert.equal(
  Object.isFrozen(expeditionControls[0]),
  false,
  "a pure action lookup froze mutable runtime controls",
);
expeditionControls[0].value = 0.25;
assert.equal(
  resolveRemoteAction(expeditionProfile, expeditionControls, "lights", true)
    .control.targetId,
  33,
);
assert.equal(
  resolveRemoteAction(expeditionProfile, expeditionControls, "brake", true)
    .status,
  "unsupported",
);
for (const invalid of [
  {
    ...structuredClone(expeditionProfile),
    actionBindings: {
      forward: {
        controlId: "missing",
        pressedValue: 1,
        releasedValue: 0,
      },
    },
  },
  {
    ...structuredClone(expeditionProfile),
    actionBindings: { lights: { controlId: "traction" } },
  },
  {
    ...structuredClone(expeditionProfile),
    actionBindings: {
      forward: {
        controlId: "traction",
        pressedValue: 2,
        releasedValue: 0,
      },
    },
  },
  {
    ...structuredClone(expeditionProfile),
    actionBindings: {
      forward: {
        controlId: "traction",
        pressedValue: 1,
        releasedValue: 0,
      },
      brake: {
        controlId: "traction",
        pressedValue: 1,
        releasedValue: 0,
      },
    },
  },
])
  assert.throws(
    () => validateRemoteActionBindings(invalid),
    /Remote action|requires|must fit|owns unrelated actions/,
  );

const bus = new CommandBus();
assert.equal(bus.writeRemote(1, "throttle", 0.3), true);
assert.deepEqual(bus.read(1, "throttle"), {
  value: 0.3,
  conflict: false,
  source: "remote",
});
assert.equal(bus.writeRemote(null, "throttle", 1), false);
assert.equal(bus.writeRemote(1, "", 1), false);
assert.equal(bus.writeRemote(1, "throttle", Infinity), false);
assert.equal(bus.writeRemote({}, "throttle", 1), false);
assert.equal(bus.writeScript(null, "drive", 1, "throttle", 1), false);
assert.equal(bus.writeScript(1, null, 2, "throttle", 1), false);
assert.equal(bus.writeScript(1, "drive", null, "throttle", 1), false);
assert.equal(bus.writeScript(1, "drive", 2, "", 1), false);
assert.equal(bus.writeScript(1, "drive", 2, "throttle", Infinity), false);
assert.equal(bus.writeScript(1, "drive", {}, "throttle", 1), false);
assert.equal(bus.writeScript(1, "drive", 2, "throttle", 0.4), true);
assert.equal(bus.writeScript(1, "drive", 2, "throttle", 0.6), true);
assert.equal(bus.writeScript(2, "drive", 2, "throttle", 0.8), false);
assert.equal(bus.read(2, "throttle", -1).value, -1);
bus.reject({ targetId: 99 }, "test rejection");
assert.equal(bus.entries().rejections[0].reason, "test rejection");
bus.clearTick();
assert.deepEqual(bus.read(2, "throttle", 0.2), {
  value: 0.2,
  conflict: false,
  source: "default",
});

const mixedRemoteIdentityBus = new CommandBus();
assert.equal(mixedRemoteIdentityBus.writeRemote(1, "throttle", 0.2), true);
assert.equal(mixedRemoteIdentityBus.writeRemote("1", "throttle", 0.8), true);
assert.equal(mixedRemoteIdentityBus.read(1, "throttle").value, 0.2);
assert.equal(mixedRemoteIdentityBus.read("1", "throttle").value, 0.8);
assert.equal(mixedRemoteIdentityBus.entries().remote.length, 2);
const mixedScriptIdentityBus = new CommandBus();
assert.equal(
  mixedScriptIdentityBus.writeScript(
    "controller-a",
    "drive",
    1,
    "throttle",
    0.2,
  ),
  true,
);
assert.equal(
  mixedScriptIdentityBus.writeScript(
    "controller-b",
    "drive",
    "1",
    "throttle",
    0.8,
  ),
  true,
);
assert.equal(mixedScriptIdentityBus.read(1, "throttle").value, 0.2);
assert.equal(mixedScriptIdentityBus.read("1", "throttle").value, 0.8);
const mixedIdentityCheckpoint = mixedScriptIdentityBus.exportState(),
  mixedIdentityRestored = new CommandBus();
mixedIdentityRestored.importState(mixedIdentityCheckpoint);
assert.deepEqual(
  mixedIdentityRestored.entries(),
  mixedScriptIdentityBus.entries(),
);

const checkpointBus = new CommandBus();
assert.equal(checkpointBus.writeRemote(4, "throttle", 0.25), true);
assert.equal(
  checkpointBus.writeScript(2, "joint", 5, "joint_target", 0.75),
  true,
);
assert.equal(
  checkpointBus.writeScript(3, "joint", 5, "joint_target", -0.75),
  false,
);
checkpointBus.reject({ targetId: 99, channel: "throttle" }, "unrouted");
const checkpointState = structuredClone(checkpointBus.exportState());
assert.deepEqual(checkpointState, {
  remote: [{ targetId: 4, channel: "throttle", value: 0.25 }],
  script: [
    {
      controllerId: 2,
      bindingId: "joint",
      targetId: 5,
      channel: "joint_target",
      value: 0.75,
    },
  ],
  conflicts: [CommandBus.key(5, "joint_target")],
  rejections: [{ targetId: 99, channel: "throttle", reason: "unrouted" }],
});
checkpointState.remote[0].value = 1;
assert.equal(checkpointBus.read(4, "throttle").value, 0.25);

const restoredBus = new CommandBus();
restoredBus.writeRemote(88, "lights", 1);
restoredBus.importState(checkpointBus.exportState());
assert.deepEqual(restoredBus.entries(), checkpointBus.entries());
assert.deepEqual(restoredBus.read(5, "joint_target", -1), {
  value: -1,
  conflict: true,
  source: "none",
});
assert.throws(
  () => restoredBus.importState(null),
  (error) => error?.code === "INVALID_COMMAND_BUS_CHECKPOINT_PLAIN_DATA",
);
const invalidRemoteCheckpoint = structuredClone(checkpointBus.exportState());
invalidRemoteCheckpoint.remote[0].targetId = null;
assert.throws(
  () => restoredBus.importState(JSON.stringify(invalidRemoteCheckpoint)),
  /invalid remote data/,
);
const invalidScriptCheckpoint = structuredClone(checkpointBus.exportState());
invalidScriptCheckpoint.script[0].controllerId = null;
assert.throws(
  () => restoredBus.importState(JSON.stringify(invalidScriptCheckpoint)),
  /invalid script data/,
);
const validEmptyCommandCheckpoint = {
    remote: [],
    script: [],
    conflicts: [],
    rejections: [],
  },
  assertInvalidCommandCheckpoint = (candidate, pattern, label) =>
    assert.throws(
      () =>
        restoredBus.validateState(
          typeof candidate === "string" ? candidate : JSON.stringify(candidate),
        ),
      pattern,
      label,
    );
for (const [index, candidate] of [
  [],
  {},
  { ...validEmptyCommandCheckpoint, extra: true },
  { remote: [], script: [], conflicts: [] },
  { ...validEmptyCommandCheckpoint, remote: {} },
  { ...validEmptyCommandCheckpoint, script: {} },
  { ...validEmptyCommandCheckpoint, conflicts: {} },
  { ...validEmptyCommandCheckpoint, rejections: {} },
  { ...validEmptyCommandCheckpoint, conflicts: ["duplicate", "duplicate"] },
  { ...validEmptyCommandCheckpoint, conflicts: [1] },
  '{"remote":[],"script":[],"conflicts":[],"rejections":[{"value":1e999}]}',
].entries())
  assertInvalidCommandCheckpoint(
    candidate,
    /object|invalid arrays/,
    `command checkpoint envelope mutant ${index} was accepted`,
  );
const validRemote = { targetId: 4, channel: "throttle", value: 0.25 };
for (const [index, entry] of [
  { ...validRemote, extra: true },
  { channel: "throttle", value: 0.25 },
  { ...validRemote, targetId: null },
  { ...validRemote, targetId: {} },
  { ...validRemote, channel: 1 },
  { ...validRemote, channel: "" },
  { ...validRemote, value: "0.25" },
].entries())
  assertInvalidCommandCheckpoint(
    { ...validEmptyCommandCheckpoint, remote: [entry] },
    /invalid remote data/,
    `command checkpoint remote mutant ${index} was accepted`,
  );
assertInvalidCommandCheckpoint(
  '{"remote":[{"targetId":4,"channel":"throttle","value":1e999}],"script":[],"conflicts":[],"rejections":[]}',
  /invalid remote data/,
  "command checkpoint accepted nonfinite remote value",
);
assertInvalidCommandCheckpoint(
  {
    ...validEmptyCommandCheckpoint,
    remote: [validRemote, { ...validRemote }],
  },
  /invalid remote data/,
  "command checkpoint accepted duplicate remote authority",
);
const validScript = {
  controllerId: 2,
  bindingId: "joint",
  targetId: 5,
  channel: "joint_target",
  value: 0.75,
};
for (const [index, entry] of [
  { ...validScript, extra: true },
  { bindingId: "joint", targetId: 5, channel: "joint_target", value: 0.75 },
  { ...validScript, controllerId: null },
  { ...validScript, bindingId: 1 },
  { ...validScript, bindingId: "" },
  { ...validScript, targetId: null },
  { ...validScript, targetId: {} },
  { ...validScript, channel: 1 },
  { ...validScript, channel: "" },
  { ...validScript, value: "0.75" },
].entries())
  assertInvalidCommandCheckpoint(
    { ...validEmptyCommandCheckpoint, script: [entry] },
    /invalid script data/,
    `command checkpoint script mutant ${index} was accepted`,
  );
assertInvalidCommandCheckpoint(
  '{"remote":[],"script":[{"controllerId":2,"bindingId":"joint","targetId":5,"channel":"joint_target","value":1e999}],"conflicts":[],"rejections":[]}',
  /invalid script data/,
  "command checkpoint accepted nonfinite script value",
);
assertInvalidCommandCheckpoint(
  {
    ...validEmptyCommandCheckpoint,
    script: [validScript, { ...validScript }],
  },
  /invalid script data/,
  "command checkpoint accepted duplicate script authority",
);
assertInvalidCommandCheckpoint(
  {
    ...validEmptyCommandCheckpoint,
    conflicts: [CommandBus.key(5, "joint_target")],
  },
  /unknown conflicts/,
  "command checkpoint accepted a conflict without a script owner",
);
restoredBus.importState(
  JSON.stringify({
    remote: [],
    script: [],
    conflicts: [],
    rejections: [],
  }),
);
assert.deepEqual(restoredBus.entries(), {
  remote: [],
  script: [],
  conflicts: [],
  rejections: [],
});
let commandCheckpointGetterReads = 0;
const accessorCommandCheckpoint = structuredClone(checkpointBus.exportState());
Object.defineProperty(accessorCommandCheckpoint.remote[0], "targetId", {
  enumerable: true,
  get() {
    commandCheckpointGetterReads++;
    return 4;
  },
});
assert.throws(
  () => restoredBus.validateState(accessorCommandCheckpoint),
  (error) => error?.code === "INVALID_COMMAND_BUS_CHECKPOINT_PLAIN_DATA",
  "command checkpoint accepted an executable accessor",
);
assert.equal(
  commandCheckpointGetterReads,
  0,
  "command checkpoint rejection invoked an accessor",
);
const inheritedCommandCheckpoint = structuredClone(checkpointBus.exportState());
Object.setPrototypeOf(inheritedCommandCheckpoint, { forged: true });
assert.throws(
  () => restoredBus.validateState(inheritedCommandCheckpoint),
  (error) => error?.code === "INVALID_COMMAND_BUS_CHECKPOINT_PLAIN_DATA",
  "command checkpoint accepted a custom prototype",
);
let commandCheckpointProxyReads = 0;
const proxiedCommandCheckpoint = new Proxy(checkpointBus.exportState(), {
  get(target, key, receiver) {
    commandCheckpointProxyReads++;
    return Reflect.get(target, key, receiver);
  },
});
assert.throws(
  () => restoredBus.validateState(proxiedCommandCheckpoint),
  (error) => error?.code === "INVALID_COMMAND_BUS_CHECKPOINT_PLAIN_DATA",
  "command checkpoint accepted Proxy state",
);
assert.equal(
  commandCheckpointProxyReads,
  0,
  "command checkpoint Proxy rejection invoked a data getter",
);

const isolatedGraph = new RunAssemblyGraph({
  parts: [
    part(1, "battery", { capacityWh: 1 }, { storedEnergyWh: 1 }),
    part(2, "computer"),
    part(3, "motor"),
    part(4, "plate"),
    part(5, "computer"),
    part(6, "computer"),
  ],
  connections: [connection("failed", 1, 5, "power", "POWER", "POWER")],
});
isolatedGraph.failConnection("failed");
const isolatedPower = new PowerNetwork(TYPES).resolve(isolatedGraph, 0);
assert.equal(isolatedPower.isPowered(2), false);
assert.equal(isolatedPower.isPowered(3), false);
assert.equal(isolatedPower.isPowered(5), false);
assert.equal(isolatedPower.isPowered(6), false);
assert.equal(isolatedPower.allocationFor(2).allocatedW, 0);
assert.equal(isolatedPower.allocationFor(4), null);
assert.deepEqual(isolatedPower.sourceIdsFor(99), []);
assert.equal(isolatedPower.drawPower(99, 10, 1), 0);
assert.equal(isolatedPower.drawPower(2, 0, 1), 0);

const zeroSourceGraph = new RunAssemblyGraph({
    parts: [
      part(1, "battery", { capacityWh: 1 }, { storedEnergyWh: 0 }),
      part(2, "computer"),
      { ...part(3, "plate"), energyJ: 3600 },
      part(4, "headlight"),
    ],
    connections: [connection("zero", 1, 2, "power", "POWER", "POWER")],
  }),
  zeroSource = new PowerNetwork(TYPES).resolve(zeroSourceGraph, 1);
assert.equal(zeroSource.isPowered(2), false);
assert.equal(zeroSource.isPowered(4), false);

const subminimumGraph = new RunAssemblyGraph({
    parts: [
      part(
        1,
        "battery",
        { capacityWh: 1, maxOutputWatts: 0.5 },
        { storedEnergyWh: 1 },
      ),
      part(2, "computer"),
    ],
    connections: [connection("p", 1, 2, "power", "POWER", "POWER")],
  }),
  subminimum = new PowerNetwork(TYPES).resolve(subminimumGraph, 1);
assert.equal(subminimum.allocationFor(2).allocatedW, 0.5);
assert.equal(subminimum.isPowered(2), false);

const multiSourceGraph = new RunAssemblyGraph({
    parts: [
      part(
        "a",
        "battery",
        { capacityWh: 1, maxOutputWatts: 30, dischargeEfficiency: 1 },
        { storedEnergyWh: 1 },
      ),
      part("lamp", "headlight"),
    ],
    connections: [connection("a-lamp", "a", "lamp", "power", "POWER", "POWER")],
  }),
  multiSource = new PowerNetwork(TYPES).resolve(multiSourceGraph, 1);
assert.deepEqual(multiSource.sourceIdsFor("lamp"), ["a"]);
assert.equal(multiSource.allocationFor("lamp").allocatedW, 30);
assert.equal(multiSource.drawPower("lamp", 100, 1), 30);
assert.equal(multiSource.drawPower("lamp", 100, 1), 0);
assert.equal(multiSourceGraph.part("a").energyJ, 3600 - 30);
assert.equal(multiSource.telemetry().sources[0].deliveredW, 30);
assert.equal(multiSource.telemetry().sources[0].energyDrawJ, 30);

const directSignalGraph = new RunAssemblyGraph({
    parts: [
      part(1, "battery", { capacityWh: 3 }, { storedEnergyWh: 3 }),
      part(2, "computer"),
      part(3, "computer"),
      part(4, "motor"),
      part(5, "sensor"),
    ],
    connections: [
      connection("p2", 1, 2, "power", "POWER", "POWER"),
      connection("p3", 1, 3, "power", "POWER", "POWER"),
      connection("p4", 1, 4, "power", "POWER", "POWER"),
      connection("hop-a", 2, 3, "signal", "OUT", "IN A"),
      connection("hop-b", 3, 4, "signal", "OUT", "CONTROL"),
      connection("reverse", 2, 5, "signal", "IN B", "SIGNAL"),
    ],
  }),
  directPower = new PowerNetwork(TYPES).resolve(directSignalGraph),
  directSignals = new SignalNetwork(TYPES).resolve(
    directSignalGraph,
    directPower,
  );
assert.equal(directSignals.hasRoute(2, 4), false);
assert.equal(directSignals.hasRoute(3, 4), true);
assert.deepEqual(directSignals.targetsForController(2), [2]);
assert.deepEqual(directSignals.targetsForController(3), [3, 4]);
assert.deepEqual(directSignals.sensorsForController(2), [5]);
assert.deepEqual(directSignals.sensorsForController(3), []);
assert.deepEqual(directSignals.controllersForTarget(999), []);
assert.deepEqual(directSignals.targetsForController(999), []);

const invalidSignalGraph = new RunAssemblyGraph({
  parts: [
    part(1, "battery", { capacityWh: 3 }, { storedEnergyWh: 3 }),
    part(2, "computer"),
    part(3, "motor"),
    part(4, "motor"),
    part(5, "motor"),
    part(6, "imu"),
  ],
  connections: [
    connection("pc", 1, 2, "power", "POWER", "POWER"),
    connection("p3", 1, 3, "power", "POWER", "POWER"),
    connection("failed", 2, 3, "signal", "OUT", "CONTROL"),
    connection("unpowered-sensor", 6, 2, "signal", "SIGNAL", "IN B"),
  ],
});
invalidSignalGraph.failConnection("failed");
const invalidSignalPower = new PowerNetwork(TYPES).resolve(invalidSignalGraph),
  invalidSignals = new SignalNetwork(TYPES).resolve(
    invalidSignalGraph,
    invalidSignalPower,
  );
assert.deepEqual(invalidSignals.targetsForController(2), [2]);
assert.deepEqual(invalidSignals.controllersForTarget(3), []);
assert.deepEqual(invalidSignals.controllersForTarget(4), []);
assert.deepEqual(invalidSignals.controllersForTarget(5), []);
assert.deepEqual(invalidSignals.sensorsForController(2), []);
assert.deepEqual(invalidSignals.evidenceIndex().blockingConnectionIds, [
  "failed",
]);

const edgeCandidates = {
    remote: [
      { targetId: 4, channel: "throttle", value: 4, active: true },
      { targetId: 404, channel: "throttle", value: 1, active: true },
      { targetId: 4, channel: "nope", value: 1, active: true },
      { targetId: 5, channel: "lights", value: 1, active: true },
      { targetId: 4, channel: "brake", value: 1, active: false },
      { targetId: 7, channel: "joint_target", value: 0.5, active: true },
    ],
    scripts: [],
  },
  edgeAssembly = {
    parts: [
      part(
        1,
        "battery",
        { capacityWh: 5, maxOutputWatts: 20_000 },
        { storedEnergyWh: 5 },
      ),
      part(2, "computer"),
      part(4, "motor"),
      part(5, "headlight"),
      part(6, "motor"),
      part(7, "hinge"),
      part(8, "hinge"),
      part(9, "rocket"),
    ],
    connections: [
      connection("pc", 1, 2, "power", "POWER", "POWER"),
      connection("pm1", 1, 4, "power", "POWER", "POWER"),
      connection("pl", 1, 5, "power", "POWER", "POWER"),
      connection("pm2", 1, 6, "power", "POWER", "POWER"),
      connection("ph1", 1, 7, "power", "POWER", "POWER"),
      connection("ph2", 1, 8, "power", "POWER", "POWER"),
      connection("cm1", 2, 4, "signal", "OUT", "CONTROL"),
      connection("cm2", 2, 6, "signal", "OUT", "CONTROL"),
      connection("ch1", 2, 7, "signal", "OUT", "CONTROL"),
      connection("ch2", 2, 8, "signal", "OUT", "CONTROL"),
      connection("cr", 2, 9, "signal", "OUT", "SIGNAL"),
    ],
  },
  edgeSession = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
    ],
  }).start(edgeAssembly, {
    catalog: TYPES,
    readCommandCandidates: () => edgeCandidates,
  });
edgeSession.stepFixed();
assert.equal(edgeSession.context.commandBus.read(4, "throttle").value, 1);
assert.equal(edgeSession.context.commandBus.read(6, "throttle").value, 1);
assert.equal(
  edgeSession.context.commandBus.read(9, "throttle").source,
  "default",
);
assert.equal(edgeSession.context.commandBus.read(7, "joint_target").value, 0.5);
assert.equal(
  edgeSession.context.commandBus.read(8, "joint_target").source,
  "default",
);
assert.equal(edgeSession.context.commandBus.read(4, "brake").source, "default");
assert.equal(edgeSession.telemetry().systems.commands.rejections.length, 3);
edgeCandidates.scripts = [
  {
    controllerId: 2,
    bindingId: "drive.front",
    targetId: 4,
    endpointPortId: "CONTROL",
    channel: "throttle",
    value: -2,
  },
  {
    controllerId: 2,
    bindingId: "bad.channel",
    targetId: 4,
    endpointPortId: "CONTROL",
    channel: "nope",
    value: 1,
  },
  {
    controllerId: 999,
    bindingId: "drive",
    targetId: 4,
    endpointPortId: "CONTROL",
    channel: "throttle",
    value: 1,
  },
];
edgeSession.stepFixed();
assert.equal(edgeSession.context.commandBus.read(4, "throttle").value, -1);
assert.equal(
  edgeSession.context.commandBus.read(6, "throttle").value,
  1,
  "endpoint-addressed script output fanned out to a sibling motor",
);
assert.equal(
  edgeSession.context.commandBus.read(5, "lights").source,
  "default",
);
assert.equal(edgeSession.telemetry().systems.commands.rejections.length, 5);
assert.equal(
  edgeSession
    .telemetry()
    .systems.commands.rejections.some(
      (entry) => entry.channel === "throttle" && entry.controllerId === 2,
    ),
  false,
);
assert.equal(
  edgeSession
    .telemetry()
    .systems.commands.rejections.some(
      (entry) => entry.channel === "nope" && entry.controllerId === 2,
    ),
  true,
);
assert.equal(
  edgeSession
    .telemetry()
    .systems.commands.rejections.find((entry) => entry.targetId === 404).reason,
  "missing or detached target",
);
assert.equal(
  edgeSession
    .telemetry()
    .systems.commands.rejections.find((entry) => entry.controllerId === 999)
    .reason,
  "controller has no allocated power",
);
assert.deepEqual(edgeSession.telemetry().systems.commands.capabilities, [
  "brake",
  "joint_target",
  "lights",
  "nope",
  "throttle",
]);
edgeSession.dispose();
assert.equal(edgeSession.context, null);
const disposableRouting = new CommandRoutingSystem(),
  disposableContext = { commandCapabilities: new Set(["throttle"]) };
disposableRouting.dispose(disposableContext);
assert.equal("commandCapabilities" in disposableContext, false);

const defaultCandidateSession = new SimulationSession({
  systems: [new PowerSystem(), new SignalSystem(), new CommandRoutingSystem()],
}).start(
  {
    parts: [
      part(1, "battery", { capacityWh: 1 }, { storedEnergyWh: 1 }),
      part(2, "computer"),
    ],
    connections: [connection("p", 1, 2, "power", "POWER", "POWER")],
  },
  {
    catalog: TYPES,
    readCommandCandidates: () => ({ remote: {}, scripts: null }),
  },
);
defaultCandidateSession.stepFixed();
assert.deepEqual(
  defaultCandidateSession.context.commandBus.entries().remote,
  [],
);
defaultCandidateSession.context.services.readCommandCandidates = () => ({
  remote: [
    {
      targetId: 2,
      channel: "target_altitude",
      value: 1234,
      active: true,
    },
  ],
  scripts: [{ controllerId: 2 }],
});
defaultCandidateSession.stepFixed();
assert.equal(
  defaultCandidateSession.context.commandBus.read(2, "target_altitude").value,
  1234,
);
defaultCandidateSession.dispose();

const emptySignals = new SignalNetwork(TYPES).resolve(
  new RunAssemblyGraph({ parts: [part(1, "plate")], connections: [] }),
  { isPowered: () => false },
);
assert.deepEqual(emptySignals.telemetry().routes, []);

console.log(
  `power, signal, and command networks passed (${power.telemetry().consumers.length} consumers, ${readings[6].speed} m/s bound sensor)`,
);
