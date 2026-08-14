import { assert } from "./lib/assert.mjs";
import {
  compileVisualProgram,
  DEFAULT_VISUAL_PROGRAM,
} from "../src/model/visual-logic.js";
import { ControllerTraceBuffer } from "../src/model/controller-debugger.js";
import { controllerSensorFrameForId } from "../src/model/controller-sensor-frame-evidence.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { normalizeBlueprint } from "../src/model/blueprints.js";
import { componentDefaults } from "../src/model/component-resolver.js";

const compiled = compileVisualProgram(DEFAULT_VISUAL_PROGRAM, []);
assert.match(compiled.source, /function tick/);
assert.doesNotMatch(compiled.source, /api\.(read|write)/);
assert.throws(
  () =>
    compileVisualProgram(
      {
        version: 1,
        name: "Cycle",
        nodes: [
          { id: "a", type: "math" },
          { id: "b", type: "output" },
        ],
        links: [
          { from: "a", to: "b", input: 0 },
          { from: "b", to: "a", input: 0 },
        ],
      },
      [],
    ),
  /feedback cycle/,
);

const controllerBindings = [
    ["imu.rate_z", 2, "imu_rate_z"],
    ["imu.accel_x", 2, "imu_accel_x"],
    ["air.static_pressure", 3, "static_pressure_pa"],
    ["load.force", 5, "load_n"],
    ["load.ratio", 5, "load_ratio"],
    ["thermal.temperature", 6, "temperature_c"],
    ["thermal.heat_flux", 6, "heat_flux_kw_m2"],
    ["contact.state", 7, "contact"],
    ["contact.force", 7, "contact_force_n"],
  ].map(([id, endpointPartId, reading]) => ({
    id,
    direction: "input",
    endpointPartId,
    endpointPortId: "SIGNAL",
    reading,
  })),
  parts = [
    { id: 1, type: "computer", controllerBindings },
    { id: 2, type: "imu" },
    { id: 3, type: "pressureprobe" },
    { id: 4, type: "contactsensor" },
    { id: 5, type: "loadcell" },
    {
      id: 6,
      type: "thermalprobe",
    },
    { id: 7, type: "contactsensor" },
  ],
  connections = [
    { id: "imu", a: 2, b: 1, kind: "signal", portA: "SIGNAL", portB: "IN A" },
    { id: "air", a: 3, b: 1, kind: "signal", portA: "SIGNAL", portB: "IN B" },
    {
      id: "loose",
      a: 3,
      b: 4,
      kind: "signal",
      portA: "SIGNAL",
      portB: "SIGNAL",
    },
    {
      id: "load-signal",
      a: 5,
      b: 1,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
    {
      id: "thermal-signal",
      a: 6,
      b: 1,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN B",
    },
    {
      id: "contact-signal",
      a: 7,
      b: 1,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
    {
      id: "load-link",
      a: 5,
      b: 3,
      kind: "mechanical",
      portA: "B",
      portB: "MOUNT",
      capacity: { ultimateForceN: 100, ultimateTorqueNm: 25 },
    },
  ],
  bank = new ControllerSensorBank(),
  body = (bodyId, partId, overrides = {}) => ({
    bodyId,
    partIds: [partId],
    bound: true,
    detached: false,
    pose: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    contacts: [],
    loads: [],
    thermal: {},
    ...overrides,
  }),
  boundIds = [2, 3, 5, 6, 7],
  bodies = {
    tick: 1,
    bodies: [
      body("imu-body", 2, {
        pose: {
          position: { x: 0, y: 5, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
        velocity: { x: 2, y: 0, z: 0 },
        angularVelocity: { x: 0.4, y: 0.5, z: 0.6 },
        acceleration: { x: 240, y: 0, z: 0 },
      }),
      body("pressure-body", 3, {
        pose: {
          position: { x: 0, y: 1200, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
        velocity: { x: 10, y: 2, z: -3 },
      }),
      body("load-body", 5, { loads: [{ forceN: 40 }] }),
      body("thermal-body", 6, {
        thermal: { temperatureK: 500, heatFluxWm2: 123000 },
      }),
      body("contact-body", 7, {
        contacts: [
          {
            tick: 1,
            normalForceValid: true,
            forceN: 88,
            point: { x: 0, y: 0, z: 0 },
            normal: { x: 0, y: 1, z: 0 },
            forceWorldN: { x: 0, y: 88, z: 0 },
            observationFrame: {
              position: { x: 0, y: 0, z: 0 },
              quaternion: { x: 0, y: 0, z: 0, w: 1 },
            },
          },
        ],
      }),
    ],
    bodyByPart: [
      { partId: 2, bodyId: "imu-body" },
      { partId: 3, bodyId: "pressure-body" },
      { partId: 5, bodyId: "load-body" },
      { partId: 6, bodyId: "thermal-body" },
      { partId: 7, bodyId: "contact-body" },
    ],
  },
  signals = {
    controllerSensors: [
      {
        controllerId: 1,
        endpoints: boundIds.map((partId) => ({
          partId,
          portIds: ["SIGNAL"],
        })),
      },
    ],
  },
  values = controllerSensorFrameForId(
    bank.capture({ parts, connections, bodies, signals }),
    1,
  );
assert.equal(values["imu.rate_z"], 0.6);
assert.equal(values["imu.accel_x"], 240);
assert.ok(Math.abs(values["air.static_pressure"] - 87715.57) < 0.01);
assert.equal(values["load.force"], 40);
assert.equal(values["load.ratio"], 0.4);
assert.ok(Math.abs(values["thermal.temperature"] - 226.85) < 1e-9);
assert.equal(values["thermal.heat_flux"], 123);
assert.equal(values["contact.state"], 1);
assert.equal(values["contact.force"], 88);
assert.ok(
  !values.__bindings.some(({ endpointPartId }) => endpointPartId === 4),
  "an unbound sensor leaked into controller input",
);
assert.deepEqual(
  values.__bindings.map(({ bindingId, endpointPartId, valid }) => ({
    bindingId,
    endpointPartId,
    valid,
  })),
  [...controllerBindings]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map(({ id: bindingId, endpointPartId }) => ({
      bindingId,
      endpointPartId,
      valid: true,
    })),
  "debug provenance did not match the explicit physical bindings",
);

const trace = new ControllerTraceBuffer({ capacity: 30 });
trace.setWatches(1, ["sensor.speed", "command.throttle"]);
trace.setBreakpoint(1, { name: "sensor.speed", op: "gt", value: 5 });
for (let tick = 1; tick <= 42; tick++)
  trace.ingest({
    controllerId: 1,
    tick,
    time: tick / 120,
    sensors: { speed: tick / 6 },
    commands: { throttle: 0.5 },
  });
const debug = trace.snapshot(1);
assert.equal(debug.sampleCount, 30);
assert.equal(debug.triggered.tick, 31);
assert.equal(debug.traces.length, 2);
assert.equal(debug.latest["command.throttle"], 0.5);
debug.latest["command.throttle"] = 99;
assert.equal(
  trace.snapshot(1).latest["command.throttle"],
  0.5,
  "controller trace snapshots leaked caller mutations into retained evidence",
);
trace.ingest({
  controllerId: 1,
  tick: 43,
  time: 43 / 120,
  sensors: { speed: 43 / 6 },
  commands: { throttle: 0.5 },
});
const compactDebug = trace.snapshot(1, { includeTraces: false });
assert.equal(compactDebug.sampleCount, 30);
assert.deepEqual(compactDebug.traces, []);

const savedVisualProgram = structuredClone(DEFAULT_VISUAL_PROGRAM);
savedVisualProgram.nodes.push({
  id: "saved-clamp",
  type: "clamp",
  x: 880,
  y: 500,
  config: { min: -1, max: 1 },
});
const roundTrip = normalizeBlueprint({
  format: "simulacrum-blueprint",
  version: 1,
  name: "Visual program round trip",
  parts: [
    {
      id: 1,
      type: "computer",
      pos: [0, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      config: componentDefaults("computer"),
      scriptLanguage: "visual",
      scriptSources: { visual: savedVisualProgram, typescript: "", wat: "" },
      controllerBindings: [],
    },
  ],
  connections: [],
  remoteProfiles: {},
  defaultRemoteProfile: null,
});
assert.equal(roundTrip.parts[0].scriptLanguage, "visual");
assert.equal(roundTrip.parts[0].scriptSources.visual.nodes.length, 1);

console.log(
  `logic tooling passed (${compiled.program.nodes.length} nodes, ${controllerBindings.length} physical bindings, ${debug.sampleCount} trace samples)`,
);
