import { assert } from "./lib/assert.mjs";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { decodeBlueprint } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { DomainValidationError } from "../src/model/primitives.js";
import {
  createSharePackage,
  decodeSharePackage,
} from "../src/model/share-packages.js";
import {
  focusedEnvironmentObject,
  syncEnvironmentBodyObjects,
} from "../src/presentation/environment-body-presentation.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import {
  EnvironmentBodyRegistry,
  measureEnvironmentProximity,
} from "../src/simulation/environment/environment-body-registry.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { SignalNetwork } from "../src/simulation/signal-network.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { EnvironmentBodySystem } from "../src/simulation/systems/environment-body-system.js";
import { SensorSystem } from "../src/simulation/systems/sensor-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const orientation = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

function descriptor({
  id,
  positionM = [0, 100, 0],
  velocityMps = [0, 0, 0],
  radiusM = 10,
  frame = "local-world-v1",
  queryKinds = ["sensing"],
} = {}) {
  return {
    id,
    frame,
    geometry: { kind: "sphere-v1", radiusM },
    queryKinds,
    pose: { positionM, orientation },
    velocityMps,
  };
}

const registry = new EnvironmentBodyRegistry([
  descriptor({
    id: "environment:global",
    frame: "earth-tangent-global-v1",
    positionM: [1_050, 100, 2_025],
    velocityMps: [0, -2, 0],
  }),
]);
const translated = registry.snapshot({
  time: 2,
  origin: { x: 1_000, y: 0, z: 2_000 },
});
assert.deepEqual(translated.bodies[0].pose.position, {
  x: 50,
  y: 100,
  z: 25,
});
assert.equal(Object.isFrozen(translated), true);
assert.throws(
  () => registry.register(descriptor({ id: "environment:global" })),
  (error) =>
    error instanceof DomainValidationError &&
    error.code === "DUPLICATE_ENVIRONMENT_BODY",
);
assert.throws(
  () =>
    registry.register({
      ...descriptor({ id: "environment:extra" }),
      presentationOnly: true,
    }),
  (error) =>
    error instanceof DomainValidationError &&
    error.code === "INVALID_ENVIRONMENT_BODY_FIELDS",
);

const movingRegistry = new EnvironmentBodyRegistry();
movingRegistry.register(
  descriptor({ id: "environment:moving" }),
  ({ time, descriptor: authored }) => ({
    pose: {
      positionM: [0, authored.pose.positionM[1] + time * 10, 0],
      orientation,
    },
    velocityMps: [0, 10, 0],
  }),
);
assert.equal(
  movingRegistry.snapshot({ time: 3 }).bodies[0].pose.position.y,
  130,
);
assert.throws(
  () => {
    const invalidProvider = new EnvironmentBodyRegistry();
    invalidProvider.register(
      descriptor({ id: "environment:bad-provider" }),
      () => ({
        pose: {
          positionM: [0, 0, 0],
          orientation: { x: 0, y: 0, z: 0, w: 2 },
        },
        velocityMps: [0, 0, 0],
      }),
    );
    invalidProvider.snapshot();
  },
  (error) =>
    error instanceof DomainValidationError &&
    error.code === "INVALID_ENVIRONMENT_BODY_ORIENTATION",
);

