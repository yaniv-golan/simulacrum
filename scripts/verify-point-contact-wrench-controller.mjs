import assert from "node:assert/strict";
import { pointContactWrenchAllocatorProgram } from "../src/model/autonomous-controller-programs.js";
import { CONTROLLER_LIMITS } from "../src/model/controller-policy.js";
import {
  assertPointContactCommandForceInRange,
  COMMAND_SINK_SCALAR_LIMIT,
  POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
  validatePointContactWrenchControllerResult,
  validatePointContactWrenchControllerSpec,
} from "../src/model/point-contact-wrench-controller-contract.js";
import { pointContactWrenchSpecsFromControlIR } from "../src/scripting/control-ir-wat.js";
import {
  compileControlIRToWat,
  compileTypeScriptToControlIR,
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../src/scripting/controller-compilers.js";
import { compileWatController } from "../src/scripting/wat-control-compiler.js";
import {
  preparePhysicsControlIRController,
  preparePhysicsTypeScriptController,
} from "../src/application/controller-physics-compilers.js";
import { allocatePointContactWrench } from "../src/simulation/point-contact-wrench-allocator.js";

function nextRepresentableAbove(value) {
  if (!Number.isFinite(value) || value === Infinity) return value;
  if (Object.is(value, -0) || value === 0) return Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  view.setBigUint64(
    0,
    view.getBigUint64(0, false) + (value > 0 ? 1n : -1n),
    false,
  );
  return view.getFloat64(0, false);
}

const axes = ["x", "y", "z"],
  contacts = ["alpha", "bravo"],
  targetForceBindings = axes.map((axis) => `target.force.${axis}`),
  targetMomentBindings = axes.map((axis) => `target.moment.${axis}`),
  contactInput = (contactId) => ({
    point: axes.map((axis) => `${contactId}.point.${axis}`),
    normal: axes.map((axis) => `${contactId}.normal.${axis}`),
    friction: `${contactId}.friction`,
  }),
  contactInputs = new Map(
    contacts.map((contactId) => [contactId, contactInput(contactId)]),
  ),
  diagnostics = {
    authorityValid: "allocation.authority-valid",
    solverConverged: "allocation.solver-converged",
    accepted: "allocation.accepted",
    rejectionCode: "allocation.rejection-code",
    forceResidualNormN: "allocation.force-residual-norm-n",
    momentResidualNormNm: "allocation.moment-residual-norm-nm",
    saturated: "allocation.saturated",
    residualClipped: "allocation.residual-clipped",
  },
  forceOutputs = new Map(
    contacts.map((contactId) => [
      contactId,
      axes.map((axis) => `${contactId}.force-world-${axis}-n`),
    ]),
  ),
  inputBindings = [
    ...targetForceBindings.map((id, axis) => ({
      id,
      direction: "input",
      endpointPartId: `target-force-${axes[axis]}`,
      endpointPortId: "SIGNAL",
      reading: "command",
    })),
    ...targetMomentBindings.map((id, axis) => ({
      id,
      direction: "input",
      endpointPartId: `target-moment-${axes[axis]}`,
      endpointPortId: "SIGNAL",
      reading: "command",
    })),
    ...contacts.flatMap((contactId) => {
      const input = contactInputs.get(contactId);
      return [
        ...input.point.map((id, axis) => ({
          id,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: `contact_resultant_point_world_${axes[axis]}_m`,
        })),
        ...input.normal.map((id, axis) => ({
          id,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: `contact_resultant_normal_world_${axes[axis]}`,
        })),
        {
          id: input.friction,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: "contact_min_friction_coefficient",
        },
      ];
    }),
  ],
  outputIds = [
    ...Object.values(diagnostics),
    ...contacts.flatMap((contactId) => forceOutputs.get(contactId)),
  ],
  manifest = [
    ...inputBindings,
    ...outputIds.map((id) => ({
      id,
      direction: "output",
      endpointPartId: `sink-${id}`,
      endpointPortId: "CONTROL",
      channel: "command",
    })),
  ]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((binding, index) => ({ ...binding, index })),
  allocationSpec = {
    version: 1,
    targetFrame: {
      frameId: "fixture/world",
      positionWorldM: [0, 0, 0],
      quaternionWorldFromFrame: [0, 0, 0, 1],
    },
    targetWrenchBindings: {
      forceN: targetForceBindings,
      momentNm: targetMomentBindings,
    },
    contacts: contacts.map((contactId) => ({
      contactId,
      pointWorldBindings: contactInputs.get(contactId).point,
      normalWorldBindings: contactInputs.get(contactId).normal,
      frictionCoefficientBinding: contactInputs.get(contactId).friction,
      normalForceLimitN: 100,
      tangentialForceLimitN: 100,
    })),
    acceptance: {
      forceResidualToleranceN: 1e-6,
      momentResidualToleranceNm: 1e-6,
      momentReferenceLengthM: 1,
    },
    solver: {
      maxIterations: 256,
      projectedGradientToleranceN: 1e-7,
    },
  },
  programOptions = {
    allocationSpec,
    diagnosticOutputBindingIds: diagnostics,
    contactForceOutputs: contacts.map((contactId) => ({
      contactId,
      forceWorldOutputBindingIds: forceOutputs.get(contactId),
    })),
    bindingManifest: manifest,
  },
  source = pointContactWrenchAllocatorProgram(programOptions);

assert.doesNotMatch(
  source,
  /\b(?:humanoid|demo|foot|gait|phase|left|right|stance|walking)\b/i,
);
assert.equal(
  (source.match(/api\.writePointContactWrench\(/gu) || []).length,
  1,
  "controller did not invoke exactly one declared canonical allocation",
);

const prepared = await preparePhysicsTypeScriptController(source, manifest),
  runtime = prepared.instantiate(),
  validFrame = ({
    tick = 7,
    targetForceN = [0, 100, 0],
    targetMomentNm = [0, 0, 0],
    points = {
      alpha: [-0.5, 0, 0],
      bravo: [0.5, 0, 0],
    },
    normals = {
      alpha: [0, 1, 0],
      bravo: [0, 1, 0],
    },
    friction = { alpha: 0.8, bravo: 0.8 },
  } = {}) => {
    const frame = { __snapshotTick: tick, __validity: {} };
    for (const [index, id] of targetForceBindings.entries()) {
      frame[id] = targetForceN[index];
      frame.__validity[id] = 1;
    }
    for (const [index, id] of targetMomentBindings.entries()) {
      frame[id] = targetMomentNm[index];
      frame.__validity[id] = 1;
    }
    for (const contactId of contacts) {
      const input = contactInputs.get(contactId);
      for (const [index, id] of input.point.entries()) {
        frame[id] = points[contactId][index];
        frame.__validity[id] = 1;
      }
      for (const [index, id] of input.normal.entries()) {
        frame[id] = normals[contactId][index];
        frame.__validity[id] = 1;
      }
      frame[input.friction] = friction[contactId];
      frame.__validity[input.friction] = 1;
    }
    return frame;
  },
  tick = (engine, frame) => Object.fromEntries(engine.tick(1 / 120, frame));

await assert.rejects(
  () => prepareTypeScriptController(source, manifest),
  /needs a physical allocator host/,
  "engine-neutral scripting compiler silently gained physics authority",
);

let output = tick(runtime, validFrame());
assert.equal(output[diagnostics.authorityValid], 1);
assert.equal(output[diagnostics.solverConverged], 1);
assert.equal(output[diagnostics.accepted], 1);
assert.equal(output[diagnostics.rejectionCode], 0);
assert.equal(output[diagnostics.saturated], 0);
assert.equal(output[diagnostics.residualClipped], 0);
assert.ok(output[diagnostics.forceResidualNormN] <= 1e-6);
assert.ok(output[diagnostics.momentResidualNormNm] <= 1e-6);
for (const contactId of contacts) {
  const [x, y, z] = forceOutputs.get(contactId).map((id) => output[id]);
  assert.ok(Math.abs(x) <= 1e-9);
  assert.ok(Math.abs(y - 50) <= 1e-6);
  assert.ok(Math.abs(z) <= 1e-9);
}

const booleanValidityFrame = validFrame({ tick: 0 });
for (const bindingId of Object.keys(booleanValidityFrame.__validity))
  booleanValidityFrame.__validity[bindingId] = true;
output = tick(runtime, booleanValidityFrame);
assert.equal(
  output[diagnostics.accepted],
  1,
  "zero tick or boolean validity lost authority",
);

for (const invalidTick of [-1, 0.5, NaN]) {
  output = tick(runtime, validFrame({ tick: invalidTick }));
  assert.equal(output[diagnostics.authorityValid], 0);
  assert.equal(output[diagnostics.rejectionCode], 1);
}

const invalidFrame = validFrame();
invalidFrame.__validity[contactInputs.get("alpha").point[0]] = 0;
output = tick(runtime, invalidFrame);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.solverConverged], 0);
assert.equal(output[diagnostics.accepted], 0);
assert.equal(output[diagnostics.rejectionCode], 1);
for (const id of contacts.flatMap((contactId) => forceOutputs.get(contactId)))
  assert.equal(output[id], 0, "invalid authority retained a force demand");

