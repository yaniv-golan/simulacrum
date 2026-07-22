/** @type {ReadonlyArray<readonly [RegExp,string]>} */
const unitRules = Object.freeze([
  [/temperature/i, "K"],
  [/energy|work/i, "J"],
  [/power|watts/i, "W"],
  [/torque/i, "N·m"],
  [/force|load|weight|thrust|buoyancy/i, "N"],
  [/angularVelocity|radPerS/i, "rad/s"],
  [/velocity|speed/i, "m/s"],
  [/acceleration/i, "m/s²"],
  [/distance|position|travel|deflection|depth|altitude|clearance/i, "m"],
  [/angle|roll|pitch|yaw|steer/i, "rad"],
  [/time/i, "s"],
  [/rpm/i, "rpm"],
]);

function unitFor(channelId) {
  return unitRules.find(([pattern]) => pattern.test(channelId))?.[1] || "ratio";
}

function coordinateFrame(channelId) {
  return /position|velocity|acceleration|contact|normal|force/i.test(channelId)
    ? "world-y-up"
    : "scalar-or-component-local";
}

/** Projects canonical completed telemetry into searchable, unit-bearing rows. */
export function projectMechanismTelemetryChannels(snapshot, tick) {
  const rows = [],
    visit = (value, path, parent = null) => {
      if (typeof value === "number") {
        const channelId = path.join("."),
          owner = path[0] === "systems" ? path[1] : path[0],
          idSegment = path.find((segment) => /^\d+$/.test(segment));
        rows.push({
          channelId,
          owner,
          bodyOrPartId: idSegment == null ? null : Number(idSegment),
          coordinateFrame: coordinateFrame(channelId),
          unit: unitFor(channelId),
          tick,
          value,
          valid: Number.isFinite(value),
          saturated: Boolean(parent?.saturated || parent?.thermalShutdown),
        });
        return;
      }
      if (Array.isArray(value))
        value.forEach((child, index) =>
          visit(child, [...path, String(index)], value),
        );
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value))
          visit(child, [...path, key], value);
    };
  visit(snapshot, []);
  return rows.sort((left, right) =>
    left.channelId.localeCompare(right.channelId),
  );
}
