import {
  DomainValidationError,
  deepFreeze,
  finiteScale3,
  immutableClone,
} from "./primitives.js";

export const ROTOR_AERODYNAMIC_PROFILES = deepFreeze({
  "utility-fixed-pitch-v1": {
    liftSlopePerRad: 5.7,
    maximumLiftCoefficient: 1.25,
    zeroLiftDragCoefficient: 0.012,
    inducedDragFactor: 0.018,
  },
});

function positive(value, field, partId) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      `${field} must be finite and positive`,
      { path: ["parts", partId, "config", field] },
    );
  return number;
}

export function validateRotorConfig(
  config,
  scale = { x: 1, y: 1, z: 1 },
  partId = null,
) {
  const normalizedScale = finiteScale3(scale);
  if (normalizedScale.some((value) => value !== 1))
    throw new DomainValidationError(
      "ROTOR_REQUIRES_IDENTITY_SCALE",
      "Rotor v1 requires portable scale { x: 1, y: 1, z: 1 }",
      { path: ["parts", partId, "scale"] },
    );
  const result = {
    mass: positive(config?.mass, "mass", partId),
    hubRadiusM: positive(config?.hubRadiusM, "hubRadiusM", partId),
    hubThicknessM: positive(config?.hubThicknessM, "hubThicknessM", partId),
    radiusM: positive(config?.radiusM, "radiusM", partId),
    bladeCount: Number(config?.bladeCount),
    bladeChordM: positive(config?.bladeChordM, "bladeChordM", partId),
    fixedPitchDeg: Number(config?.fixedPitchDeg),
    handedness: Number(config?.handedness),
    profileId: String(config?.profileId || ""),
    ratedRpm: positive(config?.ratedRpm, "ratedRpm", partId),
    maximumRpm: positive(config?.maximumRpm, "maximumRpm", partId),
  };
  if (
    !Number.isSafeInteger(result.bladeCount) ||
    result.bladeCount < 2 ||
    result.bladeCount > 8
  )
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "bladeCount must be an integer from 2 through 8",
      { path: ["parts", partId, "config", "bladeCount"] },
    );
  if (
    !Number.isFinite(result.fixedPitchDeg) ||
    result.fixedPitchDeg < 2 ||
    result.fixedPitchDeg > 35
  )
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "fixedPitchDeg must be between 2 and 35 degrees",
      { path: ["parts", partId, "config", "fixedPitchDeg"] },
    );
  if (![1, -1].includes(result.handedness))
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "handedness must be exactly -1 or 1",
      { path: ["parts", partId, "config", "handedness"] },
    );
  if (!Object.hasOwn(ROTOR_AERODYNAMIC_PROFILES, result.profileId))
    throw new DomainValidationError(
      "UNKNOWN_ROTOR_PROFILE",
      `Unknown rotor profile ${result.profileId}`,
      { path: ["parts", partId, "config", "profileId"] },
    );
  if (result.hubRadiusM >= result.radiusM)
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "hubRadiusM must be smaller than radiusM",
      { path: ["parts", partId, "config", "hubRadiusM"] },
    );
  if (result.bladeChordM >= result.radiusM - result.hubRadiusM)
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "bladeChordM must be smaller than the blade span",
      { path: ["parts", partId, "config", "bladeChordM"] },
    );
  if (result.ratedRpm > result.maximumRpm)
    throw new DomainValidationError(
      "INVALID_ROTOR_CONFIG",
      "ratedRpm may not exceed maximumRpm",
      { path: ["parts", partId, "config", "ratedRpm"] },
    );
  return immutableClone(result);
}

export function rotorAerodynamicContract(part, definition, geometry) {
  const descriptor = definition.flight?.propulsion;
  if (!descriptor) return null;
  if (descriptor.kind !== "shaft-rotor-aerodynamics-v1")
    throw new DomainValidationError(
      "UNKNOWN_PROPULSION_CONTRACT",
      `Unknown propulsion contract ${String(descriptor.kind)}`,
      { path: ["parts", part.id, "propulsion", "kind"] },
    );
  const hubOnlyCollision = geometry?.collisionPrimitives?.some(
    ({ approximationOf }) =>
      approximationOf === "rotor-blade-contact-unsupported-v1",
  );
  if (!hubOnlyCollision)
    throw new DomainValidationError(
      "INVALID_ROTOR_GEOMETRY",
      "Rotor geometry must explicitly declare its blade-contact approximation",
      { path: ["parts", part.id, "geometry", "collisionPrimitives"] },
    );
  const config = validateRotorConfig(part.config, part.scale, part.id);
  return immutableClone({
    kind: descriptor.kind,
    localAxis: [...descriptor.localAxis],
    applicationPointPartM: [0, 0, 0],
    bladeContactModel: "unsupported-v1",
    ...config,
  });
}

