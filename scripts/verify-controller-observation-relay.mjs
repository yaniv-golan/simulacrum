import assert from "node:assert/strict";
import { loadBearingContactSetProgram } from "../src/model/autonomous-controller-programs.js";
import { createCommandCandidateReader } from "../src/application/command-candidate-reader.js";
import { ControllerRuntimeReadModel } from "../src/application/controller-runtime-read-model.js";
import { TYPES } from "../src/model/component-catalog.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { controllerSensorFrameForId } from "../src/model/controller-sensor-frame-evidence.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { SignalNetwork } from "../src/simulation/signal-network.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CommandReceiverSystem } from "../src/simulation/systems/command-receiver-system.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const part = (id, type, config = {}, extra = {}) => ({
    id,
    type,
    config,
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  candidate = {
    contactInputBindingId: "candidate.contact",
    normalForceInputBindingId: "candidate.normal-force",
    membershipOutputBindingId: "candidate.loaded-contact",
    confidenceOutputBindingId: "candidate.confidence",
  },
  options = {
    candidates: [candidate],
    supportCountOutputBindingId: "loaded-contact-set.count",
    setConfidenceOutputBindingId: "loaded-contact-set.confidence",
    enterForceN: 10,
    exitForceN: 5,
  },
  outputBindings = [
    candidate.membershipOutputBindingId,
    candidate.confidenceOutputBindingId,
    options.supportCountOutputBindingId,
    options.setConfidenceOutputBindingId,
  ],
  receiverByBinding = new Map(
    outputBindings.map((bindingId, index) => [
      bindingId,
      part("observation-receiver-" + index, "receiver"),
    ]),
  ),
  battery = part(
    "relay-battery",
    "battery",
    {
      capacityWh: 100,
      maxOutputWatts: 100_000,
      dischargeEfficiency: 1,
    },
    { storedEnergyWh: 100 },
  ),
  contactSensor = part("ordinary-contact-sensor", "contactsensor"),
  observer = part("loaded-contact-observer", "computer"),
  consumer = part("observation-consumer", "computer"),
  unpoweredProducer = part(
    "unpowered-producer",
    "computer",
    {},
    {
      controllerBindings: [],
    },
  ),
  observerBindings = [
    {
      id: candidate.contactInputBindingId,
      direction: "input",
      endpointPartId: contactSensor.id,
      endpointPortId: "SIGNAL",
      reading: "contact",
    },
    {
      id: candidate.normalForceInputBindingId,
      direction: "input",
      endpointPartId: contactSensor.id,
      endpointPortId: "SIGNAL",
      reading: "contact_force_n",
    },
    ...outputBindings.map((bindingId) => ({
      id: bindingId,
      direction: "output",
      endpointPartId: receiverByBinding.get(bindingId).id,
      endpointPortId: "CONTROL",
      channel: "command",
    })),
  ],
  consumerBindings = outputBindings.map((bindingId, index) => ({
    id: "observed." + index,
    direction: "input",
    endpointPartId: receiverByBinding.get(bindingId).id,
    endpointPortId: "SIGNAL",
    reading: "command",
  }));
observer.controllerBindings = observerBindings;
consumer.controllerBindings = consumerBindings;

const parts = [
    battery,
    contactSensor,
    observer,
    consumer,
    unpoweredProducer,
    ...receiverByBinding.values(),
  ],
  connections = [
    {
      id: "contact-to-observer",
      a: contactSensor.id,
      b: observer.id,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
    {
      id: "observer-power",
      a: battery.id,
      b: observer.id,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
    },
    {
      id: "consumer-power",
      a: battery.id,
      b: consumer.id,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
    },
    ...outputBindings.flatMap((bindingId, index) => {
      const receiver = receiverByBinding.get(bindingId);
      return [
        {
          id: "observer-to-receiver-" + index,
          a: observer.id,
          b: receiver.id,
          kind: "signal",
          portA: "OUT",
          portB: "CONTROL",
        },
        {
          id: "receiver-to-consumer-" + index,
          a: receiver.id,
          b: consumer.id,
          kind: "signal",
          portA: "SIGNAL",
          portB: "IN A",
        },
        {
          id: "receiver-power-" + index,
          a: battery.id,
          b: receiver.id,
          kind: "power",
          portA: "POWER",
          portB: "POWER",
        },
      ];
    }),
  ],
  observerManifest = controllerBindingManifest(observer, parts, connections),
  consumerManifest = controllerBindingManifest(consumer, parts, connections),
  prepared = await prepareTypeScriptController(
    loadBearingContactSetProgram({
      ...options,
      bindingManifest: observerManifest,
    }),
    observerManifest,
  ),
  runtimeReadModel = new ControllerRuntimeReadModel(),
  runtimeManager = new ControllerRuntimeManager({
    onStatus: (controllerId, status, ready) =>
      runtimeReadModel.setStatus(controllerId, status, ready),
    onCommands: (controllerId, outputs) =>
      runtimeReadModel.setCommands(controllerId, outputs),
  }),
  baseCandidateReader = createCommandCandidateReader({
    getState: () => ({
      remoteControls: { default: [] },
      remoteProfile: "default",
      parts,
    }),
    runtimeManager,
    runtimeReadModel,
  });
runtimeManager.attach(observer.id, prepared, "LOADED CONTACT OBSERVER");

assert.equal(
  observerManifest.filter((binding) => binding.direction === "output").length,
  outputBindings.length,
);
assert.ok(
  observerManifest
    .filter((binding) => binding.direction === "output")
    .every(
      (binding) =>
        binding.endpointPortId === "CONTROL" && binding.channel === "command",
    ),
  "observation outputs are not ordinary route-valid receiver commands",
);
assert.equal(
  consumerManifest.filter((binding) => binding.direction === "input").length,
  outputBindings.length,
);

let commandMode = "observer";
const tickObserver = (frame) => {
    assert.equal(runtimeManager.tick(observer.id, 1 / 120, frame), true);
  },
  loadedFrame = {
    [candidate.contactInputBindingId]: 1,
    [candidate.normalForceInputBindingId]: 20,
    __validity: {
      [candidate.contactInputBindingId]: 1,
      [candidate.normalForceInputBindingId]: 1,
    },
  },
  scriptCandidates = () => {
    const candidates = baseCandidateReader(),
      observerScripts = candidates.scripts;
    if (commandMode === "silent") return { ...candidates, scripts: [] };
    if (commandMode === "source-power-loss")
      return {
        ...candidates,
        scripts: observerScripts.map((entry) => ({
          ...entry,
          controllerId: unpoweredProducer.id,
        })),
      };
    if (commandMode === "upstream-route-loss")
      return {
        ...candidates,
        scripts: observerScripts.map((entry) => ({
          ...entry,
          endpointPortId: "SIGNAL",
        })),
      };
    return candidates;
  };
tickObserver(loadedFrame);

const session = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new CommandReceiverSystem(),
      new TelemetrySystem(),
    ],
  }).start(
    { parts, connections },
    {
      catalog: TYPES,
      readCommandCandidates: scriptCandidates,
    },
  ),
  receiverBodies = {
    bodies: [...receiverByBinding.values()].map((receiver) => ({
      bodyId: "body:" + receiver.id,
      bound: true,
      detached: false,
      pose: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      contacts: [],
      loads: [],
    })),
    bodyByPart: [...receiverByBinding.values()].map((receiver) => ({
      partId: receiver.id,
      bodyId: "body:" + receiver.id,
    })),
  },
  sensorBank = new ControllerSensorBank(),
  capture = (commandReceivers = null) => {
    const telemetry = session.telemetry();
    return controllerSensorFrameForId(
      sensorBank.capture({
        parts,
        connections,
        bodies: { ...receiverBodies, tick: telemetry.tick },
        signals: telemetry.systems.signals,
        commandReceivers:
          commandReceivers || telemetry.systems.commandReceivers,
        fixedDt: 1 / 120,
        time: telemetry.time,
      }),
      consumer.id,
    );
  };

