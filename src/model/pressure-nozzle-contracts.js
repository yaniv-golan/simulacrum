import { portDefinition } from "./ports.js";
import { materialMedium } from "./material-media.js";
import { DomainValidationError, immutableClone } from "./primitives.js";

const finitePositive = (value, field, partId) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_CONTRACT",
      `${field} must be finite and positive`,
      { path: ["parts", partId, "config", field] },
    );
  return number;
};

const configured = (part, descriptor, field) =>
  part.config?.[descriptor[field]];

function normalizedAxis(value, field, partId) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => !Number.isFinite(entry))
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_AXIS",
      `${field} must contain three finite values`,
      { path: ["parts", partId, "propulsion", field] },
    );
  const length = Math.hypot(...value);
  if (length <= 1e-9)
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_AXIS",
      `${field} must have non-zero length`,
      { path: ["parts", partId, "propulsion", field] },
    );
  return value.map((entry) => entry / length);
}

const dot = (left, right) =>
  left.reduce((sum, value, axis) => sum + value * right[axis], 0);
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

function gimbalFrame(localAxis) {
  const reference = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].sort(
      (left, right) =>
        Math.abs(dot(left, localAxis)) - Math.abs(dot(right, localAxis)),
    )[0],
    projection = dot(reference, localAxis),
    gimbalAxisX = reference.map(
      (value, axis) => value - projection * localAxis[axis],
    ),
    xLength = Math.hypot(...gimbalAxisX);
  for (let axis = 0; axis < 3; axis++) gimbalAxisX[axis] /= xLength;
  const gimbalAxisZ = cross(gimbalAxisX, localAxis),
    zLength = Math.hypot(...gimbalAxisZ);
  for (let axis = 0; axis < 3; axis++) gimbalAxisZ[axis] /= zLength;
  return { gimbalAxisX, gimbalAxisZ };
}

function oppositeSurfacePoint(geometry, localAxis, partId) {
  const minimum = geometry?.bodyBoundsPartM?.minimumM,
    maximum = geometry?.bodyBoundsPartM?.maximumM;
  if (
    !Array.isArray(minimum) ||
    minimum.length !== 3 ||
    !Array.isArray(maximum) ||
    maximum.length !== 3
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_GEOMETRY",
      "Pressure nozzle requires finite compiled part bounds",
      { path: ["parts", partId, "propulsion"] },
    );
  const center = minimum.map((value, axis) => (value + maximum[axis]) / 2),
    direction = localAxis.map((value) => -value),
    distances = direction
      .map((component, axis) => {
        if (Math.abs(component) <= 1e-12) return Infinity;
        const boundary = component > 0 ? maximum[axis] : minimum[axis];
        return (boundary - center[axis]) / component;
      })
      .filter((value) => Number.isFinite(value) && value >= 0),
    distance = Math.min(...distances);
  if (!Number.isFinite(distance))
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_GEOMETRY",
      "Pressure-nozzle axis does not intersect its compiled bounds",
      { path: ["parts", partId, "propulsion", "localAxis"] },
    );
  return center.map((value, axis) => value + direction[axis] * distance);
}

function ratedCurve(descriptor, partId) {
  if (!Array.isArray(descriptor.ratedCurve) || descriptor.ratedCurve.length < 2)
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_CURVE",
      "Pressure-nozzle rated curve requires at least two points",
      { path: ["parts", partId, "propulsion", "ratedCurve"] },
    );
  const points = descriptor.ratedCurve.map((point, index) => ({
    flowFraction: finitePositive(
      point.flowFraction,
      `ratedCurve.${index}.flowFraction`,
      partId,
    ),
    exitVelocityMps: finitePositive(
      point.exitVelocityMps,
      `ratedCurve.${index}.exitVelocityMps`,
      partId,
    ),
    exitPressurePa: finitePositive(
      point.exitPressurePa,
      `ratedCurve.${index}.exitPressurePa`,
      partId,
    ),
  }));
  for (let index = 0; index < points.length; index++) {
    const point = points[index],
      previous = points[index - 1];
    if (
      point.flowFraction > 1 ||
      (previous &&
        (point.flowFraction <= previous.flowFraction ||
          point.exitVelocityMps <= previous.exitVelocityMps ||
          point.exitPressurePa <= previous.exitPressurePa))
    )
      throw new DomainValidationError(
        "INVALID_PRESSURE_NOZZLE_CURVE",
        "Pressure-nozzle curve values must be strictly increasing and flow fractions may not exceed one",
        { path: ["parts", partId, "propulsion", "ratedCurve", index] },
      );
  }
  if (points.at(-1).flowFraction !== 1)
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_CURVE",
      "Pressure-nozzle rated curve must end at full flow",
      { path: ["parts", partId, "propulsion", "ratedCurve"] },
    );
  return points;
}

