import { DomainValidationError } from "../model/primitives.js";

export const JOULES_PER_WATT_HOUR = 3600;

function nonNegativeFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new DomainValidationError(
      "INVALID_ENERGY_VALUE",
      `${label} must be a finite non-negative number`,
      { details: { label, value } },
    );
  return number;
}

export function wattHoursToJoules(value) {
  return nonNegativeFinite(value, "watt-hours") * JOULES_PER_WATT_HOUR;
}

export function joulesToWattHours(value) {
  return nonNegativeFinite(value, "joules") / JOULES_PER_WATT_HOUR;
}

/** Converts the current persistent battery representation into runtime SI. */
export function runtimeBatteryEnergy(part) {
  const capacityWh = nonNegativeFinite(
      part?.config?.capacityWh,
      "battery capacity",
    ),
    requestedEnergyWh = nonNegativeFinite(
      part?.storedEnergyWh,
      "battery energy",
    );
  if (requestedEnergyWh > capacityWh)
    throw new DomainValidationError(
      "BATTERY_CHARGE_EXCEEDS_CAPACITY",
      "Battery storedEnergyWh cannot exceed config.capacityWh",
    );
  const energyWh = requestedEnergyWh;
  return Object.freeze({
    capacityJ: wattHoursToJoules(capacityWh),
    energyJ: wattHoursToJoules(energyWh),
    capacityWh,
    energyWh,
    stateOfCharge: capacityWh > 0 ? energyWh / capacityWh : 0,
  });
}

/** Derives the wire/UI read model without changing runtime joule authority. */
export function batteryEnergyReadModel(part) {
  const capacityJ = nonNegativeFinite(part?.capacityJ ?? 0, "capacityJ"),
    energyJ = Math.min(
      capacityJ,
      nonNegativeFinite(part?.energyJ ?? 0, "energyJ"),
    ),
    capacityWh = joulesToWattHours(capacityJ),
    energyWh = joulesToWattHours(energyJ);
  return Object.freeze({
    capacityJ,
    energyJ,
    capacityWh,
    energyWh,
    stateOfCharge: capacityJ > 0 ? energyJ / capacityJ : 0,
  });
}
