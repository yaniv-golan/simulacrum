import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateCheckpointWire,
  validateExperimentWire,
  validateInputTraceWire,
  validateRunConfigurationWire,
  validateTelemetryPlaybackWire,
} from "../src/model/generated/mechanism-artifact-wire-validators.js";
import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
  decodeCheckpoint,
  decodeCheckpointOrThrow,
  decodeExperiment,
  decodeExperimentOrThrow,
  decodeInputTrace,
  decodeInputTraceOrThrow,
  decodeRunConfiguration,
  decodeRunConfigurationOrThrow,
  decodeTelemetryPlayback,
  decodeTelemetryPlaybackOrThrow,
  encodeCheckpoint,
  encodeExperiment,
  encodeInputTrace,
  encodeRunConfiguration,
  encodeTelemetryPlayback,
  experimentManifestDigest,
  fingerprintCheckpoint,
  fingerprintExperiment,
  fingerprintExperimentBlueprint,
  fingerprintInputTrace,
  fingerprintRunConfiguration,
  fingerprintTelemetryPlayback,
} from "../src/model/mechanism-artifacts.js";
import { sha256Hex } from "../src/model/sha256.js";
import { stableStringify } from "../src/model/primitives.js";
import { createWorkshopRunConfiguration } from "../src/application/mechanism-run-identity.js";

const fixture = JSON.parse(
    fs.readFileSync(
      "test/fixtures/mechanism-physics/mechanism-artifact-contracts.json",
      "utf8",
    ),
  ),
  blueprint = JSON.parse(
    fs.readFileSync(
      "test/fixtures/strict-current-contract/blueprint.spec.json",
      "utf8",
    ),
  ),
  zeroDigest = "0".repeat(64),
  identity = (kind) => ({
    id: `fixture/${kind}`,
    version: "1.0.0",
    byteLength: kind.length,
    sha256: sha256Hex(`fixture/${kind}`),
  });

const runConfiguration = {
    format: "simulacrum-run-configuration",
    version: 1,
    fixedStepS: 1 / 120,
    determinismTier: "same-build-bit-exact",
    seed: fixture.run.seed,
    durationTicks: fixture.run.durationTicks,
    identities: Object.fromEntries(
      fixture.run.identityKinds.map((kind) => [kind, identity(kind)]),
    ),
    budgets: {
      maxBodies: 64,
      maxConstraints: 256,
      maxContactCandidates: 512,
      maxStepMs: 8,
      maxMemoryBytes: 64 * 1024 * 1024,
    },
    environment: {
      gravityMPerS2: [0, -9.80665, 0],
      terrainFingerprint: `sim-sha256-${zeroDigest}`,
      materialMapFingerprint: `sim-sha256-${"1".repeat(64)}`,
    },
  },
  runConfigurationFingerprint = fingerprintRunConfiguration(runConfiguration),
  inputTrace = {
    format: "simulacrum-input-trace",
    version: 3,
    sourceId: "operator",
    runConfigurationFingerprint,
    startTick: 0,
    endTick: fixture.run.durationTicks,
    inputs: fixture.inputRecords,
  },
  blueprintFingerprint = fingerprintExperimentBlueprint(blueprint),
  stateOwners = CHECKPOINT_STATE_OWNER_IDS.map((ownerId) => {
    const payloadJson = stableStringify(fixture.stateOwnerPayloads[ownerId]);
    return {
      ownerId,
      ownerVersion: CHECKPOINT_STATE_OWNER_VERSIONS[ownerId],
      payloadJson,
      payloadByteLength: new TextEncoder().encode(payloadJson).byteLength,
      payloadSha256: sha256Hex(payloadJson),
    };
  }),
  checkpoint = {
    format: "simulacrum-checkpoint",
    version: 2,
    runConfigurationFingerprint,
    blueprintFingerprint,
    compiledTopologyFingerprint: `sim-sha256-${"2".repeat(64)}`,
    committedTick: 2,
    committed: true,
    stateOwners,
    stateDigest: zeroDigest,
  };
