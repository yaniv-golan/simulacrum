import { SimulationSession } from "../simulation/simulation-session.js";
import { startMultibodyRuntime } from "../simulation/multibody-runtime.js";
import { FlexibleLineRuntime } from "../simulation/flexible-line-runtime.js";
import { PhysicalAssemblyIndex } from "../simulation/physical-assembly-index.js";
import { createPhysicalFlightServices } from "../simulation/physical-flight-services.js";
import { TerrainCollisionStream } from "../simulation/environment/terrain-collision-stream.js";
import { WATER_DENSITY } from "../simulation/environment/earth.js";
import {
  captureProductionSystemTelemetry,
  createProductionSimulationSystems,
} from "./simulation-system-composition.js";

/** Builds the same DOM-free production run graph for browser and CLI replay. */
export function createSimulationRunRuntime({
  snapshot,
  physics,
  controllers,
  evidence,
  services,
}) {
  const multibodyRuntime = startMultibodyRuntime(snapshot, {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      catalog: physics.catalog,
      surfaceHeightAt: physics.surfaceHeightAt,
      terrainHeightAt: physics.terrainHeightAt,
      pondAt: physics.pondAt,
      waterDensity: WATER_DENSITY,
      groundBody: physics.groundBody,
      fieldBody: physics.fieldBody,
      materialForPart: physics.materialForPart,
    }),
    flexibleLineRuntime = new FlexibleLineRuntime({
      world: physics.world,
      materialForKey: physics.materialForKey,
      multibodyRuntime,
    }).start(multibodyRuntime.compiled),
    terrainCollisionStream = new TerrainCollisionStream({
      world: physics.world,
      heightAt: physics.terrainHeightAt,
      material: physics.groundMaterial,
      tileSize: physics.terrainSize,
      segments: 32,
      centralTile: { x: 0, z: 0 },
      neighborhood: 1,
    }),
    physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    flight = createPhysicalFlightServices({
      multibodyRuntime,
      physicalAssemblyIndex,
      terrainCollisionStream,
      windAt: physics.windAt,
    }),
    session = new SimulationSession({
      systems: createProductionSimulationSystems(multibodyRuntime.compiled),
    }).start(snapshot, {
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      catalog: physics.catalog,
      readSensors: controllers.captureSensors,
      tickControllers: controllers.tick,
      readCommandCandidates: controllers.readCommandCandidates,
      inputTraceRecorder: evidence.inputTraceRecorder,
      failureEvidenceRecorder: evidence.failureEvidenceRecorder,
      controllerTelemetry: controllers.telemetry,
      resolveChallengeBinding: services.resolveChallengeBinding,
      aerodynamicForceOwner: flight.aerodynamicForceOwner,
      aerothermalAblationOwner: flight.aerothermalAblationOwner,
      physicalFlightTelemetry: flight.physicalFlightTelemetry,
      physicalAssemblyIndex,
      multibodyRuntime,
      flexibleLineRuntime,
      testSite: physics.testSite,
      testCourseSelection: physics.testCourseSelection,
      surfaceSampleAt: physics.surfaceSampleAt,
      compiledAssembly: multibodyRuntime.compiled,
      environmentBodyRegistry: physics.environmentBodyRegistry,
      environmentOrigin: physics.environmentOrigin,
      windEnabled: services.windEnabled,
      pondAt: physics.pondAt,
      captureTelemetry: captureProductionSystemTelemetry,
      connectionValid: services.connectionValid,
      partMass: (part) => physics.catalog[part.type]?.mass || 0,
    });

  function createCheckpointCoordinator(
    inputCursor = evidence.inputTraceRecorder,
  ) {
    const CheckpointCoordinator = services.CheckpointCoordinator;
    if (!CheckpointCoordinator)
      throw new Error(
        "CheckpointCoordinator must be injected by a replay or checkpoint owner",
      );
    return new CheckpointCoordinator({
      session,
      multibodyRuntime,
      flexibleLineRuntime,
      worldAdapter: physics.worldAdapter,
      sensorBank: controllers.sensorBank,
      controllerManager: controllers.runtimeManager,
      aerothermalAblationOwner: flight.aerothermalAblationOwner,
      terrainState: terrainCollisionStream,
      inputCursor,
    });
  }

  function dispose() {
    session.dispose();
    flight.physicalFlightModel.dispose();
    terrainCollisionStream.dispose();
    flexibleLineRuntime.dispose();
    multibodyRuntime.dispose();
  }

  return Object.freeze({
    ...flight,
    physicalAssemblyIndex,
    multibodyRuntime,
    flexibleLineRuntime,
    terrainCollisionStream,
    session,
    createCheckpointCoordinator,
    dispose,
  });
}
