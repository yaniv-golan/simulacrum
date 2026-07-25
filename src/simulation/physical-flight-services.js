import { AerodynamicForceOwner } from "./aerodynamic-force-owner.js";
import { AerothermalAblationOwner } from "./aerothermal-ablation-owner.js";
import { PhysicalFlightModel } from "./physical-flight-model.js";
import { PhysicalFlightTelemetryProjector } from "./physical-flight-telemetry-projector.js";
import { RotorForceOwner } from "./rotor-force-owner.js";
import { HeatInputCollector } from "./heat-input-collector.js";

/** Constructs the narrow owners for one compiled physical simulation run. */
export function createPhysicalFlightServices({
  multibodyRuntime,
  physicalAssemblyIndex,
  terrainCollisionStream = null,
  windAt,
}) {
  const physicalFlightModel = new PhysicalFlightModel({
      multibodyRuntime,
      physicalAssemblyIndex,
    }),
    heatInputCollector = new HeatInputCollector(),
    aerodynamicForceOwner = new AerodynamicForceOwner({
      physicalFlightModel,
      terrainCollisionStream,
      windAt,
      heatInputCollector,
    }),
    rotorForceOwner = new RotorForceOwner({
      physicalFlightModel,
      windAt,
    }),
    aerothermalAblationOwner = new AerothermalAblationOwner({
      physicalFlightModel,
      aerodynamicForceOwner,
      heatInputCollector,
    }),
    physicalFlightTelemetry = new PhysicalFlightTelemetryProjector({
      physicalFlightModel,
      aerodynamicForceOwner,
      aerothermalAblationOwner,
      windAt,
    });
  return Object.freeze({
    physicalFlightModel,
    heatInputCollector,
    aerodynamicForceOwner,
    rotorForceOwner,
    aerothermalAblationOwner,
    physicalFlightTelemetry,
  });
}
