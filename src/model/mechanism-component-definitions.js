import { deepFreeze, immutableClone } from "./primitives.js";

const IDENTITY_ORIENTATION = Object.freeze([0, 0, 0, 1]);

const frame = (positionM = [0, 0, 0]) => ({
  positionM,
  orientation: [...IDENTITY_ORIENTATION],
});

const perfectlyInelastic = () => ({ kind: "perfectly-inelastic-v1" });

function boxMassSource(massKg, fullSizeM) {
  const [x, y, z] = fullSizeM;
  return {
    kind: "explicit-tensor-v1",
    massKg,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: (massKg * (y ** 2 + z ** 2)) / 12,
      yy: (massKg * (x ** 2 + z ** 2)) / 12,
      zz: (massKg * (x ** 2 + y ** 2)) / 12,
      xy: 0,
      xz: 0,
      yz: 0,
    },
  };
}

function cylinderMassSource(massKg, radiusM, axialLengthM) {
  const transverse = (massKg * (3 * radiusM ** 2 + axialLengthM ** 2)) / 12;
  return {
    kind: "explicit-tensor-v1",
    massKg,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: transverse,
      yy: transverse,
      zz: (massKg * radiusM ** 2) / 2,
      xy: 0,
      xz: 0,
      yz: 0,
    },
  };
}

function structureRegion(key, geometry, materialKey, localFramePart = frame()) {
  return {
    key,
    localFramePart,
    geometry,
    materialKey,
    contactRole: "structure",
  };
}

function boxComponent(componentType, massKg, fullSizeM, config, materialKey) {
  return {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType,
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: boxMassSource(massKg, fullSizeM),
    collisionRegions: [
      structureRegion("housing", { kind: "box-v1", fullSizeM }, materialKey),
    ],
    config,
  };
}

function axialCommon(dampingNsPerM, lower, upper, massModel) {
  return {
    endpointPortA: "END_A",
    endpointPortB: "END_B",
    massModel,
    dampingLaw: { kind: "linear-v1", dampingNsPerM },
    lengthRangeM: { lower, upper },
    lowerHardImpactLaw: perfectlyInelastic(),
    upperHardImpactLaw: perfectlyInelastic(),
    lowerStop: null,
    upperStop: null,
    failureLoadLaw: null,
  };
}

function rotaryConfig({ angleRangeRad, viscousNms, actuation = null }) {
  return {
    frameA: frame(),
    frameB: frame(),
    freeAxis: "local-positive-z-v1",
    angleRangeRad,
    lowerHardImpactLaw: angleRangeRad ? perfectlyInelastic() : null,
    upperHardImpactLaw: angleRangeRad ? perfectlyInelastic() : null,
    lowerStop: null,
    upperStop: null,
    friction:
      viscousNms === 0
        ? { kind: "none-v1" }
        : {
            kind: "coulomb-viscous-v1",
            coulombTorqueNm: 0,
            viscousNms,
          },
    actuation,
    failureLoadLaw: null,
  };
}

function rotaryActuation(maximumTorqueNm) {
  return {
    kind: "position-impedance-v1",
    commandRangeRad: { lower: -Math.PI / 2, upper: Math.PI / 2 },
    stiffnessNmPerRad: maximumTorqueNm * 5,
    dampingNmsPerRad: maximumTorqueNm * 0.4,
    maximumTorqueNm,
    maximumSpeedRadPerS: 4,
    powerLaw: {
      maximumMechanicalMotoringPowerW: maximumTorqueNm * 4,
      electricalMotoringEfficiency: 0.92,
      idlePowerW: 4,
      regeneration: "unsupported-dissipate-v1",
    },
    thermalLimits: {
      thermalMassJPerK: 3_000,
      ambientConductanceWPerK: 10,
      derateTemperatureK: 390,
      shutdownTemperatureK: 430,
    },
  };
}

const wheelRadiusM = 0.65,
  wheelWidthM = 0.42,
  wheelShoulderRadiusM = 0.08,
  wheelMassKg = 16,
  wheelGeometry = {
    kind: "rounded-wheel-v1",
    radiusM: wheelRadiusM,
    widthM: wheelWidthM,
    shoulderRadiusM: wheelShoulderRadiusM,
    axis: "local-positive-z-v1",
  };

