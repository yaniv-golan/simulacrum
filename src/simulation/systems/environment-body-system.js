export class EnvironmentBodySystem {
  phase = "environment";

  initialize(context) {
    const registry = context.services.environmentBodyRegistry;
    if (!registry) return;
    const snapshot = registry.snapshot({
      time: 0,
      origin: context.services.environmentOrigin?.() || undefined,
    });
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.environmentBodies = snapshot;
  }

  step(context) {
    const registry = context.services.environmentBodyRegistry;
    if (!registry) return;
    context.telemetry.environmentBodies = registry.snapshot({
      time: context.time,
      origin: context.services.environmentOrigin?.() || undefined,
    });
  }
}