checkpoint.stateDigest = checkpointStateDigest(checkpoint);

const experiment = {
  format: "simulacrum-experiment",
  version: 1,
  blueprintFingerprint,
  blueprint,
  runConfiguration,
  inputTrace,
  checkpoint,
  startTick: inputTrace.startTick,
  endTick: inputTrace.endTick,
  observations: fixture.observations,
  manifestDigest: zeroDigest,
};
experiment.manifestDigest = experimentManifestDigest(experiment);

const telemetryPlayback = {
  format: "simulacrum-telemetry-playback",
  version: 1,
  resumable: false,
  runConfigurationFingerprint,
  blueprintFingerprint,
  fixedStepS: 1 / 120,
  startTick: 0,
  endTick: fixture.run.durationTicks,
  frames: fixture.playback.frames.map((frame) => ({
    tick: frame.tick,
    timeS: frame.tick * (1 / 120),
    fixedDtS: 1 / 120,
    topologyRevision: 0,
    stateDigest: sha256Hex(`state/${frame.tick}`),
    samples: frame.samples,
    events: frame.events.map(({ payload, ...event }) => ({
      ...event,
      payloadJson: stableStringify(payload),
    })),
  })),
};

const emptyCompiledAuthority = {
    version: 1,
    sourceRevision: 0,
    parts: [],
    bodies: [],
    constraints: [],
    rigidClusters: [],
    collisionExclusions: [],
    forceElements: [],
    actuators: [],
    contactRegions: [],
    networks: {},
  },
  runIdentityInput = {
    blueprint,
    compiled: emptyCompiledAuthority,
    environment: {
      latitude: 0,
      longitude: 0,
      timeOfDay: 12,
      windEnabled: false,
      testSite: {},
      deployment: null,
    },
  },
  solverIdentity30 = createWorkshopRunConfiguration({
    ...runIdentityInput,
    solverProfile: {
      fixedDt: 1 / 120,
      iterations: 30,
      tolerance: 2e-4,
    },
  }),
  solverIdentity31 = createWorkshopRunConfiguration({
    ...runIdentityInput,
    solverProfile: {
      fixedDt: 1 / 120,
      iterations: 31,
      tolerance: 1e-5,
    },
  });
assert.notEqual(
  solverIdentity30.configuration.identities.solverProfile.sha256,
  solverIdentity31.configuration.identities.solverProfile.sha256,
  "run identity erased the effective solver iteration/tolerance authority",
);
assert.equal(solverIdentity30.configuration.fixedStepS, 1 / 120);
assert.throws(
  () => createWorkshopRunConfiguration(runIdentityInput),
  (error) => error?.code === "INVALID_RUN_SOLVER_PROFILE",
  "run identity accepted an unattested implicit solver profile",
);

const artifacts = {
    runConfiguration,
    inputTrace,
    checkpoint,
    experiment,
    telemetryPlayback,
  },
  contracts = [
    {
      name: "runConfiguration",
      validator: validateRunConfigurationWire,
      decode: decodeRunConfiguration,
      orThrow: decodeRunConfigurationOrThrow,
      encode: encodeRunConfiguration,
      fingerprint: fingerprintRunConfiguration,
    },
    {
      name: "inputTrace",
      validator: validateInputTraceWire,
      decode: decodeInputTrace,
      orThrow: decodeInputTraceOrThrow,
      encode: encodeInputTrace,
      fingerprint: fingerprintInputTrace,
    },
    {
      name: "checkpoint",
      validator: validateCheckpointWire,
      decode: decodeCheckpoint,
      orThrow: decodeCheckpointOrThrow,
      encode: encodeCheckpoint,
      fingerprint: fingerprintCheckpoint,
    },
    {
      name: "experiment",
      validator: validateExperimentWire,
      decode: decodeExperiment,
      orThrow: decodeExperimentOrThrow,
      encode: encodeExperiment,
      fingerprint: fingerprintExperiment,
    },
    {
      name: "telemetryPlayback",
      validator: validateTelemetryPlaybackWire,
      decode: decodeTelemetryPlayback,
      orThrow: decodeTelemetryPlaybackOrThrow,
      encode: encodeTelemetryPlayback,
      fingerprint: fingerprintTelemetryPlayback,
    },
  ];

