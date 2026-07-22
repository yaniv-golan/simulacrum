/** Applies component-resolved aerodynamic and gravity forces. */
export class AerodynamicSystem {
  phase = "environment";

  initialize(context) {
    const owner = context.services.aerodynamicForceOwner;
    if (!owner?.active()) return;
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.aerodynamics = owner.telemetry();
  }

  step(context) {
    context.services.aerodynamicForceOwner?.step(context);
  }

  dispose(context) {
    context.services.aerodynamicForceOwner?.dispose();
  }
}
