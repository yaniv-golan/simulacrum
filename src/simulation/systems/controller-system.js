export class ControllerSystem {
  phase = "controllers";

  step(context, fixedDt) {
    context.services.tickControllers?.(fixedDt, context.sensors);
    context.telemetry.controllers =
      context.services.controllerTelemetry?.() || Object.freeze({});
  }
}
