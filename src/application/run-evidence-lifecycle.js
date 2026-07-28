import { InputTraceRecorder } from "../simulation/input-trace-recorder.js";
import { FailureEvidenceRecorder } from "../simulation/failure-evidence-recorder.js";
import { createCheckpointCoordinatorLoader } from "./checkpoint-coordinator-loader.js";
import { createWorkshopRunConfiguration } from "./mechanism-run-identity.js";
import { deploymentForBlueprint } from "./testing-playground-deployment.js";
import { createFailureEvidenceCaptureCoordinator } from "./failure-evidence-capture-coordinator.js";

/** Owns trace, identity, and checkpoint handles for exactly one active run. */
export function createRunEvidenceLifecycle({
  runtime,
  assembly,
  physics,
  controllers,
  run,
}) {
  const inputTraceRecorder = new InputTraceRecorder(),
    failureEvidenceRecorder = new FailureEvidenceRecorder(),
    failureEvidenceCaptureCoordinator = createFailureEvidenceCaptureCoordinator(
      { runtime },
    );
  let disposed = false;
  const ownsRuntime = () =>
    !disposed &&
    runtime.inputTraceRecorder === inputTraceRecorder &&
    runtime.failureEvidence.recorder === failureEvidenceRecorder;
  runtime.inputTraceRecorder = inputTraceRecorder;
  runtime.failureEvidence.recorder = failureEvidenceRecorder;
  runtime.failureEvidence.captureCoordinator =
    failureEvidenceCaptureCoordinator;
  return Object.freeze({
    inputTraceRecorder,
    failureEvidenceRecorder,
    failureEvidenceCaptureCoordinator,
    prepare(compiled) {
      runtime.runBlueprint = assembly.serialize("Mechanism experiment");
      const deployment = deploymentForBlueprint(
        physics.testingPlaygroundDeployment(),
        runtime.runBlueprint,
      );
      runtime.runIdentity = createWorkshopRunConfiguration({
        blueprint: runtime.runBlueprint,
        compiled,
        environment: {
          latitude: physics.latitude,
          longitude: physics.longitude,
          timeOfDay: run.timeOfDay,
          windEnabled: run.windEnabled,
          testSite: physics.testSite,
          deployment,
        },
      });
      failureEvidenceRecorder.beginRun({
        runIdentity: runtime.runIdentity,
      });
      failureEvidenceCaptureCoordinator.reset();
      runtime.checkpointCoordinator = null;
      runtime.prepareCheckpointCoordinator = null;
      return runtime.runIdentity;
    },
    activate() {
      if (!runtime.runIdentity)
        throw new Error("Run evidence must be prepared before activation");
      runtime.prepareCheckpointCoordinator = createCheckpointCoordinatorLoader({
        runtime,
        physics,
        controllers,
      });
    },
    async captureReplayAnchor() {
      try {
        const prepareCheckpointCoordinator =
            runtime.prepareCheckpointCoordinator,
          coordinator = await prepareCheckpointCoordinator();
        if (!ownsRuntime()) return false;
        const runIdentity = runtime.runIdentity;
        runtime.failureEvidence.replayAnchor = coordinator.capture({
          runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
          blueprintFingerprint: runIdentity.blueprintFingerprint,
          compiledTopologyFingerprint: runIdentity.compiledTopologyFingerprint,
        });
        if (!ownsRuntime()) return false;
        runtime.failureEvidence.replayError = null;
        failureEvidenceRecorder.setReplayability({ supported: true });
        return true;
      } catch (error) {
        if (!ownsRuntime()) return false;
        const reasonCode =
          /** @type {{code?:string}} */ (error)?.code ||
          "REPLAY_ANCHOR_CAPTURE_FAILED";
        runtime.failureEvidence.replayAnchor = null;
        runtime.failureEvidence.replayError = reasonCode;
        failureEvidenceRecorder.setReplayability({
          supported: false,
          reasonCode,
        });
        return false;
      }
    },
    dispose() {
      disposed = true;
      failureEvidenceRecorder.reset();
      failureEvidenceCaptureCoordinator.reset();
      if (
        runtime.inputTraceRecorder !== inputTraceRecorder ||
        runtime.failureEvidence.recorder !== failureEvidenceRecorder
      )
        return;
      runtime.checkpointCoordinator = null;
      runtime.prepareCheckpointCoordinator = null;
      runtime.inputTraceRecorder = null;
      runtime.failureEvidence = {
        recorder: null,
        replayAnchor: null,
        replayError: null,
        captureCoordinator: null,
      };
      runtime.runIdentity = null;
      runtime.runBlueprint = null;
    },
  });
}
