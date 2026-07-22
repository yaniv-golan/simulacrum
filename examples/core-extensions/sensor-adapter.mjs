import {
  SensorSystem,
  SimulationSession,
  TelemetrySystem,
} from "@yaniv-golan/simulacrum-core";

export function sensorAdapterExample() {
  const session = new SimulationSession({
    systems: [new SensorSystem(), new TelemetrySystem()],
  });
  session.start(
    { revision: 0, parts: [], connections: [] },
    {
      readSensors: () => ({ radiation_msv_h: 0.004 }),
    },
  );
  session.stepFixed();
  const telemetry = session.telemetry();
  session.dispose();
  return telemetry.systems.sensors.radiation_msv_h;
}
