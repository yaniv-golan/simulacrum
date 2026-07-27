import { createTelemetrySnapshot } from "../simulation/telemetry.js";
/**
 * Mutable state that exists only for one workshop simulation lifecycle.
 * Keeping it separate from editor and persistent assembly state makes reset,
 * disposal, and telemetry ownership explicit.
 */
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
    failureEvidence: { recorder: null, replayAnchor: null, replayError: null },
    runIdentity: null,
    runBlueprint: null,
    workspaceFocusBefore: false,
  };
}
