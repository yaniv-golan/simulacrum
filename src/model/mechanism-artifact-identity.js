import { decodeBlueprintOrThrow } from "./blueprint-decoder.js";
import { stableStringify } from "./primitives.js";
import { sha256Hex } from "./sha256.js";

export const CHECKPOINT_STATE_OWNER_IDS = Object.freeze([
  "session",
  "input-command-bus",
  "run-graph",
  "compiled-topology",
  "physics-world",
  "flexible-line-runtime",
  "solver-contact",
  "tire-carcass",
  "body-registry",
  "structure-failure",
  "energy-power-signal",
  "release-couplers",
  "material-resources",
  "pneumatic-gas",
  "thermal-ablation",
  "articulated-drive",
  "sensors",
  "controllers",
  "terrain-environment",
  "telemetry-event-ids",
]);

export const CHECKPOINT_STATE_OWNER_VERSIONS = Object.freeze(
  Object.fromEntries(
    CHECKPOINT_STATE_OWNER_IDS.map((ownerId) => [
      ownerId,
      new Set(["session", "body-registry", "telemetry-event-ids"]).has(ownerId)
        ? 3
        : new Set([
              "input-command-bus",
              "run-graph",
              "compiled-topology",
              "physics-world",
              "solver-contact",
              "tire-carcass",
              "structure-failure",
              "energy-power-signal",
              "material-resources",
              "pneumatic-gas",
              "thermal-ablation",
              "articulated-drive",
              "sensors",
              "controllers",
              "terrain-environment",
            ]).has(ownerId)
          ? 2
          : 1,
    ]),
  ),
);

export function mechanismArtifactFingerprint(kind, value) {
  return `sim-sha256-${sha256Hex(
    `simulacrum-mechanism-artifact-v1\0${kind}\0${stableStringify(value)}`,
  )}`;
}

/** Exact fingerprint for the typed blueprint bytes embedded in an experiment. */
export function fingerprintExperimentBlueprint(input) {
  const blueprint = decodeBlueprintOrThrow(input).wire;
  return mechanismArtifactFingerprint("blueprint-v1", blueprint);
}

export function fingerprintRunConfigurationValue(input) {
  return mechanismArtifactFingerprint("run-configuration", input);
}

export function checkpointStateDigest(input) {
  const view = {
    runConfigurationFingerprint: input.runConfigurationFingerprint,
    blueprintFingerprint: input.blueprintFingerprint,
    compiledTopologyFingerprint: input.compiledTopologyFingerprint,
    committedTick: input.committedTick,
    committed: input.committed,
    stateOwners: input.stateOwners,
  };
  return sha256Hex(`simulacrum-checkpoint-state-v3\0${stableStringify(view)}`);
}

export function experimentManifestDigest(input) {
  const view = structuredClone(input);
  delete view.manifestDigest;
  return sha256Hex(
    `simulacrum-experiment-manifest-v1\0${stableStringify(view)}`,
  );
}
