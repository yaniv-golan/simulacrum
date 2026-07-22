import { InputTraceRecorder } from "../simulation/input-trace-recorder.js";
import { createCheckpointCoordinatorLoader } from "./checkpoint-coordinator-loader.js";
import { createWorkshopRunConfiguration } from "./mechanism-run-identity.js";

/** Owns trace, identity, and checkpoint handles for exactly one active run. */
export function createRunEvidenceLifecycle({
  runtime,
  assembly,
  physics,
  controllers,
  run,
}) {
  const inputTraceRecorder = new InputTraceRecorder();
  runtime.inputTraceRecorder = inputTraceRecorder;
  return Object.freeze({
    inputTraceRecorder,
    commit(compiled) {
      runtime.runBlueprint = assembly.serialize("Mechanism experiment");
      runtime.runIdentity = createWorkshopRunConfiguration({
        blueprint: runtime.runBlueprint,
        compiled,
        environment: {
          latitude: physics.latitude,
          longitude: physics.longitude,
          timeOfDay: run.timeOfDay,
          windEnabled: run.windEnabled,
        },
      });
      runtime.checkpointCoordinator = null;
      runtime.prepareCheckpointCoordinator = createCheckpointCoordinatorLoader({
        runtime,
        physics,
        controllers,
      });
    },
    dispose() {
      runtime.checkpointCoordinator = null;
      runtime.prepareCheckpointCoordinator = null;
      runtime.inputTraceRecorder = null;
      runtime.runIdentity = null;
      runtime.runBlueprint = null;
    },
  });
}
