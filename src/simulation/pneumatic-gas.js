import { DomainValidationError } from "../model/primitives.js";

export const DRY_AIR_MEDIUM_ID = "dry-air-v1";
export const DRY_AIR = Object.freeze({
  mediumId: DRY_AIR_MEDIUM_ID,
  specificGasConstantJPerKgK: 287.05,
  heatCapacityRatio: 1.4,
  constantVolumeHeatCapacityJPerKgK: 717.5,
  constantPressureHeatCapacityJPerKgK: 1_004.55,
});

const EPSILON = 1e-12;
const finitePositive = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new DomainValidationError(
      "INVALID_PNEUMATIC_STATE",
      `${label} must be a finite positive number`,
      { details: { label, value } },
    );
  return number;
};

/** Tire-wide chamber volume for one authored radial-deflection coordinate. */
export function pneumaticChamberVolume(chamber, deflectionM = 0) {
  const deflection = Math.max(0, Number(deflectionM) || 0),
    law = chamber.volumeLaw,
    volume =
      chamber.referenceInternalVolumeM3 -
      law.quadraticVolumeLossM * deflection ** 2 -
      law.cubicVolumeLoss * deflection ** 3;
  return Math.max(chamber.minimumInternalVolumeM3, volume);
}

/** -dV/du, the effective tire-wide pressure area at radial deflection u. */
export function pneumaticEffectiveArea(chamber, deflectionM = 0) {
  const deflection = Math.max(0, Number(deflectionM) || 0),
    law = chamber.volumeLaw;
  return Math.max(
    0,
    2 * law.quadraticVolumeLossM * deflection +
      3 * law.cubicVolumeLoss * deflection ** 2,
  );
}

export function pneumaticEffectiveAreaSlope(chamber, deflectionM = 0) {
  const deflection = Math.max(0, Number(deflectionM) || 0),
    law = chamber.volumeLaw;
  return Math.max(
    0,
    2 * law.quadraticVolumeLossM + 6 * law.cubicVolumeLoss * deflection,
  );
}

export function gasTemperatureK(state) {
  const massKg = finitePositive(state.massKg, "gas mass"),
    internalEnergyJ = finitePositive(state.internalEnergyJ, "gas energy");
  return internalEnergyJ / (massKg * DRY_AIR.constantVolumeHeatCapacityJPerKgK);
}

export function gasAbsolutePressurePa(state, volumeM3) {
  const massKg = finitePositive(state.massKg, "gas mass"),
    temperatureK = gasTemperatureK(state),
    volume = finitePositive(volumeM3, "gas volume");
  return (massKg * DRY_AIR.specificGasConstantJPerKgK * temperatureK) / volume;
}

/** Creates a sealed chamber state from an absolute pressure and temperature. */
export function createPneumaticState({
  absolutePressurePa,
  temperatureK,
  volumeM3,
}) {
  const pressure = finitePositive(absolutePressurePa, "absolute pressure"),
    temperature = finitePositive(temperatureK, "gas temperature"),
    volume = finitePositive(volumeM3, "gas volume"),
    massKg =
      (pressure * volume) / (DRY_AIR.specificGasConstantJPerKgK * temperature);
  return {
    massKg,
    internalEnergyJ:
      massKg * DRY_AIR.constantVolumeHeatCapacityJPerKgK * temperature,
    volumeM3: volume,
  };
}

/**
 * Returns the pressure support and tangent stiffness at one tire-wide
 * deflection. Gas mass and energy remain owned by the pneumatic runtime.
 */
export function pneumaticSupportResponse({
  chamber,
  state,
  ambientPressurePa,
  deflectionM,
}) {
  const volumeM3 = pneumaticChamberVolume(chamber, deflectionM),
    absolutePressurePa = gasAbsolutePressurePa(state, volumeM3),
    gaugePressurePa = absolutePressurePa - Number(ambientPressurePa),
    effectiveAreaM2 = pneumaticEffectiveArea(chamber, deflectionM),
    effectiveAreaSlopeM = pneumaticEffectiveAreaSlope(chamber, deflectionM),
    positiveGaugePa = Math.max(0, gaugePressurePa),
    loadN = positiveGaugePa * effectiveAreaM2,
    tangentStiffnessNPerM =
      positiveGaugePa > 0
        ? positiveGaugePa * effectiveAreaSlopeM +
          (absolutePressurePa * effectiveAreaM2 ** 2) /
            Math.max(EPSILON, volumeM3)
        : 0;
  return {
    volumeM3,
    absolutePressurePa,
    gaugePressurePa,
    temperatureK: gasTemperatureK(state),
    effectiveAreaM2,
    loadN,
    tangentStiffnessNPerM,
  };
}

