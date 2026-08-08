import {
  decodeExperimentOrThrow,
  decodeInputTraceOrThrow,
  experimentManifestDigest,
  fingerprintExperimentBlueprint,
  fingerprintRunConfiguration,
} from "../model/mechanism-artifacts.js";

/** Strict portable export boundary, loaded only when an experiment is captured. */
export function createMechanismExperiment({
  blueprint,
  runConfiguration,
  checkpoint,
  inputTraceRecorder,
  observations = [],
}) {
  if (!inputTraceRecorder)
    throw new Error("Active run has no external input trace owner");
  const endTick = checkpoint.committedTick,
    runConfigurationFingerprint = fingerprintRunConfiguration(runConfiguration),
    inputTrace = decodeInputTraceOrThrow({
      format: "simulacrum-input-trace",
      version: 3,
      sourceId: inputTraceRecorder.sourceId,
      runConfigurationFingerprint,
      startTick: 0,
      endTick,
      inputs: inputTraceRecorder.inputsThrough(endTick),
    }).wire,
    experiment = {
      format: "simulacrum-experiment",
      version: 1,
      blueprintFingerprint: fingerprintExperimentBlueprint(blueprint),
      blueprint,
      runConfiguration,
      inputTrace,
      checkpoint,
      startTick: 0,
      endTick,
      observations,
      manifestDigest: "0".repeat(64),
    };
  experiment.manifestDigest = experimentManifestDigest(experiment);
  return decodeExperimentOrThrow(experiment).wire;
}
