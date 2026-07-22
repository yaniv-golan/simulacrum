import { DomainValidationError } from "../../model/primitives.js";

/** Publishes one mobility record per canonical physical rolling assembly. */
export class MobilityTelemetrySystem {
  phase = "telemetry";

  step(context, dt) {
    const runtime = context.services.multibodyRuntime;
    if (!runtime?.compiled || !runtime.hasWheels?.()) return;
    const index = context.services.physicalAssemblyIndex;
    if (!index)
      throw new DomainValidationError(
        "MOBILITY_PHYSICAL_INDEX_REQUIRED",
        "Mobility telemetry requires the shared PhysicalAssemblyIndex",
      );
    const assemblies = index
      .snapshot()
      .components.map((component) =>
        runtime.mobilityTelemetryFor(component, context, dt),
      )
      .filter(Boolean);
    context.telemetry.mobility = { assemblies };
  }
}
