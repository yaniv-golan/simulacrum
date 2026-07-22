import {
  SimulationSession,
  TelemetrySystem,
} from "@yaniv-golan/simulacrum-core";

export function simulationSystemExample() {
  class RadiationSystem {
    phase = "environment";

    step(context) {
      context.telemetry.radiation = { doseRateMsvH: 0.004 };
    }
  }

  const session = new SimulationSession({
    systems: [new RadiationSystem(), new TelemetrySystem()],
  });
  session.start({ revision: 0, parts: [], connections: [] });
  session.stepFixed();
  const telemetry = session.telemetry();
  session.dispose();
  return telemetry.systems.radiation;
}
