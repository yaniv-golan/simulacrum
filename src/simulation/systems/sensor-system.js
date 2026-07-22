export class SensorSystem {
  phase = "sensors";

  initialize(context) {
    context.completedSensorSnapshot = Object.freeze({});
  }

  step(context, fixedDt) {
    // readSensors observes context.previousTelemetry, which was committed at
    // the end of the preceding fixed step. Controllers can therefore consume
    // this snapshot immediately without permitting same-step feedback.
    context.completedSensorSnapshot = Object.freeze(
      structuredClone(context.services.readSensors?.(context, fixedDt) || {}),
    );
    context.sensors = context.completedSensorSnapshot;
    context.telemetry.sensors = context.completedSensorSnapshot;
  }

  dispose(context) {
    delete context.completedSensorSnapshot;
  }
}
