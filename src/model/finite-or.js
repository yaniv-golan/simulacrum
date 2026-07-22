/**
 * Coerces a runtime measurement to a finite number or returns its fallback.
 *
 * This helper is intentionally distinct from `finiteNumber()`: authored and
 * wire data must fail validation, while incomplete runtime observations need a
 * deterministic fallback so telemetry and reports remain total functions.
 */
export function finiteOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
