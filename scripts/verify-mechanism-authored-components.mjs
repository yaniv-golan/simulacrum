import assert from "node:assert/strict";
import fs from "node:fs";
import { TYPES } from "../src/model/component-catalog.js";
import { validateMechanismAuthoredComponentWire } from "../src/model/generated/portable-machine-wire-validators.js";
import {
  decodeMechanismAuthoredComponent,
  decodeMechanismAuthoredComponentOrThrow,
  encodeMechanismAuthoredComponent,
  fingerprintMechanismAuthoredComponent,
} from "../src/model/mechanism-authored-components.js";
import {
  MECHANISM_COMPONENT_DEFINITIONS,
  MECHANISM_COMPONENT_TYPES,
  mechanismComponentDefinition,
} from "../src/model/mechanism-component-definitions.js";
import { stableStringify } from "../src/model/primitives.js";

const fixture = JSON.parse(
    fs.readFileSync(
      "test/fixtures/mechanism-physics/mechanism-authored-component-contracts.json",
      "utf8",
    ),
  ),
  identityQuaternion = [0, 0, 0, 1],
  frame = () => ({ positionM: [0, 0, 0], orientation: identityQuaternion }),
  impact = () => ({ kind: "perfectly-inelastic-v1" }),
  damping = () => ({
    kind: "piecewise-speed-v1",
    compressionPoints: [
      { speedMPerS: 0, forceN: 0 },
      { speedMPerS: 1, forceN: 100 },
    ],
    reboundPoints: [
      { speedMPerS: 0, forceN: 0 },
      { speedMPerS: 1, forceN: 80 },
    ],
    interpolation: "linear",
    extrapolation: "reject",
  }),
  commonAxial = () => ({
    endpointPortA: "END_A",
    endpointPortB: "END_B",
    dampingLaw: damping(),
    lengthRangeM: { lower: 0.1, upper: 1 },
    lowerHardImpactLaw: impact(),
    upperHardImpactLaw: {
      kind: "restitution-v1",
      restitutionCoefficient: 0.1,
    },
    lowerStop: null,
    upperStop: null,
    failureLoadLaw: null,
  }),
  massPropertySource = () => ({
    kind: "explicit-tensor-v1",
    massKg: 1,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: 1,
      yy: 1,
      zz: 1,
      xy: 0,
      xz: 0,
      yz: 0,
    },
  }),
  base = (componentType, config) => ({
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    componentType,
    dimensionalScalingPolicy: { kind: "fixed-authored-size-v1" },
    massPropertySource: massPropertySource(),
    collisionRegions: [],
    config,
  });

const rotaryConfig = () => ({
    frameA: frame(),
    frameB: frame(),
    freeAxis: "local-positive-z-v1",
    angleRangeRad: { lower: -1, upper: 1 },
    lowerHardImpactLaw: impact(),
    upperHardImpactLaw: impact(),
    lowerStop: null,
    upperStop: null,
    friction: { kind: "none-v1" },
    actuation: null,
    failureLoadLaw: null,
  }),
  wheelGeometry = {
    kind: "rounded-wheel-v1",
    radiusM: 0.3,
    widthM: 0.2,
    shoulderRadiusM: 0.04,
    axis: "local-positive-z-v1",
  },
  wheelRegion = (key, contactRole, geometry = wheelGeometry) => ({
    key,
    localFramePart: frame(),
    geometry,
    materialKey: contactRole === "rim" ? "aluminum" : "rubber",
    contactRole,
  });

