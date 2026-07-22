/** Lazily binds portable checkpoint machinery to the currently active run. */
export function createCheckpointCoordinatorLoader({
  runtime,
  physics,
  controllers,
}) {
  return async () => {
    const activeSession = runtime.session,
      { RuntimeCheckpointCoordinator } =
        await import("../simulation/runtime-checkpoints.js");
    if (!activeSession || runtime.session !== activeSession)
      throw new Error("Simulation stopped while checkpoint support loaded");
    runtime.checkpointCoordinator ||= new RuntimeCheckpointCoordinator({
      session: activeSession,
      multibodyRuntime: runtime.multibodyRuntime,
      worldAdapter: physics.worldAdapter,
      sensorBank: controllers.sensorBank,
      controllerManager: controllers.runtimeManager,
      aerothermalAblationOwner: runtime.aerothermalAblationOwner,
      terrainState: runtime.terrainCollisionStream,
      inputCursor: runtime.inputTraceRecorder,
    });
    return runtime.checkpointCoordinator;
  };
}
