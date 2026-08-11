import assert from "node:assert/strict";
import { boundedEvidenceEstimatorProgram } from "../src/model/autonomous-controller-programs.js";
import { TYPES } from "../src/model/component-catalog.js";
import {
  prepareTypeScriptController,
  prepareWasmController,
} from "../src/scripting/controller-compilers.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";

const manifest = [
    {
      index: 0,
      id: "estimate.confidence",
      direction: "output",
      endpointPartId: "confidence-sink",
      endpointPortId: "CONTROL",
      channel: "command",
    },
    {
      index: 1,
      id: "estimate.value",
      direction: "output",
      endpointPartId: "estimate-sink",
      endpointPortId: "CONTROL",
      channel: "command",
    },
    {
      index: 2,
      id: "sensor.value",
      direction: "input",
      endpointPartId: "navigation",
      endpointPortId: "SIGNAL",
      reading: "speed",
    },
  ],
  options = {
    inputBindingId: "sensor.value",
    estimateOutputBindingId: "estimate.value",
    confidenceOutputBindingId: "estimate.confidence",
    minimum: -5,
    maximum: 5,
    fallback: 1,
    maximumFallbackRatePerSecond: 2,
    maximumTickSeconds: 0.1,
  },
  source = boundedEvidenceEstimatorProgram(options),
  prepared = await prepareTypeScriptController(source, manifest),
  estimator = prepared.instantiate(),
  tick = (runtime, dt, value, validity) =>
    Object.fromEntries(
      runtime.tick(dt, {
        "sensor.value": value,
        ...(validity === undefined
          ? {}
          : { __validity: { "sensor.value": validity } }),
      }),
    );

assert.match(source, /api\.valid/);
assert.deepEqual(tick(estimator, 0.1, 0, 1), {
  "estimate.confidence": 1,
  "estimate.value": 0,
});
assert.deepEqual(tick(estimator, 0.1, 4, true), {
  "estimate.confidence": 1,
  "estimate.value": 4,
});
assert.deepEqual(tick(estimator, 0.1, 0, 0), {
  "estimate.confidence": 0,
  "estimate.value": 3.8,
});
const nonfiniteDt = prepared.instantiate();
tick(nonfiniteDt, 0.1, 4, 1);
assert.deepEqual(tick(nonfiniteDt, Number.POSITIVE_INFINITY, 0, 0), {
  "estimate.confidence": 0,
  "estimate.value": 3.8,
});
assert.deepEqual(
  tick(nonfiniteDt, Number.NaN, 0, 0),
  {
    "estimate.confidence": 0,
    "estimate.value": 3.8,
  },
  "NaN timestep changed or poisoned estimator state",
);
const checkpoint = estimator.exportState(),
  restored = prepared.instantiate();
restored.importState(checkpoint);
const delayed = tick(restored, 20, 0, 0);
assert.equal(delayed["estimate.confidence"], 0);
assert.ok(
  Math.abs(delayed["estimate.value"] - 3.6) < 1e-12,
  "one delayed tick exceeded the configured fallback slew bound",
);
assert.deepEqual(
  tick(restored, 0.1, -3, 1),
  {
    "estimate.confidence": 1,
    "estimate.value": -3,
  },
  "valid evidence did not recover independently of prior fallback state",
);
assert.deepEqual(tick(restored, 0.1, 99, 1), {
  "estimate.confidence": 1,
  "estimate.value": 5,
});
let converged;
for (let index = 0; index < 40; index++) converged = tick(restored, 0.1, 0, 0);
assert.equal(converged["estimate.value"], 1);
assert.equal(converged["estimate.confidence"], 0);
assert.deepEqual(tick(prepared.instantiate(), 0.1, 0, undefined), {
  "estimate.confidence": 0,
  "estimate.value": 1,
});
assert.deepEqual(
  tick(prepared.instantiate(), 0.1, 0, "1"),
  {
    "estimate.confidence": 0,
    "estimate.value": 1,
  },
  "truthy non-contract validity spoofed physical evidence",
);