/** Deterministic static same-load calibration oracle for an authored tire. */
export function solvePneumaticStaticLoad({
  chamber,
  normalModel,
  state,
  ambientPressurePa,
  loadN,
  iterations = 64,
}) {
  const requestedLoadN = Math.max(0, Number(loadN) || 0),
    maximumDeflectionM = finitePositive(
      normalModel.maximumDeflectionM,
      "maximum tire deflection",
    ),
    supportAt = (deflectionM) => {
      const pneumatic = pneumaticSupportResponse({
        chamber,
        state,
        ambientPressurePa,
        deflectionM,
      });
      return {
        ...pneumatic,
        deflectionM,
        carcassLoadN: normalModel.kRadialNPerM * deflectionM,
        totalLoadN: normalModel.kRadialNPerM * deflectionM + pneumatic.loadN,
      };
    };
  let lower = 0,
    upper = maximumDeflectionM;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const midpoint = (lower + upper) / 2;
    if (supportAt(midpoint).totalLoadN < requestedLoadN) lower = midpoint;
    else upper = midpoint;
  }
  const result = supportAt((lower + upper) / 2);
  return {
    ...result,
    requestedLoadN,
    rimClearanceMarginM: maximumDeflectionM - result.deflectionM,
    bottomedOut: result.totalLoadN + 1e-6 < requestedLoadN,
  };
}

/** Energy-derived rolling-loss projection for the completed tire state. */
export function pneumaticRollingLoss({
  rollingResistance,
  normalLoadN,
  deflectionM,
  radiusM,
  surfaceMultiplier = 1,
}) {
  const load = Math.max(0, Number(normalLoadN) || 0),
    radius = finitePositive(radiusM, "tire radius"),
    multiplier = Math.max(0, Number(surfaceMultiplier) || 0),
    hysteresisEnergyPerCycleJ =
      rollingResistance.kind === "deformation-hysteresis-moment-v1"
        ? rollingResistance.lossFractionPerCycle *
          0.5 *
          load *
          Math.max(0, Number(deflectionM) || 0)
        : 0,
    baselineCoefficient =
      rollingResistance.kind === "deformation-hysteresis-moment-v1"
        ? rollingResistance.baselineCoefficient
        : rollingResistance.kind === "load-radius-moment-v1"
          ? rollingResistance.coefficient
          : 0,
    momentNm =
      multiplier *
      (baselineCoefficient * load * radius +
        hysteresisEnergyPerCycleJ / (2 * Math.PI));
  return {
    momentNm,
    hysteresisEnergyPerCycleJ,
    effectiveCoefficient: load > 0 ? momentNm / (load * radius) : 0,
  };
}

/** Isentropic, choked/subsonic dry-air flow through an authored orifice. */
export function compressibleOrificeMassFlowKgS({
  upstreamPressurePa,
  downstreamPressurePa,
  upstreamTemperatureK,
  dischargeCoefficient,
  areaM2,
}) {
  const upstream = finitePositive(upstreamPressurePa, "upstream pressure"),
    downstream = Math.max(0, Number(downstreamPressurePa) || 0),
    temperature = finitePositive(upstreamTemperatureK, "upstream temperature"),
    coefficient = Math.max(0, Number(dischargeCoefficient) || 0),
    area = Math.max(0, Number(areaM2) || 0);
  if (!area || !coefficient || downstream >= upstream) return 0;
  const gamma = DRY_AIR.heatCapacityRatio,
    gasConstant = DRY_AIR.specificGasConstantJPerKgK,
    pressureRatio = downstream / upstream,
    criticalRatio = (2 / (gamma + 1)) ** (gamma / (gamma - 1)),
    flowFactor =
      pressureRatio <= criticalRatio
        ? Math.sqrt(
            (gamma / (gasConstant * temperature)) *
              (2 / (gamma + 1)) ** ((gamma + 1) / (gamma - 1)),
          )
        : Math.sqrt(
            ((2 * gamma) / (gasConstant * temperature * (gamma - 1))) *
              (pressureRatio ** (2 / gamma) -
                pressureRatio ** ((gamma + 1) / gamma)),
          );
  return coefficient * area * upstream * flowFactor;
}