for (const contract of contracts) {
  const artifact = artifacts[contract.name],
    boundaryInput =
      contract.name === "checkpoint" ? JSON.stringify(artifact) : artifact;
  assert.equal(contract.validator(artifact), true, `${contract.name} schema`);
  const decoded = contract.decode(boundaryInput);
  assert.equal(
    decoded.ok,
    true,
    `${contract.name} total decoder: ${JSON.stringify(decoded.errors)}`,
  );
  assert.deepEqual(decoded.value.wire, artifact);
  assert(decoded.value.envelope.bytes > 0);
  assert(decoded.value.envelope.nodes > 0);
  assert.match(decoded.value.fingerprint, /^sim-sha256-[0-9a-f]{64}$/);
  assert.equal(contract.fingerprint(boundaryInput), decoded.value.fingerprint);
  assert.equal(contract.encode(boundaryInput), stableStringify(artifact));
  assert.deepEqual(
    contract.orThrow(JSON.stringify(artifact)).wire,
    artifact,
    `${contract.name} accepts exact JSON bytes`,
  );
  assert.throws(
    () => {
      decoded.value.wire.version = 99;
    },
    TypeError,
    `${contract.name} decoded values are immutable`,
  );
}

let wireAccessorReads = 0;
const accessorRunConfiguration = structuredClone(runConfiguration);
Object.defineProperty(accessorRunConfiguration, "version", {
  enumerable: true,
  get() {
    wireAccessorReads++;
    return 1;
  },
});
assert.equal(
  decodeRunConfiguration(accessorRunConfiguration).errors[0].code,
  "INVALID_WIRE_PLAIN_DATA",
  "wire boundary accepted an executable accessor",
);
assert.equal(
  wireAccessorReads,
  0,
  "wire boundary invoked an accessor before rejection",
);
let wireProxyGetterReads = 0;
const proxyRunConfiguration = new Proxy(structuredClone(runConfiguration), {
  get(target, key, receiver) {
    wireProxyGetterReads++;
    return Reflect.get(target, key, receiver);
  },
});
assert.equal(
  decodeRunConfiguration(proxyRunConfiguration).errors[0].code,
  "INVALID_WIRE_PLAIN_DATA",
  "wire boundary accepted Proxy authority",
);
assert.equal(
  wireProxyGetterReads,
  0,
  "wire Proxy rejection invoked a data getter",
);

assert.equal(CHECKPOINT_STATE_OWNER_IDS.length, 20);
assert.equal(new Set(CHECKPOINT_STATE_OWNER_IDS).size, 20);
assert.equal(decodeExperiment({ ...experiment, checkpoint: null }).ok, false);
const noCheckpointExperiment = { ...experiment, checkpoint: null };
noCheckpointExperiment.manifestDigest = experimentManifestDigest(
  noCheckpointExperiment,
);
assert.equal(decodeExperiment(noCheckpointExperiment).ok, true);

const singleTickInputTrace = {
  ...inputTrace,
  startTick: 4,
  endTick: 4,
  inputs: [structuredClone(inputTrace.inputs.at(-1))],
};
assert.equal(decodeInputTrace(singleTickInputTrace).ok, true);
const mixedSourceInputTrace = structuredClone(inputTrace);
mixedSourceInputTrace.inputs[0].sourceId = "unregistered-source";
assert.equal(
  decodeInputTrace(mixedSourceInputTrace).errors[0].code,
  "INPUT_TRACE_SOURCE_MISMATCH",
  "input trace accepted commands attributed to multiple sources",
);
const singleTickExperiment = {
  ...experiment,
  inputTrace: singleTickInputTrace,
  checkpoint: null,
  startTick: 4,
  endTick: 4,
  observations: [structuredClone(experiment.observations.at(-1))],
};
singleTickExperiment.manifestDigest =
  experimentManifestDigest(singleTickExperiment);
