/** Captures actuator-owned luminaires used by completed mobility telemetry. */
export class RollingContactSystem {
  phase = "actuators";

  step(context, dt) {
    void dt;
    const runtime = context.services.multibodyRuntime;
    if (!runtime?.hasWheels?.()) return;
    runtime.activeLuminairePartIds = (
      context.telemetry.componentActuators?.states || []
    )
      .filter((state) => state.enabled)
      .map((state) => state.partId);
  }
}
