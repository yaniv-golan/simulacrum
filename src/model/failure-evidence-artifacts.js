import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { analyzeFailureEvidence } from "./failure-evidence-analysis.js";
import {
  failureEvidenceManifestDigest,
  failureEvidencePolicyFingerprint,
  fingerprintEvidenceDeployment,
} from "./failure-evidence-identity.js";
import { validateFailureEvidenceWire } from "./generated/mechanism-artifact-wire-validators.js";
import {
  decodeCheckpointOrThrow,
  decodeInputTraceOrThrow,
  decodeRunConfigurationOrThrow,
  fingerprintExperimentBlueprint,
  fingerprintRunConfiguration,
} from "./mechanism-artifacts.js";
import {
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "./primitives.js";
import { validateWireInput, wireResult } from "./wire-validation.js";

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function assertIncreasingTicks(frames, path) {
  for (let index = 1; index < frames.length; index++)
    if (frames[index - 1].tick >= frames[index].tick)
      fail(
        "NONCANONICAL_FAILURE_EVIDENCE_FRAME_ORDER",
        "Failure-evidence frame ticks must be unique and increasing",
        [path, index, "tick"],
      );
}

function validateArtifact(wire) {
  decodeBlueprintOrThrow(wire.blueprint);
  decodeRunConfigurationOrThrow(wire.runConfiguration);
  decodeInputTraceOrThrow(wire.externalInputTrace);
  if (wire.replayAnchorCheckpoint)
    decodeCheckpointOrThrow(wire.replayAnchorCheckpoint);

  let deployment;
  try {
    deployment = JSON.parse(wire.runIdentity.deploymentJson);
  } catch (error) {
    fail(
      "INVALID_FAILURE_EVIDENCE_DEPLOYMENT_JSON",
      "Failure-evidence deployment must be valid JSON",
      ["runIdentity", "deploymentJson"],
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (stableStringify(deployment) !== wire.runIdentity.deploymentJson)
    fail(
      "NONCANONICAL_FAILURE_EVIDENCE_DEPLOYMENT_JSON",
      "Failure-evidence deployment JSON must use canonical encoding",
      ["runIdentity", "deploymentJson"],
    );
  if (
    fingerprintEvidenceDeployment(deployment) !==
    wire.runIdentity.deploymentFingerprint
  )
    fail(
      "FAILURE_EVIDENCE_DEPLOYMENT_FINGERPRINT_MISMATCH",
      "Deployment fingerprint does not match the embedded deployment",
      ["runIdentity", "deploymentFingerprint"],
    );

  const runConfigurationFingerprint = fingerprintRunConfiguration(
      wire.runConfiguration,
    ),
    blueprintFingerprint = fingerprintExperimentBlueprint(wire.blueprint);
  if (
    wire.runIdentity.runConfigurationFingerprint !== runConfigurationFingerprint
  )
    fail(
      "FAILURE_EVIDENCE_RUN_CONFIGURATION_MISMATCH",
      "Run identity does not match the embedded run configuration",
      ["runIdentity", "runConfigurationFingerprint"],
    );
  if (wire.runIdentity.blueprintFingerprint !== blueprintFingerprint)
    fail(
      "FAILURE_EVIDENCE_BLUEPRINT_MISMATCH",
      "Run identity does not match the embedded blueprint",
      ["runIdentity", "blueprintFingerprint"],
    );
  if (
    wire.externalInputTrace.runConfigurationFingerprint !==
    runConfigurationFingerprint
  )
    fail(
      "FAILURE_EVIDENCE_TRACE_RUN_MISMATCH",
      "External input trace does not identify the embedded run configuration",
      ["externalInputTrace", "runConfigurationFingerprint"],
    );
  if (
    wire.policyFingerprint !==
    failureEvidencePolicyFingerprint(wire.diagnosticPolicy)
  )
    fail(
      "FAILURE_EVIDENCE_POLICY_FINGERPRINT_MISMATCH",
      "Diagnostic policy fingerprint does not match the embedded policy",
      ["policyFingerprint"],
    );
  if (
    wire.externalInputTrace.startTick !== 1 ||
    wire.externalInputTrace.endTick !== wire.trigger.tick
  )
    fail(
      "FAILURE_EVIDENCE_TRACE_RANGE_MISMATCH",
      "External input trace must cover tick 1 through the trigger tick",
      ["externalInputTrace"],
    );
  if (wire.trigger.tick < 1)
    fail(
      "INVALID_FAILURE_EVIDENCE_TRIGGER_TICK",
      "Failure evidence can trigger only after initialized tick zero",
      ["trigger", "tick"],
    );

  if (wire.replayability.status === "supported") {
    if (wire.replayability.reasonCode !== null)
      fail(
        "INVALID_SUPPORTED_REPLAYABILITY_REASON",
        "Supported replayability must not carry a reason code",
        ["replayability", "reasonCode"],
      );
    const anchor = wire.replayAnchorCheckpoint;
    if (!anchor || anchor.committedTick !== 0)
      fail(
        "FAILURE_EVIDENCE_REPLAY_ANCHOR_REQUIRED",
        "Supported replay requires a committed tick-zero anchor",
        ["replayAnchorCheckpoint"],
      );
    if (
      anchor.runConfigurationFingerprint !== runConfigurationFingerprint ||
      anchor.blueprintFingerprint !== blueprintFingerprint ||
      anchor.compiledTopologyFingerprint !==
        wire.runIdentity.compiledTopologyFingerprint
    )
      fail(
        "FAILURE_EVIDENCE_REPLAY_ANCHOR_MISMATCH",
        "Replay anchor identities do not match the captured run",
        ["replayAnchorCheckpoint"],
      );
  } else {
    if (wire.replayAnchorCheckpoint !== null)
      fail(
        "UNSUPPORTED_FAILURE_EVIDENCE_HAS_ANCHOR",
        "Unsupported replayability must not carry a replay anchor",
        ["replayAnchorCheckpoint"],
      );
    if (!wire.replayability.reasonCode)
      fail(
        "UNSUPPORTED_FAILURE_EVIDENCE_REASON_REQUIRED",
        "Unsupported replayability requires a reason code",
        ["replayability", "reasonCode"],
      );
  }

  assertIncreasingTicks(wire.exactFrames, "exactFrames");
  assertIncreasingTicks(wire.contextFrames, "contextFrames");
  if (!wire.exactFrames.some((frame) => frame.tick === wire.trigger.tick))
    fail(
      "FAILURE_EVIDENCE_TRIGGER_FRAME_MISSING",
      "The exact trigger frame must be retained",
      ["exactFrames"],
    );
  if (
    wire.triggers[0].tick !== wire.trigger.tick ||
    wire.triggers[0].kind !== wire.trigger.kind ||
    wire.triggers[0].subjectId !== wire.trigger.subjectId
  )
    fail(
      "FAILURE_EVIDENCE_PRIMARY_TRIGGER_MISMATCH",
      "The primary trigger must be the first retained trigger",
      ["triggers", 0],
    );

  const summary = analyzeFailureEvidence(wire);
  if (stableStringify(wire.summary) !== stableStringify(summary))
    fail(
      "FAILURE_EVIDENCE_SUMMARY_MISMATCH",
      "Failure-evidence summary must be derived from retained evidence",
      ["summary"],
    );
  const digest = failureEvidenceManifestDigest(wire);
  if (wire.manifestDigest !== digest)
    fail(
      "FAILURE_EVIDENCE_MANIFEST_DIGEST_MISMATCH",
      "Failure-evidence manifest digest does not match its contents",
      ["manifestDigest"],
      { actual: wire.manifestDigest, expected: digest },
    );
}

function decode(input) {
  const envelope = validateWireInput(
    input,
    "failure-evidence",
    validateFailureEvidenceWire,
  );
  validateArtifact(envelope.value);
  return deepFreeze({
    wire: envelope.value,
    fingerprint: `sim-sha256-${failureEvidenceManifestDigest(envelope.value)}`,
    envelope: { bytes: envelope.bytes, nodes: envelope.nodes },
  });
}

export function decodeFailureEvidence(input) {
  return wireResult(() => decode(input));
}

export function decodeFailureEvidenceOrThrow(input) {
  const result = decodeFailureEvidence(input);
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
    details: first.details,
  });
}

export function encodeFailureEvidence(input) {
  return stableStringify(decodeFailureEvidenceOrThrow(input).wire);
}

export function fingerprintFailureEvidence(input) {
  return decodeFailureEvidenceOrThrow(input).fingerprint;
}

export { failureEvidenceManifestDigest };
