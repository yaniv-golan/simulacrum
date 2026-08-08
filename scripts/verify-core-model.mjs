import { assert } from "./lib/assert.mjs";
import * as THREE from "three";
import { AssemblyModel } from "../src/model/assembly-model.js";
import {
  applyEditorAction,
  createApplicationState,
} from "../src/model/application-state.js";
import {
  createBlueprint,
  normalizeBlueprint,
} from "../src/model/blueprints.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { BlueprintAcquisition } from "../src/model/blueprint-acquisition.js";
import { TYPES } from "../src/model/component-catalog.js";
import { resolveWireComponentConfig } from "../src/model/component-resolver.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { normalizeControllerLayouts } from "../src/model/controller-layouts.js";
import {
  compatibleTargetPorts,
  inferConnectionKind,
} from "../src/model/ports.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { createTelemetrySnapshot } from "../src/simulation/telemetry.js";
import { DirectManipulator } from "../src/presentation/direct-manipulator.js";
import { projectMachineTelemetry } from "../src/presentation/machine-telemetry-projection.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { HistoryStore } from "../src/model/history-store.js";
import {
  createSubassemblyTemplate,
  createLocalSubassemblyRecord,
  decodeLocalSubassemblyLibrary,
  instantiateSubassembly,
  LOCAL_SUBASSEMBLY_FORMAT,
} from "../src/model/subassemblies.js";
import { analyzeAssembly } from "../src/model/engineering-analysis.js";
import {
  FailureRecorder,
  ReplayBuffer,
} from "../src/model/failure-analysis.js";
import {
  alignSelection,
  distributeSelection,
  translateSelectionTo,
} from "../src/model/selection-transforms.js";
import {
  BrowserStorage,
  STORAGE_KEYS,
} from "../src/application/browser-storage.js";
import * as publicCore from "../src/core/index.js";
import {
  ControllerSystem,
  MechanismSystem,
  PowerSystem,
  SensorSystem,
  SignalSystem,
  StructureSystem,
} from "../src/simulation/systems/index.js";
import {
  projectedBoxArea,
  standardAtmosphere,
} from "../src/simulation/environment/atmosphere.js";

const demoExpectations = {
  gearbox: [17, 24],
  cart: [33, 65],
  drone: [22, 44],
  humanoid: [28, 54],
  mission: [32, 66],
};
const testSystem = (phase, callbacks = {}) => ({ phase, ...callbacks });

const appState = createApplicationState({
  editor: { mode: "build", selectedIds: new Set() },
});
applyEditorAction(appState.editor, { type: "select", id: 42 });
assert(
  appState.editor.selected === 42,
  "editor selection action did not update nested editor state",
);
applyEditorAction(appState.editor, {
  type: "begin-connection",
  partId: 42,
  port: "SHAFT",
});
assert(
  appState.editor.mode === "wire" && appState.editor.connectPort === "SHAFT",
  "connection action did not update editor state atomically",
);
applyEditorAction(appState.editor, { type: "cancel-connection" });
assert(
  appState.editor.mode === "build" && appState.editor.connectFrom === null,
  "connection cancellation left stale editor state",
);
assert.equal(
  Object.hasOwn(appState, "selected"),
  false,
  "application state regained a top-level editor alias",
);
const telemetrySource = { mobility: { speed: 3 } },
  telemetrySnapshot = createTelemetrySnapshot({
    time: 1,
    systems: telemetrySource,
  });
