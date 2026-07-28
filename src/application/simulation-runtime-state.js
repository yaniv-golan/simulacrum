import { createTelemetrySnapshot } from "../simulation/telemetry.js";
export function createSimulationRuntimeState() {
  return {
    baseline: null,
    session: null,
    telemetry: createTelemetrySnapshot(),
    physicalFlightModel: null,
    aerodynamicForceOwner: null,
    rotorForceOwner: null,
    heatInputCollector: null,
    aerothermalAblationOwner: null,
    physicalFlightTelemetry: null,
    physicalAssemblyIndex: null,
    multibodyRuntime: null,
    flexibleLineRuntime: null,
    terrainCollisionStream: null,
    checkpointCoordinator: null,
    prepareCheckpointCoordinator: null,
    inputTraceRecorder: null,
    failureEvidence: {
      recorder: null,
      replayAnchor: null,
      replayError: null,
      captureCoordinator: null,
    },
    runIdentity: null,
    runBlueprint: null,
    workspaceFocusBefore: false,
  };
}
