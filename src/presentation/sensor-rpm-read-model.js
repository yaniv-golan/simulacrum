/** Reads one rotation-sensor channel from completed controller snapshots. */
export function sensorRpmFromTelemetry(telemetry, sensorId) {
  const controllers = telemetry?.systems?.sensors?.controllers;
  if (!controllers) return 0;
  for (const readings of Object.values(controllers)) {
    const value = readings?.[`rotation_rpm_${sensorId}`];
    if (Number.isFinite(value)) return value;
  }
  return 0;
}
