/** Applies completed engine-neutral body poses to their registered views. */
export function syncEnvironmentBodyObjects(snapshot, objectByBodyId) {
  for (const body of snapshot?.bodies || []) {
    const object = objectByBodyId.get(body.id);
    if (!object) continue;
    object.position.set(
      body.pose.position.x,
      body.pose.position.y,
      body.pose.position.z,
    );
    object.quaternion.set(
      body.pose.orientation.x,
      body.pose.orientation.y,
      body.pose.orientation.z,
      body.pose.orientation.w,
    );
  }
}

/** Selects the nearest visible object proven by a valid physical sensor fix. */
export function focusedEnvironmentObject({
  sensorTelemetry,
  objectByBodyId,
  maximumRangeM = 30,
}) {
  const measurement = Object.values(sensorTelemetry?.controllers || {})
    .flatMap((controller) => controller.__bindings || [])
    .filter(
      (candidate) =>
        candidate.valid === true &&
        candidate.bound === true &&
        objectByBodyId.has(candidate.hitBodyId) &&
        Number.isFinite(Number(candidate.rangeM)) &&
        Number(candidate.rangeM) <= maximumRangeM,
    )
    .sort(
      (left, right) =>
        Number(left.rangeM) - Number(right.rangeM) ||
        String(left.hitBodyId).localeCompare(String(right.hitBodyId)),
    )[0];
  return measurement ? objectByBodyId.get(measurement.hitBodyId) : null;
}