const definitions = {
  "release-coupler": boxComponent(
    "release-coupler",
    4,
    [0.44, 0.44, 0.2],
    {
      endpointPortA: "FLANGE_A",
      endpointPortB: "FLANGE_B",
      massModel: {
        kind: "lumped-endpoints-v1",
        totalMassKg: 4,
        endpointMassFractionA: 0.5,
      },
      latchFrame: frame(),
      loadLimits: {
        ultimateForceN: 120_000,
        ultimateTorqueNm: 36_000,
      },
      releaseLaw: {
        kind: "electromechanical-latch-v1",
        commandChannel: "release",
        commandThreshold: 0.5,
        actuationEnergyJ: 12,
        maximumElectricalPowerW: 1_440,
      },
    },
    "workshop-steel",
  ),
  spring: boxComponent(
    "spring",
    5,
    [0.42, 0.42, 1.1],
    {
      ...axialCommon(20, 0.2, 2, { kind: "ideal-massless-v1" }),
      referenceLaw: { kind: "zero-force-length-v1", freeLengthM: 1.1 },
      elasticLaw: { kind: "linear-v1", stiffnessNPerM: 80 },
    },
    "workshop-steel",
  ),
  damper: boxComponent(
    "damper",
    6,
    [0.28, 0.28, 1],
    axialCommon(850, 0.2, 1.6, {
      kind: "lumped-endpoints-v1",
      totalMassKg: 6,
      endpointMassFractionA: 0.5,
    }),
    "workshop-steel",
  ),
  "linear-guide": {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType: "linear-guide",
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: {
      kind: "explicit-tensor-v1",
      massKg: 8,
      comPositionPartM: [0, 0, 0],
      inertiaTensorAtComPartKgM2: {
        xx: 0.8016666666666667,
        yy: 1.6010666666666666,
        zz: 1.0694,
        xy: 0,
        xz: 0,
        yz: 0,
      },
    },
    collisionRegions: [-0.34, 0.34].map((offsetM, index) =>
      structureRegion(
        `rail-${index + 1}`,
        { kind: "box-v1", fullSizeM: [0.12, 0.45, 1] },
        "workshop-steel",
        frame([offsetM, 0, 0]),
      ),
    ),
    config: {
      frameA: frame(),
      frameB: frame(),
      freeAxis: "local-positive-z-v1",
      referenceTransform: "authored-coincident-v1",
      referenceCoordinateM: 0.3,
      travelRangeM: { lower: 0, upper: 0.6 },
      lowerHardImpactLaw: perfectlyInelastic(),
      upperHardImpactLaw: perfectlyInelastic(),
      lowerStop: null,
      upperStop: null,
      guideFriction: {
        kind: "coulomb-viscous-v1",
        staticCoefficient: 0.2,
        dynamicCoefficient: 0.15,
        preloadNormalForceN: 0,
        sealDragN: 0,
        viscousNsPerM: 5,
        reengageSpeedMPerS: 0.01,
      },
      failureLoadLaw: null,
    },
  },
  "linear-actuator": boxComponent(
    "linear-actuator",
    12,
    [0.36, 0.36, 1.1],
    {
      ...axialCommon(0, 0.4, 1.4, {
        kind: "lumped-endpoints-v1",
        totalMassKg: 12,
        endpointMassFractionA: 0.5,
      }),
      endpointPortA: "BASE",
      endpointPortB: "ROD",
      positiveDirection: "increasing-coordinate-v1",
      commandLaw: {
        kind: "position-impedance-v1",
        stiffnessNPerM: 12_000,
        dampingNsPerM: 1_200,
      },
      forceSpeedEnvelope: {
        kind: "piecewise-v1",
        points: [
          {
            absSpeedMPerS: 0,
            maxExtendForceN: 8_000,
            maxRetractForceN: 8_000,
          },
          {
            absSpeedMPerS: 1,
            maxExtendForceN: 0,
            maxRetractForceN: 0,
          },
        ],
        interpolation: "linear",
        extrapolation: "zero-capacity",
      },
      powerLaw: {
        maximumMechanicalMotoringPowerW: 4_000,
        electricalMotoringEfficiency: 0.85,
        idlePowerW: 8,
        regeneration: "unsupported-dissipate-v1",
      },
      thermalLimits: {
        thermalMassJPerK: 4_000,
        ambientConductanceWPerK: 12,
        derateTemperatureK: 390,
        shutdownTemperatureK: 430,
      },
      unpoweredLaw: {
        kind: "holding-clutch-v1",
        staticForceCapacityN: 8_000,
        dynamicForceCapacityN: 6_000,
        reengageSpeedMPerS: 0.01,
      },
      failureLoadLaw: null,
    },
    "workshop-steel",
  ),
  hinge: boxComponent(
    "hinge",
    9,
    [0.32, 0.2, 0.18],
    rotaryConfig({
      angleRangeRad: { lower: -Math.PI / 2, upper: Math.PI / 2 },
      viscousNms: 8,
      actuation: rotaryActuation(120),
    }),
    "workshop-steel",
  ),
  bearing: boxComponent(
    "bearing",
    5,
    [0.72, 0.58, 0.34],
    rotaryConfig({ angleRangeRad: null, viscousNms: 0.16, actuation: null }),
    "workshop-steel",
  ),
  axle: {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType: "axle",
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: cylinderMassSource(8, 0.09, 2),
    collisionRegions: [
      structureRegion(
        "shaft",
        {
          kind: "cylinder-v1",
          radiusM: 0.09,
          axialLengthM: 2,
          axis: "local-positive-z-v1",
        },
        "workshop-steel",
      ),
    ],
    config: {
      radiusM: 0.09,
      axialLengthM: 2,
      axis: "local-positive-z-v1",
      materialKey: "workshop-steel",
      failureLoadLaw: null,
    },
  },
  wheel: {
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType: "wheel",
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: cylinderMassSource(
      wheelMassKg,
      wheelRadiusM,
      wheelWidthM,
    ),
    collisionRegions: [
      {
        key: "tire-envelope",
        localFramePart: frame(),
        geometry: wheelGeometry,
        materialKey: "tire-rubber",
        contactRole: "tire-envelope",
      },
      {
        key: "sidewall",
        localFramePart: frame(),
        geometry: {
          kind: "capsule-v1",
          radiusM: wheelShoulderRadiusM,
          straightLengthM: wheelWidthM - 2 * wheelShoulderRadiusM,
          axis: "local-positive-z-v1",
        },
        materialKey: "tire-rubber",
        contactRole: "sidewall",
      },
      {
        key: "rim",
        localFramePart: frame(),
        geometry: {
          kind: "cylinder-v1",
          radiusM: 0.5,
          axialLengthM: 0.34,
          axis: "local-positive-z-v1",
        },
        materialKey: "workshop-aluminum",
        contactRole: "rim",
      },
    ],
    config: {
      axleFrame: frame(),
      radiusM: wheelRadiusM,
      widthM: wheelWidthM,
      shoulderRadiusM: wheelShoulderRadiusM,
      semanticRegionKeys: {
        tireEnvelope: "tire-envelope",
        sidewall: "sidewall",
        rim: "rim",
      },
      tireConstitutiveLaw: {
        kind: "memoryless-brush-v1",
        tireMaterialKey: "tire-rubber",
        calibratedNormalLoadRangeN: { lower: 100, upper: 20_000 },
        creepMatrixByLoad: [
          {
            normalLoadN: 100,
            kLongNsPerM: 1_000,
            kLatNsPerM: 800,
            kCrossNsPerM: 0,
          },
          {
            normalLoadN: 20_000,
            kLongNsPerM: 11_000,
            kLatNsPerM: 11_000,
            kCrossNsPerM: 0,
          },
        ],
        interpolation: "linear",
        outsideCalibration: "clamp-to-endpoints-v1",
        rollingResistance: {
          kind: "load-radius-moment-v1",
          coefficient: 0.015,
          regularizationSpeedMPerS: 0.05,
        },
        normalModel: {
          kind: "radial-foundation-v1",
          kRadialNPerM: 180_000,
          compressionDampingNsPerM: 4_000,
          reboundDampingNsPerM: 4_000,
          maximumDeflectionM: 0.12,
          rimContactStiffnessNPerM: 3_600_000,
          rimContactDampingNsPerM: 16_000,
          progressiveStop: null,
          rimColliderRegionKey: "rim",
        },
        thermalModel: {
          kind: "lumped-capacity-v1",
          thermalMassJPerK: 2_500,
          ambientConductanceWPerK: 8,
          referenceTemperatureK: 293.15,
        },
      },
      rimMaterialKey: "workshop-aluminum",
      failureLoadLaw: null,
    },
  },
};

export const MECHANISM_COMPONENT_TYPES = Object.freeze(
  Object.keys(definitions).sort(),
);

export const MECHANISM_COMPONENT_DEFINITIONS = deepFreeze(definitions);

export function isMechanismComponentType(type) {
  return Object.hasOwn(MECHANISM_COMPONENT_DEFINITIONS, type);
}

export function mechanismComponentDefinition(type) {
  return isMechanismComponentType(type)
    ? immutableClone(MECHANISM_COMPONENT_DEFINITIONS[type])
    : null;
}