session.stepFixed();
const routedObserverTargets = session
  .telemetry()
  .systems.signals.controllerTargets.find(
    (entry) => entry.controllerId === observer.id,
  ).targetIds;
assert.deepEqual(
  routedObserverTargets,
  [
    observer.id,
    ...receiverByBinding.values().map((receiver) => receiver.id),
  ].sort((left, right) => left.localeCompare(right, "en")),
  "observation routing gained a downstream controller or lost a receiver target",
);
let readings = capture();
for (const binding of consumerBindings) {
  assert.equal(readings[binding.id], 1);
  assert.equal(readings.__validity[binding.id], 1);
}

for (const mode of ["silent", "source-power-loss", "upstream-route-loss"]) {
  commandMode = mode;
  session.stepFixed();
  readings = capture();
  for (const binding of consumerBindings) {
    assert.equal(readings[binding.id], 0);
    assert.equal(
      readings.__validity[binding.id],
      0,
      mode + " was laundered into valid relay evidence",
    );
  }
  const rejections = session.telemetry().systems.commands.rejections;
  if (mode === "source-power-loss") {
    assert.equal(rejections.length, outputBindings.length);
    assert.ok(
      rejections.every(
        (entry) => entry.reason === "controller has no allocated power",
      ),
    );
  }
  if (mode === "upstream-route-loss") {
    assert.equal(rejections.length, outputBindings.length);
    assert.ok(
      rejections.every(
        (entry) =>
          entry.reason === "binding has no powered directed signal route",
      ),
    );
  }
  commandMode = "observer";
  session.stepFixed();
  readings = capture();
  for (const binding of consumerBindings)
    assert.equal(readings.__validity[binding.id], 1);
}