telemetrySource.mobility.speed = 7;
assert(
  Object.isFrozen(telemetrySnapshot) &&
    Object.isFrozen(telemetrySnapshot.systems) &&
    Object.isFrozen(telemetrySnapshot.systems.mobility) &&
    telemetrySnapshot.systems.mobility.speed === 3,
  "telemetry snapshot is not deeply immutable",
);
const immutableReplay = new ReplayBuffer({ sampleHz: 120 });
immutableReplay.record(telemetrySnapshot);
assert.equal(
  immutableReplay.frames[0].telemetry,
  telemetrySnapshot,
  "ReplayBuffer cloned telemetry owned by the immutable publisher",
);
const shallowFrozenTelemetry = Object.freeze({
  time: 2,
  systems: { mobility: { speed: 3 } },
});
immutableReplay.record(shallowFrozenTelemetry, { force: true });
shallowFrozenTelemetry.systems.mobility.speed = 9;
assert.equal(
  immutableReplay.frames.at(-1).telemetry.systems.mobility.speed,
  3,
  "ReplayBuffer trusted an unowned shallow-frozen telemetry graph",
);
const projectedMobility = projectMachineTelemetry(
  {
    systems: {
      mobility: {
        assemblies: [
          {
            assemblyId: "assembly-a",
            memberPartIds: [10],
            pose: { position: [1, 0, 0] },
          },
          {
            assemblyId: "assembly-b",
            memberPartIds: [20],
            pose: { position: [9, 0, 0] },
          },
        ],
      },
    },
    bodies: { bodies: [] },
  },
  [],
  [0, 0, 0],
  [20],
);
assert.deepEqual(
  projectedMobility.mobility.assemblies.map(({ assemblyId }) => assemblyId),
  ["assembly-b"],
  "machine projection selected mobility by hidden array order",
);
assert.deepEqual(projectedMobility.position, [9, 0, 0]);

const dragElement = {
    style: {},
    setPointerCapture() {},
    releasePointerCapture() {},
  },
  draggedPart = {
    id: 99,
    pos: [0, 1, 0],
    mesh: { position: new THREE.Vector3(0, 1, 0) },
  },
  dragEvents = [],
  manipulator = new DirectManipulator({
    element: dragElement,
    pointOnPlane: (x, y, height) => new THREE.Vector3(x / 10, height, y / 10),
    onActivate: () => dragEvents.push("active"),
    onMove: () => dragEvents.push("move"),
    onFinish: ({ moved }) => dragEvents.push(moved ? "moved" : "click"),
  });
assert(
  manipulator.begin(
    { clientX: 0, clientY: 0, pointerId: 1 },
    { enabled: true, primary: draggedPart, parts: [draggedPart] },
  ),
  "component drag did not arm",
);
manipulator.update({ clientX: 5, clientY: 0, pointerId: 1 });
assert.equal(draggedPart.pos[0], 0, "sub-threshold click moved a component");
manipulator.update({ clientX: 10, clientY: 0, pointerId: 1 });
assert.equal(
  draggedPart.pos[0],
  1,
  "promoted drag did not move on the snapped plane",
);
assert(
  manipulator.finish({ pointerId: 1 }),
  "drag finish did not report movement",
);
assert.deepEqual(
  dragEvents,
  ["active", "move", "moved"],
  "direct manipulation lifecycle is inconsistent",
);
const seaLevel = standardAtmosphere(0),
  stratosphere = standardAtmosphere(20000);
assert(
  Math.abs(seaLevel.pressure - 101325) < 1,
  "sea-level atmosphere drifted",
);
assert(
  stratosphere.density < seaLevel.density,
  "air density did not fall with altitude",
);
assert(
  projectedBoxArea({ x: 2, y: 3, z: 4 }, { x: 1, y: 0, z: 0 }) === 12,
  "projected aerodynamic area is incorrect",
);

const reusableSource = {
    parts: [
      {
        id: 10,
        type: "plate",
        pos: [4, 1, -2],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: TYPES.plate,
      },
      {
        id: 11,
        type: "motor",
        pos: [4, 1.54, -2],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: { ...TYPES.motor, power: 37 },
      },
    ],
    connections: [
      {
        id: "mount",
        a: 10,
        b: 11,
        kind: "mechanical",
        portA: "TOP",
        portB: "MOUNT",
        anchorA: [0, 0.09, 0],
        anchorB: [0, -0.45, 0],
        capacity: { ultimateForceN: 24000, ultimateTorqueNm: 6000 },
      },
    ],
  },
  reusable = createSubassemblyTemplate(reusableSource, [10, 11], {
    name: "Drive module",
    origin: [4, 0.9, -2],
  }),
  instance = instantiateSubassembly(reusable, {
    position: [-3, 0.1, 7],
    nextId: 50,
  });