const invalidZeroNormalAxis = validFrame();
invalidZeroNormalAxis.__validity[contactInputs.get("alpha").normal[0]] = 0;
output = tick(runtime, invalidZeroNormalAxis);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const nonNumericFrame = validFrame();
nonNumericFrame[targetForceBindings[0]] = "100";
output = tick(runtime, nonNumericFrame);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const missingTick = validFrame();
delete missingTick.__snapshotTick;
output = tick(runtime, missingTick);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const invalidNormal = validFrame();
invalidNormal[contactInputs.get("alpha").normal[0]] = 2;
invalidNormal[contactInputs.get("alpha").normal[1]] = 0;
output = tick(runtime, invalidNormal);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const nonFiniteNormal = validFrame();
nonFiniteNormal[contactInputs.get("alpha").normal[0]] = 1e308;
output = tick(runtime, nonFiniteNormal);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const boundaryNormal = validFrame();
boundaryNormal[contactInputs.get("alpha").normal[1]] = 1 + 2 ** -20;
output = tick(runtime, boundaryNormal);
assert.equal(
  output[diagnostics.authorityValid],
  1,
  "a normal at the declared unit tolerance boundary lost authority",
);

const invalidFriction = validFrame();
invalidFriction[contactInputs.get("alpha").friction] = -0.1;
output = tick(runtime, invalidFriction);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.rejectionCode], 1);

const residualFrame = validFrame({
  targetForceN: [200, 0, 0],
  friction: { alpha: 0, bravo: 0 },
});
output = tick(runtime, residualFrame);
assert.equal(output[diagnostics.authorityValid], 1);
assert.equal(output[diagnostics.solverConverged], 1);
assert.equal(output[diagnostics.accepted], 0);
assert.equal(output[diagnostics.rejectionCode], 3);
assert.ok(output[diagnostics.forceResidualNormN] > 199);
assert.equal(output[diagnostics.residualClipped], 0);
for (const id of contacts.flatMap((contactId) => forceOutputs.get(contactId)))
  assert.equal(output[id], 0, "rejected residual retained a force demand");

output = tick(
  runtime,
  validFrame({
    targetForceN: [1_000_000, 1_000_000, 1_000_000],
    friction: { alpha: 0, bravo: 0 },
  }),
);
assert.equal(output[diagnostics.accepted], 0);
assert.equal(output[diagnostics.rejectionCode], 3);
assert.equal(output[diagnostics.forceResidualNormN], 1_000_000);
assert.equal(output[diagnostics.residualClipped], 1);

output = tick(
  runtime,
  validFrame({
    targetForceN: [1_000_000, 0, 0],
    friction: { alpha: 0, bravo: 0 },
  }),
);
assert.equal(output[diagnostics.forceResidualNormN], 1_000_000);
assert.equal(
  output[diagnostics.residualClipped],
  0,
  "an exactly representable residual was reported as clipped",
);

output = tick(
  runtime,
  validFrame({
    targetForceN: [0, 0, 0],
    targetMomentNm: [1_000_000, 1_000_000, 1_000_000],
    friction: { alpha: 0, bravo: 0 },
  }),
);
assert.equal(output[diagnostics.momentResidualNormNm], 1_000_000);
assert.equal(output[diagnostics.residualClipped], 1);
output = tick(
  runtime,
  validFrame({
    targetForceN: [0, 0, 0],
    targetMomentNm: [1_000_000, 0, 0],
    friction: { alpha: 0, bravo: 0 },
  }),
);
assert.equal(output[diagnostics.momentResidualNormNm], 1_000_000);
assert.equal(
  output[diagnostics.residualClipped],
  0,
  "an exactly representable moment residual was reported as clipped",
);

output = tick(runtime, validFrame({ tick: 8 }));
assert.equal(output[diagnostics.accepted], 1);
for (const contactId of contacts)
  assert.ok(
    output[forceOutputs.get(contactId)[1]] > 49.999,
    "controller did not recover from invalid or rejected evidence",
  );

const numericalRangeFrame = validFrame({
  tick: 9,
  points: { alpha: [1e308, 0, 0], bravo: [0.5, 0, 0] },
});
output = tick(runtime, numericalRangeFrame);
assert.equal(output[diagnostics.authorityValid], 0);
assert.equal(output[diagnostics.solverConverged], 0);
assert.equal(output[diagnostics.accepted], 0);
assert.equal(output[diagnostics.rejectionCode], 4);
assert.equal(output[diagnostics.saturated], 0);
assert.equal(output[diagnostics.residualClipped], 0);
for (const id of contacts.flatMap((contactId) => forceOutputs.get(contactId)))
  assert.equal(output[id], 0, "numerical rejection retained a force demand");
output = tick(runtime, validFrame({ tick: 10 }));
assert.equal(
  output[diagnostics.accepted],
  1,
  "controller did not recover from a numerical-range rejection",
);

