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
  challenges,
  assembly,
  run,
  runEvidence,
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
      inputTraceRecorder: runEvidence.inputTraceRecorder,
      runIdentity: runtime.runIdentity,
      controllerTelemetry: controllers.telemetry,
      resolveChallengeBinding: challenges.resolveBinding,
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
      windEnabled: run.windEnabled,
      pondAt: physics.pondAt,
      captureTelemetry: captureProductionSystemTelemetry,
      connectionValid: assembly.connectionValid,
      partMass: (part) => physics.catalog[part.type]?.mass || 0,
    });
    runEvidence.activate();
    return session;
  } catch (error) {
    session.dispose();
    runEvidence.dispose();
    throw error;
  }
}
