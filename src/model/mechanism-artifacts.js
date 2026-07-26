import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
  experimentManifestDigest,
  fingerprintExperimentBlueprint,
  mechanismArtifactFingerprint,
} from "./mechanism-artifact-identity.js";
import {
  validateCheckpointWire,
  validateExperimentWire,
  validateInputTraceWire,
  validateRunConfigurationWire,
  validateTelemetryPlaybackWire,
} from "./generated/mechanism-artifact-wire-validators.js";
import {
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "./primitives.js";
import { sha256Hex } from "./sha256.js";
import { validateWireInput, wireResult } from "./wire-validation.js";
import { WIRE_LIMITS } from "./wire-limits.js";

export {
  CHECKPOINT_STATE_OWNER_IDS,
  CHECKPOINT_STATE_OWNER_VERSIONS,
  checkpointStateDigest,
  experimentManifestDigest,
  fingerprintExperimentBlueprint,
};

const encoder = new TextEncoder();

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function compareTickSequence(left, right) {
  return left.tick - right.tick || left.sequence - right.sequence;
}

function compareTickChannel(left, right) {
  return (
    left.tick - right.tick || left.channelId.localeCompare(right.channelId)
  );
}

function assertRange(startTick, endTick, path = []) {
  if (startTick > endTick)
    fail(
      "INVALID_TICK_RANGE",
      "Artifact startTick must be less than or equal to endTick",
      path,
      { startTick, endTick },
    );
}

function assertStrictOrder(entries, compare, code, path) {
  for (let index = 1; index < entries.length; index++)
    if (compare(entries[index - 1], entries[index]) >= 0)
      fail(code, "Artifact records must be unique and canonically ordered", [
        ...path,
        index,
      ]);
}

function assertEmbeddedJsonBounds(value, path) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes++;
    if (nodes > WIRE_LIMITS.maxNodes)
      fail(
        "EMBEDDED_JSON_NODE_LIMIT",
        `Embedded JSON exceeds ${WIRE_LIMITS.maxNodes} nodes`,
        path,
      );
    if (current.depth > WIRE_LIMITS.maxDepth)
      fail(
        "EMBEDDED_JSON_DEPTH_LIMIT",
        `Embedded JSON exceeds nesting depth ${WIRE_LIMITS.maxDepth}`,
        path,
      );
    if (current.value && typeof current.value === "object")
      for (const child of Object.values(current.value))
        stack.push({ value: child, depth: current.depth + 1 });
  }
}

function fingerprint(kind, value) {
  return mechanismArtifactFingerprint(kind, value);
}

function validateRunConfiguration(_wire) {}

function validateInputTrace(wire) {
  assertRange(wire.startTick, wire.endTick, ["startTick"]);
  assertStrictOrder(
    wire.inputs,
    compareTickSequence,
    "NONCANONICAL_INPUT_ORDER",
    ["inputs"],
  );
  const sequences = new Set();
  for (const [index, input] of wire.inputs.entries()) {
    if (sequences.has(input.sequence))
      fail(
        "DUPLICATE_INPUT_SEQUENCE",
        "Input sequence identifiers must be globally unique",
        ["inputs", index, "sequence"],
      );
    sequences.add(input.sequence);
    if (input.tick < wire.startTick || input.tick > wire.endTick)
      fail(
        "INPUT_OUTSIDE_TRACE_RANGE",
        "Input tick must be inside the trace range",
        ["inputs", index, "tick"],
      );
  }
}