const sensorPose = { position: { x: 0, y: 0, z: 0 } },
  straightSnapshot = new EnvironmentBodyRegistry([
    descriptor({
      id: "environment:straight",
      velocityMps: [0, -2, 0],
    }),
  ]).snapshot(),
  straight = measureEnvironmentProximity({
    sensorPose,
    sensorVelocity: { x: 0, y: 1, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
    fieldOfViewDeg: 10,
    maximumRangeM: 200,
    rangeResolutionM: 0.25,
    environmentBodies: straightSnapshot,
  });
assert.equal(straight.hitBodyId, "environment:straight");
assert.equal(straight.rangeM, 90);
assert.equal(straight.rangeRateMps, -3);
assert.deepEqual(straight.relativeVelocityMps, { x: 0, y: -3, z: 0 });

const edgeHit = measureEnvironmentProximity({
    sensorPose,
    axis: { x: 0, y: 1, z: 0 },
    fieldOfViewDeg: 10,
    maximumRangeM: 200,
    rangeResolutionM: 0.1,
    environmentBodies: new EnvironmentBodyRegistry([
      descriptor({ id: "environment:edge", positionM: [15, 100, 0] }),
    ]).snapshot(),
  }),
  outsideBeam = measureEnvironmentProximity({
    sensorPose,
    axis: { x: 0, y: 1, z: 0 },
    fieldOfViewDeg: 10,
    maximumRangeM: 200,
    rangeResolutionM: 0.1,
    environmentBodies: new EnvironmentBodyRegistry([
      descriptor({ id: "environment:outside", positionM: [30, 100, 0] }),
    ]).snapshot(),
  });
assert.equal(edgeHit.hit, true, "sphere edge inside the cone was not sensed");
assert.equal(outsideBeam.hit, false, "body outside the FOV was sensed");

const occlusion = measureEnvironmentProximity({
  sensorPose,
  axis: { x: 0, y: 1, z: 0 },
  fieldOfViewDeg: 10,
  maximumRangeM: 200,
  rangeResolutionM: 1,
  environmentBodies: new EnvironmentBodyRegistry([
    descriptor({
      id: "environment:a-farther",
      positionM: [0, 65.4, 0],
      radiusM: 10,
    }),
    descriptor({
      id: "environment:z-nearer",
      positionM: [0, 65.1, 0],
      radiusM: 10,
    }),
  ]).snapshot(),
});
assert.equal(
  occlusion.hitBodyId,
  "environment:z-nearer",
  "quantization changed the physically nearest occluder",
);
assert.equal(occlusion.rangeM, 55);

const renderedObject = {
    position: {
      set(x, y, z) {
        this.value = { x, y, z };
      },
    },
    quaternion: {
      set(x, y, z, w) {
        this.value = { x, y, z, w };
      },
    },
  },
  renderedBodies = new Map([["environment:straight", renderedObject]]);
syncEnvironmentBodyObjects(straightSnapshot, renderedBodies);
assert.deepEqual(renderedObject.position.value, { x: 0, y: 100, z: 0 });
assert.deepEqual(renderedObject.quaternion.value, orientation);
assert.equal(
  focusedEnvironmentObject({
    sensorTelemetry: {
      controllers: {
        controller: {
          __bindings: [
            {
              valid: true,
              bound: true,
              hitBodyId: "environment:straight",
              rangeM: 25,
            },
          ],
        },
      },
    },
    objectByBodyId: renderedBodies,
  }),
  renderedObject,
);
assert.equal(
  focusedEnvironmentObject({
    sensorTelemetry: {
      controllers: {
        controller: {
          __bindings: [
            {
              valid: true,
              bound: false,
              hitBodyId: "environment:straight",
              rangeM: 25,
            },
          ],
        },
      },
    },
    objectByBodyId: renderedBodies,
  }),
  null,
);

const mission = builtInDemo("mission").blueprint,
  rangeSensor = mission.parts.find((part) => part.type === "rangesensor"),
  controller = mission.parts.find((part) => part.type === "computer"),
  compiled = compileAssembly(mission, TYPES),
  compiledSensor = compiled.bodies.find(
    (body) => body.partId === rangeSensor.id,
  )?.capabilities?.sensor;
assert.ok(rangeSensor && controller && compiledSensor?.measurement);
assert.equal(compiledSensor.measurement.kind, "conical-range-v1");
assert.deepEqual(
  controller.controllerBindings
    .filter((binding) => binding.endpointPartId === rangeSensor.id)
    .map((binding) => binding.id),
  ["target.detected", "target.range", "target.range_rate"],
);
for (const kind of ["mechanical", "power", "signal"])
  assert.ok(
    mission.connections.some(
      (connection) =>
        connection.kind === kind &&
        (connection.a === rangeSensor.id || connection.b === rangeSensor.id),
    ),
    `orbital range sensor lacks an ordinary ${kind} connection`,
  );
const roundTrip = decodeBlueprint(JSON.parse(JSON.stringify(mission)));
assert.equal(roundTrip.ok, true);
assert.deepEqual(
  roundTrip.value.wire.parts.find((part) => part.id === rangeSensor.id).config,
  rangeSensor.config,
);
const sharedMission = await createSharePackage({
    kind: "blueprint",
    asset: mission,
    metadata: { title: "Sensor mission" },
  }),
  decodedShare = await decodeSharePackage(JSON.stringify(sharedMission));
assert.equal(decodedShare.ok, true);
assert.equal(
  decodedShare.item.dependencies.componentTypes.includes("rangesensor"),
  true,
);
assert.deepEqual(
  decodedShare.item.asset.parts.find((part) => part.id === rangeSensor.id)
    .config,
  rangeSensor.config,
);

const graph = new RunAssemblyGraph(mission),
  power = new PowerNetwork(TYPES).resolve(graph, 1 / 120),
  signals = new SignalNetwork(TYPES).resolve(graph, power);
assert.equal(power.isPowered(rangeSensor.id), true);
assert.equal(
  signals.hasSensorRoute(controller.id, rangeSensor.id, "SIGNAL"),
  true,
);

const bodies = {
    bodies: [
      {
        bodyId: `body:${rangeSensor.id}`,
        bound: true,
        detached: false,
        pose: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: orientation,
        },
        velocity: { x: 0, y: 1, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0, y: 0, z: 0 },
        contacts: [],
        loads: [],
        thermal: {},
      },
    ],
    bodyByPart: [{ partId: rangeSensor.id, bodyId: `body:${rangeSensor.id}` }],
  },
  sensorBank = new ControllerSensorBank(),
  captured = sensorBank.capture({
    parts: mission.parts,
    connections: mission.connections,
    bodies,
    signals: signals.telemetry(),
    environmentBodies: straightSnapshot,
    compiledBodies: compiled.bodies,
    fixedDt: 1 / 120,
  }),
  rangeBinding = captured[controller.id].__bindings.find(
    (binding) => binding.bindingId === "target.range",
  );