/** Compiles and validates the common physical contract for every chemical engine. */
export function pressureNozzleContract(part, definition, geometry, catalog) {
  const descriptor = definition.flight?.propulsion;
  if (!descriptor) return null;
  if (descriptor.kind !== "pressure-nozzle-v1")
    throw new DomainValidationError(
      "UNKNOWN_PROPULSION_CONTRACT",
      `Unknown propulsion contract ${String(descriptor.kind)}`,
      { path: ["parts", part.id, "propulsion", "kind"] },
    );
  const mediumId = String(descriptor.mediumId || ""),
    inletPortId = String(descriptor.inletPortId || ""),
    medium = materialMedium(mediumId),
    port = portDefinition(part, inletPortId, catalog),
    maximumMassFlowKgS = finitePositive(
      configured(part, descriptor, "maximumMassFlowField"),
      descriptor.maximumMassFlowField,
      part.id,
    ),
    exitAreaM2 = finitePositive(
      configured(part, descriptor, "exitAreaField"),
      descriptor.exitAreaField,
      part.id,
    ),
    throttleTimeConstantS = finitePositive(
      configured(part, descriptor, "throttleTimeConstantField"),
      descriptor.throttleTimeConstantField,
      part.id,
    ),
    minimumStableThrottle = Number(
      configured(part, descriptor, "minimumStableThrottleField"),
    ),
    thermalLossFraction = Number(
      configured(part, descriptor, "thermalLossFractionField"),
    ),
    localAxis = normalizedAxis(
      descriptor.localAxis || [0, 1, 0],
      "localAxis",
      part.id,
    ),
    gimbalRangeRad = Number(descriptor.gimbalRangeRad ?? 0),
    curve = ratedCurve(descriptor, part.id);
  if (
    port.kind !== "resource" ||
    port.behavior !== "material-resource" ||
    port.direction !== "sink" ||
    port.mediumId !== mediumId
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_INLET",
      "Pressure nozzle inlet must be a same-medium resource sink port",
      { path: ["parts", part.id, "propulsion", "inletPortId"] },
    );
  if (
    !Number.isFinite(minimumStableThrottle) ||
    minimumStableThrottle <= 0 ||
    minimumStableThrottle >= 1 ||
    curve[0].flowFraction !== minimumStableThrottle
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_MINIMUM_THROTTLE",
      "Minimum stable throttle must match the first rated curve point and lie between zero and one",
      {
        path: [
          "parts",
          part.id,
          "config",
          descriptor.minimumStableThrottleField,
        ],
      },
    );
  if (
    !Number.isFinite(thermalLossFraction) ||
    thermalLossFraction < 0 ||
    thermalLossFraction >= 1
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_THERMAL_LOSS",
      "Pressure-nozzle thermal loss fraction must be in [0, 1)",
      {
        path: ["parts", part.id, "config", descriptor.thermalLossFractionField],
      },
    );
  if (
    !Number.isFinite(gimbalRangeRad) ||
    gimbalRangeRad < 0 ||
    gimbalRangeRad >= Math.PI / 2
  )
    throw new DomainValidationError(
      "INVALID_PRESSURE_NOZZLE_GIMBAL_RANGE",
      "Pressure-nozzle gimbal range must be finite and lie in [0, pi/2)",
      { path: ["parts", part.id, "propulsion", "gimbalRangeRad"] },
    );
  for (const [index, point] of curve.entries()) {
    const massFlow = maximumMassFlowKgS * point.flowFraction,
      chemicalPowerW = massFlow * medium.specificAvailableEnergyJkg,
      exhaustKineticPowerW = 0.5 * massFlow * point.exitVelocityMps ** 2,
      vacuumPressureWorkW =
        point.exitPressurePa * exitAreaM2 * point.exitVelocityMps,
      thermalLossW = chemicalPowerW * thermalLossFraction;
    if (
      exhaustKineticPowerW + vacuumPressureWorkW + thermalLossW >
      chemicalPowerW + 1e-6
    )
      throw new DomainValidationError(
        "PRESSURE_NOZZLE_ENERGY_DEFICIT",
        "Rated pressure-nozzle point exceeds the medium's available energy",
        {
          path: ["parts", part.id, "propulsion", "ratedCurve", index],
          details: {
            chemicalPowerW,
            exhaustKineticPowerW,
            vacuumPressureWorkW,
            thermalLossW,
          },
        },
      );
  }
  const { gimbalAxisX, gimbalAxisZ } = gimbalFrame(localAxis);
  return immutableClone({
    kind: "pressure-nozzle-v1",
    mediumId,
    inletPortId,
    localAxis,
    gimbalAxisX,
    gimbalAxisZ,
    applicationPointPartM: oppositeSurfacePoint(geometry, localAxis, part.id),
    maximumMassFlowKgS,
    exitAreaM2,
    throttleTimeConstantS,
    minimumStableThrottle,
    gimbalRangeRad,
    thermalLossFraction,
    ratedCurve: curve,
    specificAvailableEnergyJkg: medium.specificAvailableEnergyJkg,
  });
}