tickObserver({
  [candidate.contactInputBindingId]: 20,
  [candidate.normalForceInputBindingId]: 20,
  __validity: {
    [candidate.contactInputBindingId]: 0,
    [candidate.normalForceInputBindingId]: 0,
  },
});
session.stepFixed();
readings = capture();
for (const binding of consumerBindings) {
  assert.equal(readings[binding.id], 0);
  assert.equal(
    readings.__validity[binding.id],
    1,
    "a valid relayed zero was confused with unavailable relay evidence",
  );
}

const currentReceivers = session.telemetry().systems.commandReceivers,
  unavailableReceivers = {
    states: currentReceivers.states.map((state, index) => ({
      ...state,
      valid: index === 0 ? false : state.valid,
    })),
  },
  unavailable = capture(unavailableReceivers);
assert.equal(unavailable[consumerBindings[0].id], 0);
assert.equal(
  unavailable.__validity[consumerBindings[0].id],
  0,
  "invalid relay state retained physical evidence validity",
);
for (const binding of consumerBindings.slice(1))
  assert.equal(unavailable.__validity[binding.id], 1);

const staleReceivers = {
    states: currentReceivers.states.map((state) => ({
      ...state,
      tick: state.tick - 1,
    })),
  },
  stale = capture(staleReceivers);
for (const binding of consumerBindings) {
  assert.equal(stale[binding.id], 0);
  assert.equal(
    stale.__validity[binding.id],
    0,
    "stale receiver state was relabeled as current physical evidence",
  );
}

tickObserver(loadedFrame);
session.stepFixed();
readings = capture();
for (const binding of consumerBindings) {
  assert.equal(readings[binding.id], 1);
  assert.equal(readings.__validity[binding.id], 1);
}

