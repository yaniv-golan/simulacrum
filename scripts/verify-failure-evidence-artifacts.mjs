import assert from "node:assert/strict";
import fs from "node:fs";
import { createFailureEvidenceArtifact } from "../src/application/failure-evidence-export.js";
import { createFailureEvidenceCaptureCoordinator } from "../src/application/failure-evidence-capture-coordinator.js";
import {
  decodeFailureEvidence,
  decodeFailureEvidenceOrThrow,
  encodeFailureEvidence,
  failureEvidenceManifestDigest,
  fingerprintFailureEvidence,
} from "../src/model/failure-evidence-artifacts.js";
import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
  fingerprintExperimentBlueprint,
  fingerprintRunConfiguration,
} from "../src/model/mechanism-artifacts.js";
import { stableStringify } from "../src/model/primitives.js";
import { sha256Hex } from "../src/model/sha256.js";
import {
  createFailureEvidencePolicy,
  failureEvidencePolicyFingerprint,
} from "../src/simulation/failure-evidence-policy.js";
import { InputTracePlayer } from "../src/simulation/input-trace-player.js";
import { WIRE_LIMITS } from "../src/model/wire-limits.js";

const blueprint = JSON.parse(
    fs.readFileSync(
      "test/fixtures/strict-current-contract/blueprint.spec.json",
      "utf8",
    ),
  ),
  fixture = JSON.parse(
    fs.readFileSync(
      "test/fixtures/mechanism-physics/mechanism-artifact-contracts.json",
      "utf8",
    ),
  ),
  identity = (kind) => ({
    id: `fixture/${kind}`,
    version: "1",
    byteLength: kind.length,
    sha256: sha256Hex(kind),
  }),
  runConfiguration = {
    format: "simulacrum-run-configuration",
    version: 1,
    fixedStepS: 1 / 120,
    determinismTier: "same-build-bit-exact",
    seed: "failure-evidence-fixture",
    durationTicks: 120,
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
      terrainFingerprint: `sim-sha256-${"0".repeat(64)}`,
      materialMapFingerprint: `sim-sha256-${"1".repeat(64)}`,
    },
  },
  runConfigurationFingerprint = fingerprintRunConfiguration(runConfiguration),
  blueprintFingerprint = fingerprintExperimentBlueprint(blueprint),
  compiledTopologyFingerprint = `sim-sha256-${"2".repeat(64)}`,
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
    compiledTopologyFingerprint,
    committedTick: 0,
    committed: true,
    stateOwners,
    stateDigest: "0".repeat(64),
  },
  policy = createFailureEvidencePolicy(),
  topology = {
    graphRevision: 4,
    connections: [
      {
        id: "joint-1",
        a: "1",
        b: "2",
        kind: "mechanical",
        failed: false,
      },
    ],
    detachedPartIds: [],
  },
  rawFrame = {
    tick: 1,
    timeS: 1 / 120,
    commandLedger: {
      remote: [{ targetId: 1, channel: "throttle", value: 1 }],
      script: [],
      conflicts: [],
      rejections: [],
      capabilities: ["throttle"],
    },
    contacts: [
      {
        contactId: "contact:1:a:b:0",
        bodyId: "part:1",
        otherBodyId: "environment:field",
        partIds: [1],
        point: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        forceWorldN: { x: 0, y: 200, z: 0 },
        forceN: 200,
        otherMaterialKey: "short-grass",
        supportShapeId: "field-heightfield",
        surfaceRegionId: "short-grass",
        featureId: { cellX: 1, cellZ: 2, triangle: "upper" },
        featureValidity: "derived",
        tireEvidence: null,
        validity: "measured",
      },
    ],
    solverContributions: [
      {
        rowId: "constraint:1:joint-1:pivot-x:0",
        rowKind: "pivot-x",
        source: "constraint",
        side: "A",
        bodyId: "part:1",
        otherBodyId: "part:2",
        constraintId: "constraint-1",
        sourceConnectionIds: ["joint-1"],
        sourceContactIds: ["contact:1:a:b:0"],
        forceWorldN: { x: 200, y: 0, z: 0 },
        momentAtApplicationPointWorldNm: { x: 0, y: 0, z: 10 },
        applicationPointWorldM: { x: 0, y: 1, z: 0 },
        forceMagnitudeN: 200,
        momentMagnitudeNm: 10,
        multiplier: 200,
        validity: "measured",
      },
    ],
    connectionLoads: [{ connectionId: "joint-1", forceN: 200, torqueNm: 10 }],
    structurePreMutation: {
      evaluations: [
        {
          connectionId: "joint-1",
          loadN: 200,
          torqueNm: 10,
          ultimateForceN: 100,
          ultimateTorqueNm: 100,
          forceUtilization: 2,
          torqueUtilization: 0.1,
          stress: 2,
          fatigue: 0,
        },
      ],
      topology,
    },
    structurePostMutation: {
      event: {
        failedConnectionIds: ["joint-1"],
        detachedPartIds: [2],
        mode: "stress",
        reason: "measured overload",
      },
      topology: {
        graphRevision: 5,
        connections: [{ ...topology.connections[0], failed: true }],
        detachedPartIds: [2],
      },
    },
    contributionValidity: "measured",
    omittedRowCount: 0,
  },
  trigger = {
    kind: "structural-failure",
    tick: 1,
    timeS: 1 / 120,
    subjectId: "joint-1",
    validity: "measured",
  };