assert.equal(reusable.parts.length, 2, "subassembly lost a selected part");
assert.equal(
  reusable.connections.length,
  1,
  "subassembly lost its internal physical connection",
);
assert.equal(instance.parts[0].id, 50, "subassembly IDs were not remapped");
assert.equal(
  instance.connections[0].b,
  51,
  "subassembly connection endpoints were not remapped",
);
assert.deepEqual(instance.idMap, { 1: 50, 2: 51 });
assert.ok(reusable.exposedPorts.length > 0);
assert.deepEqual(
  instance.exposedPorts,
  reusable.exposedPorts.map((exposed) => ({
    ...exposed,
    partId: instance.idMap[exposed.partId],
  })),
  "subassembly exposed endpoints were not remapped with their owning parts",
);
assert.equal(
  instance.parts[1].config.power,
  37,
  "subassembly lost tuned component behavior",
);
const rejectedLibrary = decodeLocalSubassemblyLibrary([
  {
    name: "Unsupported motor shape",
    base: "motor",
    config: { ...TYPES.motor, rpm: 240 },
    color: "#e8a53a",
  },
]);
assert.equal(
  rejectedLibrary.diagnostics.length,
  1,
  "obsolete one-part library item was not isolated",
);
assert.equal(rejectedLibrary.records.length, 0);
assert.equal(
  createLocalSubassemblyRecord(reusable).asset.parts[1].config.power,
  37,
);
const cartBlueprint = builtInDemo("cart").blueprint,
  cartController = cartBlueprint.parts.find((part) => part.type === "computer"),
  controllerReusable = createSubassemblyTemplate(
    {
      parts: [
        {
          ...structuredClone(cartController),
          id: 1,
          pos: [0, 0, 0],
          controllerBindings: [],
        },
      ],
      connections: [],
    },
    [1],
    { name: "Controller module" },
  ),
  importedRecord = createLocalSubassemblyRecord(controllerReusable, {
    origin: {
      kind: BlueprintAcquisition.SHARE_IMPORT,
      sourceFingerprint: `sim-sha256-${"a".repeat(64)}`,
    },
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:01:00.000Z",
  }),
  controllerId = String(controllerReusable.parts[0].id);
assert.equal(importedRecord.format, LOCAL_SUBASSEMBLY_FORMAT);
assert.deepEqual(Object.keys(importedRecord).sort(), [
  "asset",
  "createdAt",
  "format",
  "origin",
  "programAcquisitionByController",
  "updatedAt",
  "version",
]);
assert.equal(
  importedRecord.programAcquisitionByController[controllerId],
  BlueprintAcquisition.SHARE_IMPORT,
);
assert.equal(decodeLocalSubassemblyLibrary([importedRecord]).records.length, 1);
assert.throws(
  () =>
    createSubassemblyTemplate({ ...reusableSource, connections: [] }, [10, 11]),
  /connected selection/,
  "disconnected parts were accepted as a reusable subassembly",
);

