import { AerodynamicForceOwner } from "./aerodynamic-force-owner.js";
import { AerothermalAblationOwner } from "./aerothermal-ablation-owner.js";
import { PhysicalFlightModel } from "./physical-flight-model.js";
import { PhysicalFlightTelemetryProjector } from "./physical-flight-telemetry-projector.js";

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
    aerodynamicForceOwner = new AerodynamicForceOwner({
      physicalFlightModel,
      terrainCollisionStream,
      windAt,
    }),
    aerothermalAblationOwner = new AerothermalAblationOwner({
      physicalFlightModel,
      aerodynamicForceOwner,
    }),
    physicalFlightTelemetry = new PhysicalFlightTelemetryProjector({
      physicalFlightModel,
      aerodynamicForceOwner,
      aerothermalAblationOwner,
      windAt,
    });
  return Object.freeze({
    physicalFlightModel,
    aerodynamicForceOwner,
    aerothermalAblationOwner,
    physicalFlightTelemetry,
  });
}