checkpoint.stateDigest = checkpointStateDigest(checkpoint);

const runtime = {
    runBlueprint: blueprint,
    runIdentity: {
      configuration: runConfiguration,
      runConfigurationFingerprint,
      blueprintFingerprint,
      compiledTopologyFingerprint,
      testSiteFingerprint: `sim-sha256-${"3".repeat(64)}`,
      materialMapFingerprint: `sim-sha256-${"4".repeat(64)}`,
      deploymentFingerprint: `sim-sha256-${sha256Hex(stableStringify({}))}`,
      deployment: {},
      environment: {
        seed: "earth-coordinate-terrain-v1",
        latitude: 31.7,
        longitude: 35.2,
        timeOfDay: 12,
        windEnabled: false,
      },
    },
    inputTraceRecorder: {
      sourceId: "operator",
      inputsThrough: () => [
        {
          tick: 1,
          sequence: 0,
          sourceId: "operator",
          targetId: 1,
          channelId: "throttle",
          value: 1,
        },
      ],
    },
    failureEvidence: {
      replayAnchor: checkpoint,
      recorder: {
        snapshot: () => ({
          version: 1,
          runIdentity: {},
          policy,
          policyFingerprint: failureEvidencePolicyFingerprint(policy),
          replayability: { state: "supported", reasonCode: null },
          trigger,
          triggers: [trigger],
          exactFrames: [rawFrame],
          contextFrames: [],
        }),
      },
    },
  },
  artifact = createFailureEvidenceArtifact({ runtime }),
  decoded = decodeFailureEvidenceOrThrow(artifact);

assert.deepEqual(decoded.wire, artifact);
assert.equal(decoded.wire.summary.causalState, "complete");
assert.equal(decoded.wire.summary.firstFailedConnectionId, "joint-1");
assert.deepEqual(decoded.wire.summary.sourceContactIds, ["contact:1:a:b:0"]);
assert.equal(encodeFailureEvidence(artifact), stableStringify(artifact));
assert.match(fingerprintFailureEvidence(artifact), /^sim-sha256-[0-9a-f]{64}$/);
assert.equal(artifact.version, 2);
assert.deepEqual(artifact.priorEpisodeBoundaries, []);

const episodeCoordinator = createFailureEvidenceCaptureCoordinator({ runtime }),
  diagnosticTrigger = {
    ...trigger,
    kind: "rolling-actuator-stall",
    subjectId: "motor-1",
  },
  diagnosticSnapshot = {
    ...runtime.failureEvidence.recorder.snapshot(),
    priorEpisodeBoundaries: [],
    trigger: diagnosticTrigger,
    triggers: [diagnosticTrigger],
  },
  diagnosticResult = episodeCoordinator.finalize(diagnosticSnapshot);
assert.equal(diagnosticResult.rearm, true);
assert.equal(episodeCoordinator.status().state, "ready");
assert.deepEqual(episodeCoordinator.artifact().priorEpisodeBoundaries, []);
const structuralTrigger = { ...trigger, tick: 2, timeS: 2 / 120 },
  structuralFrame = { ...rawFrame, tick: 2, timeS: 2 / 120 },
  structuralResult = episodeCoordinator.finalize({
    ...runtime.failureEvidence.recorder.snapshot(),
    priorEpisodeBoundaries: diagnosticResult.priorEpisodeBoundaries,
    trigger: structuralTrigger,
    triggers: [structuralTrigger],
    exactFrames: [structuralFrame],
  });
assert.equal(structuralResult.rearm, false);
assert.equal(episodeCoordinator.artifact().trigger.kind, "structural-failure");
assert.deepEqual(
  episodeCoordinator.artifact().priorEpisodeBoundaries,
  diagnosticResult.priorEpisodeBoundaries,
);
assert.equal(decodeFailureEvidence({ ...artifact, future: true }).ok, false);
assert.equal(
  decodeFailureEvidence({ ...artifact, version: 1 }).errors[0].code,
  "UNSUPPORTED_FAILURE_EVIDENCE_VERSION",
);
assert.equal(
  decodeFailureEvidence({ ...artifact, replayAnchorCheckpoint: null }).errors[0]
    .code,
  "FAILURE_EVIDENCE_REPLAY_ANCHOR_REQUIRED",
);
const sourceSubstitution = structuredClone(artifact);
sourceSubstitution.externalInputTrace.sourceId = "substituted-operator";
for (const input of sourceSubstitution.externalInputTrace.inputs)
  input.sourceId = sourceSubstitution.externalInputTrace.sourceId;
sourceSubstitution.manifestDigest =
  failureEvidenceManifestDigest(sourceSubstitution);
