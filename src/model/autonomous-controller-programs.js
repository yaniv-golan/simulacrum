function assertBindingId(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function numberLiteral(value) {
  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * Builds an ordinary restricted controller program that estimates one scalar
 * from routed sensor evidence. Valid evidence re-seeds the estimate immediately;
 * unavailable evidence moves toward an explicit fallback at a bounded rate.
 *
 * @param {{
 *   inputBindingId?: string,
 *   estimateOutputBindingId?: string,
 *   confidenceOutputBindingId?: string,
 *   minimum?: number,
 *   maximum?: number,
 *   fallback?: number,
 *   maximumFallbackRatePerSecond?: number,
 *   maximumTickSeconds?: number,
 * }} options
 */
export function boundedEvidenceEstimatorProgram({
  inputBindingId,
  estimateOutputBindingId,
  confidenceOutputBindingId,
  minimum,
  maximum,
  fallback = 0,
  maximumFallbackRatePerSecond,
  maximumTickSeconds = 0.1,
} = {}) {
  const input = assertBindingId(inputBindingId, "inputBindingId"),
    estimateOutput = assertBindingId(
      estimateOutputBindingId,
      "estimateOutputBindingId",
    ),
    confidenceOutput = assertBindingId(
      confidenceOutputBindingId,
      "confidenceOutputBindingId",
    ),
    lower = assertFinite(minimum, "minimum"),
    upper = assertFinite(maximum, "maximum"),
    fallbackValue = assertFinite(fallback, "fallback"),
    fallbackRate = assertFinite(
      maximumFallbackRatePerSecond,
      "maximumFallbackRatePerSecond",
    ),
    maximumDt = assertFinite(maximumTickSeconds, "maximumTickSeconds");
  if (estimateOutput === confidenceOutput)
    throw new Error("estimator output binding IDs must be distinct");
  if (lower >= upper) throw new Error("minimum must be less than maximum");
  if (fallbackValue < lower || fallbackValue > upper)
    throw new Error("fallback must be inside the estimator range");
  if (fallbackRate <= 0)
    throw new Error("maximumFallbackRatePerSecond must be positive");
  if (maximumDt <= 0) throw new Error("maximumTickSeconds must be positive");

  return `interface ControlAPI {
  read(binding: string): number;
  valid(binding: string): number;
  write(binding: string, value: number): void;
}
let estimate = ${numberLiteral(fallbackValue)};
function clamp(value: number): number {
  return Math.max(${numberLiteral(lower)}, Math.min(${numberLiteral(upper)}, value));
}
function moveToward(current: number, target: number, maximumDelta: number): number {
  return current < target
    ? Math.min(target, current + maximumDelta)
    : Math.max(target, current - maximumDelta);
}
function tick(api: ControlAPI, dt: number): void {
  const evidenceValid = api.valid(${JSON.stringify(input)}) > 0.5;
  const boundedDt = dt === dt ? Math.max(0, Math.min(${numberLiteral(maximumDt)}, dt)) : 0;
  if (evidenceValid) {
    estimate = clamp(api.read(${JSON.stringify(input)}));
  } else {
    estimate = moveToward(
      estimate,
      ${numberLiteral(fallbackValue)},
      ${numberLiteral(fallbackRate)} * boundedDt,
    );
  }
  api.write(${JSON.stringify(estimateOutput)}, estimate);
  api.write(${JSON.stringify(confidenceOutput)}, evidenceValid ? 1 : 0);
}`;
}