for (const [mutate, pattern] of [
  [(candidate) => (candidate.inputBindingId = ""), /non-empty string/],
  [
    (candidate) => (candidate.inputBindingId = { trim: () => "not-a-string" }),
    /non-empty string/,
  ],
  [(candidate) => (candidate.minimum = Number.NaN), /minimum must be finite/],
  [(candidate) => (candidate.minimum = 5), /less than maximum/],
  [(candidate) => (candidate.fallback = 6), /inside the estimator range/],
  [(candidate) => (candidate.fallback = -6), /inside the estimator range/],
  [
    (candidate) => (candidate.maximumFallbackRatePerSecond = 0),
    /must be positive/,
  ],
  [(candidate) => (candidate.maximumTickSeconds = 0), /must be positive/],
  [
    (candidate) =>
      (candidate.confidenceOutputBindingId = candidate.estimateOutputBindingId),
    /must be distinct/,
  ],
]) {
  const candidate = { ...options };
  mutate(candidate);
  assert.throws(() => boundedEvidenceEstimatorProgram(candidate), pattern);
}
assert.doesNotThrow(() =>
  boundedEvidenceEstimatorProgram({ ...options, fallback: -5 }),
);
assert.doesNotThrow(() =>
  boundedEvidenceEstimatorProgram({ ...options, fallback: 5 }),
);
assert.match(
  boundedEvidenceEstimatorProgram({ ...options, fallback: -0 }),
  /let estimate = -0;/,
  "negative-zero fallback lost its deterministic source representation",
);

await assert.rejects(
  () =>
    prepareTypeScriptController(
      `function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.write('estimate.value', api.valid('missing'));
}`,
      manifest,
    ),
  /unknown input binding missing/,
);
for (const [attack, pattern] of [
  [
    `function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.write('estimate.value', other.valid('sensor.value'));
}`,
    /only declared helpers/,
  ],
  [
    `function tick(api: ControlAPI, dt: number): void {
  void dt;
  api.write('estimate.value', api.valid('sensor.value', 'extra'));
}`,
    /needs one literal input binding ID/,
  ],
])
  await assert.rejects(
    () => prepareTypeScriptController(attack, manifest),
    pattern,
  );

const validityWat = `(module
    (import "env" "read_binding_valid" (func $valid (param i32) (result f64)))
    (import "env" "write_binding" (func $write (param i32 f64)))
    (func (export "tick") (param f64)
      (call $write (i32.const 1) (call $valid (i32.const 2)))))`,
  watRuntime = (
    await prepareWasmController(validityWat, manifest)
  ).instantiate();
assert.equal(
  watRuntime
    .tick(0.1, {
      "sensor.value": 0,
      __validity: { "sensor.value": 1 },
    })
    .get("estimate.value"),
  1,
);
assert.equal(
  watRuntime.tick(0.1, { "sensor.value": 0 }).get("estimate.value"),
  0,
);
for (const malformedMeasurement of [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "0",
  true,
  null,
])
  assert.equal(
    watRuntime
      .tick(0.1, {
        "sensor.value": malformedMeasurement,
        __validity: { "sensor.value": 1 },
      })
      .get("estimate.value"),
    0,
    "non-numeric or non-finite evidence retained physical validity",
  );
for (const malformedValidity of [
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "1",
])
  assert.equal(
    watRuntime
      .tick(0.1, {
        "sensor.value": 0,
        __validity: { "sensor.value": malformedValidity },
      })
      .get("estimate.value"),
    0,
  );
assert.equal(
  watRuntime.tick(0.1, [0, 0, 0]).get("estimate.value"),
  0,
  "legacy array sensors invented validity",
);
await assert.rejects(
  () =>
    prepareWasmController(
      `(module
        (import "env" "read_binding_valid" (func (param i32) (result i32)))
        (func (export "tick") (param f32)))`,
      manifest,
    ),
  /read_binding_valid must have signature/,
);
const invalidIndexRuntime = (
  await prepareWasmController(
    `(module
      (import "env" "read_binding_valid" (func $valid (param i32) (result f32)))
      (func (export "tick") (param f32)
        (drop (call $valid (i32.add (i32.const 998) (i32.const 1))))))`,
    manifest,
  )
).instantiate();
assert.throws(
  () => invalidIndexRuntime.tick(0.1, {}),
  /input binding index 999 is out of range/,
);
const outputIndexRuntime = (
  await prepareWasmController(
    `(module
      (import "env" "read_binding_valid" (func $valid (param i32) (result f32)))
      (func (export "tick") (param f32)
        (drop (call $valid (i32.const 0)))))`,
    manifest,
  )
).instantiate();
assert.throws(
  () => outputIndexRuntime.tick(0.1, {}),
  /input binding index 0 is out of range/,
  "validity import accepted an output binding index",
);

