import { resolveComponentConfig } from "./component-resolver.js";
import {
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteVector3,
} from "./primitives.js";

/** Compiles the authored component settings into one finite conical beam. */
export function rangeSensorContract(part, definition, catalog) {
  if (definition?.sensorContract?.kind !== "conical-range-v1") return null;
  const config = resolveComponentConfig(part, undefined, catalog),
    localAxisPart = finiteVector3(config.sensingAxis, {
      path: ["parts", part.id, "config", "sensingAxis"],
    });
  if (Math.hypot(...localAxisPart) < 1e-9)
    throw new DomainValidationError(
      "INVALID_RANGE_SENSOR_AXIS",
      `Range sensor ${String(part.id)} requires a nonzero sensing axis`,
      { path: ["parts", part.id, "config", "sensingAxis"] },
    );
  const axisMagnitude = Math.hypot(...localAxisPart);
  return deepFreeze({
    kind: "conical-range-v1",
    localAxisPart: localAxisPart.map((value) => value / axisMagnitude),
    emitterOffsetPartM: finiteVector3(config.emitterOffsetM, {
      path: ["parts", part.id, "config", "emitterOffsetM"],
    }),
    fieldOfViewDeg: finiteNumber(config.fieldOfViewDeg, {
      min: Number.EPSILON,
      max: 179.999,
      path: ["parts", part.id, "config", "fieldOfViewDeg"],
    }),
    maximumRangeM: finiteNumber(config.maximumRangeM, {
      min: Number.EPSILON,
      path: ["parts", part.id, "config", "maximumRangeM"],
    }),
    rangeResolutionM: finiteNumber(config.rangeResolutionM, {
      min: Number.EPSILON,
      path: ["parts", part.id, "config", "rangeResolutionM"],
    }),
  });
}