function validateCheckpoint(wire) {
  for (const [index, expectedOwnerId] of CHECKPOINT_STATE_OWNER_IDS.entries()) {
    const owner = wire.stateOwners[index];
    if (owner.ownerId !== expectedOwnerId)
      fail(
        "INVALID_CHECKPOINT_OWNER_SET",
        "Checkpoint must contain every state owner exactly once in canonical order",
        ["stateOwners", index, "ownerId"],
        { actual: owner.ownerId, expected: expectedOwnerId },
      );
    const expectedOwnerVersion =
      CHECKPOINT_STATE_OWNER_VERSIONS[expectedOwnerId];
    if (owner.ownerVersion !== expectedOwnerVersion)
      fail(
        "INVALID_CHECKPOINT_OWNER_VERSION",
        "Checkpoint owner version must match the current owner contract",
        ["stateOwners", index, "ownerVersion"],
        { actual: owner.ownerVersion, expected: expectedOwnerVersion },
      );
    let payload;
    try {
      payload = JSON.parse(owner.payloadJson);
    } catch (error) {
      fail(
        "INVALID_CHECKPOINT_OWNER_JSON",
        "Checkpoint owner payload must be valid JSON",
        ["stateOwners", index, "payloadJson"],
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    assertEmbeddedJsonBounds(payload, ["stateOwners", index, "payloadJson"]);
    if (stableStringify(payload) !== owner.payloadJson)
      fail(
        "NONCANONICAL_CHECKPOINT_OWNER_JSON",
        "Checkpoint owner payload must use canonical JSON encoding",
        ["stateOwners", index, "payloadJson"],
      );
    const byteLength = encoder.encode(owner.payloadJson).byteLength;
    if (owner.payloadByteLength !== byteLength)
      fail(
        "CHECKPOINT_OWNER_BYTE_LENGTH_MISMATCH",
        "Checkpoint owner payload byte length does not match its bytes",
        ["stateOwners", index, "payloadByteLength"],
        { actual: owner.payloadByteLength, expected: byteLength },
      );
    const payloadSha256 = sha256Hex(owner.payloadJson);
    if (owner.payloadSha256 !== payloadSha256)
      fail(
        "CHECKPOINT_OWNER_DIGEST_MISMATCH",
        "Checkpoint owner payload digest does not match its bytes",
        ["stateOwners", index, "payloadSha256"],
        { actual: owner.payloadSha256, expected: payloadSha256 },
      );
  }
  const stateDigest = checkpointStateDigest(wire);
  if (wire.stateDigest !== stateDigest)
    fail(
      "CHECKPOINT_STATE_DIGEST_MISMATCH",
      "Checkpoint state digest does not match its canonical state",
      ["stateDigest"],
      { actual: wire.stateDigest, expected: stateDigest },
    );
}

function validateExperiment(wire) {
  assertRange(wire.startTick, wire.endTick, ["startTick"]);
  decodeBlueprintOrThrow(wire.blueprint);
  validateRunConfiguration(wire.runConfiguration);
  validateInputTrace(wire.inputTrace);
  if (wire.checkpoint) validateCheckpoint(wire.checkpoint);

  const blueprintFingerprint = fingerprintExperimentBlueprint(wire.blueprint);
  if (wire.blueprintFingerprint !== blueprintFingerprint)
    fail(
      "EXPERIMENT_BLUEPRINT_FINGERPRINT_MISMATCH",
      "Experiment blueprint fingerprint does not match its typed blueprint",
      ["blueprintFingerprint"],
      { actual: wire.blueprintFingerprint, expected: blueprintFingerprint },
    );
  const runConfigurationFingerprint = fingerprint(
    "run-configuration",
    wire.runConfiguration,
  );
  if (
    wire.inputTrace.runConfigurationFingerprint !== runConfigurationFingerprint
  )
    fail(
      "EXPERIMENT_RUN_FINGERPRINT_MISMATCH",
      "Input trace does not identify the embedded run configuration",
      ["inputTrace", "runConfigurationFingerprint"],
    );
  if (
    wire.inputTrace.startTick !== wire.startTick ||
    wire.inputTrace.endTick !== wire.endTick
  )
    fail(
      "EXPERIMENT_TRACE_RANGE_MISMATCH",
      "Input trace range must equal the experiment range",
      ["inputTrace"],
    );
  if (wire.checkpoint) {
    if (
      wire.checkpoint.runConfigurationFingerprint !==
      runConfigurationFingerprint
    )
      fail(
        "EXPERIMENT_CHECKPOINT_RUN_MISMATCH",
        "Checkpoint does not identify the embedded run configuration",
        ["checkpoint", "runConfigurationFingerprint"],
      );
    if (wire.checkpoint.blueprintFingerprint !== blueprintFingerprint)
      fail(
        "EXPERIMENT_CHECKPOINT_BLUEPRINT_MISMATCH",
        "Checkpoint does not identify the embedded blueprint",
        ["checkpoint", "blueprintFingerprint"],
      );
    if (
      wire.checkpoint.committedTick < wire.startTick ||
      wire.checkpoint.committedTick > wire.endTick
    )
      fail(
        "EXPERIMENT_CHECKPOINT_OUTSIDE_RANGE",
        "Checkpoint committed tick must be inside the experiment range",
        ["checkpoint", "committedTick"],
      );
  }
  assertStrictOrder(
    wire.observations,
    compareTickChannel,
    "NONCANONICAL_OBSERVATION_ORDER",
    ["observations"],
  );
  for (const [index, observation] of wire.observations.entries())
    if (observation.tick < wire.startTick || observation.tick > wire.endTick)
      fail(
        "OBSERVATION_OUTSIDE_EXPERIMENT_RANGE",
        "Observation tick must be inside the experiment range",
        ["observations", index, "tick"],
      );
    else if (
      !Array.isArray(observation.expected) &&
      typeof observation.expected !== "number" &&
      (observation.tolerance.absolute !== 0 ||
        observation.tolerance.relative !== 0)
    )
      fail(
        "INVALID_EXACT_OBSERVATION_TOLERANCE",
        "Boolean and string observations require zero numeric tolerance",
        ["observations", index, "tolerance"],
      );
  const manifestDigest = experimentManifestDigest(wire);
  if (wire.manifestDigest !== manifestDigest)
    fail(
      "EXPERIMENT_MANIFEST_DIGEST_MISMATCH",
      "Experiment manifest digest does not match its canonical contents",
      ["manifestDigest"],
      { actual: wire.manifestDigest, expected: manifestDigest },
    );
}

function assertSortedIdentifiers(values, code, path) {
  for (let index = 1; index < values.length; index++)
    if (values[index - 1].localeCompare(values[index]) >= 0)
      fail(code, "Identifier arrays must be unique and canonically ordered", [
        ...path,
        index,
      ]);
}

function validateTelemetryPlayback(wire) {
  assertRange(wire.startTick, wire.endTick, ["startTick"]);
  if (
    wire.frames[0].tick !== wire.startTick ||
    wire.frames.at(-1).tick !== wire.endTick
  )
    fail(
      "PLAYBACK_FRAME_RANGE_MISMATCH",
      "Playback first and last frames must equal its declared range",
      ["frames"],
    );
  for (const [index, frame] of wire.frames.entries()) {
    if (index && wire.frames[index - 1].tick >= frame.tick)
      fail(
        "NONCANONICAL_PLAYBACK_FRAME_ORDER",
        "Playback frame ticks must be unique and increasing",
        ["frames", index, "tick"],
      );
    const expectedTimeS = frame.tick * wire.fixedStepS;
    if (frame.timeS !== expectedTimeS)
      fail(
        "PLAYBACK_TIME_MISMATCH",
        "Playback frame time must equal tick times the fixed step",
        ["frames", index, "timeS"],
        { actual: frame.timeS, expected: expectedTimeS },
      );
    for (let sampleIndex = 1; sampleIndex < frame.samples.length; sampleIndex++)
      if (
        frame.samples[sampleIndex - 1].channelId.localeCompare(
          frame.samples[sampleIndex].channelId,
        ) >= 0
      )
        fail(
          "NONCANONICAL_PLAYBACK_SAMPLE_ORDER",
          "Playback samples must have unique, ordered channel IDs",
          ["frames", index, "samples", sampleIndex, "channelId"],
        );
    for (const [sampleIndex, sample] of frame.samples.entries())
      assertSortedIdentifiers(
        sample.sourceDescriptorIds,
        "NONCANONICAL_SAMPLE_PROVENANCE_ORDER",
        ["frames", index, "samples", sampleIndex, "sourceDescriptorIds"],
      );
    for (let eventIndex = 0; eventIndex < frame.events.length; eventIndex++) {
      const event = frame.events[eventIndex];
      if (
        eventIndex &&
        frame.events[eventIndex - 1].eventId.localeCompare(event.eventId) >= 0
      )
        fail(
          "NONCANONICAL_PLAYBACK_EVENT_ORDER",
          "Playback events must have unique, ordered event IDs",
          ["frames", index, "events", eventIndex, "eventId"],
        );
      assertSortedIdentifiers(
        event.predecessorIds,
        "NONCANONICAL_EVENT_PREDECESSOR_ORDER",
        ["frames", index, "events", eventIndex, "predecessorIds"],
      );
      assertSortedIdentifiers(
        event.sourceDescriptorIds,
        "NONCANONICAL_EVENT_PROVENANCE_ORDER",
        ["frames", index, "events", eventIndex, "sourceDescriptorIds"],
      );
      let payload;
      try {
        payload = JSON.parse(event.payloadJson);
      } catch (error) {
        fail(
          "INVALID_PLAYBACK_EVENT_JSON",
          "Playback event payload must be valid JSON",
          ["frames", index, "events", eventIndex, "payloadJson"],
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      assertEmbeddedJsonBounds(payload, [
        "frames",
        index,
        "events",
        eventIndex,
        "payloadJson",
      ]);
      if (stableStringify(payload) !== event.payloadJson)
        fail(
          "NONCANONICAL_PLAYBACK_EVENT_JSON",
          "Playback event payload must use canonical JSON encoding",
          ["frames", index, "events", eventIndex, "payloadJson"],
        );
    }
  }
}

function createBoundary(kind, validator, semanticValidator) {
  function decode(input) {
    const envelope = validateWireInput(input, kind, validator);
    semanticValidator(envelope.value);
    return deepFreeze({
      wire: envelope.value,
      fingerprint: fingerprint(kind, envelope.value),
      envelope: { bytes: envelope.bytes, nodes: envelope.nodes },
    });
  }
  function decodeTotal(input) {
    return wireResult(() => decode(input));
  }
  function decodeOrThrow(input) {
    const result = decodeTotal(input);
    if (result.ok) return result.value;
    const first = result.errors[0];
    throw new DomainValidationError(first.code, first.message, {
      path: first.path,
      details: first.details,
    });
  }
  function encode(input) {
    return stableStringify(decodeOrThrow(input).wire);
  }
  function getFingerprint(input) {
    return decodeOrThrow(input).fingerprint;
  }
  return Object.freeze({ decodeTotal, decodeOrThrow, encode, getFingerprint });
}

const runConfigurationBoundary = createBoundary(
    "run-configuration",
    validateRunConfigurationWire,
    validateRunConfiguration,
  ),
  inputTraceBoundary = createBoundary(
    "input-trace",
    validateInputTraceWire,
    validateInputTrace,
  ),
  checkpointBoundary = createBoundary(
    "checkpoint",
    validateCheckpointWire,
    validateCheckpoint,
  ),
  experimentBoundary = createBoundary(
    "experiment",
    validateExperimentWire,
    validateExperiment,
  ),
  telemetryPlaybackBoundary = createBoundary(
    "telemetry-playback",
    validateTelemetryPlaybackWire,
    validateTelemetryPlayback,
  );

export const decodeRunConfiguration = runConfigurationBoundary.decodeTotal;
export const decodeRunConfigurationOrThrow =
  runConfigurationBoundary.decodeOrThrow;
export const encodeRunConfiguration = runConfigurationBoundary.encode;
export const fingerprintRunConfiguration =
  runConfigurationBoundary.getFingerprint;

export const decodeInputTrace = inputTraceBoundary.decodeTotal;
export const decodeInputTraceOrThrow = inputTraceBoundary.decodeOrThrow;
export const encodeInputTrace = inputTraceBoundary.encode;
export const fingerprintInputTrace = inputTraceBoundary.getFingerprint;

export const decodeCheckpoint = checkpointBoundary.decodeTotal;
export const decodeCheckpointOrThrow = checkpointBoundary.decodeOrThrow;
export const encodeCheckpoint = checkpointBoundary.encode;
export const fingerprintCheckpoint = checkpointBoundary.getFingerprint;

export const decodeExperiment = experimentBoundary.decodeTotal;
export const decodeExperimentOrThrow = experimentBoundary.decodeOrThrow;
export const encodeExperiment = experimentBoundary.encode;
export const fingerprintExperiment = experimentBoundary.getFingerprint;

export const decodeTelemetryPlayback = telemetryPlaybackBoundary.decodeTotal;
export const decodeTelemetryPlaybackOrThrow =
  telemetryPlaybackBoundary.decodeOrThrow;
export const encodeTelemetryPlayback = telemetryPlaybackBoundary.encode;
export const fingerprintTelemetryPlayback =
  telemetryPlaybackBoundary.getFingerprint;