const checkpoint = runtime.exportState(),
  restored = prepared.instantiate();
restored.importState(checkpoint);
assert.deepEqual(
  tick(restored, validFrame({ tick: 11 })),
  tick(prepared.instantiate(), validFrame({ tick: 11 })),
  "stateless allocation diverged after checkpoint restore",
);

const reversedSource = pointContactWrenchAllocatorProgram({
    ...programOptions,
    allocationSpec: {
      ...allocationSpec,
      contacts: [...allocationSpec.contacts].reverse(),
    },
    contactForceOutputs: [...programOptions.contactForceOutputs].reverse(),
  }),
  reversed = (
    await preparePhysicsTypeScriptController(reversedSource, manifest)
  ).instantiate();
assert.deepEqual(
  tick(reversed, validFrame({ tick: 12 })),
  tick(prepared.instantiate(), validFrame({ tick: 12 })),
  "contact declaration order changed the allocation",
);

const rotatedSource = pointContactWrenchAllocatorProgram({
    ...programOptions,
    allocationSpec: {
      ...allocationSpec,
      targetFrame: {
        ...allocationSpec.targetFrame,
        quaternionWorldFromFrame: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
    },
  }),
  rotated = (
    await preparePhysicsTypeScriptController(rotatedSource, manifest)
  ).instantiate();
output = tick(rotated, validFrame({ tick: 13, targetForceN: [100, 0, 0] }));
assert.equal(output[diagnostics.accepted], 1);
for (const contactId of contacts) {
  const [x, y, z] = forceOutputs.get(contactId).map((id) => output[id]);
  assert.ok(Math.abs(x) <= 1e-6);
  assert.ok(Math.abs(y - 50) <= 1e-6);
  assert.ok(Math.abs(z) <= 1e-6);
}

for (const [mutate, pattern] of [
  [(value) => (value.allocationSpec = null), /invalid field set/],
  [(value) => (value.allocationSpec = 1), /invalid field set/],
  [(value) => (value.allocationSpec.unexpected = true), /invalid field set/],
  [(value) => (value.allocationSpec.version = 2), /version must be 1/],
  [
    (value) => (value.allocationSpec.targetFrame.frameId = " not-canonical"),
    /canonical identifier/,
  ],
  [
    (value) => (value.allocationSpec.targetFrame.frameId = "canonical!"),
    /canonical identifier/,
  ],
  [
    (value) => (value.allocationSpec.targetFrame.frameId = 7),
    /canonical identifier/,
  ],
  [
    (value) => (value.allocationSpec.targetFrame.positionWorldM = [0, 0]),
    /finite three-vector/,
  ],
  [
    (value) => (value.allocationSpec.targetFrame.positionWorldM = [0, NaN, 0]),
    /finite three-vector/,
  ],
  [
    (value) =>
      (value.allocationSpec.targetFrame.quaternionWorldFromFrame = [0, 0, 1]),
    /finite quaternion/,
  ],
  [
    (value) =>
      (value.allocationSpec.targetFrame.quaternionWorldFromFrame = [
        0, 0, 0, 2,
      ]),
    /unit quaternion/,
  ],
  [
    (value) => value.allocationSpec.targetWrenchBindings.forceN.pop(),
    /three binding IDs/,
  ],
  [
    (value) =>
      (value.allocationSpec.targetWrenchBindings.forceN[0] =
        value.allocationSpec.contacts[0].pointWorldBindings[0]),
    /must read command/,
  ],
  [
    (value) =>
      (value.allocationSpec.targetWrenchBindings.forceN[0] = "missing-input"),
    /must name a declared input binding/,
  ],
  [
    (value) =>
      (value.allocationSpec.targetWrenchBindings.forceN[0] =
        diagnostics.accepted),
    /must name a declared input binding/,
  ],
  [
    (value) => (value.allocationSpec.contacts = []),
    /contacts must be non-empty/,
  ],
  [
    (value) =>
      (value.allocationSpec.contacts = Array.from(
        { length: 17 },
        (_, index) => ({
          ...structuredClone(value.allocationSpec.contacts[0]),
          contactId: `overflow-${index}`,
        }),
      )),
    /too many contacts/,
  ],
  [
    (value) =>
      (value.allocationSpec.contacts[1].contactId =
        value.allocationSpec.contacts[0].contactId),
    /duplicate point-contact controller ID/,
  ],
  [
    (value) => (value.allocationSpec.contacts[0].contactId = "!invalid"),
    /canonical identifier/,
  ],
  [
    (value) => value.allocationSpec.contacts[0].pointWorldBindings.pop(),
    /three binding IDs/,
  ],
  [
    (value) => (value.allocationSpec.solver.maxIterations = 257),
    /iteration budget must be a non-negative safe integer in range/,
  ],
  [
    (value) => (value.allocationSpec.solver.maxIterations = 0),
    /iteration budget must be positive/,
  ],
  [
    (value) => (value.allocationSpec.solver.maxIterations = -1),
    /non-negative safe integer/,
  ],
  [
    (value) => (value.allocationSpec.solver.maxIterations = 1.5),
    /non-negative safe integer/,
  ],
  [
    (value) => (value.allocationSpec.solver.projectedGradientToleranceN = -1),
    /finite number in range/,
  ],
  [
    (value) => (value.allocationSpec.acceptance.forceResidualToleranceN = -1),
    /finite number in range/,
  ],
  [
    (value) =>
      (value.allocationSpec.acceptance.momentResidualToleranceNm = Infinity),
    /finite number in range/,
  ],
  [
    (value) => (value.allocationSpec.acceptance.momentReferenceLengthM = 0),
    /finite number in range/,
  ],
  [
    (value) => {
      value.allocationSpec.contacts[0].normalForceLimitN = 800_000;
      value.allocationSpec.contacts[0].tangentialForceLimitN = 800_000;
    },
    /force envelope exceeds the command-sink scalar limit/,
  ],
  [
    (value) => (value.allocationSpec.contacts[0].normalForceLimitN = -1),
    /finite number in range/,
  ],
  [
    (value) =>
      (value.allocationSpec.contacts[0].tangentialForceLimitN = Infinity),
    /finite number in range/,
  ],
  [
    (value) =>
      (value.allocationSpec.contacts[0].pointWorldBindings[0] =
        targetForceBindings[0]),
    /must read contact_resultant_point_world_x_m/,
  ],
  [
    (value) =>
      (value.allocationSpec.contacts[0].normalWorldBindings[0] =
        value.allocationSpec.contacts[1].normalWorldBindings[0]),
    /one sensor endpoint/,
  ],
  [
    (value) => {
      const bindingId = value.allocationSpec.contacts[0].normalWorldBindings[0];
      value.bindingManifest.find(
        (binding) => binding.id === bindingId,
      ).endpointPortId = "OTHER";
    },
    /one sensor endpoint/,
  ],
  [
    (value) =>
      (value.diagnosticOutputBindingIds.accepted =
        value.diagnosticOutputBindingIds.authorityValid),
    /binding ID .* is reused/,
  ],
  [
    (value) => (value.contactForceOutputs = null),
    /must match the allocation contact count/,
  ],
  [
    (value) => value.contactForceOutputs.pop(),
    /must match the allocation contact count/,
  ],
  [
    (value) => (value.contactForceOutputs[0].contactId = "unknown"),
    /unknown force-output contact/,
  ],
  [
    (value) =>
      (value.contactForceOutputs[1].contactId =
        value.contactForceOutputs[0].contactId),
    /duplicate force-output contact/,
  ],
  [
    (value) => value.contactForceOutputs[0].forceWorldOutputBindingIds.pop(),
    /must contain three binding IDs/,
  ],
  [
    (value) =>
      (value.contactForceOutputs[0].forceWorldOutputBindingIds[0] = ""),
    /non-empty string/,
  ],
  [
    (value) =>
      (value.contactForceOutputs[0].forceWorldOutputBindingIds[0] =
        targetForceBindings[0]),
    /unknown output binding/,
  ],
  [
    (value) =>
      (value.diagnosticOutputBindingIds.unexpected = "unexpected-output"),
    /invalid field set/,
  ],
]) {
  const value = structuredClone(programOptions);
  mutate(value);
  assert.throws(() => pointContactWrenchAllocatorProgram(value), pattern);
}

const wrongChannel = structuredClone(programOptions);
wrongChannel.bindingManifest.find(
  (binding) => binding.id === diagnostics.accepted,
).channel = "throttle";
assert.throws(
  () => pointContactWrenchAllocatorProgram(wrongChannel),
  /command relay channel/,
);
await assert.rejects(
  () =>
    preparePhysicsTypeScriptController(source, wrongChannel.bindingManifest),
  /command relay channel/,
  "direct TypeScript bypassed the physical command-output boundary",
);

for (const mutate of [
  (value) => {
    value.allocationSpec.contacts[0].normalForceLimitN = 0;
    value.allocationSpec.contacts[0].tangentialForceLimitN = 0;
  },
  (value) => {
    value.allocationSpec.acceptance.forceResidualToleranceN = 0;
    value.allocationSpec.acceptance.momentResidualToleranceNm = 0;
    value.allocationSpec.solver.maxIterations = 1;
  },
]) {
  const value = structuredClone(programOptions);
  mutate(value);
  assert.doesNotThrow(() => pointContactWrenchAllocatorProgram(value));
}

const boundarySpec = structuredClone(allocationSpec);
boundarySpec.targetFrame.quaternionWorldFromFrame = [0, 0, 0, 1 + 2 ** -20];
boundarySpec.contacts[0].normalForceLimitN = 600_000;
boundarySpec.contacts[0].tangentialForceLimitN = 800_000;
const validatedBoundarySpec = validatePointContactWrenchControllerSpec(
  boundarySpec,
  manifest,
);
assert.ok(
  Math.abs(
    Math.hypot(...validatedBoundarySpec.targetFrame.quaternionWorldFromFrame) -
      1,
  ) <= Number.EPSILON,
  "accepted quaternion was not canonically normalized",
);

const controlIr = await compileTypeScriptToControlIR(source, manifest),
  controlIrPrepared = await preparePhysicsControlIRController(controlIr),
  controlIrOutput = tick(
    controlIrPrepared.instantiate(),
    validFrame({ tick: 14 }),
  );
assert.deepEqual(
  controlIrOutput,
  tick(prepared.instantiate(), validFrame({ tick: 14 })),
  "physical Control IR composition diverged from TypeScript composition",
);
const duplicateControlIr = structuredClone(controlIr);
duplicateControlIr.functions[0].body.push(
  structuredClone(duplicateControlIr.functions[0].body[0]),
);
assert.equal(
  pointContactWrenchSpecsFromControlIR(duplicateControlIr).length,
  1,
  "identical declarative allocation specs were not canonicalized",
);
const nestedControlIr = structuredClone(controlIr);
nestedControlIr.functions[0].body = [
  {
    kind: "if",
    condition: { kind: "number", value: 1 },
    then: [structuredClone(controlIr.functions[0].body[0])],
    else: [],
  },
];
assert.equal(
  pointContactWrenchSpecsFromControlIR(nestedControlIr).length,
  1,
  "nested declarative allocation was not collected",
);
await assert.rejects(
  () => prepareControlIRController(controlIr),
  /needs a physical allocator host/,
  "engine-neutral Control IR compiler silently gained physics authority",
);
const wrongChannelControlIr = structuredClone(controlIr);
wrongChannelControlIr.bindingManifest.find(
  (binding) => binding.id === diagnostics.accepted,
).channel = "throttle";
await assert.rejects(
  () => preparePhysicsControlIRController(wrongChannelControlIr),
  /command relay channel/,
  "direct Control IR bypassed the physical command-output boundary",
);
assert.equal(
  (
    compileControlIRToWat(controlIr).match(/point_contact_wrench_output/gu) ||
    []
  ).length,
  2 + outputIds.length,
  "Control IR did not lower one declared host import plus one call per output",
);

for (const [mutate, pattern] of [
  [(value) => (value.version = 2), /unsupported control IR version/],
  [
    (value) => (value.functions[0].body[0].spec.unexpected = true),
    /invalid field set/,
  ],
  [
    (value) => value.functions[0].body[0].outputBindingIds.pop(),
    /output bindings are invalid/,
  ],
  [
    (value) =>
      (value.functions[0].body[0].outputBindingIds[1] =
        value.functions[0].body[0].outputBindingIds[0]),
    /output bindings are invalid/,
  ],
  [
    (value) =>
      (value.functions[0].body[0].outputBindingIds[0] = "unknown-output"),
    /unknown output binding/,
  ],
]) {
  const value = structuredClone(controlIr);
  mutate(value);
  await assert.rejects(() => preparePhysicsControlIRController(value), pattern);
}

let allocatorCalls = 0,
  capturedPointContactRequest = null;
const countedPrepared = await compileWatController(
  compileControlIRToWat(controlIr),
  {
    language: "visual",
    enforceSourceLimit: false,
    bindingManifest: manifest,
    pointContactWrenchSpecs: [controlIr.functions[0].body[0].spec],
    pointContactWrenchHost: Object.freeze({
      identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
      allocate(input) {
        allocatorCalls++;
        capturedPointContactRequest = JSON.parse(input);
        return allocatePointContactWrench(input);
      },
    }),
  },
);
tick(countedPrepared.instantiate(), validFrame({ tick: 15 }));
assert.equal(
  allocatorCalls,
  1,
  "one allocation declaration was recomputed for every scalar output",
);
const validatedControllerSpec = validatePointContactWrenchControllerSpec(
    controlIr.functions[0].body[0].spec,
    manifest,
  ),
  canonicalControllerResult = structuredClone(
    allocatePointContactWrench(JSON.stringify(capturedPointContactRequest)),
  ),
  rejectForgedResult = (label, mutate) => {
    const forged = structuredClone(canonicalControllerResult);
    mutate(forged);
    assert.throws(
      () =>
        validatePointContactWrenchControllerResult(
          JSON.stringify(forged),
          validatedControllerSpec,
          capturedPointContactRequest,
        ),
      /invalid field set|must be a finite three-vector|is inconsistent/,
      `controller host accepted forged ${label}`,
    );
  };
assert.doesNotThrow(() =>
  validatePointContactWrenchControllerResult(
    JSON.stringify(canonicalControllerResult),
    validatedControllerSpec,
    capturedPointContactRequest,
  ),
);
const scalarBoundarySpec = validatePointContactWrenchControllerSpec(
    {
      ...structuredClone(allocationSpec),
      contacts: allocationSpec.contacts.map((contact, index) => ({
        ...structuredClone(contact),
        normalForceLimitN: index === 0 ? COMMAND_SINK_SCALAR_LIMIT : 0,
        tangentialForceLimitN: 0,
      })),
    },
    manifest,
  ),
  scalarBoundaryRequest = {
    tick: 16,
    targetFrame: scalarBoundarySpec.targetFrame,
    targetWrenchFrame: {
      valid: true,
      forceN: [0, COMMAND_SINK_SCALAR_LIMIT, 0],
      momentNm: [0, 0, 0],
    },
    contacts: scalarBoundarySpec.contacts.map((contact, index) => ({
      contactId: contact.contactId,
      tick: 16,
      geometryValid: true,
      frictionValid: true,
      limitValid: true,
      pointWorldM: [0, 0, 0],
      normalWorld: [0, 1, 0],
      frictionCoefficient: 0.8,
      normalForceLimitN: index === 0 ? COMMAND_SINK_SCALAR_LIMIT : 0,
      tangentialForceLimitN: 0,
    })),
    acceptance: scalarBoundarySpec.acceptance,
    solver: scalarBoundarySpec.solver,
  },
  scalarBoundaryResult = allocatePointContactWrench(
    JSON.stringify(scalarBoundaryRequest),
  );
assert.equal(scalarBoundaryResult.accepted, true);
assert.doesNotThrow(() =>
  validatePointContactWrenchControllerResult(
    JSON.stringify(scalarBoundaryResult),
    scalarBoundarySpec,
    scalarBoundaryRequest,
  ),
);
const forgedScalarBoundaryResult = structuredClone(scalarBoundaryResult),
  forgedNormalForceN = nextRepresentableAbove(COMMAND_SINK_SCALAR_LIMIT),
  scalarExcessN = forgedNormalForceN - COMMAND_SINK_SCALAR_LIMIT,
  forgedAllocation = forgedScalarBoundaryResult.allocations[0];
assert.ok(forgedNormalForceN > COMMAND_SINK_SCALAR_LIMIT);
assert.equal(
  nextRepresentableAbove(COMMAND_SINK_SCALAR_LIMIT),
  forgedNormalForceN,
);
assert.doesNotThrow(() =>
  assertPointContactCommandForceInRange(true, [
    COMMAND_SINK_SCALAR_LIMIT,
    0,
    0,
  ]),
);
assert.throws(
  () =>
    assertPointContactCommandForceInRange(true, [
      COMMAND_SINK_SCALAR_LIMIT + scalarExcessN,
      0,
      0,
    ]),
  /exceeds the command-sink scalar limit/,
);
forgedAllocation.forceFrameN[1] = forgedNormalForceN;
forgedAllocation.forceWorldN[1] = forgedNormalForceN;
forgedAllocation.normalForceN = forgedNormalForceN;
forgedAllocation.frictionLimitN =
  forgedNormalForceN * forgedAllocation.frictionCoefficient;
forgedScalarBoundaryResult.achievedWrenchFrame.forceN[1] = forgedNormalForceN;
forgedScalarBoundaryResult.residualWrenchFrame.forceN[1] = -scalarExcessN;
forgedScalarBoundaryResult.residualWrenchFrame.forceNormN = scalarExcessN;
assert.throws(
  () =>
    validatePointContactWrenchControllerResult(
      JSON.stringify(forgedScalarBoundaryResult),
      scalarBoundarySpec,
      scalarBoundaryRequest,
    ),
  /exceeds the command-sink scalar limit/,
  "controller host accepted a force that downstream routing would clamp",
);
for (const [label, mutate] of [
  ["root field", (value) => (value.unexpected = true)],
  ["version", (value) => (value.version = 2)],
  ["tick", (value) => value.tick++],
  ["target frame", (value) => (value.targetFrameId = "forged/frame")],
  ["authority type", (value) => (value.authorityValid = 1)],
  ["authority", (value) => (value.authorityValid = false)],
  ["convergence type", (value) => (value.solverConverged = 1)],
  ["convergence", (value) => (value.solverConverged = false)],
  ["acceptance type", (value) => (value.accepted = 1)],
  ["acceptance", (value) => (value.accepted = false)],
  ["reason", (value) => (value.reason = "forged-reason")],
  ["negative iterations", (value) => (value.iterations = -1)],
  [
    "excess iterations",
    (value) =>
      (value.iterations = validatedControllerSpec.solver.maxIterations + 1),
  ],
  ["fractional iterations", (value) => (value.iterations = 0.5)],
  ["saturation type", (value) => (value.saturated = 1)],
  ["saturation", (value) => (value.saturated = !value.saturated)],
  ["target force shape", (value) => value.targetWrenchFrame.forceN.pop()],
  ["target force", (value) => value.targetWrenchFrame.forceN[0]++],
  ["target moment shape", (value) => value.targetWrenchFrame.momentNm.pop()],
  ["target moment", (value) => value.targetWrenchFrame.momentNm[0]++],
  ["achieved force shape", (value) => value.achievedWrenchFrame.forceN.pop()],
  ["achieved force", (value) => value.achievedWrenchFrame.forceN[0]++],
  [
    "achieved moment shape",
    (value) => value.achievedWrenchFrame.momentNm.pop(),
  ],
  ["achieved moment", (value) => value.achievedWrenchFrame.momentNm[0]++],
  ["residual force shape", (value) => value.residualWrenchFrame.forceN.pop()],
  ["residual force", (value) => value.residualWrenchFrame.forceN[0]++],
  [
    "residual moment shape",
    (value) => value.residualWrenchFrame.momentNm.pop(),
  ],
  ["residual moment", (value) => value.residualWrenchFrame.momentNm[0]++],
  [
    "negative force residual",
    (value) => (value.residualWrenchFrame.forceNormN = -1),
  ],
  ["force residual norm", (value) => value.residualWrenchFrame.forceNormN++],
  [
    "negative moment residual",
    (value) => (value.residualWrenchFrame.momentNormNm = -1),
  ],
  ["moment residual norm", (value) => value.residualWrenchFrame.momentNormNm++],
  ["force tolerance", (value) => value.acceptance.forceResidualToleranceN++],
  ["moment tolerance", (value) => value.acceptance.momentResidualToleranceNm++],
  ["moment reference", (value) => value.acceptance.momentReferenceLengthM++],
  ["allocation count", (value) => value.allocations.pop()],
  [
    "allocation contact",
    (value) => (value.allocations[0].contactId = "forged"),
  ],
  ["allocation tick", (value) => value.allocations[0].tick++],
  ["allocation point", (value) => value.allocations[0].pointFrameM[0]++],
  ["allocation normal", (value) => value.allocations[0].normalFrame[0]++],
  ["allocation frame force", (value) => value.allocations[0].forceFrameN[0]++],
  ["allocation world force", (value) => value.allocations[0].forceWorldN[0]++],
  ["normal force", (value) => value.allocations[0].normalForceN++],
  [
    "negative normal force",
    (value) => (value.allocations[0].normalForceN = -1),
  ],
  ["tangential force", (value) => value.allocations[0].tangentialForceN++],
  [
    "negative tangential force",
    (value) => (value.allocations[0].tangentialForceN = -1),
  ],
  ["friction limit", (value) => value.allocations[0].frictionLimitN++],
  [
    "negative friction limit",
    (value) => (value.allocations[0].frictionLimitN = -1),
  ],
  ["normal limit", (value) => value.allocations[0].normalForceLimitN++],
  [
    "negative normal limit",
    (value) => (value.allocations[0].normalForceLimitN = -1),
  ],
  ["tangent limit", (value) => value.allocations[0].tangentialForceLimitN++],
  [
    "negative tangent limit",
    (value) => (value.allocations[0].tangentialForceLimitN = -1),
  ],
  ["friction", (value) => value.allocations[0].frictionCoefficient++],
  [
    "negative friction",
    (value) => (value.allocations[0].frictionCoefficient = -1),
  ],
  [
    "normal saturation type",
    (value) => (value.allocations[0].normalSaturated = 1),
  ],
  [
    "normal saturation",
    (value) =>
      (value.allocations[0].normalSaturated =
        !value.allocations[0].normalSaturated),
  ],
  [
    "friction saturation type",
    (value) => (value.allocations[0].frictionSaturated = 1),
  ],
  [
    "friction saturation",
    (value) =>
      (value.allocations[0].frictionSaturated =
        !value.allocations[0].frictionSaturated),
  ],
  [
    "tangent saturation type",
    (value) => (value.allocations[0].tangentialLimitSaturated = 1),
  ],
  [
    "tangent saturation",
    (value) =>
      (value.allocations[0].tangentialLimitSaturated =
        !value.allocations[0].tangentialLimitSaturated),
  ],
  [
    "allocation saturation type",
    (value) => (value.allocations[0].saturated = 1),
  ],
  [
    "allocation saturation",
    (value) =>
      (value.allocations[0].saturated = !value.allocations[0].saturated),
  ],
])
  rejectForgedResult(label, mutate);

const spatialQuaternion = [1, 2, 3, 4].map((value) => value / Math.sqrt(30)),
  spatialFramePosition = [1, -2, 3],
  spatialPointFrameM = [1, -0.5, 0.25],
  spatialForceFrameN = [20, 100, 30],
  spatialMomentFrameNm = [-40, -25, 110],
  rotateVector = ([x, y, z], [qx, qy, qz, qw]) => {
    const tx = 2 * (qy * z - qz * y),
      ty = 2 * (qz * x - qx * z),
      tz = 2 * (qx * y - qy * x);
    return [
      x + qw * tx + (qy * tz - qz * ty),
      y + qw * ty + (qz * tx - qx * tz),
      z + qw * tz + (qx * ty - qy * tx),
    ];
  },
  spatialSpec = validatePointContactWrenchControllerSpec(
    {
      ...structuredClone(allocationSpec),
      targetFrame: {
        frameId: "fixture/spatial",
        positionWorldM: spatialFramePosition,
        quaternionWorldFromFrame: spatialQuaternion,
      },
    },
    manifest,
  ),
  spatialNormalWorld = rotateVector([0, 1, 0], spatialQuaternion),
  spatialPointWorldM = rotateVector(spatialPointFrameM, spatialQuaternion).map(
    (value, axis) => value + spatialFramePosition[axis],
  ),
  spatialRequest = {
    tick: 22,
    targetFrame: spatialSpec.targetFrame,
    targetWrenchFrame: {
      valid: true,
      forceN: spatialForceFrameN,
      momentNm: spatialMomentFrameNm,
    },
    contacts: spatialSpec.contacts.map((contact) => ({
      contactId: contact.contactId,
      tick: 22,
      geometryValid: true,
      frictionValid: true,
      limitValid: true,
      pointWorldM: spatialPointWorldM,
      normalWorld: spatialNormalWorld,
      frictionCoefficient: 0.8,
      normalForceLimitN: contact.normalForceLimitN,
      tangentialForceLimitN: contact.tangentialForceLimitN,
    })),
    acceptance: spatialSpec.acceptance,
    solver: spatialSpec.solver,
  },
  spatialResult = allocatePointContactWrench(JSON.stringify(spatialRequest));
assert.equal(spatialResult.accepted, true);
assert.doesNotThrow(() =>
  validatePointContactWrenchControllerResult(
    JSON.stringify(spatialResult),
    spatialSpec,
    spatialRequest,
  ),
);

const validateCanonicalRequest = (spec, request, assertion) => {
    const result = allocatePointContactWrench(JSON.stringify(request));
    assert.doesNotThrow(() =>
      validatePointContactWrenchControllerResult(
        JSON.stringify(result),
        spec,
        request,
      ),
    );
    assertion(result);
    return result;
  },
  normalSaturationRequest = structuredClone(capturedPointContactRequest);
normalSaturationRequest.targetWrenchFrame.forceN = [0, 200, 0];
const normalSaturationResult = validateCanonicalRequest(
  validatedControllerSpec,
  normalSaturationRequest,
  (result) => {
    assert.equal(result.accepted, true);
    assert.ok(
      result.allocations.every((allocation) => allocation.normalSaturated),
    );
  },
);
const fullBudgetResult = structuredClone(normalSaturationResult);
fullBudgetResult.iterations = validatedControllerSpec.solver.maxIterations;
assert.doesNotThrow(() =>
  validatePointContactWrenchControllerResult(
    JSON.stringify(fullBudgetResult),
    validatedControllerSpec,
    normalSaturationRequest,
  ),
);

const frictionSaturationRequest = structuredClone(capturedPointContactRequest);
frictionSaturationRequest.targetWrenchFrame.forceN = [80, 100, 0];
validateCanonicalRequest(
  validatedControllerSpec,
  frictionSaturationRequest,
  (result) => {
    assert.equal(result.accepted, true);
    assert.ok(
      result.allocations.every((allocation) => allocation.frictionSaturated),
    );
  },
);

const tangentLimitedSpecInput = structuredClone(allocationSpec);
for (const contact of tangentLimitedSpecInput.contacts)
  contact.tangentialForceLimitN = 20;
const tangentLimitedSpec = validatePointContactWrenchControllerSpec(
    tangentLimitedSpecInput,
    manifest,
  ),
  tangentLimitedRequest = structuredClone(capturedPointContactRequest);
tangentLimitedRequest.targetWrenchFrame.forceN = [40, 100, 0];
for (const contact of tangentLimitedRequest.contacts)
  contact.tangentialForceLimitN = 20;
validateCanonicalRequest(
  tangentLimitedSpec,
  tangentLimitedRequest,
  (result) => {
    assert.equal(result.accepted, true);
    assert.ok(
      result.allocations.every(
        (allocation) => allocation.tangentialLimitSaturated,
      ),
    );
  },
);

for (const [component, target] of [
  ["force", [200, 0, 0]],
  ["moment", [200, 0, 0]],
]) {
  const boundarySpecInput = structuredClone(allocationSpec),
    boundaryRequest = structuredClone(capturedPointContactRequest);
  boundarySpecInput.acceptance.forceResidualToleranceN =
    component === "force" ? 200 : 0;
  boundarySpecInput.acceptance.momentResidualToleranceNm =
    component === "moment" ? 200 : 0;
  const boundaryAcceptanceSpec = validatePointContactWrenchControllerSpec(
    boundarySpecInput,
    manifest,
  );
  boundaryRequest.acceptance = boundaryAcceptanceSpec.acceptance;
  boundaryRequest.targetWrenchFrame.forceN =
    component === "force" ? target : [0, 0, 0];
  boundaryRequest.targetWrenchFrame.momentNm =
    component === "moment" ? target : [0, 0, 0];
  for (const contact of boundaryRequest.contacts)
    contact.frictionCoefficient = 0;
  validateCanonicalRequest(boundaryAcceptanceSpec, boundaryRequest, (result) =>
    assert.equal(result.accepted, true),
  );
}

const invalidAuthorityRequest = structuredClone(capturedPointContactRequest);
invalidAuthorityRequest.contacts[0].geometryValid = false;
const invalidAuthorityResult = validateCanonicalRequest(
  validatedControllerSpec,
  invalidAuthorityRequest,
  (result) => assert.equal(result.authorityValid, false),
);
const invalidSolverType = structuredClone(invalidAuthorityResult);
invalidSolverType.solverConverged = 0;
assert.throws(
  () =>
    validatePointContactWrenchControllerResult(
      JSON.stringify(invalidSolverType),
      validatedControllerSpec,
      invalidAuthorityRequest,
    ),
  /result is inconsistent/,
);
const invalidAllocationCount = structuredClone(invalidAuthorityResult);
invalidAllocationCount.allocations.pop();
assert.throws(
  () =>
    validatePointContactWrenchControllerResult(
      JSON.stringify(invalidAllocationCount),
      validatedControllerSpec,
      invalidAuthorityRequest,
    ),
  /result is inconsistent/,
);
const reformattedPrepared = await preparePhysicsTypeScriptController(
  `${source}\n`,
  manifest,
);
assert.notEqual(
  reformattedPrepared.programIdentity,
  prepared.programIdentity,
  "controller identity ignored the authored source",
);

const callLine = source.match(
    /api\.writePointContactWrench\(([^\n]+)\);/u,
  )?.[1],
  separator = callLine.lastIndexOf(", "),
  specificationLiteral = callLine.slice(0, separator),
  outputLiteral = callLine.slice(separator + 2),
  outputBindingList = JSON.parse(JSON.parse(outputLiteral)),
  sourceWithCall = (call) =>
    source.replace(/api\.writePointContactWrench\([^\n]+\);/u, call);
for (const [call, pattern] of [
  ["api.writePointContactWrench();", /needs literal specification/],
  [
    `api.writePointContactWrench(api.read(${JSON.stringify(
      targetForceBindings[0],
    )}), ${outputLiteral});`,
    /needs literal specification/,
  ],
  [
    `rogue.writePointContactWrench(${specificationLiteral}, ${outputLiteral});`,
    /only declared helpers|unsupported expression statement/,
  ],
  [
    `api.writePointContactWrench(${JSON.stringify("{")}, ${outputLiteral});`,
    /JSON/,
  ],
  [
    `api.writePointContactWrench(${specificationLiteral}, ${JSON.stringify("{}")});`,
    /output bindings are invalid/,
  ],
  ...[
    (values) => values.pop(),
    (values) => (values[1] = values[0]),
    (values) => (values[0] = ""),
    (values) => (values[0] = 1),
    (values) => (values[0] = "unknown-output"),
  ].map((mutate) => {
    const values = [...outputBindingList];
    mutate(values);
    return [
      `api.writePointContactWrench(${specificationLiteral}, ${JSON.stringify(
        JSON.stringify(values),
      )});`,
      /output bindings are invalid|unknown output binding/,
    ];
  }),
]) {
  await assert.rejects(
    () => preparePhysicsTypeScriptController(sourceWithCall(call), manifest),
    pattern,
  );
}

const generatedWat = compileControlIRToWat(controlIr),
  declaredSpecs = [controlIr.functions[0].body[0].spec],
  physicalWatOptions = {
    language: "visual",
    enforceSourceLimit: false,
    bindingManifest: manifest,
    pointContactWrenchSpecs: declaredSpecs,
    pointContactWrenchHost: Object.freeze({
      identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
      allocate: allocatePointContactWrench,
    }),
  };
await assert.rejects(
  () =>
    compileWatController(generatedWat, {
      ...physicalWatOptions,
      pointContactWrenchHost: Object.freeze({
        identity: "forged-host-abi",
        allocate: allocatePointContactWrench,
      }),
    }),
  /needs a physical allocator host/,
  "allocator function without the canonical host ABI gained authority",
);
await assert.rejects(
  () =>
    compileWatController(generatedWat, {
      ...physicalWatOptions,
      pointContactWrenchHost: Object.freeze({
        identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
        allocate: null,
      }),
    }),
  /needs a physical allocator host/,
  "host ABI identity without an allocator gained authority",
);
for (const [wat, pattern] of [
  [
    generatedWat.replace(
      '"env" "point_contact_wrench_output"',
      '"other" "point_contact_wrench_output"',
    ),
    /only env\.read_binding/,
  ],
  [
    generatedWat.replace(
      "(param i32 i32) (result f64)",
      "(param i32) (result f64)",
    ),
    /must have signature/,
  ],
  [
    generatedWat.replace(
      "(param i32 i32) (result f64)",
      "(param i32 i32) (result i32)",
    ),
    /must have signature/,
  ],
]) {
  await assert.rejects(
    () => compileWatController(wat, physicalWatOptions),
    pattern,
  );
}

const hostProbeWat = (specIndex, outputIndex) => `(module
  (import "env" "point_contact_wrench_output"
    (func $allocate (param i32 i32) (result f64)))
  (func (export "tick") (param f64)
    (drop (call $allocate (i32.const ${specIndex}) (i32.const ${outputIndex})))))`;
for (const [specIndex, outputIndex] of [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, outputIds.length],
]) {
  const invalidIndexPrepared = await compileWatController(
    hostProbeWat(specIndex, outputIndex),
    physicalWatOptions,
  );
  assert.throws(
    () => invalidIndexPrepared.instantiate().tick(1 / 120, validFrame()),
    /index is out of range/,
  );
}
const distinctMaximalSpecs = ["a", "b", "c"].map((suffix) => ({
    ...structuredClone(declaredSpecs[0]),
    targetFrame: {
      ...structuredClone(declaredSpecs[0].targetFrame),
      frameId: `fixture/${suffix}`,
    },
    solver: {
      ...structuredClone(declaredSpecs[0].solver),
      maxIterations: 256,
    },
    contacts: Array.from({ length: 16 }, (_, index) => ({
      ...structuredClone(declaredSpecs[0].contacts[index % 2]),
      contactId: `${suffix}-${index}`,
    })),
  })),
  exhaustingHostWat = `(module
    (import "env" "point_contact_wrench_output"
      (func $allocate (param i32 i32) (result f64)))
    (func (export "tick") (param f64)
      (drop (call $allocate (i32.const 0) (i32.const 0)))
      (drop (call $allocate (i32.const 1) (i32.const 0)))
      (drop (call $allocate (i32.const 2) (i32.const 0)))))`,
  exhaustingPrepared = await compileWatController(exhaustingHostWat, {
    ...physicalWatOptions,
    pointContactWrenchSpecs: distinctMaximalSpecs,
  });
