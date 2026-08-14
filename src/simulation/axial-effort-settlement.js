const SOURCE_VALUES = new Set(["default", "none", "remote", "script"]);

export const AXIAL_EFFORT_SATURATION_CAUSES = Object.freeze({
  FORCE_SPEED_CAPACITY: 1,
  THERMAL_DERATE: 2,
  POWER_UNAVAILABLE: 4,
  POWER_ALLOCATION: 8,
});

/** @type {readonly (readonly [number, string])[]} */
const SATURATION_CAUSE_LABELS = Object.freeze([
  [AXIAL_EFFORT_SATURATION_CAUSES.FORCE_SPEED_CAPACITY, "force-speed-capacity"],
  [AXIAL_EFFORT_SATURATION_CAUSES.THERMAL_DERATE, "thermal-derate"],
  [AXIAL_EFFORT_SATURATION_CAUSES.POWER_UNAVAILABLE, "power-unavailable"],
  [AXIAL_EFFORT_SATURATION_CAUSES.POWER_ALLOCATION, "power-allocation"],
]);

const near = (left, right) =>
  Math.abs(left - right) <=
  Math.max(1e-9, 1e-12 * Math.max(1, Math.abs(left), Math.abs(right)));

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

function validTick(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalidDemand(commandSource, commandValidity, commandTick = null) {
  return Object.freeze({
    commandSource,
    commandValidity,
    commandTick,
    requestedForceN: 0,
    speedLimitedForceN: 0,
    capacityLimitedForceN: 0,
    saturationCauseMask: 0,
  });
}

/**
 * Resolves one absolute coordinate-force command against current-tick command
 * authority and the authored force-speed/thermal envelope. Electrical delivery
 * is deliberately settled in a second step by the owning power network.
 */
export function resolveAbsoluteAxialEffortDemand({
  command,
  commandTick,
  fixedTick,
  minimumForceN,
  maximumForceN,
  speedExtendCapacityN,
  speedRetractCapacityN,
  thermalAvailability,
}) {
  const source = SOURCE_VALUES.has(command?.source) ? command.source : "none";
  if (!validTick(fixedTick) || commandTick !== fixedTick)
    return invalidDemand(
      source,
      "stale",
      validTick(commandTick) ? commandTick : null,
    );
  if (command?.conflict === true)
    return invalidDemand("none", "conflict", fixedTick);
  if (source !== "remote" && source !== "script")
    return invalidDemand(source, "missing", fixedTick);
  const requestedForceN = command?.value;
  if (
    !Number.isFinite(requestedForceN) ||
    !Number.isFinite(minimumForceN) ||
    !Number.isFinite(maximumForceN) ||
    requestedForceN < minimumForceN ||
    requestedForceN > maximumForceN ||
    !Number.isFinite(speedExtendCapacityN) ||
    speedExtendCapacityN < 0 ||
    !Number.isFinite(speedRetractCapacityN) ||
    speedRetractCapacityN < 0 ||
    !Number.isFinite(thermalAvailability) ||
    thermalAvailability < 0 ||
    thermalAvailability > 1
  )
    return invalidDemand(source, "out-of-range", fixedTick);

  const speedLimitedForceN = clamp(
      requestedForceN,
      -speedRetractCapacityN,
      speedExtendCapacityN,
    ),
    capacityLimitedForceN = clamp(
      speedLimitedForceN,
      -speedRetractCapacityN * thermalAvailability,
      speedExtendCapacityN * thermalAvailability,
    );
  let saturationCauseMask = 0;
  if (!near(speedLimitedForceN, requestedForceN))
    saturationCauseMask |= AXIAL_EFFORT_SATURATION_CAUSES.FORCE_SPEED_CAPACITY;
  if (!near(capacityLimitedForceN, speedLimitedForceN))
    saturationCauseMask |= AXIAL_EFFORT_SATURATION_CAUSES.THERMAL_DERATE;
  return Object.freeze({
    commandSource: source,
    commandValidity: "current",
    commandTick: fixedTick,
    requestedForceN,
    speedLimitedForceN,
    capacityLimitedForceN,
    saturationCauseMask,
  });
}

/** Settles current-tick electrical delivery without changing the demand. */
export function settleAbsoluteAxialEffortDelivery({
  demand,
  powerOperational,
  requestedElectricalW,
  deliveredElectricalW,
}) {
  const requestedForceN = Number(demand?.requestedForceN),
    capacityLimitedForceN = Number(demand?.capacityLimitedForceN);
  if (
    demand?.commandValidity !== "current" ||
    !Number.isFinite(requestedForceN) ||
    !Number.isFinite(capacityLimitedForceN)
  )
    return Object.freeze({
      appliedForceN: 0,
      residualForceN: 0,
      saturationCauseMask: 0,
      saturated: false,
    });
  if (!powerOperational) {
    const residualForceN = requestedForceN;
    return Object.freeze({
      appliedForceN: 0,
      residualForceN,
      saturationCauseMask:
        demand.saturationCauseMask |
        (near(residualForceN, 0)
          ? 0
          : AXIAL_EFFORT_SATURATION_CAUSES.POWER_UNAVAILABLE),
      saturated: !near(residualForceN, 0),
    });
  }
  if (
    !Number.isFinite(requestedElectricalW) ||
    requestedElectricalW < 0 ||
    !Number.isFinite(deliveredElectricalW) ||
    deliveredElectricalW < 0 ||
    deliveredElectricalW > requestedElectricalW + 1e-9
  )
    throw new RangeError("Axial effort electrical settlement is invalid");
  const deliveryRatio = requestedElectricalW
      ? Math.min(1, deliveredElectricalW / requestedElectricalW)
      : 1,
    appliedForceN = capacityLimitedForceN * deliveryRatio,
    residualForceN = requestedForceN - appliedForceN;
  let saturationCauseMask = demand.saturationCauseMask;
  if (!near(appliedForceN, capacityLimitedForceN))
    saturationCauseMask |= AXIAL_EFFORT_SATURATION_CAUSES.POWER_ALLOCATION;
  return Object.freeze({
    appliedForceN,
    residualForceN,
    saturationCauseMask,
    saturated: !near(residualForceN, 0),
  });
}

export function axialEffortSaturationCauses(mask) {
  if (!Number.isSafeInteger(mask) || mask < 0)
    throw new RangeError("Axial effort saturation mask is invalid");
  return Object.freeze(
    SATURATION_CAUSE_LABELS.filter(([bit]) => (mask & bit) !== 0).map(
      ([, label]) => label,
    ),
  );
}

export const AXIAL_EFFORT_SATURATION_MASK = SATURATION_CAUSE_LABELS.reduce(
  (mask, [bit]) => mask | bit,
  0,
);
