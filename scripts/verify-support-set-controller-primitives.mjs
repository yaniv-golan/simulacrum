import assert from "node:assert/strict";
import { loadBearingContactSetProgram } from "../src/model/autonomous-controller-programs.js";
import { TYPES } from "../src/model/component-catalog.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";

const candidate = (key) => ({
    key,
    contactInputBindingId: key + ".contact",
    normalForceInputBindingId: key + ".normal-force",
    membershipOutputBindingId: key + ".loaded-contact",
    confidenceOutputBindingId: key + ".confidence",
  }),
  candidates = ["alpha", "bravo", "charlie"].map(candidate),
  options = {
    candidates,
    supportCountOutputBindingId: "loaded-contact-set.count",
    setConfidenceOutputBindingId: "loaded-contact-set.confidence",
    enterForceN: 10,
    exitForceN: 5,
  },
  outputBindings = [
    {
      id: options.setConfidenceOutputBindingId,
      endpointPartId: "set-confidence-sink",
    },
    {
      id: options.supportCountOutputBindingId,
      endpointPartId: "set-count-sink",
    },
    ...candidates.flatMap((entry) => [
      {
        id: entry.confidenceOutputBindingId,
        endpointPartId: entry.key + "-confidence-sink",
      },
      {
        id: entry.membershipOutputBindingId,
        endpointPartId: entry.key + "-membership-sink",
      },
    ]),
  ],
  inputBindings = candidates.flatMap((entry) => [
    {
      id: entry.contactInputBindingId,
      endpointPartId: entry.key + "-contact-sensor",
      reading: "contact",
    },
    {
      id: entry.normalForceInputBindingId,
      endpointPartId: entry.key + "-contact-sensor",
      reading: "contact_force_n",
    },
  ]),
  manifest = [
    ...outputBindings.map((binding) => ({
      id: binding.id,
      direction: "output",
      endpointPartId: binding.endpointPartId,
      endpointPortId: "CONTROL",
      channel: "command",
    })),
    ...inputBindings.map((binding) => ({
      id: binding.id,
      direction: "input",
      endpointPartId: binding.endpointPartId,
      endpointPortId: "SIGNAL",
      reading: binding.reading,
    })),
  ]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((binding, index) => ({ ...binding, index })),
  source = loadBearingContactSetProgram({
    ...options,
    bindingManifest: manifest,
  }),
  prepared = await prepareTypeScriptController(source, manifest);