assert.throws(
  () => exhaustingPrepared.instantiate().tick(1 / 120, validFrame()),
  /fuel exhausted/,
  "multiple physical allocations bypassed the per-tick controller budget",
);
const throwingPrepared = await compileWatController(hostProbeWat(0, 0), {
  ...physicalWatOptions,
  pointContactWrenchHost: Object.freeze({
    identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
    allocate() {
      throw new TypeError("allocator contract sentinel");
    },
  }),
});
assert.throws(
  () => throwingPrepared.instantiate().tick(1 / 120, validFrame()),
  /allocator contract sentinel/,
  "non-numerical allocator errors were laundered into recoverable evidence",
);

const untrustedResultPrepared = await compileWatController(hostProbeWat(0, 0), {
  ...physicalWatOptions,
  pointContactWrenchHost: Object.freeze({
    identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
    allocate(input) {
      return structuredClone(allocatePointContactWrench(input));
    },
  }),
});
assert.throws(
  () => untrustedResultPrepared.instantiate().tick(1 / 120, validFrame()),
  /untrusted result data/,
  "unissued host output crossed the controller authority boundary",
);

const wrongTickResultPrepared = await compileWatController(hostProbeWat(0, 0), {
  ...physicalWatOptions,
  pointContactWrenchHost: Object.freeze({
    identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
    allocate(input) {
      const result = structuredClone(allocatePointContactWrench(input));
      result.tick++;
      return JSON.stringify(result);
    },
  }),
});
assert.throws(
  () => wrongTickResultPrepared.instantiate().tick(1 / 120, validFrame()),
  /result is inconsistent/,
  "host output laundered a different physical tick",
);

