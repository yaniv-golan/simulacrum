/** Publishes completed flight kinematics from already-resolved physical data. */
export class PhysicalFlightTelemetrySystem {
  phase = "telemetry";

  initialize(context) {
    context.services.physicalFlightTelemetry?.initialize(context);
  }

  step(context, dt) {
    context.services.physicalFlightTelemetry?.projectCompleted(context, dt);
  }

  afterCheckpointRestore(context) {
    context.services.physicalFlightTelemetry?.afterCheckpointRestore(context);
  }

  dispose(context) {
    context.services.physicalFlightTelemetry?.dispose();
  }
}