const signalPort = (id, direction, multiplicity = "one") => ({
    id,
    kind: "signal",
    behavior: "signal-network",
    direction,
    multiplicity,
  }),
  producer = part("boundary-producer", "computer"),
  passiveSensor = part("passive-sensor-target", "contactsensor"),
  boundaryConsumer = part("boundary-consumer", "computer"),
  passiveCatalog = {
    ...TYPES,
    contactsensor: {
      ...TYPES.contactsensor,
      ports: [...TYPES.contactsensor.ports, signalPort("CONTROL", "sink")],
    },
  },
  passiveParts = [producer, passiveSensor, boundaryConsumer],
  passiveConnections = [
    {
      id: "producer-to-passive",
      a: producer.id,
      b: passiveSensor.id,
      kind: "signal",
      portA: "OUT",
      portB: "CONTROL",
    },
    {
      id: "passive-to-consumer",
      a: passiveSensor.id,
      b: boundaryConsumer.id,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
  ],
  graph = (graphParts, graphConnections) => ({
    graphRevision: 0,
    parts: () => graphParts,
    connections: () => graphConnections,
  }),
  powered = { isPowered: () => true },
  passiveNetwork = new SignalNetwork(passiveCatalog).resolve(
    graph(passiveParts, passiveConnections),
    powered,
  );
assert.deepEqual(passiveNetwork.targetsForController(producer.id), [
  producer.id,
]);
assert.equal(
  passiveNetwork.hasRoute(producer.id, passiveSensor.id, "CONTROL"),
  false,
  "a sensor without a control contract became a command target",
);
assert.equal(
  passiveNetwork.hasSensorRoute(
    boundaryConsumer.id,
    passiveSensor.id,
    "SIGNAL",
  ),
  true,
);

const unpoweredReceiver = part("unpowered-receiver", "receiver"),
  unpoweredParts = [producer, unpoweredReceiver, boundaryConsumer],
  unpoweredConnections = [
    {
      id: "producer-to-unpowered",
      a: producer.id,
      b: unpoweredReceiver.id,
      kind: "signal",
      portA: "OUT",
      portB: "CONTROL",
    },
    {
      id: "unpowered-to-consumer",
      a: unpoweredReceiver.id,
      b: boundaryConsumer.id,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
  ],
  unpoweredNetwork = new SignalNetwork(TYPES).resolve(
    graph(unpoweredParts, unpoweredConnections),
    { isPowered: (partId) => partId !== unpoweredReceiver.id },
  );
assert.deepEqual(unpoweredNetwork.targetsForController(producer.id), [
  producer.id,
]);
assert.equal(
  unpoweredNetwork.hasRoute(producer.id, unpoweredReceiver.id, "CONTROL"),
  false,
  "an unpowered observation receiver became a command target",
);

const graphRevisionBefore = session.context.runGraph.graphRevision;
session.context.runGraph.applyStructuralEvent({
  failedConnectionIds: [
    "observer-to-receiver-0",
    "receiver-power-1",
    "receiver-to-consumer-2",
  ],
  reason: "relay route qualification",
  mode: "verification",
  time: session.telemetry().time,
});
assert.equal(
  session.context.runGraph.graphRevision,
  graphRevisionBefore + 1,
  "relay topology changes were not committed atomically",
);
session.stepFixed();
readings = capture();
for (const binding of consumerBindings.slice(0, 3)) {
  assert.equal(readings[binding.id], 0);
  assert.equal(readings.__validity[binding.id], 0);
}
assert.equal(readings[consumerBindings[3].id], 1);
assert.equal(readings.__validity[consumerBindings[3].id], 1);
for (const [index, bindingId] of outputBindings.entries()) {
  const receiverState = session
    .telemetry()
    .systems.commandReceivers.states.find(
      (state) => state.partId === receiverByBinding.get(bindingId).id,
    );
  assert.equal(receiverState.valid, index === 3);
}

session.dispose();
runtimeManager.disposeAll();
console.log(
  "controller observation relay passed (route-valid publication, zero, invalidity, recovery)",
);