assert.equal(decodeExperiment(singleTickExperiment).ok, true);
const singleTickPlayback = {
  ...telemetryPlayback,
  startTick: 4,
  frames: [structuredClone(telemetryPlayback.frames.at(-1))],
};
assert.equal(decodeTelemetryPlayback(singleTickPlayback).ok, true);

const decoders = {
  runConfiguration: decodeRunConfiguration,
  inputTrace: decodeInputTrace,
  checkpoint: (value) => decodeCheckpoint(JSON.stringify(value)),
  experiment: decodeExperiment,
  telemetryPlayback: decodeTelemetryPlayback,
};

function mutate(candidate, testCase) {
  let target = candidate;
  for (const segment of testCase.path || []) target = target[segment];
  const parentPath = (testCase.path || []).slice(0, -1);
  let parent = candidate;
  for (const segment of parentPath) parent = parent[segment];
  const key = testCase.path?.at(-1);
  if (testCase.operation === "reverse") target.reverse();
  else if (testCase.operation === "swap-first-two")
    [target[0], target[1]] = [target[1], target[0]];
  else if (testCase.operation === "duplicate-first")
    target.push(structuredClone(target[0]));
  else parent[key] = testCase.value;
}

for (const testCase of fixture.negativeCases) {
  const candidate = structuredClone(artifacts[testCase.artifact]);
  if (testCase.path || testCase.operation) mutate(candidate, testCase);
  if (
    testCase.recompute === "checkpoint-state-digest" ||
    testCase.expected.startsWith("EXPERIMENT_CHECKPOINT_")
  )
    candidate.checkpoint.stateDigest = checkpointStateDigest(
      candidate.checkpoint,
    );
  const result = decoders[testCase.decoder || testCase.artifact](candidate);
  assert.equal(result.ok, false, `${testCase.id} must be rejected`);
  assert.equal(
    result.errors[0].code,
    testCase.expected,
    `${testCase.id} stable error code`,
  );
}

const nonnumericTolerance = structuredClone(experiment);
nonnumericTolerance.observations[0] = {
  tick: 0,
  channelId: "contact/front/active",
  expected: true,
  tolerance: { absolute: 1, relative: 0 },
};
assert.equal(
  decodeExperiment(nonnumericTolerance).errors[0].code,
  "INVALID_EXACT_OBSERVATION_TOLERANCE",
);

const unorderedSampleProvenance = structuredClone(telemetryPlayback);
unorderedSampleProvenance.frames[0].samples[0].sourceDescriptorIds = [
  "descriptor/z",
  "descriptor/a",
];
assert.equal(
  decodeTelemetryPlayback(unorderedSampleProvenance).errors[0].code,
  "NONCANONICAL_SAMPLE_PROVENANCE_ORDER",
);
const unorderedEventPredecessors = structuredClone(telemetryPlayback);
unorderedEventPredecessors.frames[1].events[0].predecessorIds = [
  "event/z",
  "event/a",
];
assert.equal(
  decodeTelemetryPlayback(unorderedEventPredecessors).errors[0].code,
  "NONCANONICAL_EVENT_PREDECESSOR_ORDER",
);
const unorderedEventProvenance = structuredClone(telemetryPlayback);
unorderedEventProvenance.frames[1].events[0].sourceDescriptorIds = [
  "descriptor/z",
  "descriptor/a",
];
assert.equal(
  decodeTelemetryPlayback(unorderedEventProvenance).errors[0].code,
  "NONCANONICAL_EVENT_PROVENANCE_ORDER",
);
const wrongPlaybackStep = structuredClone(telemetryPlayback);
wrongPlaybackStep.frames[0].fixedDtS = 1 / 60;
assert.equal(
  decodeTelemetryPlayback(wrongPlaybackStep).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);

