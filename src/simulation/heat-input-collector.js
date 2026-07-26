import { DomainValidationError } from "../model/primitives.js";

function nonNegative(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0)
    throw new DomainValidationError(
      "INVALID_HEAT_INPUT",
      `${field} must be finite and non-negative`,
    );
  return number;
}

/** Current-tick merge boundary for independently owned physical heat sources. */
export class HeatInputCollector {
  #tick = null;
  #records = [];
  #snapshot = null;

  submit(record) {
    const tick = Number(record?.tick);
    if (!Number.isSafeInteger(tick) || tick < 0)
      throw new DomainValidationError(
        "INVALID_HEAT_INPUT",
        "Heat input tick must be a non-negative safe integer",
      );
    if (this.#tick == null || tick > this.#tick) {
      this.#tick = tick;
      this.#records = [];
      this.#snapshot = null;
    } else if (tick < this.#tick)
      throw new DomainValidationError(
        "STALE_HEAT_INPUT",
        `Heat input tick ${tick} is older than current tick ${this.#tick}`,
      );
    const source = String(record?.source || "");
    if (!source)
      throw new DomainValidationError(
        "INVALID_HEAT_INPUT",
        "Heat input source is required",
      );
    this.#records.push(
      Object.freeze({
        tick,
        partId: record.partId,
        source,
        incidentHeatFluxWPerM2: nonNegative(
          record.incidentHeatFluxWPerM2,
          "incidentHeatFluxWPerM2",
        ),
        surfaceAreaM2: nonNegative(record.surfaceAreaM2, "surfaceAreaM2"),
        atmosphereTemperatureK: nonNegative(
          record.atmosphereTemperatureK,
          "atmosphereTemperatureK",
        ),
        directHeatPowerW: nonNegative(
          record.directHeatPowerW,
          "directHeatPowerW",
        ),
      }),
    );
    this.#snapshot = null;
  }

  recordsForTick(tick) {
    if (tick !== this.#tick) return Object.freeze([]);
    this.#snapshot ||= Object.freeze([...this.#records]);
    return this.#snapshot;
  }
}
