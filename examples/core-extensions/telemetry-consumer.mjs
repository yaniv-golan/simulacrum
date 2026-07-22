import { createTelemetrySnapshot } from "@yaniv-golan/simulacrum-core";

export function telemetryConsumerExample() {
  const snapshot = createTelemetrySnapshot({
    time: 2,
    tick: 240,
    systems: { mission: { altitudeM: 12.5, status: "ascending" } },
  });
  return Object.freeze({
    elapsed: snapshot.time,
    altitude: snapshot.systems.mission.altitudeM,
    label: snapshot.systems.mission.status.toUpperCase(),
  });
}