const engineering = analyzeAssembly(
  JSON.stringify({
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
      },
      {
        id: 2,
        type: "rocket",
        pos: [0, 2, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: resolveWireComponentConfig({
          type: "rocket",
          config: { power: 100 },
        }),
      },
      {
        id: 3,
        type: "battery",
        pos: [4, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
    connections: [],
  }),
  TYPES,
);
assert.equal(engineering.totalMass, 101, "engineering mass is inconsistent");
assert.ok(
  engineering.centerOfMass[0] > 0 && engineering.centerOfMass[1] > 1,
  "center of mass did not respond to component placement",
);
assert.equal(
  engineering.thrust.forceN,
  24000,
  "nominal thrust overlay does not match the flight solver",
);
assert.ok(
  engineering.displacedVolumeM3 > 0,
  "center-of-buoyancy analysis has no physical displacement volume",
);
const arrangedParts = [
    { id: 1, pos: [-2, 1, 3] },
    { id: 2, pos: [1, 4, 5] },
    { id: 3, pos: [7, 8, 9] },
  ],
  aligned = alignSelection(arrangedParts, 2, 1),
  distributed = distributeSelection(arrangedParts, 0),
  translated = translateSelectionTo(arrangedParts, [10, 10, 10]);
assert.deepEqual(
  [...aligned.values()].map((position) => position[1]),
  [4, 4, 4],
  "alignment did not use the primary component reference",
);
assert.deepEqual(
  [...distributed.values()].map((position) => position[0]),
  [-2, 2.5, 7],
  "distribution did not preserve endpoints and equalize spacing",
);
assert.ok(
  [...translated.values()]
    .reduce(
      (sum, position) => sum.map((value, axis) => value + position[axis]),
      [0, 0, 0],
    )
    .map((value) => value / 3)
    .every((value) => Math.abs(value - 10) < 1e-9),
  "numeric translation did not move the selection pivot exactly",
);
const normalizedLayouts = normalizeControllerLayouts({
  cart: { style: "drive-pad", title: "Pilot", accent: "#ffb84d" },
  expedition: {
    style: "drive-pad",
    title: "Expedition pilot",
    accent: "invalid",
  },
});
assert.equal(
  normalizedLayouts.cart.style,
  "drive-pad",
  "compatible graphic controller style was rejected",
);
assert.equal(
  normalizedLayouts.expedition.style,
  "drive-pad",
  "reusable graphic controller style depended on the cart profile name",
);
assert.equal(
  normalizedLayouts.expedition.accent,
  "#70e0c4",
  "invalid controller accent was not normalized",
);

for (const [kind, [partCount, connectionCount]] of Object.entries(
  demoExpectations,
)) {
  const { blueprint } = builtInDemo(kind, {
    wat: "(module)",
    typescript: "function tick() {}",
    droneTypescript: "function tick() {}",
  });
  const normalized = normalizeBlueprint(blueprint);
  assert(normalized.parts.length === partCount, `${kind} part count changed`);
  assert(
    normalized.connections.length === connectionCount,
    `${kind} connection count changed`,
  );
  const roundTrip = AssemblyModel.fromBlueprint(normalized).snapshot();
  assert(
    roundTrip.parts.length === partCount,
    `${kind} model round-trip lost parts`,
  );
  assert(
    roundTrip.connections.length === connectionCount,
    `${kind} model round-trip lost connections`,
  );
}

assert.throws(
  () =>
    normalizeBlueprint({
      format: "simulacrum-blueprint",
      version: 2,
      parts: [],
      connections: [],
    }),
  (error) => error.code === "UNSUPPORTED_BLUEPRINT_VERSION",
  "unsupported blueprint v2 was accepted",
);
const currentGearbox = normalizeBlueprint(builtInDemo("gearbox").blueprint),
  exported = createBlueprint(AssemblyModel.fromBlueprint(currentGearbox), {
    name: "Current round-trip",
    remoteProfiles: currentGearbox.remoteProfiles,
    defaultRemoteProfile: currentGearbox.defaultRemoteProfile,
  });
assert.equal(exported.version, 1, "model export did not emit blueprint v1");
assert.deepEqual(
  normalizeBlueprint(exported),
  exported,
  "current blueprint normalization is not idempotent",
);

const graph = AssemblyModel.fromBlueprint({
  parts: [
    { id: 1, type: "computer", orientation: [0, 0, 0, 1] },
    { id: 2, type: "motor", orientation: [0, 0, 0, 1] },
    {
      id: 3,
      type: "axle",
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      mechanism: mechanismComponentDefinition("axle"),
    },
  ],
  connections: [
    {
      id: "signal",
      a: 1,
      b: 2,
      kind: "signal",
      portA: "OUT",
      portB: "CONTROL",
    },
    {
      id: "mechanical",
      a: 2,
      b: 3,
      kind: "mechanical",
      portA: "SHAFT",
      portB: "JOURNAL",
      capacity: { ultimateForceN: 24000, ultimateTorqueNm: 6000 },
    },
  ],
});
assert.equal(
  graph.snapshot().connections[0].id,
  "signal",
  "assembly snapshot lost its stable connection ID",
);
assert(
  graph.controllersFor(2)[0]?.id === 1,
  "controller routing graph is incorrect",
);
assert(
  graph.connectedComponents().length === 1,
  "assembly graph should be connected",
);
graph.addPart({
  id: 4,
  type: "bearing",
  pos: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: { x: 1, y: 1, z: 1 },
  mechanism: mechanismComponentDefinition("bearing"),
});
graph.addConnection({
  a: 3,
  b: 4,
  kind: "mechanical",
  portA: "JOURNAL",
  portB: "SHAFT",
  capacity: { ultimateForceN: 24000, ultimateTorqueNm: 6000 },
});
assert(
  graph.connectedComponents().length === 1,
  "model action did not update graph cache",
);
graph.removeParts([4]);
assert(!graph.hasPart(4), "model action did not remove part");
assert(
  graph
    .snapshot()
    .connections.every(
      (connection) => connection.a !== 4 && connection.b !== 4,
    ),
  "part removal left dangling model connections",
);

assert(
  compatibleTargetPorts(
    { type: "battery" },
    "POWER",
    { type: "computer" },
    TYPES,
  ).includes("POWER"),
  "controller has no compatible electrical power input",
);
assert(
  compatibleTargetPorts({ type: "battery" }, "POWER", { type: "beam" }, TYPES)
    .length === 0,
  "electrical power incorrectly connects to a structural beam",
);
assert(
  inferConnectionKind(
    { type: "gear12", config: { teeth: 12 } },
    { type: "gear24", config: { teeth: 24 } },
  ) === "mesh",
  "gear-to-gear inference is not a tooth mesh",
);

const phases = [];
const session = new SimulationSession({
  systems: [
    testSystem("thermal", { step: () => phases.push("thermal") }),
    testSystem("sensors", { step: () => phases.push("sensors") }),
    testSystem("integration", { step: () => phases.push("integration") }),
  ],
}).start(graph.snapshot());
assert(
  session.step(1 / 60) === 2,
  "fixed 1/120 accumulator did not take two steps",
);
assert(
  phases.join(",") ===
    "sensors,integration,thermal,sensors,integration,thermal",
  "simulation systems ran out of phase order",
);
assert(Math.abs(session.time - 1 / 60) < 1e-10, "session time drifted");
assert.equal(
  session.stepFixed(),
  1,
  "single-step did not advance exactly once",
);
assert(
  Math.abs(session.time - 1 / 40) < 1e-10,
  "single-step did not advance exactly 1/120 second",
);
assert.equal(phases.length, 9, "single-step skipped a simulation phase");
session.dispose();

const controllerReads = [],
  networkSession = new SimulationSession({
    systems: [
      new SensorSystem(),
      new ControllerSystem(),
      new PowerSystem(),
      new SignalSystem(),
      testSystem("telemetry", {
        step: (context) => {
          context.telemetry = Object.freeze({
            ...context.telemetry,
            time: context.time,
          });
        },
      }),
    ],
  }).start(
    {
      revision: 1,
      parts: [
        {
          id: 1,
          type: "battery",
          orientation: [0, 0, 0, 1],
          storedEnergyWh: 10,
          config: { capacityWh: 10 },
        },
        { id: 2, type: "computer", orientation: [0, 0, 0, 1] },
        { id: 3, type: "motor", orientation: [0, 0, 0, 1] },
      ],
      connections: [
        {
          id: "power",
          a: 1,
          b: 2,
          kind: "power",
          portA: "POWER",
          portB: "POWER",
        },
        {
          id: "motor-power",
          a: 1,
          b: 3,
          kind: "power",
          portA: "POWER",
          portB: "POWER",
        },
        {
          id: "signal",
          a: 2,
          b: 3,
          kind: "signal",
          portA: "OUT",
          portB: "CONTROL",
        },
      ],
    },
    {
      catalog: TYPES,
      readSensors: (context) => ({
        sample: context.previousTelemetry.time || 0,
      }),
      tickControllers: (_dt, sensors) => controllerReads.push(sensors),
    },
  );
networkSession.step(1 / 120);
networkSession.step(1 / 120);
assert(
  controllerReads[0].sample === 0 &&
    Math.abs(controllerReads[1].sample - 1 / 120) < 1e-12,
  "controller did not read the previous completed telemetry snapshot",
);
assert(
  networkSession.context.powerNetwork.isPowered(2),
  "powered controller was not resolved from the electrical graph",
);
assert(
  networkSession.context.signalNetwork.controllersForTarget(3).includes(2),
  "powered signal route was not resolved",
);
networkSession.context.runGraph.consumeEnergy(1, 10 * 3600);
networkSession.step(1 / 120);
assert(
  !networkSession.context.powerNetwork.isPowered(2),
  "power loss did not invalidate the controller network",
);
assert(
  networkSession.context.signalNetwork.controllersForTarget(3).length === 0,
  "signal route remained online after controller power loss",
);
networkSession.dispose();

const runtimeParts = [
    {
      id: 1,
      type: "battery",
      orientation: [0, 0, 0, 1],
      storedEnergyWh: 10,
      config: { capacityWh: 10 },
    },
    {
      id: 2,
      type: "motor",
      orientation: [0, 0, 0, 1],
      phase: 0,
      config: { rpm: 60, power: 4, direction: 1 },
    },
    {
      id: 3,
      type: "gear12",
      orientation: [0, 0, 0, 1],
      phase: 0,
      config: { teeth: 12 },
    },
    {
      id: 4,
      type: "gear24",
      orientation: [0, 0, 0, 1],
      phase: 0,
      config: { teeth: 24 },
    },
  ],
  runtimeConnections = [
    {
      id: "power",
      a: 1,
      b: 2,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
    },
    {
      id: "shaft",
      a: 2,
      b: 3,
      kind: "mechanical",
      portA: "SHAFT",
      portB: "AXLE",
      capacity: { ultimateForceN: 240, ultimateTorqueNm: 120 },
    },
    {
      id: "mesh",
      a: 3,
      b: 4,
      kind: "mesh",
      portA: "MESH",
      portB: "MESH",
      capacity: { ultimateForceN: 1, ultimateTorqueNm: 0.5 },
    },
  ],
  physicalSession = new SimulationSession({
    systems: [new PowerSystem(), new MechanismSystem(), new StructureSystem()],
  }).start(
    { revision: 1, parts: runtimeParts, connections: runtimeConnections },
    {
      connectionValid: (connection) => !connection.failed,
      catalog: TYPES,
      partMass: () => 6,
      forwardSpeed: () => 0,
      multibodyRuntime: {
        compiled: { parts: runtimeParts },
        bodyByPart: new Map(runtimeParts.map((part) => [part.id, { mass: 6 }])),
        constraintEntries: [
          {
            active: true,
            descriptor: {
              kind: "fixed",
              a: 2,
              b: 3,
              sourceConnectionIds: ["shaft"],
            },
          },
          {
            active: true,
            descriptor: {
              kind: "gear",
              a: 3,
              b: 4,
              sourceConnectionIds: ["mesh"],
            },
          },
        ],
        loadByConnection: new Map([
          ["shaft", 60],
          ["mesh", 0.6],
        ]),
        torqueByConnection: new Map([
          ["shaft", 0],
          ["mesh", 0.2],
        ]),
        stepActuators: () => ({ active: true }),
        applyConnectionFailures: () => [],
      },
    },
  );
physicalSession.context.commandBus.writeRemote(2, "throttle", 1);
physicalSession.step(1 / 120);
assert(
  runtimeParts.every((part) => !part.phase),
  "mechanism fallback still animated physical poses",
);
assert(
  physicalSession.context.telemetry.systems.structures.worstFatigue > 0 &&
    physicalSession.context.runGraph.connection("mesh").stress > 0,
  "structure system did not derive fatigue from physical load",
);
assert.equal(
  runtimeConnections[1].stress,
  undefined,
  "transient structural state leaked into the editor connection",
);
physicalSession.dispose();

const bus = new CommandBus();
bus.writeRemote(2, "throttle", 0.25);
assert(
  bus.read(2, "throttle").source === "remote",
  "remote fallback is unavailable",
);
bus.writeScript(1, "drive", 2, "throttle", 0.7);
assert(bus.read(2, "throttle").value === 0.7, "script did not override remote");
bus.writeScript(3, "drive", 2, "throttle", 0.9);
assert(
  bus.read(2, "throttle").conflict,
  "multi-controller conflict was hidden",
);

const preparedRuntime = (value, options = {}) => ({
    language: "test",
    policyVersion: "test-v1",
    instantiate() {
      return {
        tick() {
          if (options.trap) throw new Error(options.trap);
          return new Map([["throttle", value]]);
        },
        dispose() {
          options.onDispose?.();
        },
      };
    },
  }),
  statuses = [],
  manager = new ControllerRuntimeManager({
    onStatus: (id, status) => statuses.push([id, status]),
  });
let disposeCount = 0;
manager.attach(
  10,
  preparedRuntime(0.5, { onDispose: () => disposeCount++ }),
  "TS",
);
manager.attach(
  11,
  preparedRuntime(0.5, { onDispose: () => disposeCount++ }),
  "WASM",
);
assert(manager.tick(10, 1 / 120, {}), "first controller did not tick");
assert(
  manager.tick(11, 1 / 120, {}),
  "second controller did not tick independently",
);
assert(
  manager.commands(10).get("throttle") === 0.5,
  "first commands were lost",
);
assert(
  manager.commands(11).get("throttle") === 0.5,
  "second commands were lost",
);
manager.disposeAll();
assert(disposeCount === 2, "controller engines leaked");
assert(statuses.length === 2, "controller statuses were not independent");

const isolatedManager = new ControllerRuntimeManager();
isolatedManager.attach(
  20,
  preparedRuntime(0, { trap: "fuel exhausted" }),
  "TRAP",
);
isolatedManager.attach(21, preparedRuntime(0.5), "HEALTHY");
assert.equal(isolatedManager.tick(20, 1 / 120, {}), false);
assert.equal(isolatedManager.tick(21, 1 / 120, {}), true);
assert(!isolatedManager.ready(20), "trapped controller remained online");
assert(
  isolatedManager.ready(21),
  "one controller trap terminated another controller",
);
assert.match(isolatedManager.status(20).status, /TRAP: fuel exhausted/);
isolatedManager.disposeAll();

const history = new HistoryStore({ limit: 2 });
history.record("first", { value: 1 });
history.record("second", { value: 2 });
history.record("third", { value: 3 });
assert.equal(history.undoStack.length, 2, "history limit was not enforced");
const undone = history.undo({ value: 4 });
assert.deepEqual(undone.snapshot, { value: 3 }, "undo returned wrong snapshot");
assert.deepEqual(
  history.redo({ value: 2 }).snapshot,
  { value: 4 },
  "redo returned wrong snapshot",
);

const values = new Map(),
  fakeStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  },
  browserStorage = new BrowserStorage(fakeStorage, { logger: { warn() {} } });
assert.deepEqual(
  browserStorage.readJson(STORAGE_KEYS.challengeBest, { safe: true }),
  { safe: true },
  "empty current persistence did not use its root default",
);
assert.equal(
  browserStorage.writeJson(STORAGE_KEYS.challengeBest, { score: 7 }).ok,
  true,
);
assert.deepEqual(browserStorage.readJson(STORAGE_KEYS.challengeBest, {}), {
  score: 7,
});

const failureRecorder = new FailureRecorder({ catalog: TYPES }),
  replay = new ReplayBuffer({
    seconds: 1,
    sampleHz: 4,
    postFailureSeconds: 0.5,
  }),
  failureParts = [
    { id: 1, type: "plate" },
    { id: 2, type: "motor" },
  ],
  failureConnection = {
    id: "joint-1",
    a: 1,
    b: 2,
    kind: "mechanical",
    capacity: { ultimateForceN: 1000, ultimateTorqueNm: 500 },
    failed: false,
  };
for (const time of [0, 0.25, 0.5]) {
  replay.record({ time, systems: {} });
  const failed = time === 0.5,
    runConnection = {
      ...failureConnection,
      failed,
      peakLoadN: failed ? 2600 : time * 2000,
      lastLoadN: failed ? 2600 : time * 2000,
      failureMode: failed ? "impact" : null,
      failureReason: failed
        ? "2600 N collision load exceeded 1000 N rating"
        : null,
    };
  failureRecorder.ingest(
    {
      time,
      run: {
        parts: failureParts.map((part) => ({
          ...part,
          detached: failed && part.id === 2,
        })),
        connections: [runConnection],
      },
      bodies: {
        bodies: failureParts.map((part) => ({
          bodyId: `body:${part.id}`,
          partIds: [part.id],
          descriptors: [{ massKg: 10 }],
          pose: {
            position: { x: part.id === 1 ? 0 : 2, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
          velocity: { x: 0, y: 0, z: 0 },
          contacts: failed
            ? [
                {
                  otherBodyId: "environment:field",
                  surface: "field",
                  normal: { x: 0, y: 1, z: 0 },
                  relativeVelocity: { x: 5, y: 0, z: 0 },
                },
              ]
            : [],
          detached: failed && part.id === 2,
        })),
        bodyByPart: failureParts.map((part) => ({
          partId: part.id,
          bodyId: `body:${part.id}`,
        })),
      },
      systems: {
        physicalAssembly: {
          schemaVersion: 1,
          compiledIdentity: "compiled-physical:core-failure-test",
          graphRevision: failed ? 1 : 0,
          topologyRevision: failed ? 1 : 0,
          components: (failed ? [[1], [2]] : [[1, 2]]).map((partIds) => ({
            id: `physical-test:${partIds.join("|")}`,
            partIds,
            bodyPartIds: partIds,
            compiledBodyIds: partIds.map((partId) => `body:${partId}`),
            constraintIds: failed ? [] : ["joint-1"],
            sourceConnectionIds: failed ? [] : ["joint-1"],
            supportPartIds: partIds,
            lineage: {
              parentIds: [],
              splitFromIds: [],
              structuralEventIds: [],
            },
          })),
        },
        fluids: { byPart: {} },
      },
    },
    {
      parts: failureParts,
      connections: [{ ...failureConnection, failed: time === 0.5 }],
      positions: { 1: [0, 0, 0], 2: [2, 0, 0] },
    },
  );
}
const report = failureRecorder.report();
assert.equal(report.eventCount, 1, "failure transition was not recorded once");
assert.equal(report.primary.mode, "impact", "impact cause was misclassified");
assert.equal(report.primary.load.peakN, 2600, "peak failure load was lost");
assert.equal(report.primary.load.ratedN, 1000, "attachment rating was lost");
assert.equal(
  report.primary.worldPosition.x,
  1,
  "failure point was not derived",
);
assert.equal(
  report.primary.detachedPartIds[0],
  2,
  "failure consequence was not retained",
);
assert.ok(
  report.primary.causalChain.length >= 4,
  "post-mortem omitted its causal chain",
);
replay.pinFailure(0.5);
replay.record({ time: 0.75, systems: {} });
replay.record({ time: 1, systems: {} });
assert.equal(
  replay.snapshot().frozen,
  true,
  "replay did not freeze after failure",
);
assert.ok(
  replay.snapshot().frameCount <= 4,
  "replay buffer exceeded its bound",
);
assert.equal(replay.frame(999).time, 1, "replay frame clamping failed");

for (const contract of [
  "AssemblyModel",
  "SimulationSession",
  "ChallengeBindingResolver",
  "ControllerRuntimeManager",
  "HistoryStore",
  "MobilityTelemetrySystem",
  "PhysicalAssemblyIndex",
  "standardAtmosphere",
  "FailureRecorder",
  "ReplayBuffer",
  "resolveRemoteAction",
  "resolveRemoteActionState",
  "remoteActionTargetPartIds",
  "validateRemoteActionBindings",
])
  assert.equal(
    typeof publicCore[contract],
    "function",
    `public core is missing ${contract}`,
  );
assert.deepEqual(publicCore.REMOTE_ACTIONS, [
  "forward",
  "reverse",
  "left",
  "right",
  "brake",
  "lights",
]);

console.log("core model/session/controller contracts passed");