const components = {
  spring: base("spring", {
    ...commonAxial(),
    referenceLaw: { kind: "zero-force-length-v1", freeLengthM: 0.5 },
    elasticLaw: {
      kind: "piecewise-force-v1",
      points: [
        { displacementM: -0.2, forceN: -200 },
        { displacementM: 0, forceN: 0 },
        { displacementM: 0.2, forceN: 200 },
      ],
      interpolation: "linear",
      extrapolation: "reject",
    },
    massModel: { kind: "ideal-massless-v1" },
  }),
  damper: base("damper", {
    ...commonAxial(),
    massModel: {
      kind: "lumped-endpoints-v1",
      totalMassKg: 6,
      endpointMassFractionA: 0.5,
    },
  }),
  "release-coupler": base("release-coupler", {
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
  }),
  "linear-guide": base("linear-guide", {
    frameA: frame(),
    frameB: frame(),
    freeAxis: "local-positive-z-v1",
    referenceTransform: "authored-coincident-v1",
    referenceCoordinateM: 0.25,
    travelRangeM: { lower: 0, upper: 0.5 },
    lowerHardImpactLaw: impact(),
    upperHardImpactLaw: impact(),
    lowerStop: null,
    upperStop: null,
    guideFriction: {
      kind: "coulomb-viscous-v1",
      staticCoefficient: 0.3,
      dynamicCoefficient: 0.2,
      preloadNormalForceN: 10,
      sealDragN: 1,
      viscousNsPerM: 2,
      reengageSpeedMPerS: 0.01,
    },
    failureLoadLaw: null,
  }),
  "linear-actuator": base("linear-actuator", {
    ...commonAxial(),
    endpointPortA: "BASE",
    endpointPortB: "ROD",
    massModel: {
      kind: "lumped-endpoints-v1",
      totalMassKg: 6,
      endpointMassFractionA: 0.5,
    },
    positiveDirection: "increasing-coordinate-v1",
    commandLaw: {
      kind: "position-impedance-v1",
      stiffnessNPerM: 1000,
      dampingNsPerM: 50,
    },
    forceSpeedEnvelope: {
      kind: "piecewise-v1",
      points: [
        { absSpeedMPerS: 0, maxExtendForceN: 1000, maxRetractForceN: 1000 },
        { absSpeedMPerS: 1, maxExtendForceN: 0, maxRetractForceN: 0 },
      ],
      interpolation: "linear",
      extrapolation: "zero-capacity",
    },
    powerLaw: {
      maximumMechanicalMotoringPowerW: 1000,
      electricalMotoringEfficiency: 0.8,
      idlePowerW: 5,
      regeneration: "unsupported-dissipate-v1",
    },
    thermalLimits: {
      thermalMassJPerK: 1000,
      ambientConductanceWPerK: 10,
      derateTemperatureK: 400,
      shutdownTemperatureK: 450,
    },
    unpoweredLaw: {
      kind: "holding-clutch-v1",
      staticForceCapacityN: 1000,
      dynamicForceCapacityN: 800,
      reengageSpeedMPerS: 0.01,
    },
    failureLoadLaw: null,
  }),
  hinge: base("hinge", rotaryConfig()),
  bearing: base("bearing", { ...rotaryConfig(), angleRangeRad: null }),
  axle: base("axle", {
    radiusM: 0.02,
    axialLengthM: 0.5,
    axis: "local-positive-z-v1",
    materialKey: "steel",
    failureLoadLaw: null,
  }),
  wheel: {
    ...base("wheel", {
      axleFrame: frame(),
      radiusM: 0.3,
      widthM: 0.2,
      shoulderRadiusM: 0.04,
      semanticRegionKeys: {
        tireEnvelope: "tire-envelope",
        sidewall: "sidewall",
        rim: "rim",
      },
      tireConstitutiveLaw: {
        kind: "memoryless-brush-v1",
        tireMaterialKey: "rubber",
        calibratedNormalLoadRangeN: { lower: 100, upper: 10000 },
        creepMatrixByLoad: [
          {
            normalLoadN: 100,
            kLongNsPerM: 1000,
            kLatNsPerM: 800,
            kCrossNsPerM: 0,
          },
          {
            normalLoadN: 10000,
            kLongNsPerM: 5000,
            kLatNsPerM: 4000,
            kCrossNsPerM: 0,
          },
        ],
        interpolation: "linear",
        outsideCalibration: "clamp-to-endpoints-v1",
        rollingResistance: {
          kind: "load-radius-moment-v1",
          coefficient: 0.01,
          regularizationSpeedMPerS: 0.01,
        },
        normalModel: {
          kind: "radial-foundation-v1",
          kRadialNPerM: 200000,
          compressionDampingNsPerM: 2000,
          reboundDampingNsPerM: 1500,
          maximumDeflectionM: 0.05,
          rimContactStiffnessNPerM: 4_000_000,
          rimContactDampingNsPerM: 10_000,
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
      rimMaterialKey: "aluminum",
      failureLoadLaw: null,
    }),
    collisionRegions: [
      wheelRegion("tire-envelope", "tire-envelope"),
      wheelRegion("sidewall", "sidewall", {
        kind: "capsule-v1",
        radiusM: 0.04,
        straightLengthM: 0.12,
        axis: "local-positive-z-v1",
      }),
      wheelRegion("rim", "rim", {
        kind: "cylinder-v1",
        radiusM: 0.2,
        axialLengthM: 0.18,
        axis: "local-positive-z-v1",
      }),
    ],
  },
};

assert.deepEqual(Object.keys(components).sort(), fixture.componentTypes.sort());
assert.deepEqual(MECHANISM_COMPONENT_TYPES, fixture.componentTypes.sort());
for (const [componentType, definition] of Object.entries(
  MECHANISM_COMPONENT_DEFINITIONS,
)) {
  const decoded = decodeMechanismAuthoredComponent(definition);
  assert.equal(decoded.ok, true, `catalog ${componentType}`);
  assert.deepEqual(mechanismComponentDefinition(componentType), definition);
  if (Object.hasOwn(TYPES, componentType))
    assert.deepEqual(TYPES[componentType].mechanism, definition);
}
assert.equal(mechanismComponentDefinition("beam"), null);
for (const [componentType, component] of Object.entries(components)) {
  assert.equal(
    validateMechanismAuthoredComponentWire(component),
    true,
    `${componentType}: ${JSON.stringify(validateMechanismAuthoredComponentWire.errors)}`,
  );
  const decoded = decodeMechanismAuthoredComponent(component);
  assert.equal(decoded.ok, true, componentType);
  assert.deepEqual(decoded.value.wire, component);
  assert.equal(
    encodeMechanismAuthoredComponent(component),
    stableStringify(component),
  );
  assert.match(
    fingerprintMechanismAuthoredComponent(component),
    /^sim-sha256-[0-9a-f]{64}$/,
  );
  assert.deepEqual(
    decodeMechanismAuthoredComponentOrThrow(JSON.stringify(component)).wire,
    component,
  );
}

function mutate(candidate, testCase) {
  let parent = candidate;
  for (const segment of testCase.path.slice(0, -1)) parent = parent[segment];
  const key = testCase.path.at(-1),
    target = parent[key];
  if (testCase.operation === "remove-last") target.pop();
  else parent[key] = structuredClone(testCase.value);
}

for (const testCase of fixture.negativeCases) {
  const candidate = structuredClone(components[testCase.componentType]);
  mutate(candidate, testCase);
  const result = decodeMechanismAuthoredComponent(candidate);
  assert.equal(result.ok, false, testCase.id);
  assert.equal(result.errors[0].code, testCase.expected, testCase.id);
}

const missingScalingPolicy = structuredClone(components.axle);
delete missingScalingPolicy.dimensionalScalingPolicy;
assert.equal(
  decodeMechanismAuthoredComponent(missingScalingPolicy).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);

function expectCode(candidate, code) {
  const result = decodeMechanismAuthoredComponent(candidate);
  assert.equal(result.ok, false, code);
  assert.equal(result.errors[0].code, code);
}

const underCapacityTire = structuredClone(components.wheel);
underCapacityTire.config.tireConstitutiveLaw.normalModel.kRadialNPerM = 100_000;
expectCode(underCapacityTire, "TIRE_LOAD_RANGE_EXCEEDS_CARCASS_CAPACITY");

const mismatchedTireCalibration = structuredClone(components.wheel);
mismatchedTireCalibration.config.tireConstitutiveLaw.creepMatrixByLoad[0].normalLoadN = 99;
expectCode(mismatchedTireCalibration, "TIRE_CALIBRATION_ENDPOINT_MISMATCH");

const outOfRangeGuideReference = structuredClone(components["linear-guide"]);
outOfRangeGuideReference.config.referenceCoordinateM = 0.6;
expectCode(outOfRangeGuideReference, "REFERENCE_COORDINATE_OUTSIDE_RANGE");

const instanceBoundActuator = structuredClone(components["linear-actuator"]);
instanceBoundActuator.config.coordinate = {
  kind: "guide-coordinate-v1",
  guidePartId: 1,
};
expectCode(instanceBoundActuator, "WIRE_SCHEMA_VIOLATION");

function withTensor(tensor) {
  const candidate = structuredClone(components.spring);
  Object.assign(
    candidate.massPropertySource.inertiaTensorAtComPartKgM2,
    tensor,
  );
  return candidate;
}

assert.equal(
  decodeMechanismAuthoredComponent(
    withTensor({ xx: 2, yy: 2.5, zz: 3, xy: 0.2, xz: -0.1, yz: 0.3 }),
  ).ok,
  true,
);
for (const tensor of [
  { xx: 3, yy: 1, zz: 1, xy: 0, xz: 0, yz: 0 },
  { xx: 1, yy: 3, zz: 1, xy: 0, xz: 0, yz: 0 },
  { xx: 2, yy: 2, zz: 2, xy: 1.5, xz: 0, yz: 0 },
  { xx: 2, yy: 2, zz: 2, xy: 0, xz: 1.5, yz: 0 },
  { xx: 2, yy: 2, zz: 2, xy: 0, xz: 0, yz: 1.5 },
  { xx: 2, yy: 2, zz: 2, xy: -0.9, xz: -0.9, yz: 0.9 },
])
  expectCode(withTensor(tensor), "PHYSICALLY_UNREALIZABLE_INERTIA");
expectCode(
  withTensor({ xx: 1, yy: 1, zz: 1, xy: 0.9, xz: 0.9, yz: -0.9 }),
  "NON_POSITIVE_DEFINITE_INERTIA",
);

const duplicateRegionWheel = structuredClone(components.wheel);
duplicateRegionWheel.collisionRegions[1].key = "tire-envelope";
expectCode(duplicateRegionWheel, "DUPLICATE_COLLISION_REGION_KEY");

for (const failureLoadLaw of [
  {
    kind: "generalized-load-v1",
    continuousLoad: {
      breakForceN: 100,
      breakTorqueNm: null,
      responseTimeS: 0.1,
    },
    impactLoad: null,
  },
  {
    kind: "generalized-load-v1",
    continuousLoad: {
      breakForceN: null,
      breakTorqueNm: 100,
      responseTimeS: 0.1,
    },
    impactLoad: null,
  },
  {
    kind: "generalized-load-v1",
    continuousLoad: null,
    impactLoad: { breakImpulseNs: 10, breakAngularImpulseNms: null },
  },
  {
    kind: "generalized-load-v1",
    continuousLoad: null,
    impactLoad: { breakImpulseNs: null, breakAngularImpulseNms: 10 },
  },
]) {
  const candidate = structuredClone(components.axle);
  candidate.config.failureLoadLaw = failureLoadLaw;
  assert.equal(decodeMechanismAuthoredComponent(candidate).ok, true);
}

const flatElasticSegment = structuredClone(components.spring);
flatElasticSegment.config.elasticLaw.points[1].forceN =
  flatElasticSegment.config.elasticLaw.points[0].forceN;
assert.equal(decodeMechanismAuthoredComponent(flatElasticSegment).ok, true);

const equalFrictionGuide = structuredClone(components["linear-guide"]);
equalFrictionGuide.config.guideFriction.dynamicCoefficient =
  equalFrictionGuide.config.guideFriction.staticCoefficient;
assert.equal(decodeMechanismAuthoredComponent(equalFrictionGuide).ok, true);
const equalClutchActuator = structuredClone(components["linear-actuator"]);
equalClutchActuator.config.unpoweredLaw.dynamicForceCapacityN =
  equalClutchActuator.config.unpoweredLaw.staticForceCapacityN;
assert.equal(decodeMechanismAuthoredComponent(equalClutchActuator).ok, true);
const equalTemperatureActuator = structuredClone(components["linear-actuator"]);
equalTemperatureActuator.config.thermalLimits.derateTemperatureK =
  equalTemperatureActuator.config.thermalLimits.shutdownTemperatureK;
expectCode(equalTemperatureActuator, "INVALID_THERMAL_LIMIT_ORDER");
const semidefiniteTire = structuredClone(components.wheel);
Object.assign(
  semidefiniteTire.config.tireConstitutiveLaw.creepMatrixByLoad[0],
  { kLongNsPerM: 100, kLatNsPerM: 100, kCrossNsPerM: 100 },
);
assert.equal(decodeMechanismAuthoredComponent(semidefiniteTire).ok, true);

const stopLaw = {
  engageCoordinate: 0.2,
  elasticLaw: { kind: "linear-v1", stiffnessNPerM: 1000 },
  dampingLaw: { kind: "linear-v1", dampingNsPerM: 10 },
};
const validStops = structuredClone(components.spring);
validStops.config.lowerStop = structuredClone(stopLaw);
validStops.config.upperStop = {
  ...structuredClone(stopLaw),
  engageCoordinate: 0.8,
};
assert.equal(decodeMechanismAuthoredComponent(validStops).ok, true);
const invalidLowerStop = structuredClone(validStops);
invalidLowerStop.config.lowerStop.engageCoordinate = 0.1;
expectCode(invalidLowerStop, "INVALID_LOWER_STOP_COORDINATE");
const invalidUpperStop = structuredClone(validStops);
invalidUpperStop.config.upperStop.engageCoordinate = 1;
expectCode(invalidUpperStop, "INVALID_UPPER_STOP_COORDINATE");

for (const geometryField of ["widthM", "shoulderRadiusM"]) {
  const mismatch = structuredClone(components.wheel);
  mismatch.collisionRegions[0].geometry[geometryField] *= 0.9;
  expectCode(mismatch, "INVALID_WHEEL_ENVELOPE_GEOMETRY");
}
const oversizedShoulder = structuredClone(components.wheel);
oversizedShoulder.config.shoulderRadiusM = 0.11;
oversizedShoulder.collisionRegions[0].geometry.shoulderRadiusM = 0.11;
expectCode(oversizedShoulder, "INVALID_WHEEL_SHOULDER_GEOMETRY");
const halfWidthShoulder = structuredClone(components.wheel);
halfWidthShoulder.config.shoulderRadiusM = 0.1;
halfWidthShoulder.collisionRegions[0].geometry.shoulderRadiusM = 0.1;
assert.equal(decodeMechanismAuthoredComponent(halfWidthShoulder).ok, true);
const extraWheelRegion = structuredClone(components.wheel);
extraWheelRegion.collisionRegions.push({
  ...structuredClone(extraWheelRegion.collisionRegions[2]),
  key: "hub",
  contactRole: "structure",
});
expectCode(extraWheelRegion, "INVALID_WHEEL_SEMANTIC_REGION_SET");
const invalidRimClearance = structuredClone(components.wheel);
invalidRimClearance.config.tireConstitutiveLaw.normalModel.maximumDeflectionM = 0.11;
expectCode(invalidRimClearance, "INVALID_CARCASS_RIM_CLEARANCE");

const pneumaticWheel = () =>
  structuredClone(MECHANISM_COMPONENT_DEFINITIONS.wheel);
const pneumaticChamber = (wheel) =>
  wheel.config.tireConstitutiveLaw.pneumaticChamber;
const preservePneumaticMassVolume = (wheel) => {
  const chamber = pneumaticChamber(wheel),
    massModel = chamber.massModel;
  massModel.axialSemiAxisM =
    chamber.referenceInternalVolumeM3 /
    (2 * Math.PI ** 2 * massModel.majorRadiusM * massModel.radialSemiAxisM);
};

const collapsedPneumaticRange = pneumaticWheel();
pneumaticChamber(collapsedPneumaticRange).minimumInternalVolumeM3 =
  pneumaticChamber(collapsedPneumaticRange).referenceInternalVolumeM3;
expectCode(collapsedPneumaticRange, "INVALID_PNEUMATIC_CHAMBER_VOLUME_RANGE");

const mismatchedPneumaticMassVolume = pneumaticWheel();
pneumaticChamber(mismatchedPneumaticMassVolume).massModel.axialSemiAxisM *= 0.9;
expectCode(
  mismatchedPneumaticMassVolume,
  "INVALID_PNEUMATIC_GAS_MASS_GEOMETRY",
);

const pneumaticMassInsideRim = pneumaticWheel();
Object.assign(pneumaticChamber(pneumaticMassInsideRim).massModel, {
  majorRadiusM: 0.56,
  radialSemiAxisM: 0.07,
});
preservePneumaticMassVolume(pneumaticMassInsideRim);
expectCode(pneumaticMassInsideRim, "INVALID_PNEUMATIC_GAS_MASS_GEOMETRY");

const pneumaticMassOutsideTire = pneumaticWheel();
Object.assign(pneumaticChamber(pneumaticMassOutsideTire).massModel, {
  majorRadiusM: 0.58,
  radialSemiAxisM: 0.08,
});
preservePneumaticMassVolume(pneumaticMassOutsideTire);
expectCode(pneumaticMassOutsideTire, "INVALID_PNEUMATIC_GAS_MASS_GEOMETRY");

const pneumaticMassOutsideSidewalls = pneumaticWheel();
Object.assign(pneumaticChamber(pneumaticMassOutsideSidewalls).massModel, {
  majorRadiusM: 0.565,
  radialSemiAxisM: 0.06,
});
preservePneumaticMassVolume(pneumaticMassOutsideSidewalls);
expectCode(
  pneumaticMassOutsideSidewalls,
  "INVALID_PNEUMATIC_GAS_MASS_GEOMETRY",
);

const pneumaticVolumeClampsBeforeRim = pneumaticWheel();
pneumaticChamber(
  pneumaticVolumeClampsBeforeRim,
).volumeLaw.quadraticVolumeLossM = 2;
expectCode(
  pneumaticVolumeClampsBeforeRim,
  "PNEUMATIC_CHAMBER_VOLUME_CLAMPS_BEFORE_RIM",
);

const excessiveInitialPneumaticPressure = pneumaticWheel();
pneumaticChamber(excessiveInitialPneumaticPressure).initialColdGaugePressurePa =
  pneumaticChamber(
    excessiveInitialPneumaticPressure,
  ).limits.maximumAbsolutePressurePa;
expectCode(
  excessiveInitialPneumaticPressure,
  "INITIAL_PNEUMATIC_PRESSURE_EXCEEDS_LIMIT",
);

const reversedPneumaticLeakAreas = pneumaticWheel();
pneumaticChamber(reversedPneumaticLeakAreas).damageLaw.burstLeakAreaM2 =
  pneumaticChamber(reversedPneumaticLeakAreas).damageLaw.punctureLeakAreaM2 / 2;
expectCode(reversedPneumaticLeakAreas, "INVALID_PNEUMATIC_DAMAGE_LAW");

const coldPneumaticThermalLimit = pneumaticWheel();
pneumaticChamber(coldPneumaticThermalLimit).damageLaw.maximumGasTemperatureK =
  pneumaticChamber(coldPneumaticThermalLimit).initialGasTemperatureK;
expectCode(coldPneumaticThermalLimit, "INVALID_PNEUMATIC_DAMAGE_LAW");

const reversedPneumaticPressureLimits = pneumaticWheel();
pneumaticChamber(
  reversedPneumaticPressureLimits,
).limits.maximumAbsolutePressurePa = pneumaticChamber(
  reversedPneumaticPressureLimits,
).limits.burstAbsolutePressurePa;
expectCode(
  reversedPneumaticPressureLimits,
  "INVALID_PNEUMATIC_PRESSURE_LIMIT_ORDER",
);

const uniformMassAxle = structuredClone(components.axle);
uniformMassAxle.massPropertySource = {
  kind: "uniform-density-solids-v1",
  densityKgPerM3: 7800,
  massSolids: [
    {
      id: "tetrahedron",
      localFramePart: frame(),
      geometry: {
        kind: "closed-triangle-mesh-v1",
        coordinateExponent10: -3,
        verticesTicks: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        triangleIndices: [
          [0, 2, 1],
          [0, 1, 3],
          [0, 3, 2],
          [1, 2, 3],
        ],
      },
    },
  ],
};
assert.equal(decodeMechanismAuthoredComponent(uniformMassAxle).ok, true);
const openMesh = structuredClone(uniformMassAxle);
openMesh.massPropertySource.massSolids[0].geometry.triangleIndices.pop();
assert.equal(
  decodeMechanismAuthoredComponent(openMesh).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
);
const inconsistentMesh = structuredClone(uniformMassAxle);
inconsistentMesh.massPropertySource.massSolids[0].geometry.triangleIndices[0] =
  [0, 1, 2];
assert.equal(
  decodeMechanismAuthoredComponent(inconsistentMesh).errors[0].code,
  "OPEN_OR_INCONSISTENT_MASS_MESH",
);
const duplicateVertexMesh = structuredClone(uniformMassAxle);
duplicateVertexMesh.massPropertySource.massSolids[0].geometry.verticesTicks[3] =
  [0, 0, 0];
expectCode(duplicateVertexMesh, "DUPLICATE_MESH_VERTEX");
const outOfRangeMesh = structuredClone(uniformMassAxle);
outOfRangeMesh.massPropertySource.massSolids[0].geometry.triangleIndices[0][0] = 99;
expectCode(outOfRangeMesh, "MESH_INDEX_OUT_OF_RANGE");
const degenerateMesh = structuredClone(uniformMassAxle);
degenerateMesh.massPropertySource.massSolids[0].geometry.triangleIndices[0] = [
  0, 0, 1,
];
expectCode(degenerateMesh, "DEGENERATE_MESH_TRIANGLE");
const duplicateSolid = structuredClone(uniformMassAxle);
duplicateSolid.massPropertySource.massSolids.push(
  structuredClone(duplicateSolid.massPropertySource.massSolids[0]),
);
expectCode(duplicateSolid, "DUPLICATE_MASS_SOLID_ID");
const zeroVolumeMesh = structuredClone(uniformMassAxle);
zeroVolumeMesh.massPropertySource.massSolids[0].geometry.verticesTicks[3] = [
  1, 1, 0,
];
expectCode(zeroVolumeMesh, "MASS_MESH_NONPOSITIVE_VOLUME");

assert.throws(
  () => decodeMechanismAuthoredComponentOrThrow(components.wheel.config),
  (error) => error.code === "UNSUPPORTED_MECHANISM_COMPONENT_VERSION",
);

console.log(
  "eight strict authored mechanism component contracts and adversarial physical invariants passed",
);