function interpolate(left, right, fraction, field) {
  return left[field] + (right[field] - left[field]) * fraction;
}

/** Derives nozzle thrust and its complete energy ledger from delivered mass flow. */
export function pressureNozzlePerformance(
  contract,
  deliveredMassFlowKgS,
  ambientPressurePa,
) {
  const massFlowKgS = Math.max(0, Number(deliveredMassFlowKgS || 0)),
    ambient = Math.max(0, Number(ambientPressurePa || 0));
  if (massFlowKgS <= 0)
    return immutableClone({
      massFlowKgS: 0,
      flowFraction: 0,
      exitVelocityMps: 0,
      exitPressurePa: ambient,
      momentumThrustN: 0,
      pressureThrustN: 0,
      thrustN: 0,
      chemicalInputW: 0,
      exhaustKineticW: 0,
      pressureWorkW: 0,
      thermalLossW: 0,
      residualW: 0,
    });
  const flowFraction = Math.min(1, massFlowKgS / contract.maximumMassFlowKgS),
    first = contract.ratedCurve[0],
    points =
      flowFraction < first.flowFraction
        ? [
            {
              flowFraction: 0,
              exitVelocityMps: 0,
              exitPressurePa: ambient,
            },
            first,
          ]
        : contract.ratedCurve;
  let left = points[0],
    right = points.at(-1);
  for (let index = 1; index < points.length; index++)
    if (flowFraction <= points[index].flowFraction) {
      left = points[index - 1];
      right = points[index];
      break;
    }
  const fraction =
      (flowFraction - left.flowFraction) /
      Math.max(1e-12, right.flowFraction - left.flowFraction),
    exitVelocityMps = interpolate(left, right, fraction, "exitVelocityMps"),
    exitPressurePa = interpolate(left, right, fraction, "exitPressurePa"),
    momentumThrustN = massFlowKgS * exitVelocityMps,
    pressureThrustN = (exitPressurePa - ambient) * contract.exitAreaM2,
    thrustN = Math.max(0, momentumThrustN + pressureThrustN),
    chemicalInputW = massFlowKgS * contract.specificAvailableEnergyJkg,
    exhaustKineticW = 0.5 * massFlowKgS * exitVelocityMps ** 2,
    pressureWorkW = Math.max(0, pressureThrustN) * exitVelocityMps,
    thermalLossW = chemicalInputW * contract.thermalLossFraction,
    rawResidualW =
      chemicalInputW - exhaustKineticW - pressureWorkW - thermalLossW,
    toleranceW = Math.max(1e-6, chemicalInputW * 1e-10);
  if (rawResidualW < -toleranceW)
    throw new DomainValidationError(
      "PRESSURE_NOZZLE_RUNTIME_ENERGY_DEFICIT",
      "Interpolated pressure-nozzle state exceeds delivered chemical energy",
      {
        details: {
          flowFraction,
          chemicalInputW,
          exhaustKineticW,
          pressureWorkW,
          thermalLossW,
          residualW: rawResidualW,
        },
      },
    );
  const residualW = Math.max(0, rawResidualW);
  return immutableClone({
    massFlowKgS,
    flowFraction,
    exitVelocityMps,
    exitPressurePa,
    momentumThrustN,
    pressureThrustN,
    thrustN,
    chemicalInputW,
    exhaustKineticW,
    pressureWorkW,
    thermalLossW,
    residualW,
  });
}
