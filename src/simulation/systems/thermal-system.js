/** Advances thermal and ablative material response after structural loads. */
export class ThermalSystem {
  phase = "thermal";

  initialize(context) {
    const owner = context.services.aerothermalAblationOwner;
    if (!owner?.active()) return;
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.aerothermal =
      owner.initializeTelemetry(context);
  }

  step(context, dt) {
    context.services.aerothermalAblationOwner?.step(context, dt);
  }

  dispose(context) {
    context.services.aerothermalAblationOwner?.dispose();
  }
}