assert.equal(
  decodeFailureEvidence(sourceSubstitution).errors[0].code,
  "FAILURE_EVIDENCE_TRACE_SOURCE_MISMATCH",
  "failure evidence accepted an input source not bound by its replay anchor",
);
assert.equal(
  decodeFailureEvidence({
    ...artifact,
    summary: { ...artifact.summary, causalState: "incomplete" },
  }).errors[0].code,
  "FAILURE_EVIDENCE_SUMMARY_MISMATCH",
);

const player = new InputTracePlayer(artifact.externalInputTrace, {
  targetIds: [1],
});
assert.deepEqual(player.readCommandCandidates(1).remote, [
  {
    targetId: 1,
    channel: "throttle",
    sourceId: "operator",
    value: 1,
    active: true,
    replayable: true,
  },
]);
assert.equal(player.readCommandCandidates(2).remote[0].value, 1);

const denseBlueprint = {
    ...structuredClone(blueprint),
    name: "Maximum-density failure-evidence fixture",
    parts: Array.from({ length: 300 }, (_, index) => ({
      ...structuredClone(blueprint.parts[0]),
      id: index + 1,
      pos: [(index % 20) * 2.4, 1, Math.floor(index / 20) * 3],
    })),
    connections: [structuredClone(blueprint.connections[0])],
  },
  denseRunConfiguration = {
    ...structuredClone(runConfiguration),
    seed: "maximum-density-failure-evidence-fixture",
    durationTicks: 840,
    budgets: { ...runConfiguration.budgets, maxBodies: 512 },
  },
  denseRunConfigurationFingerprint = fingerprintRunConfiguration(
    denseRunConfiguration,
  ),
  denseBlueprintFingerprint = fingerprintExperimentBlueprint(denseBlueprint),
  denseTrigger = { ...trigger, tick: 840, timeS: 7 },
  quietExactFrame = {
    ...rawFrame,
    structurePreMutation: null,
    structurePostMutation: null,
  },
  denseSnapshot = {
    ...runtime.failureEvidence.recorder.snapshot(),
    replayability: {
      state: "unsupported",
      reasonCode: "DENSE_FIXTURE_NO_RUNTIME_ANCHOR",
    },
    trigger: denseTrigger,
    triggers: [denseTrigger],
    exactFrames: Array.from({ length: 480 }, (_, index) => {
      const tick = index + 361;
      return tick === denseTrigger.tick
        ? { ...rawFrame, tick, timeS: tick / 120 }
        : { ...quietExactFrame, tick, timeS: tick / 120 };
    }),
    contextFrames: Array.from({ length: 360 }, (_, index) => {
      const tick = index + 1;
      return {
        tick,
        timeS: tick / 120,
        graphRevision: 4,
        commandLedger: rawFrame.commandLedger,
        connectionLoads: rawFrame.connectionLoads,
        mobility: {
          assemblies: [
            {
              assemblyId: "maximum-density-machine",
              pose: { position: { x: tick / 120, y: 1, z: 0 } },
              signedSpeed: 1,
              grounded: true,
              brake: 0,
              driveForce: {
                motors: [
                  {
                    partId: 1,
                    resolvedThrottle: 1,
                    commandSource: "remote",
                    availablePowerW: 1000,
                    deliveredPowerW: 500,
                    operational: true,
                    shaftPositionRad: tick / 10,
                    shaftAngularSpeedRadPerS: 12,
                  },
                ],
              },
              wheelStates: [
                {
                  partId: 2,
                  touching: true,
                  angularSpeed: 12,
                  normalLoadN: 1000,
                },
              ],
            },
          ],
        },
      };
    }),
  },
  denseRuntime = {
    ...runtime,
    runBlueprint: denseBlueprint,
    runIdentity: {
      ...runtime.runIdentity,
      configuration: denseRunConfiguration,
      runConfigurationFingerprint: denseRunConfigurationFingerprint,
      blueprintFingerprint: denseBlueprintFingerprint,
    },
    inputTraceRecorder: { sourceId: "operator", inputsThrough: () => [] },
    failureEvidence: {
      ...runtime.failureEvidence,
      replayAnchor: null,
      recorder: { snapshot: () => denseSnapshot },
    },
  },
  denseCoordinator = createFailureEvidenceCaptureCoordinator({
    runtime: denseRuntime,
  }),
  denseResult = denseCoordinator.finalize(denseSnapshot),
  denseDecoded = decodeFailureEvidenceOrThrow(denseCoordinator.artifact());
assert.equal(denseResult.rearm, false);
assert.equal(denseCoordinator.status().state, "ready");
assert.equal(denseDecoded.wire.blueprint.parts.length, 300);
assert.equal(denseDecoded.wire.exactFrames.length, 480);
assert.equal(denseDecoded.wire.contextFrames.length, 360);
assert.ok(denseDecoded.envelope.bytes <= WIRE_LIMITS.failureEvidenceBytes);
assert.ok(denseDecoded.envelope.nodes <= WIRE_LIMITS.failureEvidenceNodes);

console.log(
  `failure evidence artifacts passed (strict wire, causal summary, tick-zero anchor, trace playback, maximum-density envelope ${denseDecoded.envelope.bytes} bytes/${denseDecoded.envelope.nodes} nodes)`,
);