const part = (id, type, extra = {}) => ({
    id,
    type,
    config: {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  navigation = part("navigation", "navsensor"),
  controller = part("estimator", "computer", {
    controllerBindings: [
      {
        id: "sensor.value",
        direction: "input",
        endpointPartId: "navigation",
        endpointPortId: "SIGNAL",
        reading: "speed",
      },
    ],
  }),
  bodies = {
    bodies: [
      {
        bodyId: "navigation-body",
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
    bodyByPart: [{ partId: "navigation", bodyId: "navigation-body" }],
  },
  signals = {
    controllerSensors: [
      {
        controllerId: "estimator",
        endpoints: [{ partId: "navigation", portIds: ["SIGNAL"] }],
      },
    ],
  },
  capture = (
    captureBodies = bodies,
    captureSignals = signals,
    captureController = controller,
  ) =>
    new ControllerSensorBank().capture({
      parts: [navigation, captureController],
      connections: [
        {
          id: "navigation-signal",
          a: "navigation",
          b: "estimator",
          kind: "signal",
          portA: "SIGNAL",
          portB: "IN A",
        },
      ],
      bodies: captureBodies,
      signals: captureSignals,
    })[captureController.id],
  measuredZero = capture(),
  missingBody = capture({}),
  missingRoute = capture(bodies, {}),
  unsupportedReadingController = structuredClone(controller),
  mixedReadingController = structuredClone(controller),
  outputBindingController = structuredClone(controller);
unsupportedReadingController.controllerBindings[0].reading = "telepathy";
mixedReadingController.controllerBindings.push({
  id: "z.unsupported",
  direction: "input",
  endpointPartId: "navigation",
  endpointPortId: "SIGNAL",
  reading: "telepathy",
});
outputBindingController.controllerBindings.push({
  id: "output-is-not-a-reading",
  direction: "output",
  endpointPartId: "navigation",
  endpointPortId: "SIGNAL",
  channel: "command",
});
const unsupportedReading = capture(
    bodies,
    signals,
    unsupportedReadingController,
  ),
  mixedReadings = capture(bodies, signals, mixedReadingController),
  outputFiltered = capture(bodies, signals, outputBindingController);

assert.equal(measuredZero["sensor.value"], 0);
assert.equal(measuredZero.__validity["sensor.value"], 1);
assert.equal(
  measuredZero.__bindings[0].valid,
  Boolean(measuredZero.__validity["sensor.value"]),
);
assert.ok(Object.isFrozen(measuredZero.__validity));
assert.equal(missingBody.__validity["sensor.value"], 0);
assert.equal(missingRoute.__validity["sensor.value"], 0);
assert.equal(unsupportedReading.__validity["sensor.value"], 0);
assert.equal(mixedReadings.__validity["sensor.value"], 1);
assert.equal(mixedReadings.__validity["z.unsupported"], 0);
assert.equal(
  Object.hasOwn(outputFiltered.__validity, "output-is-not-a-reading"),
  false,
);
assert.deepEqual(
  Object.fromEntries(prepared.instantiate().tick(0.1, measuredZero)),
  {
    "estimate.confidence": 1,
    "estimate.value": 0,
  },
);
assert.deepEqual(
  Object.fromEntries(prepared.instantiate().tick(0.1, missingRoute)),
  {
    "estimate.confidence": 0,
    "estimate.value": 1,
  },
);

assert.ok(TYPES.navsensor, "synthetic evidence test lost its ordinary sensor");
console.log("autonomous controller primitives passed");
