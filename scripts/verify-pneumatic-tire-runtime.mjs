import assert from "node:assert/strict";
import {
  AssemblyModel,
  compileAssembly,
  compressibleOrificeMassFlowKgS,
  createPneumaticState,
  deriveDynamicMassProperties,
  DRY_AIR,
  gasAbsolutePressurePa,
  PneumaticNetwork,
  pneumaticChamberVolume,
  pneumaticRollingLoss,
  pneumaticSupportResponse,
  portsCompatible,
  resolveWireComponentConfig,
  RunAssemblyGraph,
  solvePneumaticStaticLoad,
  TYPES,
} from "../src/core/index.js";
import { surfaceFoundationResponse } from "../src/simulation/tire-contact.js";
import {
  pneumaticEffectiveArea,
  pneumaticEffectiveAreaSlope,
} from "../src/simulation/pneumatic-gas.js";
import { stableStringify } from "../src/model/primitives.js";

function assertNear(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} within ${tolerance} of ${expected}`,
  );
}

const wheelMechanism = structuredClone(TYPES.wheel.mechanism),
  chamber = wheelMechanism.config.tireConstitutiveLaw.pneumaticChamber,
  ambientPressurePa = 101_325,
  initialState = createPneumaticState({
    absolutePressurePa: ambientPressurePa + chamber.initialColdGaugePressurePa,
    temperatureK: chamber.initialGasTemperatureK,
    volumeM3: chamber.referenceInternalVolumeM3,
  }),
  compressedVolumeM3 = pneumaticChamberVolume(chamber, 0.08),
  unloaded = pneumaticSupportResponse({
    chamber,
    state: initialState,
    ambientPressurePa,
    deflectionM: 0,
  }),
  loaded = pneumaticSupportResponse({
    chamber,
    state: initialState,
    ambientPressurePa,
    deflectionM: 0.08,
  });

assert.equal(unloaded.volumeM3, chamber.referenceInternalVolumeM3);
assertNear(compressedVolumeM3, 0.1477472);
assertNear(pneumaticEffectiveArea(chamber, 0.08), 0.05888);
assertNear(pneumaticEffectiveAreaSlope(chamber, 0.08), 0.832);
assertNear(loaded.absolutePressurePa, 326_224.4563687163, 1e-9);
assertNear(loaded.gaugePressurePa, 224_899.45636871632, 1e-9);
assertNear(loaded.loadN, 13_242.079990990018, 1e-9);
assertNear(loaded.tangentStiffnessNPerM, 194_771.13027298995, 1e-9);
assert.equal(initialState.massKg, initialState.massKg);
for (const invalidState of [
  { massKg: 0, internalEnergyJ: 1 },
  { massKg: 1, internalEnergyJ: 0 },
])
  assert.throws(
    () => gasAbsolutePressurePa(invalidState, 1),
    /must be a finite positive number/,
  );
assert.throws(
  () => gasAbsolutePressurePa(initialState, 0),
  /gas volume must be a finite positive number/,
);
assert.throws(
  () =>
    createPneumaticState({
      absolutePressurePa: 0,
      temperatureK: 293.15,
      volumeM3: 1,
    }),
  /absolute pressure must be a finite positive number/,
);
const foundationInput = {
    normalModel: wheelMechanism.config.tireConstitutiveLaw.normalModel,
    pneumaticChamber: chamber,
    pneumaticState: initialState,
    ambientPressurePa,
    pair: { foundationStiffnessNPerM: null },
    deflectionM: 0.08,
    normalRateMPerS: 0,
    dt: 1 / 120,
  },
  onePoint = surfaceFoundationResponse({
    ...foundationInput,
    manifoldShare: 1,
  }),
  fourPoint = surfaceFoundationResponse({
    ...foundationInput,
    manifoldShare: 0.25,
  });
assert.ok(onePoint.normalLoadN > 0);
assert.ok(
  Math.abs(onePoint.normalLoadN - fourPoint.normalLoadN * 4) < 1e-9,
  "tire-wide gas support changed with manifold point count",
);

const calibrationPressuresPa = [0, 80_000, 220_000, 400_000],
  staticLoadCases = calibrationPressuresPa.map((gaugePressurePa) => {
    const state = createPneumaticState({
        absolutePressurePa: ambientPressurePa + gaugePressurePa,
        temperatureK: chamber.initialGasTemperatureK,
        volumeM3: chamber.referenceInternalVolumeM3,
      }),
      solved = solvePneumaticStaticLoad({
        chamber,
        normalModel: wheelMechanism.config.tireConstitutiveLaw.normalModel,
        state,
        ambientPressurePa,
        loadN: 5_000,
      }),
      rolling = pneumaticRollingLoss({
        rollingResistance:
          wheelMechanism.config.tireConstitutiveLaw.rollingResistance,
        normalLoadN: 5_000,
        deflectionM: solved.deflectionM,
        radiusM: 0.65,
      });
    return { gaugePressurePa, state, solved, rolling };
  });
for (let index = 1; index < staticLoadCases.length; index++) {
  const lower = staticLoadCases[index - 1],
    higher = staticLoadCases[index];
  assert.ok(higher.state.massKg > lower.state.massKg);
  assert.ok(higher.solved.deflectionM < lower.solved.deflectionM);
  assert.ok(
    higher.solved.rimClearanceMarginM > lower.solved.rimClearanceMarginM,
  );
  assert.ok(
    higher.rolling.hysteresisEnergyPerCycleJ <
      lower.rolling.hysteresisEnergyPerCycleJ,
  );
  assert.ok(
    higher.rolling.effectiveCoefficient < lower.rolling.effectiveCoefficient,
  );
}
assertNear(staticLoadCases[2].solved.deflectionM, 0.026574233744260815);
assertNear(staticLoadCases[2].solved.carcassLoadN, 1_062.9693497704327);
assertNear(staticLoadCases[2].solved.totalLoadN, 5_000);
assert.equal(staticLoadCases[2].solved.bottomedOut, false);
assertNear(
  pneumaticRollingLoss({
    rollingResistance:
      wheelMechanism.config.tireConstitutiveLaw.rollingResistance,
    normalLoadN: 5_000,
    deflectionM: 0.08,
    radiusM: 0.65,
  }).momentNm,
  50.34154943091895,
);
assert.equal(
  pneumaticSupportResponse({
    chamber,
    state: staticLoadCases[0].state,
    ambientPressurePa,
    deflectionM: 0,
  }).loadN,
  0,
  "zero-gauge unloaded tire did not reduce to carcass-only support",
);
assert.equal(
  solvePneumaticStaticLoad({
    chamber,
    normalModel: wheelMechanism.config.tireConstitutiveLaw.normalModel,
    state: staticLoadCases[0].state,
    ambientPressurePa,
    loadN: undefined,
    iterations: 1,
  }).requestedLoadN,
  0,
);
assert.deepEqual(
  pneumaticRollingLoss({
    rollingResistance: { kind: "unsupported-test-law" },
    normalLoadN: 0,
    deflectionM: -1,
    radiusM: 0.65,
    surfaceMultiplier: -1,
  }),
  {
    momentNm: 0,
    hysteresisEnergyPerCycleJ: 0,
    effectiveCoefficient: 0,
  },
);

const choked = compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 400_000,
    downstreamPressurePa: 101_325,
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0.72,
    areaM2: 0.000018,
  }),
  subsonic = compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 120_000,
    downstreamPressurePa: 101_325,
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0.72,
    areaM2: 0.000018,
  });
assert.ok(choked > subsonic && subsonic > 0);
assertNear(choked, 0.012236622089896242);
assertNear(subsonic, 0.0027303822097164967);
assert.equal(
  compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 101_325,
    downstreamPressurePa: 101_325,
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0.72,
    areaM2: 0.000018,
  }),
  0,
);
assert.equal(
  compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 101_325,
    downstreamPressurePa: -1,
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0,
    areaM2: 0.000018,
  }),
  0,
);
const criticalRatio = (2 / 2.4) ** (1.4 / 0.4),
  criticalDownstreamPa = 300_000 * criticalRatio,
  justChoked = compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 300_000,
    downstreamPressurePa: criticalDownstreamPa * (1 - 1e-7),
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0.72,
    areaM2: 0.000018,
  }),
  justSubsonic = compressibleOrificeMassFlowKgS({
    upstreamPressurePa: 300_000,
    downstreamPressurePa: criticalDownstreamPa * (1 + 1e-7),
    upstreamTemperatureK: 293.15,
    dischargeCoefficient: 0.72,
    areaM2: 0.000018,
  });
assert.ok(
  Math.abs(justChoked - justSubsonic) / justChoked < 1e-8,
  "choked/subsonic mass flow is discontinuous",
);

const transform = {
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
  },
  configured = (id, type, pos) => ({
    id,
    type,
    pos,
    ...transform,
    config: resolveWireComponentConfig({ type }),
  }),
  wheel = {
    id: 1,
    type: "wheel",
    pos: [0, 0.65, 0],
    ...transform,
    mechanism: wheelMechanism,
  },
  compressor = configured(2, "aircompressor", [1, 1, 0]),
  valve = configured(3, "pneumaticvalve", [2, 1, 0]),
  sensor = configured(4, "tirepressureprobe", [0, 1.2, 0]),
  connections = [
    {
      id: "compressor-supply",
      kind: "resource",
      a: 2,
      portA: "AIR",
      b: 3,
      portB: "SUPPLY",
      transport: {
        kind: "compressible-gas-v1",
        effectiveOrificeAreaM2: 0.00002,
        dischargeCoefficient: 0.72,
        lineVolumePolicy: { kind: "zero-storage-line-v1" },
        maximumAbsolutePressurePa: 1_000_000,
      },
    },
    {
      id: "valve-tire",
      kind: "resource",
      a: 3,
      portA: "TIRE",
      b: 1,
      portB: "AIR",
      transport: {
        kind: "compressible-gas-v1",
        effectiveOrificeAreaM2: 0.00002,
        dischargeCoefficient: 0.72,
        lineVolumePolicy: { kind: "zero-storage-line-v1" },
        maximumAbsolutePressurePa: 1_000_000,
      },
    },
    {
      id: "pressure-tap",
      kind: "resource",
      a: 4,
      portA: "AIR",
      b: 1,
      portB: "AIR",
      transport: {
        kind: "compressible-gas-v1",
        effectiveOrificeAreaM2: 0.00002,
        dischargeCoefficient: 0.72,
        lineVolumePolicy: { kind: "zero-storage-line-v1" },
        maximumAbsolutePressurePa: 1_000_000,
      },
    },
  ],
  snapshot = {
    parts: [wheel, compressor, valve, sensor],
    connections,
  },
  model = new AssemblyModel(snapshot),
  compiled = compileAssembly(model.snapshot(), TYPES),
  runGraph = new RunAssemblyGraph(model.snapshot()),
  gas = new PneumaticNetwork(compiled),
  powerState = { available: true },
  commandState = { conflict: false },
  commands = new Map([
    ["2\0inflate", 1],
    ["3\0position", 1],
  ]),
  context = {
    runGraph,
    commandBus: {
      read(partId, channel, fallback) {
        return {
          value: commands.get(`${partId}\0${channel}`) ?? fallback,
          conflict: commandState.conflict,
        };
      },
    },
    powerNetwork: {
      allocationFor() {
        return { operational: powerState.available };
      },
      isPowered() {
        return powerState.available;
      },
      drawPower(_partId, requestedW) {
        return powerState.available ? requestedW : 0;
      },
    },
  };

const fixedWheel = structuredClone(wheel);
fixedWheel.id = 10;
fixedWheel.mechanism.config.tireConstitutiveLaw.kind = "memoryless-brush-v1";
fixedWheel.mechanism.config.tireConstitutiveLaw.normalModel.kRadialNPerM = 180_000;
delete fixedWheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber;
assert.equal(
  compileAssembly({ parts: [fixedWheel], connections: [] }, TYPES)
    .contactRegions[0].tireConstitutiveLaw.kind,
  "memoryless-brush-v1",
);
const invalidPneumaticWheel = structuredClone(fixedWheel);
invalidPneumaticWheel.mechanism.config.tireConstitutiveLaw.kind =
  "pneumatic-brush-v1";
assert.throws(() =>
  compileAssembly({ parts: [invalidPneumaticWheel], connections: [] }, TYPES),
);

assert.equal(portsCompatible(compressor, "AIR", valve, "SUPPLY", TYPES), true);
assert.equal(portsCompatible(valve, "TIRE", wheel, "AIR", TYPES), true);
assert.equal(
  compiled.bodies.find(({ partId }) => partId === 1).capabilities.pneumatic
    .kind,
  "tire-chamber-v1",
);
assert.equal(
  compiled.bodies.find(({ partId }) => partId === 2).capabilities.pneumatic
    .kind,
  "ambient-air-compressor-v1",
);

const initialMassKg = gas.stateForPart(wheel.id).massKg;
for (let tick = 0; tick < 120; tick++) gas.resolve(context, 1 / 120);
const inflated = gas.stateForPart(wheel.id),
  inflatedTelemetry = gas.telemetry().chambers[0],
  compressorTelemetry = gas
    .telemetry()
    .devices.find((device) => device.partId === compressor.id),
  sensorReading = gas.measurementForPart(sensor.id, runGraph);
assert.ok(inflated.massKg > initialMassKg);
assert.ok(
  inflatedTelemetry.gaugePressurePa > chamber.initialColdGaugePressurePa,
);
assert.equal(sensorReading.chamberPartId, wheel.id);
assert.equal(
  sensorReading.absolutePressurePa,
  inflatedTelemetry.absolutePressurePa,
);
assert.ok(
  compressorTelemetry.compressionWorkJ <=
    compressorTelemetry.deliveredW *
      compressor.config.electricalEfficiency *
      (1 / 120) +
      1e-9,
  "compressor added more compression work than delivered electrical energy",
);
assert.equal(gas.telemetry().sensors[0].valid, true);

const massBeforePowerLossKg = gas.stateForPart(wheel.id).massKg;
powerState.available = false;
for (let tick = 0; tick < 20; tick++) gas.resolve(context, 1 / 120);
const powerLossValve = gas
  .telemetry()
  .devices.find((device) => device.partId === valve.id);
assert.equal(powerLossValve.position, valve.config.failPosition);
assert.equal(powerLossValve.limitingReason, "power-loss");
assert.equal(gas.telemetry().sensors[0].valid, false);
assert.equal(gas.stateForPart(wheel.id).massKg, massBeforePowerLossKg);
powerState.available = true;

commandState.conflict = true;
for (let tick = 0; tick < 20; tick++) gas.resolve(context, 1 / 120);
assert.equal(
  gas.telemetry().devices.find((device) => device.partId === valve.id).position,
  valve.config.failPosition,
);
assert.equal(
  gas.telemetry().devices.find((device) => device.partId === compressor.id)
    .commandConflict,
  true,
);
commandState.conflict = false;

commands.set("2\0inflate", 0);
commands.set("3\0position", 0);
const heldMassKg = gas.stateForPart(wheel.id).massKg;
for (let tick = 0; tick < 120; tick++) gas.resolve(context, 1 / 120);
assert.equal(gas.stateForPart(wheel.id).massKg, heldMassKg);

commands.set("3\0position", -1);
for (let tick = 0; tick < 120; tick++) gas.resolve(context, 1 / 120);
assert.ok(gas.stateForPart(wheel.id).massKg < heldMassKg);
assert.ok(gas.telemetry().chambers[0].massOutKg > 0);

const checkpoint = gas.exportState(),
  restored = new PneumaticNetwork(compiled);
restored.importState(checkpoint);
assert.deepEqual(restored.exportState(), checkpoint);
assert.ok(
  Number.isFinite(
    gasAbsolutePressurePa(
      restored.stateForPart(wheel.id),
      restored.stateForPart(wheel.id).volumeM3,
    ),
  ),
);

const damageModel = new AssemblyModel({ parts: [wheel], connections: [] }),
  damageGraph = new RunAssemblyGraph(damageModel.snapshot()),
  damageNetwork = new PneumaticNetwork(
    compileAssembly(damageModel.snapshot(), TYPES),
  ),
  damageLaw = chamber.damageLaw;
for (let tick = 0; tick < 71; tick++)
  damageNetwork.commitMechanicalState(
    wheel.id,
    {
      deflectionM: 0.14,
      carcassTemperatureK: 293.15,
      rimLoadN: damageLaw.rimLoadThresholdN + 2_000,
      normalLoadN: 0,
      contactRoles: ["rim"],
    },
    1 / 120,
    tick / 120,
  );
assert.equal(damageNetwork.telemetry().chambers[0].failureMode, null);
damageNetwork.commitMechanicalState(
  wheel.id,
  {
    deflectionM: 0.14,
    carcassTemperatureK: 293.15,
    rimLoadN: damageLaw.rimLoadThresholdN + 3_000,
    normalLoadN: 0,
    contactRoles: ["rim"],
  },
  1 / 120,
  72 / 120,
);
const punctured = damageNetwork.telemetry().chambers[0];
assert.equal(punctured.failureMode, "puncture-v1");
assert.equal(punctured.leakAreaM2, damageLaw.punctureLeakAreaM2);
assert.equal(
  damageNetwork.telemetry().newFailureEvents[0].causal.criterion,
  "excess-contact-load-impulse",
);
const massBeforeLeakKg = damageNetwork.stateForPart(wheel.id).massKg;
damageNetwork.resolve({ runGraph: damageGraph, time: 73 / 120 }, 1 / 120);
assert.ok(damageNetwork.stateForPart(wheel.id).massKg < massBeforeLeakKg);
assert.equal(damageNetwork.telemetry().transfers[0].kind, "damage-leak-v1");
const damageCheckpoint = damageNetwork.exportState(),
  damageRestored = new PneumaticNetwork(
    compileAssembly(damageModel.snapshot(), TYPES),
  );
damageRestored.importState(damageCheckpoint);
damageNetwork.resolve({ runGraph: damageGraph, time: 74 / 120 }, 1 / 120);
damageRestored.resolve({ runGraph: damageGraph, time: 74 / 120 }, 1 / 120);
assert.deepEqual(damageRestored.exportState(), damageNetwork.exportState());

const burstNetwork = new PneumaticNetwork(
    compileAssembly(damageModel.snapshot(), TYPES),
  ),
  burstState = burstNetwork.exportState();
burstState.chambers[0].state.internalEnergyJ *= 4;
burstNetwork.importState(burstState);
burstNetwork.resolve({ runGraph: damageGraph, time: 1 }, 1 / 120);
assert.equal(burstNetwork.telemetry().chambers[0].failureMode, "burst-v1");
assert.equal(
  burstNetwork.telemetry().chambers[0].leakAreaM2,
  damageLaw.burstLeakAreaM2,
);

const overtemperatureNetwork = new PneumaticNetwork(
    compileAssembly(damageModel.snapshot(), TYPES),
  ),
  overtemperatureState = overtemperatureNetwork.exportState(),
  overtemperatureChamber = overtemperatureState.chambers[0];
overtemperatureChamber.state.internalEnergyJ =
  overtemperatureChamber.state.massKg *
  DRY_AIR.constantVolumeHeatCapacityJPerKgK *
  (damageLaw.maximumGasTemperatureK + 1);
overtemperatureNetwork.importState(overtemperatureState);
overtemperatureNetwork.resolve({ runGraph: damageGraph, time: 1 }, 1 / 120);
assert.equal(
  overtemperatureNetwork.telemetry().chambers[0].failureMode,
  "chamber-overtemperature-v1",
);
assert.equal(
  overtemperatureNetwork.telemetry().newFailureEvents[0].causal.criterion,
  "gas-temperature-threshold",
);

const highWheel = structuredClone(wheel),
  lowWheel = structuredClone(wheel),
  equalizationTransport = {
    kind: "compressible-gas-v1",
    effectiveOrificeAreaM2: 0.00002,
    dischargeCoefficient: 0.72,
    lineVolumePolicy: { kind: "zero-storage-line-v1" },
    maximumAbsolutePressurePa: 1_000_000,
  };
highWheel.id = 20;
lowWheel.id = 21;
highWheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa = 320_000;
lowWheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa = 80_000;
const equalizer = {
    id: "equalizer",
    a: highWheel.id,
    b: lowWheel.id,
    kind: "resource",
    portA: "AIR",
    portB: "AIR",
    transport: equalizationTransport,
  },
  equalizationSnapshot = {
    parts: [highWheel, lowWheel],
    connections: [equalizer],
  },
  equalizationModel = new AssemblyModel(equalizationSnapshot),
  equalizationCompiled = compileAssembly(equalizationModel.snapshot(), TYPES),
  equalizationGraph = new RunAssemblyGraph(equalizationModel.snapshot()),
  equalization = new PneumaticNetwork(equalizationCompiled),
  beforeHigh = equalization.stateForPart(highWheel.id),
  beforeLow = equalization.stateForPart(lowWheel.id),
  beforeMassKg = beforeHigh.massKg + beforeLow.massKg,
  beforeEnergyJ = beforeHigh.internalEnergyJ + beforeLow.internalEnergyJ;
equalization.resolve({ runGraph: equalizationGraph }, 1 / 120);
const afterHigh = equalization.stateForPart(highWheel.id),
  afterLow = equalization.stateForPart(lowWheel.id),
  transfer = equalization.telemetry().transfers[0];
assert.ok(afterHigh.massKg < beforeHigh.massKg);
assert.ok(afterLow.massKg > beforeLow.massKg);
assertNear(transfer.requestedMassKg, 0.00011934026052755383);
assertNear(transfer.deliveredMassKg, 0.00011934026052755383);
assertNear(transfer.deliveredEnergyJ, 35.14377729170252);
assert.equal(transfer.sourcePartId, highWheel.id);
assert.equal(transfer.destinationPartId, lowWheel.id);
assert.deepEqual(transfer.connectionIds, [equalizer.id]);
assertNear(afterHigh.massKg, beforeHigh.massKg - transfer.deliveredMassKg);
assertNear(afterLow.massKg, beforeLow.massKg + transfer.deliveredMassKg);
assert.ok(
  Math.abs(afterHigh.massKg + afterLow.massKg - beforeMassKg) < 1e-12,
  "passive equalization did not conserve gas mass",
);
assert.ok(
  Math.abs(
    afterHigh.internalEnergyJ + afterLow.internalEnergyJ - beforeEnergyJ,
  ) < 1e-9,
  "passive equalization did not conserve gas energy",
);
assert.ok(
  Math.abs(equalization.telemetry().conservation.massResidualKg) < 1e-12,
);
assert.ok(
  Math.abs(equalization.telemetry().conservation.energyResidualJ) < 1e-9,
);

const reversedHighWheel = structuredClone(lowWheel),
  reversedLowWheel = structuredClone(highWheel);
reversedHighWheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa = 320_000;
reversedLowWheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa = 80_000;
const reversalModel = new AssemblyModel({
    parts: [reversedLowWheel, reversedHighWheel],
    connections: [equalizer],
  }),
  reversal = new PneumaticNetwork(
    compileAssembly(reversalModel.snapshot(), TYPES),
  );
reversal.resolve(
  { runGraph: new RunAssemblyGraph(reversalModel.snapshot()) },
  1 / 120,
);
assert.equal(
  reversal.telemetry().transfers[0].sourcePartId,
  reversedHighWheel.id,
  "flow direction did not reverse with pressure ordering",
);

const permutedEqualizer = {
    ...structuredClone(equalizer),
    a: lowWheel.id,
    b: highWheel.id,
  },
  permutedModel = new AssemblyModel({
    parts: [lowWheel, highWheel],
    connections: [permutedEqualizer],
  }),
  permutedGraph = new RunAssemblyGraph(permutedModel.snapshot()),
  permuted = new PneumaticNetwork(
    compileAssembly(permutedModel.snapshot(), TYPES),
  );
permuted.resolve({ runGraph: permutedGraph }, 1 / 120);
for (const partId of [highWheel.id, lowWheel.id])
  assert.deepEqual(
    permuted.stateForPart(partId),
    equalization.stateForPart(partId),
    "gas transfer changed with part/edge insertion order",
  );

const isolatedMassKg = equalization.stateForPart(highWheel.id).massKg;
equalizationGraph.failConnection(equalizer.id, {
  reason: "test line severed",
  mode: "structural",
});
equalization.resolve({ runGraph: equalizationGraph }, 1 / 120);
assert.equal(equalization.stateForPart(highWheel.id).massKg, isolatedMassKg);
assert.deepEqual(equalization.telemetry().transfers, []);

const weakLine = {
    ...structuredClone(equalizer),
    id: "weak-pressure-line",
    transport: {
      ...structuredClone(equalizationTransport),
      maximumAbsolutePressurePa: 150_000,
    },
  },
  weakLineModel = new AssemblyModel({
    parts: [highWheel, lowWheel],
    connections: [weakLine],
  }),
  weakLineGraph = new RunAssemblyGraph(weakLineModel.snapshot()),
  weakLineNetwork = new PneumaticNetwork(
    compileAssembly(weakLineModel.snapshot(), TYPES),
  );
weakLineNetwork.resolve({ runGraph: weakLineGraph }, 1 / 120);
assert.equal(
  weakLineGraph.connection(weakLine.id).failed,
  false,
  "line pressure failure escaped the structure phase",
);
const lineFailures = weakLineNetwork.commitStructuralFailures({
  runGraph: weakLineGraph,
  time: 1 / 120,
});
assert.equal(weakLineGraph.connection(weakLine.id).failed, true);
assert.equal(
  weakLineGraph.connection(weakLine.id).failureMode,
  "pneumatic-line-overpressure-v1",
);
assert.equal(weakLineGraph.graphRevision, 1);
assert.equal(lineFailures[0].connectionId, weakLine.id);
assert.deepEqual(weakLineNetwork.telemetry().lineFailures, lineFailures);
assert.equal(weakLineNetwork.telemetry().components.length, 0);
const weakLineHighMassKg = weakLineNetwork.stateForPart(highWheel.id).massKg;
weakLineNetwork.resolve({ runGraph: weakLineGraph }, 1 / 120);
assert.equal(
  weakLineNetwork.stateForPart(highWheel.id).massKg,
  weakLineHighMassKg,
  "failed pressure line continued to transport gas",
);

const detachedModel = new AssemblyModel({
    parts: [highWheel, lowWheel],
    connections: [equalizer],
  }),
  detachedGraph = new RunAssemblyGraph(detachedModel.snapshot()),
  detachedNetwork = new PneumaticNetwork(
    compileAssembly(detachedModel.snapshot(), TYPES),
  );
detachedGraph.detachComponent(lowWheel.id, { mode: "test-detachment" });
const detachedHighMassKg = detachedNetwork.stateForPart(highWheel.id).massKg;
detachedNetwork.resolve({ runGraph: detachedGraph }, 1 / 120);
assert.equal(
  detachedNetwork.stateForPart(highWheel.id).massKg,
  detachedHighMassKg,
);
assert.deepEqual(detachedNetwork.telemetry().transfers, []);

assert.throws(
  () =>
    new AssemblyModel({
      parts: [highWheel, lowWheel],
      connections: [{ ...equalizer, transport: undefined }],
    }),
  (error) => error?.code === "RESOURCE_TRANSPORT_MISMATCH",
);
assert.throws(
  () =>
    new AssemblyModel({
      parts: [highWheel, lowWheel],
      connections: [
        { ...equalizer, transport: { kind: "finite-allocation-v1" } },
      ],
    }),
  (error) => error?.code === "RESOURCE_TRANSPORT_MISMATCH",
);

const reservoir = configured(30, "airreservoir", [0, 1, 0]),
  reservoirWheel = structuredClone(wheel),
  reservoirLine = {
    id: "reservoir-line",
    a: reservoir.id,
    b: 31,
    kind: "resource",
    portA: "AIR",
    portB: "AIR",
    transport: structuredClone(equalizationTransport),
  };
reservoirWheel.id = 31;
const reservoirModel = new AssemblyModel({
    parts: [reservoir, reservoirWheel],
    connections: [reservoirLine],
  }),
  reservoirCompiled = compileAssembly(reservoirModel.snapshot(), TYPES),
  reservoirGraph = new RunAssemblyGraph(reservoirModel.snapshot()),
  reservoirNetwork = new PneumaticNetwork(reservoirCompiled),
  reservoirMassBefore = reservoirNetwork.stateForPart(reservoir.id).massKg,
  wheelMassBefore = reservoirNetwork.stateForPart(reservoirWheel.id).massKg,
  reservoirTotalMassBefore = reservoirMassBefore + wheelMassBefore;
assert.equal(
  reservoirCompiled.bodies.find(({ partId }) => partId === reservoir.id)
    .capabilities.pneumatic.kind,
  "ideal-gas-control-volume-v1",
);
const wheelGasContribution = reservoirNetwork.gasMassContributionForPart(
    reservoirWheel.id,
  ),
  wheelBody = reservoirCompiled.bodies.find(
    ({ partId }) => partId === reservoirWheel.id,
  ),
  wheelWithGas = deriveDynamicMassProperties(wheelBody, {
    structuralMassKg: wheelBody.massProperties.massKg,
    additionalMassContributions: [wheelGasContribution],
  });
assert.ok(wheelGasContribution.inertiaTensorAtCenterKgM2.zz > 0);
assert.ok(
  wheelWithGas.massKg > wheelBody.massProperties.massKg,
  "contained gas did not contribute wheel mass",
);
assert.equal(wheelWithGas.volumeM3, wheelBody.massProperties.volumeM3);
assert.doesNotThrow(() => stableStringify(wheelWithGas));
assert.ok(
  wheelWithGas.inertiaTensorAtComPartKgM2.zz >
    wheelBody.massProperties.inertiaTensorAtComPartKgM2.zz,
  "contained toroidal gas did not contribute wheel inertia",
);
reservoirNetwork.resolve({ runGraph: reservoirGraph }, 1 / 120);
assert.ok(
  reservoirNetwork.stateForPart(reservoir.id).massKg < reservoirMassBefore,
);
assert.ok(
  reservoirNetwork.stateForPart(reservoirWheel.id).massKg > wheelMassBefore,
);
assert.ok(
  Math.abs(
    reservoirNetwork.stateForPart(reservoir.id).massKg +
      reservoirNetwork.stateForPart(reservoirWheel.id).massKg -
      reservoirTotalMassBefore,
  ) < 1e-12,
);
const invalidReservoir = structuredClone(reservoir);
invalidReservoir.id = 32;
invalidReservoir.config.maximumAbsolutePressurePa =
  invalidReservoir.config.burstAbsolutePressurePa;
assert.throws(
  () => compileAssembly({ parts: [invalidReservoir], connections: [] }, TYPES),
  (error) => error?.code === "INVALID_PNEUMATIC_CONTROL_VOLUME",
);
const invalidCompressor = structuredClone(compressor);
invalidCompressor.id = 33;
invalidCompressor.config.responseTimeS = 0;
assert.throws(
  () => compileAssembly({ parts: [invalidCompressor], connections: [] }, TYPES),
  (error) => error?.code === "INVALID_PNEUMATIC_COMPRESSOR",
);
const invalidValve = structuredClone(valve);
invalidValve.id = 34;
invalidValve.config.failPosition = 2;
assert.throws(
  () => compileAssembly({ parts: [invalidValve], connections: [] }, TYPES),
  (error) => error?.code === "INVALID_PNEUMATIC_VALVE",
);

const altitudeWheel = structuredClone(wheel);
altitudeWheel.id = 35;
altitudeWheel.pos = [0, 3_000, 0];
const altitudeModel = new AssemblyModel({
    parts: [altitudeWheel],
    connections: [],
  }),
  altitudeNetwork = new PneumaticNetwork(
    compileAssembly(altitudeModel.snapshot(), TYPES),
  ),
  altitudeChamber = altitudeNetwork.telemetry().chambers[0],
  altitudeGraph = new RunAssemblyGraph(altitudeModel.snapshot());
assert.ok(altitudeChamber.ambientPressurePa < ambientPressurePa);
assert.ok(
  Math.abs(
    altitudeChamber.gaugePressurePa - chamber.initialColdGaugePressurePa,
  ) < 1e-6,
);
assert.ok(altitudeChamber.gasMassKg < initialState.massKg);

altitudeNetwork.resolve(
  {
    runGraph: altitudeGraph,
    services: {
      multibodyRuntime: {
        bodyByPart: new Map([[altitudeWheel.id, { position: { y: 5_000 } }]]),
      },
    },
  },
  1 / 120,
);
const dynamicAltitudeCheckpoint = altitudeNetwork.exportState(),
  restoredAltitudeNetwork = new PneumaticNetwork(
    compileAssembly(altitudeModel.snapshot(), TYPES),
  );
assert.notEqual(
  dynamicAltitudeCheckpoint.chambers[0].ambientPressurePa,
  altitudeChamber.ambientPressurePa,
);
restoredAltitudeNetwork.importState(dynamicAltitudeCheckpoint);
assert.deepEqual(
  restoredAltitudeNetwork.exportState(),
  dynamicAltitudeCheckpoint,
  "checkpoint restore must preserve the live altitude-dependent ambient state",
);

console.log(
  `pneumatic tire runtime passed (${Math.round(inflatedTelemetry.gaugePressurePa / 1000)} kPa inflated, ${Math.round(gas.telemetry().chambers[0].gaugePressurePa / 1000)} kPa vented)`,
);