assert.equal(rangeBinding.valid, true);
assert.equal(rangeBinding.bound, true);
assert.equal(rangeBinding.hitBodyId, "environment:straight");
assert.equal(captured[controller.id]["target.detected"], 1);

const sensorPowerConnection = mission.connections.find(
    (connection) =>
      connection.kind === "power" &&
      (connection.a === rangeSensor.id || connection.b === rangeSensor.id),
  ),
  powerLossGraph = new RunAssemblyGraph(mission);
powerLossGraph.failConnection(sensorPowerConnection.id);
const powerAfterLoss = new PowerNetwork(TYPES).resolve(powerLossGraph, 1 / 120),
  withoutSensorPower = new SignalNetwork(TYPES).resolve(
    powerLossGraph,
    powerAfterLoss,
  ),
  unpoweredCapture = new ControllerSensorBank().capture({
    parts: mission.parts,
    connections: mission.connections,
    bodies,
    signals: withoutSensorPower.telemetry(),
    environmentBodies: straightSnapshot,
    compiledBodies: compiled.bodies,
    fixedDt: 1 / 120,
  }),
  unpoweredRange = unpoweredCapture[controller.id].__bindings.find(
    (binding) => binding.bindingId === "target.range",
  );
assert.equal(powerAfterLoss.isPowered(rangeSensor.id), false);
assert.equal(
  withoutSensorPower
    .sensorsForController(controller.id)
    .includes(rangeSensor.id),
  false,
);
assert.equal(unpoweredRange.routeOnline, false);
assert.equal(unpoweredRange.valid, false);
assert.equal(unpoweredRange.hitBodyId, null);

const sensorSignalConnection = mission.connections.find(
    (connection) =>
      connection.kind === "signal" &&
      (connection.a === rangeSensor.id || connection.b === rangeSensor.id),
  ),
  signalLossGraph = new RunAssemblyGraph(mission);
signalLossGraph.failConnection(sensorSignalConnection.id);
const powerWithSignalLoss = new PowerNetwork(TYPES).resolve(
    signalLossGraph,
    1 / 120,
  ),
  signalsAfterLoss = new SignalNetwork(TYPES).resolve(
    signalLossGraph,
    powerWithSignalLoss,
  ),
  signalLossCapture = new ControllerSensorBank().capture({
    parts: mission.parts,
    connections: signalLossGraph.connections(),
    bodies,
    signals: signalsAfterLoss.telemetry(),
    environmentBodies: straightSnapshot,
    compiledBodies: compiled.bodies,
    fixedDt: 1 / 120,
  }),
  signalLossRange = signalLossCapture[controller.id].__bindings.find(
    (binding) => binding.bindingId === "target.range",
  );
assert.equal(powerWithSignalLoss.isPowered(rangeSensor.id), true);
assert.equal(signalLossRange.routeOnline, false);
assert.equal(signalLossRange.valid, false);
assert.equal(signalLossRange.hitBodyId, null);

const looseBodies = { ...bodies, bodies: [], bodyByPart: [] },
  looseCapture = new ControllerSensorBank().capture({
    parts: mission.parts,
    connections: mission.connections,
    bodies: looseBodies,
    signals: signals.telemetry(),
    environmentBodies: straightSnapshot,
    compiledBodies: compiled.bodies,
    fixedDt: 1 / 120,
  }),
  looseRange = looseCapture[controller.id].__bindings.find(
    (binding) => binding.bindingId === "target.range",
  );
assert.equal(looseRange.routeOnline, true);
assert.equal(looseRange.bound, false);
assert.equal(looseRange.valid, false);
assert.equal(looseRange.hitBodyId, null);

const latencyRegistry = new EnvironmentBodyRegistry();
latencyRegistry.register(
  descriptor({ id: "environment:latency" }),
  ({ time }) => ({
    pose: { positionM: [0, 100 + time * 10, 0], orientation },
    velocityMps: [0, 10, 0],
  }),
);
const latencySession = new SimulationSession({
  systems: [
    new SensorSystem(),
    new EnvironmentBodySystem(),
    new TelemetrySystem(),
  ],
}).start(
  { revision: 1, parts: [], connections: [] },
  {
    environmentBodyRegistry: latencyRegistry,
    readSensors: (context) => ({
      sampledEnvironmentTime:
        context.previousTelemetry.systems.environmentBodies.time,
    }),
  },
);
latencySession.stepFixed();
assert.equal(
  latencySession.telemetry().systems.sensors.sampledEnvironmentTime,
  0,
  "sensor consumed same-step environment state",
);
const checkpoint = latencySession.exportState();
latencySession.stepFixed();
const expectedResume = latencySession.telemetry();
assert.equal(expectedResume.systems.sensors.sampledEnvironmentTime, 1 / 120);
latencySession.importState(checkpoint);
latencySession.resynchronizeAfterCheckpointRestore();
latencySession.stepFixed();
assert.deepEqual(latencySession.telemetry(), expectedResume);
latencySession.dispose();

console.log(
  "environment proximity passed (strict registry, sphere/FOV/occlusion geometry, powered routing, physical binding, previous-step latency, exact resume)",
);