assert.doesNotMatch(
  source,
  /\b(?:humanoid|foot|gait|phase|left|right|actuator|joint)\b/i,
);
assert.equal(
  (source.match(/api\.write\(/g) || []).length,
  outputBindings.length,
  "generated controller must write each declared observation exactly once",
);
assert.ok(
  manifest
    .filter((binding) => binding.direction === "output")
    .every((binding) => binding.channel === "command"),
  "support observation program gained an actuator-specific output channel",
);

function sensorFrame(samples = {}, invalidBindings = [], rawOverrides = {}) {
  const invalid = new Set(invalidBindings),
    frame = { __validity: {} };
  for (const entry of candidates) {
    const sample = samples[entry.key] || { contact: 0, force: 0 };
    frame[entry.contactInputBindingId] = sample.contact;
    frame[entry.normalForceInputBindingId] = sample.force;
    frame.__validity[entry.contactInputBindingId] = invalid.has(
      entry.contactInputBindingId,
    )
      ? 0
      : 1;
    frame.__validity[entry.normalForceInputBindingId] = invalid.has(
      entry.normalForceInputBindingId,
    )
      ? 0
      : 1;
  }
  return Object.assign(frame, rawOverrides);
}

const tick = (runtime, frame) =>
    Object.fromEntries(runtime.tick(1 / 120, frame)),
  membership = (output, key) => output[key + ".loaded-contact"],
  confidence = (output, key) => output[key + ".confidence"],
  setCount = (output) => output[options.supportCountOutputBindingId],
  setConfidence = (output) => output[options.setConfidenceOutputBindingId];

const runtime = prepared.instantiate();
let output = tick(runtime, sensorFrame());
assert.equal(setCount(output), 0);
assert.equal(setConfidence(output), 1);
for (const entry of candidates) {
  assert.equal(membership(output, entry.key), 0);
  assert.equal(confidence(output, entry.key), 1);
}

output = tick(
  runtime,
  sensorFrame({
    alpha: { contact: 1, force: 10 },
    bravo: { contact: 1, force: 9 },
  }),
);
assert.equal(membership(output, "alpha"), 1);
assert.equal(membership(output, "bravo"), 0);
assert.equal(setCount(output), 1);

output = tick(
  runtime,
  sensorFrame({
    alpha: { contact: 1, force: 7 },
    bravo: { contact: 1, force: 12 },
  }),
);
assert.equal(
  membership(output, "alpha"),
  1,
  "force hysteresis did not retain an already-loaded contact",
);
assert.equal(membership(output, "bravo"), 1);
assert.equal(setCount(output), 2);

output = tick(
  runtime,
  sensorFrame({
    alpha: { contact: 1, force: 5 },
    bravo: { contact: 1, force: 7 },
  }),
);
assert.equal(
  membership(output, "alpha"),
  0,
  "exit threshold did not release a lightly loaded contact",
);
assert.equal(membership(output, "bravo"), 1);
assert.equal(setCount(output), 1);

const staleAlpha = sensorFrame(
  {
    alpha: { contact: 1, force: 14 },
    bravo: { contact: 1, force: 7 },
  },
  [
    candidates[0].contactInputBindingId,
    candidates[0].normalForceInputBindingId,
  ],
);
output = tick(runtime, staleAlpha);
assert.equal(membership(output, "alpha"), 0);
assert.equal(confidence(output, "alpha"), 0);
assert.equal(membership(output, "bravo"), 1);
assert.equal(setCount(output), 1);
assert.equal(setConfidence(output), 0);

output = tick(
  runtime,
  sensorFrame({
    alpha: { contact: 1, force: 12 },
    bravo: { contact: 0, force: 0 },
  }),
);
assert.equal(
  membership(output, "alpha"),
  1,
  "valid evidence did not recover without a sequence reset",
);
assert.equal(membership(output, "bravo"), 0);
assert.equal(setCount(output), 1);
assert.equal(setConfidence(output), 1);

for (const sample of [
  { contact: 0, force: 1 },
  { contact: 0.5, force: 12 },
  { contact: 1, force: -1 },
]) {
  output = tick(runtime, sensorFrame({ alpha: sample }));
  assert.equal(membership(output, "alpha"), 0);
  assert.equal(confidence(output, "alpha"), 0);
  assert.equal(setConfidence(output), 0);
}

for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY, "12", true]) {
  const bindingId = candidates[0].normalForceInputBindingId;
  output = tick(
    runtime,
    sensorFrame({ alpha: { contact: 1, force: 12 } }, [], {
      [bindingId]: malformed,
    }),
  );
  assert.equal(membership(output, "alpha"), 0);
  assert.equal(
    confidence(output, "alpha"),
    0,
    "a malformed numeric observation retained physical confidence",
  );
}

const checkpointRuntime = prepared.instantiate();
tick(checkpointRuntime, sensorFrame({ alpha: { contact: 1, force: 12 } }));
output = tick(
  checkpointRuntime,
  sensorFrame({ alpha: { contact: 1, force: 7 } }),
);
assert.equal(membership(output, "alpha"), 1);
const checkpoint = checkpointRuntime.exportState(),
  restored = prepared.instantiate();