const infeasibleForceResultPrepared = await compileWatController(
  hostProbeWat(0, 0),
  {
    ...physicalWatOptions,
    pointContactWrenchHost: Object.freeze({
      identity: POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
      allocate(input) {
        const result = structuredClone(allocatePointContactWrench(input));
        result.allocations[0].forceWorldN[0] = 1_000_000;
        return JSON.stringify(result);
      },
    }),
  },
);
assert.throws(
  () => infeasibleForceResultPrepared.instantiate().tick(1 / 120, validFrame()),
  /allocation is inconsistent|exceeds the command-sink scalar limit/,
  "host output bypassed physical contact-force validation",
);

await assert.rejects(
  () =>
    prepareWasmController(
      `(module
        (import "env" "point_contact_wrench_output"
          (func $allocate (param i32 i32) (result f64)))
        (func (export "tick") (param f64)
          (drop (call $allocate (i32.const 0) (i32.const 0)))))`,
      manifest,
    ),
  /only env\.read_binding/,
  "direct WAT gained an undeclared allocation specification",
);

const maximumContactIds = Array.from(
    { length: 16 },
    (_, index) => `contact-${String(index).padStart(2, "0")}`,
  ),
  maximumInputs = new Map(
    maximumContactIds.map((contactId) => [contactId, contactInput(contactId)]),
  ),
  maximumForceOutputs = new Map(
    maximumContactIds.map((contactId) => [
      contactId,
      axes.map((axis) => `${contactId}.force-world-${axis}-n`),
    ]),
  ),
  maximumManifest = [
    ...inputBindings.slice(0, 6),
    ...maximumContactIds.flatMap((contactId) => {
      const input = maximumInputs.get(contactId);
      return [
        ...input.point.map((id, axis) => ({
          id,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: `contact_resultant_point_world_${axes[axis]}_m`,
        })),
        ...input.normal.map((id, axis) => ({
          id,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: `contact_resultant_normal_world_${axes[axis]}`,
        })),
        {
          id: input.friction,
          direction: "input",
          endpointPartId: `sensor-${contactId}`,
          endpointPortId: "SIGNAL",
          reading: "contact_min_friction_coefficient",
        },
      ];
    }),
    ...Object.values(diagnostics).map((id) => ({
      id,
      direction: "output",
      endpointPartId: `sink-${id}`,
      endpointPortId: "CONTROL",
      channel: "command",
    })),
    ...maximumContactIds.flatMap((contactId) =>
      maximumForceOutputs.get(contactId).map((id) => ({
        id,
        direction: "output",
        endpointPartId: `sink-${id}`,
        endpointPortId: "CONTROL",
        channel: "command",
      })),
    ),
  ]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((binding, index) => ({ ...binding, index })),
  maximumSource = pointContactWrenchAllocatorProgram({
    allocationSpec: {
      ...allocationSpec,
      contacts: maximumContactIds.map((contactId, index) => ({
        contactId,
        pointWorldBindings: maximumInputs.get(contactId).point,
        normalWorldBindings: maximumInputs.get(contactId).normal,
        frictionCoefficientBinding: maximumInputs.get(contactId).friction,
        normalForceLimitN: 100 + index,
        tangentialForceLimitN: 100 + index,
      })),
    },
    diagnosticOutputBindingIds: diagnostics,
    contactForceOutputs: maximumContactIds.map((contactId) => ({
      contactId,
      forceWorldOutputBindingIds: maximumForceOutputs.get(contactId),
    })),
    bindingManifest: maximumManifest,
  });
assert.ok(
  new TextEncoder().encode(maximumSource).byteLength <=
    CONTROLLER_LIMITS.sourceBytes,
  "maximum-contact generated controller exceeds the source budget",
);
const maximumPrepared = await preparePhysicsTypeScriptController(
    maximumSource,
    maximumManifest,
  ),
  maximumControlIr = await compileTypeScriptToControlIR(
    maximumSource,
    maximumManifest,
  );
await preparePhysicsControlIRController(maximumControlIr);
assert.equal(
  maximumPrepared.bindingManifest.length,
  maximumManifest.length,
  "maximum-contact TypeScript controller did not compile",
);

console.log(
  "point-contact wrench controller passed (canonical allocation, rejection, permutation, checkpoint, recovery)",
);
