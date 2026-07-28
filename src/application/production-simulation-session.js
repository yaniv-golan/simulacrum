import { SimulationSession } from "../simulation/simulation-session.js";
import {
  captureProductionSystemTelemetry,
  createProductionSimulationSystems,
} from "./simulation-system-composition.js";

/** Starts one production session and rolls back every owned resource on error. */
export function startProductionSimulationSession({
  compiled,
  snapshot,
  runtime,
  physics,
  controllers,
  evidence,
  services,
}) {
  const session = new SimulationSession({
    systems: createProductionSimulationSystems(compiled),
  });
  try {
    session.start(snapshot, {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      catalog: physics.catalog,
      readSensors: controllers.captureSensors,
      tickControllers: controllers.tick,
      readCommandCandidates: controllers.readCommandCandidates,
      inputTraceRecorder: evidence.inputTraceRecorder,
      failureEvidenceRecorder: evidence.failureEvidenceRecorder,
      finalizeFailureEvidenceEpisode:
        evidence.failureEvidenceCaptureCoordinator?.finalize,
      failureEvidenceCaptureStatus:
        evidence.failureEvidenceCaptureCoordinator?.status,
      runIdentity: services.runIdentity,
      controllerTelemetry: controllers.telemetry,
      resolveChallengeBinding: services.resolveChallengeBinding,
      aerodynamicForceOwner: runtime.aerodynamicForceOwner,
      rotorForceOwner: runtime.rotorForceOwner,
      heatInputCollector: runtime.heatInputCollector,
      aerothermalAblationOwner: runtime.aerothermalAblationOwner,
      physicalFlightTelemetry: runtime.physicalFlightTelemetry,
      physicalAssemblyIndex: runtime.physicalAssemblyIndex,
      multibodyRuntime: runtime.multibodyRuntime,
      flexibleLineRuntime: runtime.flexibleLineRuntime,
      testSite: physics.testSite,
      testCourseSelection: physics.testCourseSelection,
      surfaceSampleAt: physics.surfaceSampleAt,
      compiledAssembly: compiled,
      environmentBodyRegistry: physics.environmentBodyRegistry,
      environmentOrigin: physics.environmentOrigin,
      windEnabled: services.windEnabled,
      pondAt: physics.pondAt,
      captureTelemetry: captureProductionSystemTelemetry,
      connectionValid: services.connectionValid,
      partMass: (part) => physics.catalog[part.type]?.mass || 0,
    });
    return session;
  } catch (error) {
    session.dispose();
    throw error;
  }
}