restored.importState(checkpoint);
output = tick(restored, sensorFrame({ alpha: { contact: 1, force: 7 } }));
assert.equal(
  membership(output, "alpha"),
  1,
  "checkpoint restore lost the qualified hysteresis state",
);
output = tick(
  restored,
  sensorFrame({ alpha: { contact: 1, force: 12 } }, [
    candidates[0].normalForceInputBindingId,
  ]),
);
assert.equal(membership(output, "alpha"), 0);
assert.equal(confidence(output, "alpha"), 0);
output = tick(restored, sensorFrame({ alpha: { contact: 1, force: 12 } }));
assert.equal(
  membership(output, "alpha"),
  1,
  "restored controller did not recover from unavailable evidence",
);

const restarted = prepared.instantiate();
output = tick(restarted, sensorFrame({ alpha: { contact: 1, force: 7 } }));
assert.equal(
  membership(output, "alpha"),
  0,
  "a fresh controller invented pre-restart contact history",
);

const permutedSource = loadBearingContactSetProgram({
    ...options,
    candidates: [candidates[2], candidates[0], candidates[1]],
    bindingManifest: manifest,
  }),
  permuted = (
    await prepareTypeScriptController(permutedSource, manifest)
  ).instantiate(),
  permutationFrame = sensorFrame({
    alpha: { contact: 1, force: 12 },
    charlie: { contact: 1, force: 12 },
  }),
  canonicalOutput = tick(prepared.instantiate(), permutationFrame),
  permutedOutput = tick(permuted, permutationFrame);
for (const binding of outputBindings)
  assert.equal(
    permutedOutput[binding.id],
    canonicalOutput[binding.id],
    "candidate ordering changed physical classification for " + binding.id,
  );

for (const [mutate, pattern] of [
  [(value) => (value.candidates = undefined), /non-empty array/],
  [(value) => (value.candidates = []), /non-empty array/],
  [(value) => (value.candidates = [null]), /must be an object/],
  [(value) => (value.candidates = [7]), /must be an object/],
  [
    (value) => (value.candidates[0].contactInputBindingId = ""),
    /non-empty string/,
  ],
  [(value) => (value.enterForceN = Number.NaN), /enterForceN must be finite/],
  [(value) => (value.exitForceN = -1), /must be non-negative/],
  [(value) => (value.enterForceN = value.exitForceN), /must be greater/],
  [
    (value) =>
      (value.candidates[0].membershipOutputBindingId =
        value.supportCountOutputBindingId),
    /binding ID .* is reused/,
  ],
]) {
  const value = structuredClone(options);
  mutate(value);
  assert.throws(() => loadBearingContactSetProgram(value), pattern);
}

assert.doesNotThrow(() =>
  loadBearingContactSetProgram({
    ...options,
    exitForceN: 0,
    bindingManifest: manifest,
  }),
);

assert.throws(
  () => loadBearingContactSetProgram(options),
  /controllerBindings must be an array/,
);
const manifestCase = (mutate) => {
  const candidateManifest = structuredClone(manifest);
  mutate(candidateManifest);
  return { ...options, bindingManifest: candidateManifest };
};
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        candidateManifest.find(
          (binding) => binding.id === candidates[0].normalForceInputBindingId,
        ).endpointPartId = candidates[1].key + "-contact-sensor";
      }),
    ),
  /must come from the same sensor endpoint/,
);
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        candidateManifest.find(
          (binding) => binding.id === candidates[0].normalForceInputBindingId,
        ).endpointPortId = "OTHER-SIGNAL";
      }),
    ),
  /must come from the same sensor endpoint/,
);
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        candidateManifest.find(
          (binding) => binding.id === candidates[0].contactInputBindingId,
        ).reading = "speed";
      }),
    ),
  /contact input must read contact/,
);
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        candidateManifest.find(
          (binding) => binding.id === candidates[0].normalForceInputBindingId,
        ).reading = "load_n";
      }),
    ),
  /normal-force input must read contact_force_n/,
);
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        const forceBinding = candidateManifest.find(
          (binding) => binding.id === candidates[0].normalForceInputBindingId,
        );
        forceBinding.direction = "output";
        forceBinding.channel = "command";
        delete forceBinding.reading;
      }),
    ),
  /must name a declared input binding/,
);
assert.throws(
  () =>
    loadBearingContactSetProgram(
      manifestCase((candidateManifest) => {
        candidateManifest.find(
          (binding) => binding.id === candidates[0].membershipOutputBindingId,
        ).channel = "joint_target";
      }),
    ),
  /must publish through the command relay channel/,
);
assert.throws(() => {
  const incompleteManifest = manifest
    .filter((binding) => binding.id !== options.setConfidenceOutputBindingId)
    .map((binding, index) => ({ ...binding, index }));
  loadBearingContactSetProgram({
    ...options,
    bindingManifest: incompleteManifest,
  });
}, /must name a declared output binding/);

