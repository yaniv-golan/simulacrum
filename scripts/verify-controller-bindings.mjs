import assert from "node:assert/strict";
import {
  canonicalControllerBindings,
  controllerBindingIndex,
  controllerBindingManifest,
  controllerBindingManifestIdentity,
  controllerBindingOptions,
  remapControllerBindings,
  validateControllerBindingManifest,
} from "../src/model/controller-bindings.js";
import { TYPES } from "../src/model/component-catalog.js";
import {
  quaternionFromEulerXYZ,
  rotateVectorByQuaternion,
} from "../src/model/primitives.js";
import { compileVisualProgram } from "../src/model/visual-logic.js";
import {
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { ControllerRuntimeReadModel } from "../src/application/controller-runtime-read-model.js";
import { createCommandCandidateReader } from "../src/application/command-candidate-reader.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { SensorSystem } from "../src/simulation/systems/sensor-system.js";
import { ControllerSystem } from "../src/simulation/systems/controller-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { CommandReceiverSystem } from "../src/simulation/systems/command-receiver-system.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { SignalNetwork } from "../src/simulation/signal-network.js";
import { CommandBus } from "../src/simulation/command-bus.js";

const part = (id, type, extra = {}) => ({
    id,
    type,
    config:
      type === "battery"
        ? { capacityWh: 100, maxOutputWatts: 50_000 }
        : type === "motor"
          ? { power: 1 }
          : {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...(type === "battery" ? { storedEnergyWh: 100 } : {}),
    ...extra,
  }),
  connection = (id, a, b, kind, portA, portB) => ({
    id,
    a,
    b,
    kind,
    portA,
    portB,
  });

const battery = part(1, "battery"),
  navigation = part(2, "navsensor"),
  controller = part(3, "computer"),
  motors = [4, 5, 6, 7].map((id) => part(id, "motor")),
  parts = [battery, navigation, controller, ...motors],
  connections = [
    connection("power-controller", 1, 3, "power", "POWER", "POWER"),
    connection("power-navigation", 1, 2, "power", "POWER", "POWER"),
    connection("signal-navigation", 2, 3, "signal", "SIGNAL", "IN A"),
    ...motors.flatMap((motor) => [
      connection(`power-${motor.id}`, 1, motor.id, "power", "POWER", "POWER"),
      connection(`signal-${motor.id}`, 3, motor.id, "signal", "OUT", "CONTROL"),
    ]),
  ];
controller.controllerBindings = [
  ...motors.map((motor, index) => ({
    id: `motor.${index}`,
    direction: "output",
    endpointPartId: motor.id,
    endpointPortId: "CONTROL",
    channel: "throttle",
  })),
  {
    id: "nav.speed",
    direction: "input",
    endpointPartId: navigation.id,
    endpointPortId: "SIGNAL",
    reading: "speed",
  },
];

const manifest = controllerBindingManifest(controller, parts, connections);
assert.throws(() => canonicalControllerBindings(null), /must be an array/);
assert.throws(
  () => controllerBindingManifest(null, parts, connections),
  /Logic Controller/,
);
assert.throws(
  () => controllerBindingManifest(navigation, parts, connections),
  /Logic Controller/,
);
assert.deepEqual(controllerBindingOptions(null, parts, connections), []);
assert.deepEqual(controllerBindingOptions(navigation, parts, connections), []);
assert.deepEqual(
  manifest.map(({ index, id }) => ({ index, id })),
  [
    { index: 0, id: "motor.0" },
    { index: 1, id: "motor.1" },
    { index: 2, id: "motor.2" },
    { index: 3, id: "motor.3" },
    { index: 4, id: "nav.speed" },
  ],
  "binding ABI ordering was not stable and alias-sorted",
);
assert.equal(
  controllerBindingOptions(controller, parts, connections).filter(
    (option) => option.direction === "output" && option.channel === "throttle",
  ).length,
  4,
);

const expectInvalid = (mutate, pattern) => {
  const invalid = structuredClone(controller),
    invalidParts = parts.map((candidate) =>
      candidate.id === controller.id ? invalid : candidate,
    ),
    invalidConnections = structuredClone(connections);
  mutate(invalid, invalidParts, invalidConnections);
  assert.throws(
    () => controllerBindingManifest(invalid, invalidParts, invalidConnections),
    pattern,
  );
};
expectInvalid(
  (invalid) => (invalid.controllerBindings[0].endpointPartId = 404),
  /missing component/,
);
expectInvalid(
  (invalid) => (invalid.controllerBindings[0].endpointPortId = "MISSING"),
  /missing endpoint port/,
);
expectInvalid(
  (invalid) => (invalid.controllerBindings.at(-1).reading = "telepathy"),
  /does not expose/,
);
expectInvalid(
  (invalid) => (invalid.controllerBindings[0].channel = "teleport"),
  /does not accept/,
);
expectInvalid(
  (invalid) => (invalid.controllerBindings[1].id = "motor.0"),
  /Duplicate controller binding/,
);
expectInvalid((invalid) => {
  invalid.controllerBindings.push({
    ...structuredClone(invalid.controllerBindings[0]),
    id: "motor.duplicate-authority",
  });
}, /duplicates an existing output endpoint and channel/);
expectInvalid(
  (_invalid, _parts, invalidConnections) =>
    invalidConnections.splice(
      invalidConnections.findIndex((item) => item.id === "signal-4"),
      1,
    ),
  /no directed signal route/,
);
expectInvalid((_invalid, _parts, invalidConnections) => {
  const signal = invalidConnections.find((item) => item.id === "signal-4");
  signal.kind = "mechanical";
}, /no directed signal route/);
expectInvalid((_invalid, _parts, invalidConnections) => {
  const signal = invalidConnections.find((item) => item.id === "signal-4");
  signal.failed = true;
}, /no directed signal route/);
expectInvalid((invalid, _parts, invalidConnections) => {
  invalid.controllerBindings[0].endpointPortId = "POWER";
  const signal = invalidConnections.find((item) => item.id === "signal-4");
  signal.portB = "POWER";
}, /no directed signal route/);
expectInvalid(
  (_invalid, _parts, invalidConnections) =>
    invalidConnections.splice(
      invalidConnections.findIndex((item) => item.id === "signal-navigation"),
      1,
    ),
  /no directed signal route/,
);
expectInvalid(
  (invalid) => (invalid.controllerBindings[0].direction = "sideways"),
  /invalid direction/,
);
expectInvalid((_invalid, invalidParts, invalidConnections) => {
  invalidParts.push(part(8, "computer", { controllerBindings: [] }));
  invalidConnections.splice(
    invalidConnections.findIndex((item) => item.id === "signal-4"),
    1,
    connection("signal-relay-in", 3, 8, "signal", "OUT", "IN A"),
    connection("signal-relay-out", 8, 4, "signal", "OUT", "CONTROL"),
  );
}, /no directed signal route/);
assert.deepEqual(
  controllerBindingManifest(controller, parts, [
    ...connections,
    connection("dangling-signal", 404, 3, "signal", "SIGNAL", "IN B"),
  ]),
  manifest,
  "dangling signal metadata entered the binding graph",
);

const duplicateAuthorityManifest = [
  ...structuredClone(manifest),
  {
    ...structuredClone(manifest[0]),
    id: "motor.duplicate-direct-manifest",
  },
]
  .sort((left, right) => left.id.localeCompare(right.id, "en"))
  .map((binding, index) => ({ ...binding, index }));
assert.throws(
  () => validateControllerBindingManifest(duplicateAuthorityManifest),
  /duplicates output authority/,
);

const remapped = remapControllerBindings(
  controller.controllerBindings,
  new Map([
    [2, 102],
    [4, 104],
    [5, 105],
    [6, 106],
    [7, 107],
  ]),
);
assert.deepEqual(
  remapped.map((binding) => binding.endpointPartId),
  [104, 105, 106, 107, 102],
  "copied controller bindings did not remap physical endpoint IDs",
);
const objectRemap = remapControllerBindings(controller.controllerBindings, {
  4: 204,
});
assert.equal(objectRemap[0].endpointPartId, 204);
assert.equal(
  objectRemap.find((binding) => binding.id === "nav.speed").endpointPartId,
  2,
);

const reversedConnections = connections.map((candidate) =>
  candidate.id === "signal-navigation"
    ? {
        ...candidate,
        a: candidate.b,
        b: candidate.a,
        portA: candidate.portB,
        portB: candidate.portA,
      }
    : candidate,
);
assert.deepEqual(
  controllerBindingManifest(controller, parts, reversedConnections),
  manifest,
  "connection endpoint ordering changed the directed binding manifest",
);
const detachedParts = parts.map((candidate) =>
  candidate.id === 4 ? { ...candidate, detached: true } : candidate,
);
assert.ok(
  !controllerBindingOptions(controller, detachedParts, connections).some(
    (option) => option.endpointPartId === 4,
  ),
);

const dualPortCatalog = {
    ...TYPES,
    "dual-port-actuator": {
      ...TYPES.motor,
      ports: TYPES.motor.ports.flatMap((descriptor) =>
        descriptor.id === "CONTROL"
          ? [
              { ...descriptor, id: "CONTROL A" },
              { ...descriptor, id: "CONTROL B" },
            ]
          : [descriptor],
      ),
    },
  },
  dualController = part(22, "computer", {
    controllerBindings: [
      {
        id: "drive",
        direction: "output",
        endpointPartId: 23,
        endpointPortId: "CONTROL A",
        channel: "throttle",
      },
    ],
  }),
  dualParts = [
    { ...battery, energyJ: 360_000 },
    dualController,
    part(23, "dual-port-actuator"),
  ],
  dualConnections = [
    connection("dual-controller-power", 1, 22, "power", "POWER", "POWER"),
    connection("dual-actuator-power", 1, 23, "power", "POWER", "POWER"),
    connection("dual-signal", 22, 23, "signal", "OUT", "CONTROL A"),
  ],
  dualGraph = {
    graphRevision: 0,
    parts: () => dualParts,
    connections: () => dualConnections,
    consumeEnergy: (_partId, joules) => joules,
  },
  dualPower = new PowerNetwork(dualPortCatalog).resolve(dualGraph, 1 / 120),
  dualSignals = new SignalNetwork(dualPortCatalog).resolve(
    dualGraph,
    dualPower,
  );
assert.equal(dualSignals.hasRoute(22, 23, "CONTROL A"), true);
assert.equal(dualSignals.hasRoute(22, 23, "CONTROL B"), false);
const endpointBus = new CommandBus(),
  endpointRouting = new CommandRoutingSystem(),
  wrongEndpointCandidate = {
    controllerId: 22,
    bindingId: "drive",
    targetId: 23,
    endpointPortId: "CONTROL B",
    channel: "throttle",
    value: 0.8,
  },
  endpointContext = {
    clock: { tick: 1 },
    commandBus: endpointBus,
    powerNetwork: dualPower,
    signalNetwork: dualSignals,
    runGraph: {
      part: (id) => dualParts.find((candidate) => candidate.id === id),
    },
    services: {
      catalog: dualPortCatalog,
      readCommandCandidates: () => ({
        remote: [],
        scripts: [wrongEndpointCandidate],
      }),
    },
    telemetry: {},
  };
endpointRouting.step(endpointContext);
assert.equal(endpointBus.read(23, "throttle").value, 0);
assert.equal(
  endpointBus.entries().rejections[0].reason,
  "binding has no powered directed signal route",
);
assert.doesNotThrow(() =>
  controllerBindingManifest(
    dualController,
    dualParts,
    dualConnections,
    dualPortCatalog,
  ),
);
dualController.controllerBindings[0].endpointPortId = "CONTROL B";
assert.throws(
  () =>
    controllerBindingManifest(
      dualController,
      dualParts,
      dualConnections,
      dualPortCatalog,
    ),
  /no directed signal route/,
);

for (const [candidate, pattern] of [
  [[{ ...manifest[0], index: 9 }], /unstable ABI index/],
  [
    [
      { ...manifest[0], index: 0 },
      { ...manifest[0], index: 1 },
    ],
    /duplicate controller binding/,
  ],
  [[{ ...manifest[0], index: 0, direction: "sideways" }], /invalid direction/],
  [[{ ...manifest.at(-1), index: 0, reading: "" }], /incomplete/],
  [[{ ...manifest[0], index: 0, channel: "" }], /incomplete/],
])
  assert.throws(() => validateControllerBindingManifest(candidate), pattern);
assert.equal(controllerBindingIndex(manifest, "nav.speed", "input"), 4);
assert.throws(
  () => controllerBindingIndex(manifest, "nav.speed", "output"),
  /unknown output binding/,
);
assert.throws(
  () => controllerBindingIndex(manifest, "missing", "input"),
  /unknown input binding/,
);

const typescriptSource = `interface ControlAPI {
  read(binding: string): number;
  write(binding: string, value: number): void;
}
function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.write('motor.0', 0.1);
  api.write('motor.1', 0.2);
  api.write('motor.2', 0.3);
  api.write('motor.3', 0.4);
}`,
  visualProgram = {
    version: 1,
    name: "Four outputs",
    nodes: motors.flatMap((_motor, index) => [
      {
        id: `value-${index}`,
        type: "constant",
        value: (index + 1) / 10,
        x: 20,
        y: index * 100,
      },
      {
        id: `output-${index}`,
        type: "output",
        bindingId: `motor.${index}`,
        x: 260,
        y: index * 100,
      },
    ]),
    links: motors.map((_motor, index) => ({
      from: `value-${index}`,
      to: `output-${index}`,
      input: 0,
    })),
  },
  watSource = `(module
    (import "env" "write_binding" (func $write (param i32 f32)))
    (func (export "tick") (param f32)
      (call $write (i32.const 0) (f32.const 0.1))
      (call $write (i32.const 1) (f32.const 0.2))
      (call $write (i32.const 2) (f32.const 0.3))
      (call $write (i32.const 3) (f32.const 0.4))))`,
  prepared = [
    await prepareTypeScriptController(typescriptSource, manifest),
    await prepareControlIRController(
      compileVisualProgram(visualProgram, manifest).ir,
    ),
    await prepareWasmController(watSource, manifest),
  ],
  expected = {
    "motor.0": 0.1,
    "motor.1": 0.2,
    "motor.2": 0.3,
    "motor.3": 0.4,
  };
for (const runtime of prepared) {
  const actual = Object.fromEntries(runtime.instantiate().tick(1 / 120, {}));
  for (const [bindingId, value] of Object.entries(expected))
    assert.ok(
      Math.abs(actual[bindingId] - value) < 1e-6,
      `${runtime.language} diverged at ${bindingId}`,
    );
  assert.equal(
    runtime.bindingManifestIdentity,
    controllerBindingManifestIdentity(manifest),
  );
}

const readModel = new ControllerRuntimeReadModel(),
  manager = new ControllerRuntimeManager({
    onStatus: (id, status, online) => readModel.setStatus(id, status, online),
    onCommands: (id, commands) => readModel.setCommands(id, commands),
  });
manager.attach(controller.id, prepared[0], "BOUND TS");
manager.tick(controller.id, 1 / 120, {});
const candidateReader = createCommandCandidateReader({
    getState: () => ({
      parts,
      remoteControls: { test: [] },
      remoteProfile: "test",
    }),
    runtimeManager: manager,
    runtimeReadModel: readModel,
  }),
  candidates = candidateReader();
assert.deepEqual(
  candidates.scripts.map(
    ({ bindingId, targetId, endpointPortId, channel, value }) => ({
      bindingId,
      targetId,
      endpointPortId,
      channel,
      value,
    }),
  ),
  motors.map((motor, index) => ({
    bindingId: `motor.${index}`,
    targetId: motor.id,
    endpointPortId: "CONTROL",
    channel: "throttle",
    value: (index + 1) / 10,
  })),
);
const remoteCandidateReader = createCommandCandidateReader({
    getState: () => ({
      parts: [],
      remoteProfile: "mission",
      remoteControls: {
        mission: [
          {
            targetId: 21,
            channel: "command",
            type: "range",
            value: 100_000,
            defaultValue: 100_000,
            active: false,
          },
          {
            targetId: 22,
            channel: "command",
            type: "toggle",
            value: 1,
            defaultValue: 1,
            active: false,
          },
          {
            targetId: 23,
            channel: "command",
            type: "range",
            value: 0,
            defaultValue: 0,
            active: false,
          },
          {
            targetId: 24,
            channel: "command",
            type: "range",
            value: 0,
            defaultValue: 0.5,
            active: true,
          },
        ],
      },
    }),
    runtimeManager: manager,
    runtimeReadModel: readModel,
  }),
  remoteCandidates = remoteCandidateReader().remote;
assert.deepEqual(
  remoteCandidates.map(({ targetId, value, active }) => ({
    targetId,
    value,
    active,
  })),
  [
    { targetId: 21, value: 100_000, active: true },
    { targetId: 22, value: 1, active: true },
    { targetId: 23, value: 0, active: false },
    { targetId: 24, value: 0, active: true },
  ],
  "non-zero range/toggle defaults must be real remote commands, while an explicit zero remains commandable",
);
const routingSession = new SimulationSession({
  systems: [new PowerSystem(), new SignalSystem(), new CommandRoutingSystem()],
}).start(
  { parts, connections },
  { catalog: TYPES, readCommandCandidates: () => candidates },
);
routingSession.stepFixed();
for (const [index, motor] of motors.entries())
  assert.ok(
    Math.abs(
      routingSession.context.commandBus.read(motor.id, "throttle").value -
        (index + 1) / 10,
    ) < 1e-6,
  );

const receiver = part(12, "receiver"),
  receiverController = part(13, "computer", {
    controllerBindings: [
      {
        id: "pilot.command",
        direction: "input",
        endpointPartId: 12,
        endpointPortId: "SIGNAL",
        reading: "command",
      },
    ],
  }),
  receiverAssembly = {
    parts: [battery, receiver, receiverController],
    connections: [
      connection("receiver-power", 1, 12, "power", "POWER", "POWER"),
      connection("receiver-controller-power", 1, 13, "power", "POWER", "POWER"),
      connection("receiver-signal", 12, 13, "signal", "SIGNAL", "IN A"),
    ],
  };

const receiverSystem = new CommandReceiverSystem(),
  receiverUnitContext = ({
    powered = true,
    detached = false,
    routedControllerIds = [13],
    routeValid = true,
    command = { value: 0.75, conflict: false, source: "remote" },
  } = {}) => ({
    runGraph: { parts: () => [{ ...receiver, detached }] },
    services: { catalog: TYPES },
    powerNetwork: { isPowered: () => powered },
    signalNetwork: {
      controllersForSensor: () => routedControllerIds,
      hasSensorRoute: () => routeValid,
    },
    commandBus: { read: () => command },
    clock: { tick: 42 },
    commands: new Map([["stale", { value: 1 }]]),
    telemetry: {},
  }),
  runReceiverUnitStep = (options) => {
    const context = receiverUnitContext(options);
    receiverSystem.step(context);
    return { context, state: context.telemetry.commandReceivers.states[0] };
  };
const initializedReceiverContext = receiverUnitContext();
receiverSystem.initialize(initializedReceiverContext);
assert.equal(
  initializedReceiverContext.commands.size,
  0,
  "receiver initialization retained stale command state",
);
const onlineReceiver = runReceiverUnitStep();
assert.deepEqual(onlineReceiver.state, {
  partId: 12,
  channel: "command",
  value: 0.75,
  valid: true,
  powered: true,
  routedControllerIds: [13],
  source: "remote",
  conflict: false,
  tick: 42,
});
const validZeroReceiver = runReceiverUnitStep({
  command: { value: 0, conflict: false, source: "remote" },
});
assert.equal(validZeroReceiver.state.value, 0);
assert.equal(validZeroReceiver.state.valid, true);
for (const command of [
  { value: 0, conflict: false, source: "default" },
  { value: 0, conflict: false, source: "none" },
  { value: 0, conflict: false },
]) {
  const sourceAbsent = runReceiverUnitStep({ command });
  assert.equal(
    sourceAbsent.state.valid,
    false,
    "a receiver without a current command source published valid evidence",
  );
  assert.equal(sourceAbsent.state.value, 0);
}
assert.ok(Object.isFrozen(onlineReceiver.state.routedControllerIds));
assert.throws(
  () => onlineReceiver.state.routedControllerIds.push(99),
  TypeError,
  "owned receiver telemetry exposed a mutable nested controller list",
);
for (const options of [
  { powered: false },
  { detached: true },
  { routedControllerIds: [] },
  { routeValid: false },
]) {
  const offline = runReceiverUnitStep(options);
  assert.equal(offline.state.valid, false);
  assert.equal(offline.state.value, 0);
  assert.equal(offline.state.source, "none");
  assert.equal(offline.state.conflict, false);
}
const conflictedReceiver = runReceiverUnitStep({
  command: { value: 0.75, conflict: true, source: "conflict" },
});
assert.equal(conflictedReceiver.state.valid, false);
assert.equal(conflictedReceiver.state.conflict, true);
assert.equal(conflictedReceiver.state.source, "conflict");
const restoredReceiverContext = receiverUnitContext({
    command: { value: 0.25, conflict: false, source: "replay" },
  }),
  incompleteTelemetry = Object.freeze({ status: "not-completed" });
restoredReceiverContext.telemetry.commandReceivers = incompleteTelemetry;
receiverSystem.afterCheckpointRestore(restoredReceiverContext);
assert.deepEqual(restoredReceiverContext.commands.get(receiver.id), {
  partId: 12,
  channel: "command",
  value: 0.25,
  valid: true,
  powered: true,
  routedControllerIds: [13],
  source: "replay",
  conflict: false,
  tick: 42,
});
assert.equal(
  restoredReceiverContext.telemetry.commandReceivers,
  incompleteTelemetry,
  "checkpoint reconstruction published an incomplete receiver telemetry frame",
);
receiverSystem.dispose(onlineReceiver.context);
assert.equal(
  onlineReceiver.context.commands.size,
  0,
  "receiver disposal retained committed command state",
);

const observed = [],
  sensorBank = new ControllerSensorBank(),
  receiverCandidate = {
    targetId: 12,
    channel: "command",
    value: 0.75,
    active: true,
  },
  receiverBodies = {
    bodies: [
      {
        bodyId: "receiver-body",
        bound: true,
        detached: false,
        pose: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
      },
    ],
    bodyByPart: [{ partId: 12, bodyId: "receiver-body" }],
  },
  receiverSession = new SimulationSession({
    systems: [
      new SensorSystem(),
      new ControllerSystem(),
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new CommandReceiverSystem(),
    ],
  }).start(receiverAssembly, {
    catalog: TYPES,
    readCommandCandidates: () => ({ remote: [receiverCandidate], scripts: [] }),
    readSensors: (context, fixedDt) => {
      const previous = context.previousTelemetry || {},
        systems = previous.systems || {};
      return {
        controllers: sensorBank.capture({
          parts: previous.run?.parts || [],
          connections: previous.run?.connections || [],
          bodies: receiverBodies,
          signals: systems.signals || {},
          commandReceivers: systems.commandReceivers || {},
          fixedDt,
          time: previous.time || 0,
        }),
        poweredControllerIds: systems.power?.poweredPartIds || null,
      };
    },
    tickControllers: (_dt, snapshot) => {
      const readings = snapshot.controllers?.[13];
      observed.push({
        value: readings?.["pilot.command"] || 0,
        valid: readings?.__validity?.["pilot.command"] || 0,
      });
    },
  });
receiverSession.stepFixed();
assert.deepEqual(
  observed.at(-1),
  { value: 0, valid: 0 },
  "receiver leaked a same-step command or validity",
);
receiverSession.stepFixed();
assert.deepEqual(
  observed.at(-1),
  { value: 0.75, valid: 1 },
  "receiver command and validity were not exposed exactly one completed step later",
);
receiverSession.context.runGraph.failConnection("receiver-signal");
receiverSession.stepFixed();
assert.deepEqual(
  observed.at(-1),
  { value: 0.75, valid: 1 },
  "signal failure rewrote the prior snapshot",
);
receiverSession.stepFixed();
assert.deepEqual(
  observed.at(-1),
  { value: 0, valid: 0 },
  "signal loss retained a hidden receiver value or stale validity",
);

const imu = part(31, "imu"),
  imuController = part(32, "computer", {
    controllerBindings: [
      ["roll", "imu_roll_deg"],
      ["pitch", "imu_pitch_deg"],
      ["yaw", "imu_yaw_deg"],
    ].map(([id, reading]) => ({
      id,
      direction: "input",
      endpointPartId: 31,
      endpointPortId: "SIGNAL",
      reading,
    })),
  }),
  imuParts = [imu, imuController],
  imuConnections = [
    connection("imu-signal", 31, 32, "signal", "SIGNAL", "IN A"),
  ],
  imuSignals = {
    controllerSensors: [
      {
        controllerId: 32,
        endpoints: [{ partId: 31, portIds: ["SIGNAL"] }],
      },
    ],
  },
  imuReadingFromQuaternion = ([x, y, z, w]) => {
    return sensorBank.capture({
      parts: imuParts,
      connections: imuConnections,
      bodies: {
        bodies: [
          {
            bodyId: "imu-body",
            bound: true,
            detached: false,
            pose: {
              position: { x: 0, y: 0, z: 0 },
              quaternion: { x, y, z, w },
            },
            velocity: { x: 0, y: 0, z: 0 },
            angularVelocity: { x: 0, y: 0, z: 0 },
          },
        ],
        bodyByPart: [{ partId: 31, bodyId: "imu-body" }],
      },
      signals: imuSignals,
    })[32];
  },
  imuReading = (euler) =>
    imuReadingFromQuaternion(quaternionFromEulerXYZ(euler)),
  angleRad = Math.PI / 12,
  angleDeg = 15,
  closeAngle = (actual, expected, label) =>
    assert.ok(
      Math.abs(actual - expected) < 1e-9,
      `${label}: expected ${expected}, got ${actual}`,
    );
for (const [euler, expected, label] of [
  [[angleRad, 0, 0], { pitch: angleDeg }, "pitch about +X"],
  [[0, angleRad, 0], { yaw: angleDeg }, "yaw about +Y"],
  [[0, 0, angleRad], { roll: angleDeg }, "roll about +Z"],
]) {
  const reading = imuReading(euler);
  for (const axis of ["roll", "pitch", "yaw"])
    closeAngle(reading[axis], expected[axis] || 0, `${label} ${axis}`);
}
const multiplyQuaternion = (left, right) => {
    const [lx, ly, lz, lw] = left,
      [rx, ry, rz, rw] = right;
    return [
      lw * rx + lx * rw + ly * rz - lz * ry,
      lw * ry - lx * rz + ly * rw + lz * rx,
      lw * rz + lx * ry - ly * rx + lz * rw,
      lw * rw - lx * rx - ly * ry - lz * rz,
    ];
  },
  singularYawRad = Math.PI / 7,
  singularPitchRad = Math.PI / 2,
  singularY = [
    0,
    Math.sin(singularYawRad / 2),
    0,
    Math.cos(singularYawRad / 2),
  ],
  singularX = [
    Math.sin(singularPitchRad / 2),
    0,
    0,
    Math.cos(singularPitchRad / 2),
  ],
  singularReading = imuReadingFromQuaternion(
    multiplyQuaternion(singularY, singularX),
  );
closeAngle(singularReading.pitch, 90, "positive pitch singularity pitch");
closeAngle(
  singularReading.yaw,
  (singularYawRad * 180) / Math.PI,
  "positive pitch singularity yaw",
);

const rangeSensor = part(41, "rangesensor"),
  rangeController = part(42, "computer", {
    controllerBindings: [
      {
        id: "target.detected",
        direction: "input",
        endpointPartId: 41,
        endpointPortId: "SIGNAL",
        reading: "proximity_detected",
      },
      {
        id: "target.range",
        direction: "input",
        endpointPartId: 41,
        endpointPortId: "SIGNAL",
        reading: "proximity_range_m",
      },
    ],
  }),
  rangeQuaternion = quaternionFromEulerXYZ([0.43, -0.31, 0.67]),
  rangeQuaternionObject = {
    x: rangeQuaternion[0],
    y: rangeQuaternion[1],
    z: rangeQuaternion[2],
    w: rangeQuaternion[3],
  },
  axisMagnitude = Math.hypot(1, 2, 3),
  localRangeAxis = [1 / axisMagnitude, 2 / axisMagnitude, 3 / axisMagnitude],
  localEmitterOffset = [0.31, -0.23, 0.17],
  worldRangeAxis = rotateVectorByQuaternion(localRangeAxis, rangeQuaternion),
  worldEmitterOffset = rotateVectorByQuaternion(
    localEmitterOffset,
    rangeQuaternion,
  ),
  rangeHostPosition = { x: 7, y: -4, z: 2 },
  expectedSurfaceRangeM = 40,
  targetRadiusM = 3,
  rangeEmitterPosition = {
    x: rangeHostPosition.x + worldEmitterOffset[0],
    y: rangeHostPosition.y + worldEmitterOffset[1],
    z: rangeHostPosition.z + worldEmitterOffset[2],
  },
  rangeTargetPosition = {
    x:
      rangeEmitterPosition.x +
      worldRangeAxis[0] * (expectedSurfaceRangeM + targetRadiusM),
    y:
      rangeEmitterPosition.y +
      worldRangeAxis[1] * (expectedSurfaceRangeM + targetRadiusM),
    z:
      rangeEmitterPosition.z +
      worldRangeAxis[2] * (expectedSurfaceRangeM + targetRadiusM),
  },
  rangeReadings = new ControllerSensorBank().capture({
    parts: [rangeSensor, rangeController],
    connections: [
      connection("range-signal", 41, 42, "signal", "SIGNAL", "IN A"),
    ],
    bodies: {
      bodies: [
        {
          bodyId: "range-body",
          bound: true,
          detached: false,
          pose: {
            position: rangeHostPosition,
            quaternion: rangeQuaternionObject,
          },
          velocity: { x: 1, y: 2, z: -1 },
          angularVelocity: { x: 0, y: 0, z: 0 },
        },
      ],
      bodyByPart: [{ partId: 41, bodyId: "range-body" }],
    },
    signals: {
      controllerSensors: [
        {
          controllerId: 42,
          endpoints: [{ partId: 41, portIds: ["SIGNAL"] }],
        },
      ],
    },
    environmentBodies: {
      schemaVersion: 1,
      time: 0,
      bodies: [
        {
          id: "environment:rotated-target",
          frame: "earth-tangent-global-v1",
          geometry: { kind: "sphere-v1", radiusM: targetRadiusM },
          queryKinds: ["sensing"],
          pose: {
            position: rangeTargetPosition,
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
          velocityMps: { x: 3, y: -2, z: 5 },
        },
      ],
    },
    compiledBodies: [
      {
        partId: 41,
        capabilities: {
          sensor: {
            measurement: {
              kind: "conical-range-v1",
              localAxisPart: localRangeAxis,
              emitterOffsetPartM: localEmitterOffset,
              fieldOfViewDeg: 0.1,
              maximumRangeM: 100,
              rangeResolutionM: 0.01,
            },
          },
        },
      },
    ],
  })[42];
assert.equal(rangeReadings["target.detected"], 1);
assert.equal(
  rangeReadings["target.range"],
  expectedSurfaceRangeM,
  "rotated range sensor lost its authored beam or emitter pose",
);
assert.equal(
  rangeReadings.__bindings.find(
    (binding) => binding.bindingId === "target.range",
  )?.hitBodyId,
  "environment:rotated-target",
  "rotated range sensor lost environment-body provenance",
);
closeAngle(singularReading.roll, 0, "positive pitch singularity roll");

const checkpoint = manager.exportState(),
  restoredReadModel = new ControllerRuntimeReadModel(),
  restored = new ControllerRuntimeManager({
    onCommands: (id, commands) => restoredReadModel.setCommands(id, commands),
  });
restored.attach(controller.id, prepared[0], "BOUND TS");
restored.importState(checkpoint);
assert.deepEqual(restored.exportState(), checkpoint);
const wrongManifest = {
  ...prepared[0],
  bindingManifestIdentity: "different-bindings",
};
const mismatched = new ControllerRuntimeManager();
mismatched.attach(controller.id, wrongManifest, "MISMATCH");
assert.throws(() => mismatched.importState(checkpoint), /identity mismatch/);

manager.disposeAll();
restored.disposeAll();
mismatched.disposeAll();
routingSession.dispose();
receiverSession.dispose();
console.log("controller binding contract passed");