function bladeLoads(
  contract,
  density,
  angularSpeed,
  axialInflow,
  inducedVelocity,
) {
  const profile = ROTOR_AERODYNAMIC_PROFILES[contract.profileId],
    direction = Math.sign(angularSpeed * contract.handedness) || 1,
    omega = Math.abs(angularSpeed),
    pitch = (contract.fixedPitchDeg * Math.PI * direction) / 180,
    segments = 16,
    span = contract.radiusM - contract.hubRadiusM,
    width = span / segments;
  let thrustN = 0,
    torqueNm = 0;
  for (let index = 0; index < segments; index++) {
    const radius = contract.hubRadiusM + (index + 0.5) * width,
      tangentialMps = omega * radius,
      axialMps = axialInflow + inducedVelocity,
      relativeSpeedSquared = tangentialMps ** 2 + axialMps ** 2,
      inflowAngle = Math.atan2(axialMps, Math.max(1e-9, tangentialMps)),
      alpha = pitch - inflowAngle,
      liftCoefficient = Math.max(
        -profile.maximumLiftCoefficient,
        Math.min(
          profile.maximumLiftCoefficient,
          profile.liftSlopePerRad * alpha,
        ),
      ),
      dragCoefficient =
        profile.zeroLiftDragCoefficient +
        profile.inducedDragFactor * liftCoefficient ** 2,
      dynamicStrip =
        0.5 *
        density *
        relativeSpeedSquared *
        contract.bladeChordM *
        width *
        contract.bladeCount,
      liftN = dynamicStrip * liftCoefficient,
      dragN = dynamicStrip * dragCoefficient;
    thrustN += liftN * Math.cos(inflowAngle) - dragN * Math.sin(inflowAngle);
    torqueNm +=
      radius *
      Math.abs(liftN * Math.sin(inflowAngle) + dragN * Math.cos(inflowAngle));
  }
  return { thrustN, torqueNm };
}

export function rotorAerodynamicPerformance(
  contract,
  { airDensityKgM3, axialInflowMps = 0, angularSpeedRadS },
) {
  const density = Math.max(0, Number(airDensityKgM3) || 0),
    angularSpeed = Number(angularSpeedRadS) || 0,
    rpm = (angularSpeed * 60) / (2 * Math.PI),
    absoluteRpm = Math.abs(rpm),
    tipSpeedMps = Math.abs(angularSpeed) * contract.radiusM,
    tipMach = tipSpeedMps / 340.29;
  if (!density || Math.abs(angularSpeed) <= 1e-9)
    return immutableClone({
      thrustN: 0,
      aerodynamicTorqueNm: 0,
      aerodynamicPowerW: 0,
      inducedVelocityMps: 0,
      rpm,
      tipMach,
      valid: true,
      reason: "idle",
    });
  if (absoluteRpm > contract.maximumRpm || tipMach > 0.82) {
    const profile = ROTOR_AERODYNAMIC_PROFILES[contract.profileId],
      dragTorqueNm =
        (density *
          contract.bladeCount *
          contract.bladeChordM *
          profile.zeroLiftDragCoefficient *
          contract.radiusM ** 4 *
          angularSpeed ** 2) /
        8;
    return immutableClone({
      thrustN: 0,
      aerodynamicTorqueNm: -Math.sign(angularSpeed) * dragTorqueNm,
      aerodynamicPowerW: dragTorqueNm * Math.abs(angularSpeed),
      inducedVelocityMps: 0,
      rpm,
      tipMach,
      valid: false,
      reason: absoluteRpm > contract.maximumRpm ? "overspeed" : "tip-mach",
    });
  }
  let inducedVelocityMps = 0,
    loads = bladeLoads(
      contract,
      density,
      angularSpeed,
      axialInflowMps,
      inducedVelocityMps,
    );
  const diskAreaM2 = Math.PI * contract.radiusM ** 2;
  for (let iteration = 0; iteration < 12; iteration++) {
    const target =
      Math.sign(loads.thrustN || 1) *
      Math.sqrt(Math.abs(loads.thrustN) / (2 * density * diskAreaM2));
    inducedVelocityMps = inducedVelocityMps * 0.5 + target * 0.5;
    loads = bladeLoads(
      contract,
      density,
      angularSpeed,
      axialInflowMps,
      inducedVelocityMps,
    );
  }
  const aerodynamicTorqueNm =
    -Math.sign(angularSpeed) * Math.abs(loads.torqueNm);
  return immutableClone({
    thrustN: loads.thrustN,
    aerodynamicTorqueNm,
    aerodynamicPowerW: Math.max(0, -aerodynamicTorqueNm * angularSpeed),
    inducedVelocityMps,
    rpm,
    tipMach,
    valid: true,
    reason: "in-envelope",
  });
}