let deeplyNestedPayload = {};
for (let depth = 0; depth <= 64; depth++)
  deeplyNestedPayload = { child: deeplyNestedPayload };
const deepCheckpoint = structuredClone(checkpoint),
  deepPayloadJson = stableStringify(deeplyNestedPayload);
Object.assign(deepCheckpoint.stateOwners[0], {
  payloadJson: deepPayloadJson,
  payloadByteLength: new TextEncoder().encode(deepPayloadJson).byteLength,
  payloadSha256: sha256Hex(deepPayloadJson),
});
deepCheckpoint.stateDigest = checkpointStateDigest(deepCheckpoint);
assert.equal(
  decodeCheckpoint(JSON.stringify(deepCheckpoint)).errors[0].code,
  "EMBEDDED_JSON_DEPTH_LIMIT",
);

const futureOwnerCheckpoint = structuredClone(checkpoint);
futureOwnerCheckpoint.stateOwners[0].ownerVersion = 4;
futureOwnerCheckpoint.stateDigest = checkpointStateDigest(
  futureOwnerCheckpoint,
);
assert.equal(
  decodeCheckpoint(JSON.stringify(futureOwnerCheckpoint)).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);

const deepPlayback = structuredClone(telemetryPlayback);
deepPlayback.frames[1].events[0].payloadJson = deepPayloadJson;
assert.equal(
  decodeTelemetryPlayback(deepPlayback).errors[0].code,
  "EMBEDDED_JSON_DEPTH_LIMIT",
);

const wideCheckpoint = structuredClone(checkpoint),
  widePayloadJson = stableStringify(Array.from({ length: 100001 }, () => null));
Object.assign(wideCheckpoint.stateOwners[0], {
  payloadJson: widePayloadJson,
  payloadByteLength: new TextEncoder().encode(widePayloadJson).byteLength,
  payloadSha256: sha256Hex(widePayloadJson),
});
wideCheckpoint.stateDigest = checkpointStateDigest(wideCheckpoint);
assert.equal(
  decodeCheckpoint(JSON.stringify(wideCheckpoint)).errors[0].code,
  "EMBEDDED_JSON_NODE_LIMIT",
);

const duplicateMiddleFrame = structuredClone(telemetryPlayback);
duplicateMiddleFrame.frames.splice(
  1,
  0,
  structuredClone(duplicateMiddleFrame.frames[0]),
);
assert.equal(
  decodeTelemetryPlayback(duplicateMiddleFrame).errors[0].code,
  "NONCANONICAL_PLAYBACK_FRAME_ORDER",
);

assert.equal(
  decodeInputTrace({ ...inputTrace, version: 1 }).errors[0].code,
  "UNSUPPORTED_INPUT_TRACE_VERSION",
);
assert.equal(
  decodeRunConfiguration({ ...runConfiguration, unexpected: true }).errors[0]
    .code,
  "WIRE_SCHEMA_VIOLATION",
);
assert.equal(
  decodeCheckpoint(JSON.stringify({ ...checkpoint, committed: false }))
    .errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);
assert.equal(
  decodeCheckpoint(JSON.stringify({ ...checkpoint, version: 1 })).errors[0]
    .code,
  "UNSUPPORTED_CHECKPOINT_VERSION",
);
assert.equal(
  decodeTelemetryPlayback({ ...telemetryPlayback, frames: [] }).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);
assert.throws(
  () => decodeCheckpointOrThrow(JSON.stringify({ ...inputTrace, version: 2 })),
  (error) =>
    error.code === "UNSUPPORTED_WIRE_FORMAT" && Array.isArray(error.path),
);

console.log(
  "five strict mechanism artifact schemas, canonical identities, semantic invariants and negative fixtures passed",
);