const part = (id, type, extra = {}) => ({
    id,
    type,
    config: {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  contactSensors = candidates.map((entry) =>
    part(entry.key + "-contact-sensor", "contactsensor"),
  ),
  controller = part("load-bearing-contact-observer", "computer", {
    controllerBindings: inputBindings.map((binding) => ({
      id: binding.id,
      direction: "input",
      endpointPartId: binding.endpointPartId,
      endpointPortId: "SIGNAL",
      reading: binding.reading,
    })),
  }),
  body = (entry, contacts) => ({
    bodyId: entry.key + "-body",
    bound: true,
    detached: false,
    pose: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    contacts,
    loads: [],
  }),
  bodies = {
    bodies: [
      body(candidates[0], [{ forceN: 6 }, { forceN: 4 }]),
      body(candidates[1], []),
      body(candidates[2], [{ forceN: 3 }]),
    ],
    bodyByPart: candidates.map((entry) => ({
      partId: entry.key + "-contact-sensor",
      bodyId: entry.key + "-body",
    })),
  },
  connections = candidates.map((entry) => ({
    id: entry.key + "-signal",
    a: entry.key + "-contact-sensor",
    b: controller.id,
    kind: "signal",
    portA: "SIGNAL",
    portB: "IN A",
  })),
  signals = {
    controllerSensors: [
      {
        controllerId: controller.id,
        endpoints: candidates.map((entry) => ({
          partId: entry.key + "-contact-sensor",
          portIds: ["SIGNAL"],
        })),
      },
    ],
  },
  bank = new ControllerSensorBank(),
  capture = (captureSignals = signals) =>
    bank.capture({
      parts: [...contactSensors, controller],
      connections,
      bodies,
      signals: captureSignals,
    })[controller.id],
  measured = capture();

assert.ok(TYPES.contactsensor, "ordinary contact sensor contract is missing");
assert.equal(measured["alpha.contact"], 1);
assert.equal(measured["alpha.normal-force"], 10);
assert.equal(measured["bravo.contact"], 0);
assert.equal(measured["bravo.normal-force"], 0);
for (const binding of inputBindings)
  assert.equal(measured.__validity[binding.id], 1);
output = tick(prepared.instantiate(), measured);
assert.equal(membership(output, "alpha"), 1);
assert.equal(membership(output, "bravo"), 0);
assert.equal(membership(output, "charlie"), 0);
assert.equal(setCount(output), 1);
assert.equal(setConfidence(output), 1);

const routeLoss = capture({
  controllerSensors: [
    {
      controllerId: controller.id,
      endpoints: candidates.slice(1).map((entry) => ({
        partId: entry.key + "-contact-sensor",
        portIds: ["SIGNAL"],
      })),
    },
  ],
});
assert.equal(routeLoss.__validity["alpha.contact"], 0);
assert.equal(routeLoss.__validity["alpha.normal-force"], 0);
output = tick(prepared.instantiate(), routeLoss);
assert.equal(membership(output, "alpha"), 0);
assert.equal(confidence(output, "alpha"), 0);
assert.equal(setConfidence(output), 0);

console.log("support-set controller primitives passed");
