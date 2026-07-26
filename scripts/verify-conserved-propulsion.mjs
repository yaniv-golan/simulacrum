import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import {
  AssemblyModel,
  MaterialResourceNetwork,
  RunAssemblyGraph,
  TYPES,
  compileAssembly,
  deriveDynamicMassProperties,
  pressureNozzleContract,
  pressureNozzlePerformance,
  resolveWireComponentConfig,
} from "../src/core/index.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import {
  MassPropertyCommitSystem,
  PressureNozzleDemandSystem,
  PressureNozzleForceSystem,
  RigidBodySystem,
  TelemetrySystem,
} from "../src/simulation/systems/index.js";
import {
  MaterialResourceCommitSystem,
  MaterialResourceSystem,
} from "../src/simulation/systems/material-resource-system.js";

const DT = 1 / 120;
const MEDIUM = "hydrogen-peroxide-90-v1";
const IDENTITIES = Object.freeze({
  runConfigurationFingerprint: `sim-sha256-${"a".repeat(64)}`,
  blueprintFingerprint: `sim-sha256-${"b".repeat(64)}`,
  compiledTopologyFingerprint: `sim-sha256-${"c".repeat(64)}`,
});
const transform = Object.freeze({
  orientation: [0, 0, 0, 1],
  scale: { x: 1, y: 1, z: 1 },
});

function part(id, type, pos, config = {}) {
  return {
    id,
    type,
    pos,
    ...transform,
    config: resolveWireComponentConfig({ type, config }),
  };
}

function near(actual, expected, tolerance = 1e-9, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message || "values differ"}: ${actual} vs ${expected}`,
  );
}

const tank = part(1, "propellanttank", [0, 2, 0], {
    capacityKg: 1,
    initialUsableMassKg: 1,
  }),
  engineA = part(2, "rocket", [-1, 0, 0]),
  engineB = part(3, "rocket", [1, 0, 0]),
  feedA = {
    id: "feed-a",
    a: tank.id,
    b: engineA.id,
    kind: "resource",
    portA: "OUTLET",
    portB: "PROPELLANT",
    transport: { kind: "finite-allocation-v1" },
  },
  feedB = { ...feedA, id: "feed-b", b: engineB.id },
  sharedSnapshot = {
    revision: 1,
    parts: [tank, engineA, engineB],
    connections: [feedA, feedB],
  },
  sharedModel = new AssemblyModel(sharedSnapshot),
  sharedCompiled = compileAssembly(sharedModel.snapshot(), TYPES),
  tankDescriptor = sharedCompiled.bodies.find(
    (body) => body.partId === tank.id,
  ),
  engineDescriptor = sharedCompiled.bodies.find(
    (body) => body.partId === engineA.id,
  ),
  nozzle = engineDescriptor.capabilities.propulsion;

assert.equal(sharedCompiled.stats.errorCount, 0);
assert.equal(nozzle.kind, "pressure-nozzle-v1");
assert.equal(nozzle.maximumMassFlowKgS, 24);
const seaLevel = pressureNozzlePerformance(nozzle, 24, 101_325),
  vacuum = pressureNozzlePerformance(nozzle, 24, 0),
  zero = pressureNozzlePerformance(nozzle, 0, 42_000);
near(seaLevel.momentumThrustN, 20_400);
near(seaLevel.pressureThrustN, 3_600);
near(seaLevel.thrustN, 24_000);
near(vacuum.pressureThrustN, 9_679.5);
assert.deepEqual(zero, {
  massFlowKgS: 0,
  flowFraction: 0,
  exitVelocityMps: 0,
  exitPressurePa: 42_000,
  momentumThrustN: 0,
  pressureThrustN: 0,
  thrustN: 0,
  chemicalInputW: 0,
  exhaustKineticW: 0,
  pressureWorkW: 0,
  thermalLossW: 0,
  residualW: 0,
});
near(
  seaLevel.chemicalInputW,
  seaLevel.exhaustKineticW +
    seaLevel.pressureWorkW +
    seaLevel.thermalLossW +
    seaLevel.residualW,
  1e-6,
  "nozzle energy ledger",
);

function invalidNozzle(mutator, expectedCode) {
  const catalog = structuredClone(TYPES),
    candidate = structuredClone(engineA);
  mutator({
    catalog,
    candidate,
    descriptor: catalog.rocket.flight.propulsion,
  });
  assert.throws(
    () =>
      pressureNozzleContract(
        candidate,
        catalog.rocket,
        engineDescriptor.geometry,
        catalog,
      ),
    (error) => error?.code === expectedCode,
    expectedCode,
  );
}

assert.equal(
  pressureNozzleContract(
    part(99, "beam", [0, 0, 0]),
    TYPES.beam,
    compileAssembly(
      {
        revision: 1,
        parts: [part(99, "beam", [0, 0, 0])],
        connections: [],
      },
      TYPES,
    ).bodies[0].geometry,
    TYPES,
  ),
  null,
);
invalidNozzle(
  ({ descriptor }) => (descriptor.kind = "unknown-nozzle"),
  "UNKNOWN_PROPULSION_CONTRACT",
);
invalidNozzle(
  ({ descriptor }) => (descriptor.mediumId = "unknown-medium"),
  "UNKNOWN_MATERIAL_MEDIUM",
);
invalidNozzle(
  ({ candidate }) => (candidate.config.maximumMassFlowKgS = 0),
  "INVALID_PRESSURE_NOZZLE_CONTRACT",
);
invalidNozzle(
  ({ descriptor }) => (descriptor.localAxis = [0, 0, 0]),
  "INVALID_PRESSURE_NOZZLE_AXIS",
);
assert.throws(
  () => pressureNozzleContract(engineA, TYPES.rocket, {}, TYPES),
  (error) => error?.code === "INVALID_PRESSURE_NOZZLE_GEOMETRY",
);
invalidNozzle(
  ({ descriptor }) =>
    (descriptor.ratedCurve = descriptor.ratedCurve.slice(0, 1)),
  "INVALID_PRESSURE_NOZZLE_CURVE",
);
invalidNozzle(
  ({ descriptor }) =>
    (descriptor.ratedCurve[1].flowFraction =
      descriptor.ratedCurve[0].flowFraction),
  "INVALID_PRESSURE_NOZZLE_CURVE",
);
invalidNozzle(
  ({ descriptor }) => (descriptor.ratedCurve.at(-1).flowFraction = 0.9),
  "INVALID_PRESSURE_NOZZLE_CURVE",
);
invalidNozzle(
  ({ descriptor }) => (descriptor.inletPortId = "MOUNT"),
  "INVALID_PRESSURE_NOZZLE_INLET",
);
invalidNozzle(
  ({ candidate }) => (candidate.config.minimumStableThrottle = 0.2),
  "INVALID_PRESSURE_NOZZLE_MINIMUM_THROTTLE",
);
invalidNozzle(
  ({ candidate }) => (candidate.config.thermalLossFraction = 1),
  "INVALID_PRESSURE_NOZZLE_THERMAL_LOSS",
);
invalidNozzle(
  ({ descriptor }) => (descriptor.gimbalRangeRad = Math.PI / 2),
  "INVALID_PRESSURE_NOZZLE_GIMBAL_RANGE",
);
invalidNozzle(({ descriptor }) => {
  descriptor.ratedCurve[0].exitVelocityMps = 10_000;
  descriptor.ratedCurve[1].exitVelocityMps = 11_000;
  descriptor.ratedCurve[2].exitVelocityMps = 12_000;
}, "PRESSURE_NOZZLE_ENERGY_DEFICIT");
const subStable = pressureNozzlePerformance(nozzle, 1, 101_325);
assert.ok(subStable.thrustN > 0 && subStable.flowFraction < 0.15);
const firstRatedPoint = nozzle.ratedCurve[0],
  halfSubStableFlow =
    (nozzle.maximumMassFlowKgS * firstRatedPoint.flowFraction) / 2,
  halfSubStable = pressureNozzlePerformance(nozzle, halfSubStableFlow, 101_325);
near(halfSubStable.flowFraction, firstRatedPoint.flowFraction / 2);
near(halfSubStable.exitVelocityMps, firstRatedPoint.exitVelocityMps / 2);
near(
  halfSubStable.exitPressurePa,
  (101_325 + firstRatedPoint.exitPressurePa) / 2,
);
near(
  halfSubStable.momentumThrustN,
  halfSubStableFlow * halfSubStable.exitVelocityMps,
);
near(
  halfSubStable.pressureThrustN,
  (halfSubStable.exitPressurePa - 101_325) * nozzle.exitAreaM2,
);
const [ratedLeft, ratedRight] = nozzle.ratedCurve,
  middleFraction = (ratedLeft.flowFraction + ratedRight.flowFraction) / 2,
  middleFlow = nozzle.maximumMassFlowKgS * middleFraction,
  middlePerformance = pressureNozzlePerformance(nozzle, middleFlow, 50_000);
near(middlePerformance.flowFraction, middleFraction);
near(
  middlePerformance.exitVelocityMps,
  (ratedLeft.exitVelocityMps + ratedRight.exitVelocityMps) / 2,
);
near(
  middlePerformance.exitPressurePa,
  (ratedLeft.exitPressurePa + ratedRight.exitPressurePa) / 2,
);
near(
  middlePerformance.chemicalInputW,
  middleFlow * nozzle.specificAvailableEnergyJkg,
);
near(
  middlePerformance.exhaustKineticW,
  0.5 * middleFlow * middlePerformance.exitVelocityMps ** 2,
);
near(
  middlePerformance.pressureWorkW,
  Math.max(0, middlePerformance.pressureThrustN) *
    middlePerformance.exitVelocityMps,
);
near(
  middlePerformance.thermalLossW,
  middlePerformance.chemicalInputW * nozzle.thermalLossFraction,
);
near(
  middlePerformance.residualW,
  middlePerformance.chemicalInputW -
    middlePerformance.exhaustKineticW -
    middlePerformance.pressureWorkW -
    middlePerformance.thermalLossW,
  1e-6,
);
assert.throws(
  () =>
    pressureNozzlePerformance(
      { ...nozzle, specificAvailableEnergyJkg: 1, thermalLossFraction: 0 },
      nozzle.maximumMassFlowKgS,
      0,
    ),
  (error) => error?.code === "PRESSURE_NOZZLE_RUNTIME_ENERGY_DEFICIT",
);

const arbitraryCatalog = structuredClone(TYPES);
arbitraryCatalog.rocket.flight.propulsion.localAxis = [1, 2, 3];
const arbitraryCompiled = compileAssembly(
    { revision: 1, parts: [engineA], connections: [] },
    arbitraryCatalog,
  ),
  arbitrary = arbitraryCompiled.bodies[0].capabilities.propulsion,
  dot = (left, right) =>
    left.reduce((sum, value, index) => sum + value * right[index], 0);
near(Math.hypot(...arbitrary.localAxis), 1);
near(Math.hypot(...arbitrary.gimbalAxisX), 1);
near(Math.hypot(...arbitrary.gimbalAxisZ), 1);
near(dot(arbitrary.localAxis, arbitrary.gimbalAxisX), 0);
near(dot(arbitrary.localAxis, arbitrary.gimbalAxisZ), 0);
near(dot(arbitrary.gimbalAxisX, arbitrary.gimbalAxisZ), 0);
assert.ok(
  arbitrary.applicationPointPartM.some((value, axis) => {
    const bounds = arbitraryCompiled.bodies[0].geometry.boundsPartM;
    return (
      Math.abs(value - bounds.minimumM[axis]) <= 1e-12 ||
      Math.abs(value - bounds.maximumM[axis]) <= 1e-12
    );
  }),
  "compiled nozzle application point is not on a body surface",
);

for (const invalidAxis of ["not-an-axis", [1, 2], [1, 2, Number.NaN]])
  invalidNozzle(
    ({ descriptor }) => (descriptor.localAxis = invalidAxis),
    "INVALID_PRESSURE_NOZZLE_AXIS",
  );
invalidNozzle(
  ({ descriptor }) => (descriptor.localAxis = [1e-12, 0, 0]),
  "INVALID_PRESSURE_NOZZLE_AXIS",
);
for (const geometry of [
  { boundsPartM: { minimumM: null, maximumM: [1, 1, 1] } },
  { boundsPartM: { minimumM: [0, 0], maximumM: [1, 1, 1] } },
  { boundsPartM: { minimumM: [-1, -1, -1], maximumM: null } },
  { boundsPartM: { minimumM: [-1, -1, -1], maximumM: [1, 1] } },
])
  assert.throws(
    () => pressureNozzleContract(engineA, TYPES.rocket, geometry, TYPES),
    (error) => error?.code === "INVALID_PRESSURE_NOZZLE_GEOMETRY",
  );
for (const mutateCurve of [
  (curve) => (curve[0].flowFraction = 1.1),
  (curve) => (curve[1].exitVelocityMps = curve[0].exitVelocityMps),
  (curve) => (curve[1].exitPressurePa = curve[0].exitPressurePa),
])
  invalidNozzle(
    ({ descriptor }) => mutateCurve(descriptor.ratedCurve),
    "INVALID_PRESSURE_NOZZLE_CURVE",
  );
invalidNozzle(
  ({ descriptor }) => (descriptor.ratedCurve[0].flowFraction = 0),
  "INVALID_PRESSURE_NOZZLE_CONTRACT",
);
for (const portField of ["kind", "behavior", "direction", "mediumId"])
  invalidNozzle(({ catalog, descriptor }) => {
    const inlet = catalog.rocket.ports.find(
      (port) => port.id === descriptor.inletPortId,
    );
    inlet[portField] = `wrong-${portField}`;
  }, "INVALID_PRESSURE_NOZZLE_INLET");
for (const minimumStableThrottle of [Number.NaN, 0, 1, 0.16])
  invalidNozzle(
    ({ candidate }) =>
      (candidate.config.minimumStableThrottle = minimumStableThrottle),
    "INVALID_PRESSURE_NOZZLE_MINIMUM_THROTTLE",
  );
for (const thermalLossFraction of [Number.NaN, -0.01, 1])
  invalidNozzle(
    ({ candidate }) =>
      (candidate.config.thermalLossFraction = thermalLossFraction),
    "INVALID_PRESSURE_NOZZLE_THERMAL_LOSS",
  );
for (const gimbalRangeRad of [Number.NaN, -0.01, Math.PI / 2])
  invalidNozzle(
    ({ descriptor }) => (descriptor.gimbalRangeRad = gimbalRangeRad),
    "INVALID_PRESSURE_NOZZLE_GIMBAL_RANGE",
  );

function allocateShared(requests) {
  const graph = new RunAssemblyGraph(sharedModel.snapshot()),
    network = new MaterialResourceNetwork(sharedCompiled).resolve(graph),
    allocation = network.allocate(requests, { tick: 7, dt: DT });
  return { graph, network, allocation };
}

const forward = allocateShared([
    { consumerPartId: engineA.id, mediumId: MEDIUM, requestedMassKg: 0.75 },
    { consumerPartId: engineB.id, mediumId: MEDIUM, requestedMassKg: 0.75 },
  ]),
  reverse = allocateShared([
    { consumerPartId: engineB.id, mediumId: MEDIUM, requestedMassKg: 0.75 },
    { consumerPartId: engineA.id, mediumId: MEDIUM, requestedMassKg: 0.75 },
  ]);
assert.deepEqual(forward.allocation, reverse.allocation);
assert.deepEqual(
  forward.allocation.map((record) => record.deliveredMassKg),
  [0.5, 0.5],
);
assert.ok(
  forward.allocation.every(
    (record) =>
      record.tick === 7 &&
      record.dt === DT &&
      record.availabilityFraction === 2 / 3 &&
      record.allocatedChemicalEnergyJ > 0 &&
      record.allocationId.startsWith(record.transactionId),
  ),
);
assert.equal(forward.network.remainingMass(tank.id), 0);
assert.throws(
  () =>
    allocateShared([
      { consumerPartId: engineA.id, mediumId: MEDIUM, requestedMassKg: 0.1 },
      { consumerPartId: engineA.id, mediumId: MEDIUM, requestedMassKg: 0.2 },
    ]),
  (error) => error?.code === "DUPLICATE_MATERIAL_REQUEST",
);
const partitioned = allocateShared([]);
partitioned.graph.failConnection(feedA.id, {
  reason: "conservation fixture partition",
  mode: "structural",
  time: 0,
});
partitioned.network.resolve(partitioned.graph);
const disconnected = partitioned.network.allocate(
  [{ consumerPartId: engineA.id, mediumId: MEDIUM, requestedMassKg: 0.5 }],
  { tick: 8, dt: DT },
)[0];
assert.equal(disconnected.deliveredMassKg, 0);
assert.equal(disconnected.allocatedChemicalEnergyJ, 0);
assert.deepEqual(disconnected.storeDebits, []);
assert.equal(disconnected.reason, "reachable stores empty");

const store = tankDescriptor.capabilities.materialStore,
  dryMass = tankDescriptor.massProperties.massKg,
  halfStore = { ...store, remainingMassKg: store.initialUsableMassKg / 2 },
  dynamic = deriveDynamicMassProperties(tankDescriptor, {
    structuralMassKg: dryMass,
    materialStore: halfStore,
  }),
  bladder = dynamic.dynamicMaterialStore,
  expectedOccupiedLength =
    halfStore.remainingMassKg /
    store.densityKgM3 /
    (store.storageSolid.fullSizeM[0] * store.storageSolid.fullSizeM[2]),
  expectedBladderCenterY =
    store.storageSolid.centerPartM[1] -
    (store.storageSolid.fullSizeM[1] - expectedOccupiedLength) / 2,
  expectedComY =
    (tankDescriptor.massProperties.comPositionPartM[1] * dryMass +
      expectedBladderCenterY * halfStore.remainingMassKg) /
    (dryMass + halfStore.remainingMassKg);
near(bladder.sizeM[1], expectedOccupiedLength);
near(bladder.centerPartM[1], expectedBladderCenterY);
near(dynamic.comPositionPartM[1], expectedComY);
near(dynamic.massKg, dryMass + halfStore.remainingMassKg);
near(dynamic.volumeM3, tankDescriptor.massProperties.volumeM3);
const emptyDynamic = deriveDynamicMassProperties(tankDescriptor, {
  structuralMassKg: dryMass,
  materialStore: { ...store, remainingMassKg: 0 },
});
assert.equal(emptyDynamic.dynamicMaterialStore, null);
assert.throws(
  () =>
    deriveDynamicMassProperties(tankDescriptor, {
      structuralMassKg: dryMass,
      materialStore: {
        ...halfStore,
        storageAxisPart: [0.5, 0.5, 0],
      },
    }),
  (error) => error?.code === "UNSUPPORTED_MATERIAL_STORAGE_AXIS",
);
assert.throws(
  () =>
    deriveDynamicMassProperties(tankDescriptor, {
      structuralMassKg: dryMass,
      materialStore: { ...store, remainingMassKg: store.capacityKg + 1 },
    }),
  (error) => error?.code === "MATERIAL_STORE_MASS_EXCEEDS_CAPACITY",
);

const asymmetricDescriptor = {
    partId: "asymmetric-store",
    massProperties: {
      massKg: 10,
      volumeM3: 2,
      comPositionPartM: [0.3, -0.2, 0.4],
      inertiaTensorAtComPartKgM2: {
        xx: 4,
        yy: 5,
        zz: 6,
        xy: 0.2,
        xz: -0.3,
        yz: 0.4,
      },
      contributingSolidIds: ["dry-solid"],
    },
  },
  asymmetricStore = {
    capacityKg: 8,
    remainingMassKg: 6,
    densityKgM3: 1_000,
    storageAxisPart: [1, 0, 0],
    storageSolid: {
      centerPartM: [0.7, 0.2, -0.5],
      fullSizeM: [0.2, 0.3, 0.4],
    },
  },
  asymmetric = deriveDynamicMassProperties(asymmetricDescriptor, {
    structuralMassKg: 5,
    materialStore: asymmetricStore,
  }),
  asymmetricBladderCenter = [0.775, 0.2, -0.5],
  asymmetricBladderSize = [0.05, 0.3, 0.4],
  asymmetricCom = [0, 1, 2].map(
    (axis) =>
      (asymmetricDescriptor.massProperties.comPositionPartM[axis] * 5 +
        asymmetricBladderCenter[axis] * 6) /
      11,
  ),
  matrixAdd = (left, right) =>
    left.map((row, rowIndex) =>
      row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
    ),
  independentParallelAxis = (massKg, offset) => {
    const distanceSquared = offset.reduce(
      (sum, value) => sum + value * value,
      0,
    );
    return [0, 1, 2].map((row) =>
      [0, 1, 2].map(
        (column) =>
          massKg *
          ((row === column ? distanceSquared : 0) -
            offset[row] * offset[column]),
      ),
    );
  },
  baseTensor = [
    [4, 0.2, -0.3],
    [0.2, 5, 0.4],
    [-0.3, 0.4, 6],
  ].map((row) => row.map((value) => value * 0.5)),
  structuralOffset = asymmetricDescriptor.massProperties.comPositionPartM.map(
    (value, axis) => value - asymmetricCom[axis],
  ),
  bladderOffset = asymmetricBladderCenter.map(
    (value, axis) => value - asymmetricCom[axis],
  ),
  [asymmetricX, asymmetricY, asymmetricZ] = asymmetricBladderSize,
  bladderCenterTensor = [
    [(6 * (asymmetricY ** 2 + asymmetricZ ** 2)) / 12, 0, 0],
    [0, (6 * (asymmetricX ** 2 + asymmetricZ ** 2)) / 12, 0],
    [0, 0, (6 * (asymmetricX ** 2 + asymmetricY ** 2)) / 12],
  ],
  asymmetricTensor = matrixAdd(
    matrixAdd(baseTensor, independentParallelAxis(5, structuralOffset)),
    matrixAdd(bladderCenterTensor, independentParallelAxis(6, bladderOffset)),
  );
near(asymmetric.massKg, 11);
near(asymmetric.volumeM3, 2);
asymmetric.comPositionPartM.forEach((value, axis) =>
  near(value, asymmetricCom[axis]),
);
asymmetric.dynamicMaterialStore.centerPartM.forEach((value, axis) =>
  near(value, asymmetricBladderCenter[axis]),
);
asymmetric.dynamicMaterialStore.sizeM.forEach((value, axis) =>
  near(value, asymmetricBladderSize[axis]),
);
for (const [field, row, column] of [
  ["xx", 0, 0],
  ["yy", 1, 1],
  ["zz", 2, 2],
  ["xy", 0, 1],
  ["xz", 0, 2],
  ["yz", 1, 2],
])
  near(
    asymmetric.inertiaTensorAtComPartKgM2[field],
    asymmetricTensor[row][column],
  );
assert.deepEqual(asymmetric.contributingSolidIds, [
  "dry-solid",
  "material-store:asymmetric-store",
]);

const gasContribution = {
    id: "pneumatic-gas:asymmetric-store",
    massKg: 2,
    centerPartM: [1.2, -0.4, 0.6],
    inertiaTensorAtCenterKgM2: {
      xx: 0.7,
      yy: 0.8,
      zz: 0.9,
      xy: 0.1,
      xz: -0.2,
      yz: 0.3,
    },
  },
  dynamicWithGas = deriveDynamicMassProperties(asymmetricDescriptor, {
    structuralMassKg: 5,
    additionalMassContributions: [
      gasContribution,
      {
        ...gasContribution,
        id: "zero-mass-contribution",
        massKg: 0,
      },
      {
        ...gasContribution,
        id: "invalid-mass-contribution",
        massKg: "not-a-number",
      },
    ],
  }),
  gasCom = [0, 1, 2].map(
    (axis) =>
      (asymmetricDescriptor.massProperties.comPositionPartM[axis] * 5 +
        gasContribution.centerPartM[axis] * gasContribution.massKg) /
      7,
  ),
  gasStructuralOffset =
    asymmetricDescriptor.massProperties.comPositionPartM.map(
      (value, axis) => value - gasCom[axis],
    ),
  gasOffset = gasContribution.centerPartM.map(
    (value, axis) => value - gasCom[axis],
  ),
  gasCenterTensor = [
    [0.7, 0.1, -0.2],
    [0.1, 0.8, 0.3],
    [-0.2, 0.3, 0.9],
  ],
  expectedGasTensor = matrixAdd(
    matrixAdd(baseTensor, independentParallelAxis(5, gasStructuralOffset)),
    matrixAdd(
      gasCenterTensor,
      independentParallelAxis(gasContribution.massKg, gasOffset),
    ),
  );
near(dynamicWithGas.massKg, 7);
near(dynamicWithGas.volumeM3, asymmetricDescriptor.massProperties.volumeM3);
dynamicWithGas.comPositionPartM.forEach((value, axis) =>
  near(value, gasCom[axis]),
);
for (const [field, row, column] of [
  ["xx", 0, 0],
  ["yy", 1, 1],
  ["zz", 2, 2],
  ["xy", 0, 1],
  ["xz", 0, 2],
  ["yz", 1, 2],
])
  near(
    dynamicWithGas.inertiaTensorAtComPartKgM2[field],
    expectedGasTensor[row][column],
  );
assert.deepEqual(dynamicWithGas.contributingSolidIds, [
  "dry-solid",
  gasContribution.id,
]);
assert.equal(dynamicWithGas.dynamicMaterialStore, null);

const unsupportedCatalog = structuredClone(TYPES);
unsupportedCatalog.propellanttank.ports.find(
  (port) => port.id === "MOUNT",
).behavior = "rotary-coupling";
const unsupportedTank = part(10, "propellanttank", [0, 0, 0]),
  bearing = {
    id: 11,
    type: "bearing",
    pos: [0, 0, 0],
    ...transform,
    mechanism: structuredClone(TYPES.bearing.mechanism),
  },
  unsupported = compileAssembly(
    {
      revision: 1,
      parts: [unsupportedTank, bearing],
      connections: [
        {
          id: "unsupported-dynamic-joint",
          a: unsupportedTank.id,
          b: bearing.id,
          kind: "mechanical",
          portA: "MOUNT",
          portB: "SHAFT",
          capacity: { ultimateForceN: 10_000, ultimateTorqueNm: 2_000 },
        },
      ],
    },
    unsupportedCatalog,
  );
assert.ok(
  unsupported.diagnostics.some(
    (diagnostic) =>
      diagnostic.code === "DYNAMIC_MASS_CONSTRAINT_UNSUPPORTED" &&
      diagnostic.severity === "error",
  ),
  "unsupported dynamic-mass joint reached runtime validation",
);

function createRuntime({
  throttle = 0,
  collective = 0,
  gimbalX = 0,
  gimbalZ = 0,
} = {}) {
  const singleSnapshot = {
      revision: 1,
      parts: [tank, engineA],
      connections: [feedA],
    },
    singleModel = new AssemblyModel(singleSnapshot),
    assembly = singleModel.snapshot(),
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("conserved-propulsion-fixture"),
      catalog: TYPES,
      fixedDt: DT,
    }),
    demand = new PressureNozzleDemandSystem(),
    forceSystem = new PressureNozzleForceSystem(),
    forceObservation = {
      bodyPosition: null,
      force: null,
      torque: null,
      propulsion: null,
    },
    commandSystem = {
      phase: "controllers",
      step(context) {
        context.commandBus.clearTick();
        context.commandBus.writeRemote(engineA.id, "throttle", throttle);
        context.commandBus.writeRemote(engineA.id, "collective", collective);
        context.commandBus.writeRemote(engineA.id, "gimbal_x", gimbalX);
        context.commandBus.writeRemote(engineA.id, "gimbal_z", gimbalZ);
      },
    },
    observeForceSystem = {
      phase: "environment",
      step(context) {
        const body = multibodyRuntime.bodyByPart.get(engineA.id);
        forceObservation.bodyPosition = body.position.clone();
        forceObservation.force = body.force.clone();
        forceObservation.torque = body.torque.clone();
        forceObservation.propulsion = structuredClone(
          context.telemetry.propulsion,
        );
      },
    };
  multibodyRuntime.start(assembly);
  const session = new SimulationSession({
      systems: [
        commandSystem,
        new MaterialResourceSystem(),
        demand,
        forceSystem,
        observeForceSystem,
        new RigidBodySystem(),
        new MaterialResourceCommitSystem(),
        new MassPropertyCommitSystem(),
        new TelemetrySystem(),
      ],
    }).start(assembly, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      compiledAssembly: multibodyRuntime.compiled,
      pressureNozzleDemandSystem: demand,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      worldAdapter,
    });
  return {
    session,
    coordinator,
    demand,
    forceSystem,
    multibodyRuntime,
    observation: forceObservation,
    setThrottle(value) {
      throttle = value;
    },
    setCollective(value) {
      collective = value;
    },
    setGimbalX(value) {
      gimbalX = value;
    },
    setGimbalZ(value) {
      gimbalZ = value;
    },
    dispose() {
      session.dispose();
      multibodyRuntime.dispose();
    },
  };
}

const responseRun = createRuntime({
  throttle: 1,
  gimbalX: -1,
  gimbalZ: 0.5,
});
responseRun.session.stepFixed();
const responseEngine =
    responseRun.session.context.pressureNozzleRuntime.engines.get(engineA.id),
  responseRecord = responseEngine.record,
  expectedResponse =
    1 - Math.exp(-DT / responseEngine.contract.throttleTimeConstantS);
near(responseEngine.throttleState, expectedResponse);
near(responseRecord.gimbalXRad, -responseEngine.contract.gimbalRangeRad);
near(responseRecord.gimbalZRad, responseEngine.contract.gimbalRangeRad / 2);
assert.equal(responseRecord.throttle, 0);
assert.equal(responseRecord.requestedMassFlowKgS, 0);
while (
  responseEngine.throttleState + 1e-12 <
  responseEngine.contract.minimumStableThrottle
)
  responseRun.session.stepFixed();
near(
  responseEngine.record.requestedMassFlowKgS,
  responseEngine.throttleState * responseEngine.contract.maximumMassFlowKgS,
);
responseRun.session.context.runGraph.detachComponent(engineA.id, {
  reason: "mutation contract detachment",
  time: responseRun.session.context.clock.time,
});
responseRun.session.stepFixed();
assert.equal(responseEngine.record.detached, true);
assert.equal(responseEngine.record.targetThrottle, 0);
assert.equal(responseEngine.record.gimbalXRad, 0);
assert.equal(responseEngine.record.gimbalZRad, 0);
assert.equal(responseEngine.record.deliveredMassKg, 0);
responseRun.dispose();

const idleRun = createRuntime(),
  initialization = idleRun.session.telemetry().systems.massProperties,
  tankBody = idleRun.multibodyRuntime.bodyByPart.get(tank.id);
assert.equal(initialization.stage, "initialization");
assert.equal(initialization.effectiveTick, 0);
assert.equal(initialization.appliedAfterIntegratedTick, null);
assert.equal(initialization.timingPolicy, "before-first-integration-v1");
assert.equal(initialization.committedPartCount, 1);
near(tankBody.mass, dryMass + tank.config.initialUsableMassKg);
idleRun.session.stepFixed();
const idleCommit = idleRun.session.telemetry().systems.massProperties;
assert.equal(idleCommit.stage, "post-thermal");
assert.equal(idleCommit.effectiveTick, 2);
assert.equal(idleCommit.appliedAfterIntegratedTick, 1);
assert.equal(idleCommit.evaluatedPartCount, 1);
assert.equal(idleCommit.committedPartCount, 0);
assert.deepEqual(idleCommit.unchangedPartIds, [tank.id]);
const checkpoint = idleRun.coordinator.capture(IDENTITIES);
idleRun.session.context.massPropertyRuntime.lastTransaction = {
  transactionId: "stale-diagnostic",
};
idleRun.coordinator.restore(checkpoint, IDENTITIES);
assert.deepEqual(
  {
    version: 1,
    policy: "single-post-thermal-transaction-v1",
    ...idleRun.session.context.massPropertyRuntime.lastTransaction,
  },
  idleRun.session.telemetry().systems.massProperties,
  "checkpoint restore left a stale mass-property diagnostic cache",
);
idleRun.session.stepFixed();
const idleContext = idleRun.session.context,
  idleEngine = idleContext.pressureNozzleRuntime.engines.get(engineA.id),
  idleRecord = idleEngine.record,
  demandState = idleRun.demand.exportState(idleContext);
assert.throws(
  () => idleRun.demand.importState(idleContext, { version: 2, engines: [] }),
  (error) => error?.code === "INVALID_PRESSURE_NOZZLE_CHECKPOINT",
);
assert.throws(
  () => idleRun.demand.importState(idleContext, { version: 1, engines: [] }),
  (error) => error?.code === "PRESSURE_NOZZLE_CHECKPOINT_IDENTITY_MISMATCH",
);
const nonFiniteDemandState = structuredClone(demandState);
nonFiniteDemandState.engines[0].throttleState = Number.NaN;
assert.throws(
  () => idleRun.demand.importState(idleContext, nonFiniteDemandState),
  (error) => error?.code === "INVALID_PRESSURE_NOZZLE_CHECKPOINT",
);
const allocationTick = idleRecord.allocationTick;
idleRecord.allocationTick = -1;
assert.throws(
  () => idleRun.forceSystem.step(idleContext),
  (error) => error?.code === "PRESSURE_NOZZLE_FORCE_WITHOUT_ALLOCATION",
);
idleRecord.allocationTick = allocationTick;
idleRecord.allocatedChemicalEnergyJ = 1;
assert.throws(
  () => idleRun.forceSystem.step(idleContext),
  (error) => error?.code === "PRESSURE_NOZZLE_ENERGY_ALLOCATION_MISMATCH",
);
idleRecord.allocatedChemicalEnergyJ = 0;
const demandService = idleContext.services.pressureNozzleDemandSystem;
delete idleContext.services.pressureNozzleDemandSystem;
idleContext.telemetry = {};
idleRun.forceSystem.step(idleContext);
idleContext.services.pressureNozzleDemandSystem = demandService;
const noRuntimeForce = new PressureNozzleForceSystem();
noRuntimeForce.step({});
noRuntimeForce.dispose();
idleRun.dispose();

const missingNetworkDemand = new PressureNozzleDemandSystem(),
  missingNetworkContext = {
    services: { compiledAssembly: sharedCompiled },
  };
missingNetworkDemand.initialize(missingNetworkContext);
assert.throws(
  () => missingNetworkDemand.step(missingNetworkContext, DT),
  (error) => error?.code === "MATERIAL_RESOURCE_NETWORK_UNAVAILABLE",
);
missingNetworkDemand.dispose(missingNetworkContext);

function massFailureContext(commitMassProperties) {
  const body = {
    userData: {
      massProperties: structuredClone(tankDescriptor.massProperties),
    },
  };
  return {
    clock: { tick: 0 },
    services: {
      multibodyRuntime: {
        compiled: { bodies: [tankDescriptor] },
        bodyByPart: new Map([[tank.id, body]]),
        commitMassProperties,
      },
    },
    materialResourceNetwork: {
      stores: () => [
        { ...store, partId: tank.id, remainingMassKg: store.capacityKg / 2 },
      ],
    },
    bodyRegistry: {
      bodyForPart: () => ({ bodyId: "fake-tank" }),
      setMassProperties() {},
    },
  };
}

const missingMassTarget = massFailureContext(() => []);
missingMassTarget.bodyRegistry.bodyForPart = () => null;
assert.throws(
  () => new MassPropertyCommitSystem().initialize(missingMassTarget),
  (error) => error?.code === "MASS_PROPERTY_TARGET_UNAVAILABLE",
);
let successfulMassCommit = null;
const registryMassWrites = [],
  successfulMassContext = massFailureContext((records) => {
    successfulMassCommit = structuredClone(records);
    return structuredClone(records);
  });
successfulMassContext.services.aerothermalAblationOwner = {
  massContributions: () => [
    {
      partId: tank.id,
      structuralMassKg: dryMass - 0.1,
      ablatedMassKg: 0.1,
    },
  ],
};
successfulMassContext.bodyRegistry.setMassProperties = (...args) =>
  registryMassWrites.push(structuredClone(args));
const successfulMassSystem = new MassPropertyCommitSystem();
successfulMassSystem.initialize(successfulMassContext);
assert.equal(successfulMassCommit.length, 1);
assert.equal(registryMassWrites.length, 1);
assert.equal(registryMassWrites[0][0], "fake-tank");
assert.equal(
  successfulMassSystem.telemetry(successfulMassContext).records[0]
    .ablatedMassKg,
  0.1,
);
assert.equal(
  successfulMassSystem.telemetry(successfulMassContext).records[0]
    .materialMassKg,
  store.capacityKg / 2,
);
let rollbackCalls = 0;
const rollbackContext = massFailureContext(() => {
  rollbackCalls++;
  if (rollbackCalls === 1) throw new Error("commit failed");
  return [];
});
assert.throws(
  () => new MassPropertyCommitSystem().initialize(rollbackContext),
  /commit failed/,
);
assert.equal(rollbackCalls, 2);
const failedRollbackContext = massFailureContext(() => {
  throw new Error("transaction failed");
});
assert.throws(
  () => new MassPropertyCommitSystem().initialize(failedRollbackContext),
  (error) =>
    error instanceof AggregateError &&
    error.message.includes("rollback could not restore"),
);
const emptyMassContext = { clock: { tick: 0 }, services: {} };
const emptyMassSystem = new MassPropertyCommitSystem();
emptyMassSystem.initialize(emptyMassContext);
assert.equal(emptyMassSystem.telemetry(emptyMassContext).evaluatedPartCount, 0);
emptyMassSystem.dispose(emptyMassContext);
assert.equal("massPropertyRuntime" in emptyMassContext, false);
for (const telemetry of [null, { version: 2 }])
  assert.throws(
    () =>
      new MassPropertyCommitSystem().afterCheckpointRestore({
        massPropertyRuntime: { version: 1, lastTransaction: null },
        telemetry: { systems: { massProperties: telemetry } },
      }),
    (error) => error?.code === "MASS_PROPERTY_CHECKPOINT_TELEMETRY_MISSING",
  );

const poweredRun = createRuntime({ throttle: 1, gimbalX: 1 });
for (let index = 0; index < 12; index++) poweredRun.session.stepFixed();
const propulsion = poweredRun.observation.propulsion.engines[0],
  observedForce = poweredRun.observation.force,
  observedTorque = poweredRun.observation.torque,
  observedBodyPosition = poweredRun.observation.bodyPosition,
  application = propulsion.applicationPointWorldM,
  relative = new CANNON.Vec3(
    application.x - observedBodyPosition.x,
    application.y - observedBodyPosition.y,
    application.z - observedBodyPosition.z,
  ),
  expectedForce = new CANNON.Vec3(
    propulsion.worldDirection.x * propulsion.thrustN,
    propulsion.worldDirection.y * propulsion.thrustN,
    propulsion.worldDirection.z * propulsion.thrustN,
  ),
  expectedTorque = relative.cross(expectedForce);
assert.equal(propulsion.allocationTick, poweredRun.session.context.clock.tick);
assert.equal(
  propulsion.forceApplicationTick,
  poweredRun.session.context.clock.tick,
);
assert.ok(propulsion.deliveredMassKg > 0);
assert.ok(propulsion.allocatedChemicalEnergyJ > 0);
near(observedForce.x, expectedForce.x, 1e-7);
near(observedForce.y, expectedForce.y, 1e-7);
near(observedForce.z, expectedForce.z, 1e-7);
near(observedTorque.x, expectedTorque.x, 1e-6);
near(observedTorque.y, expectedTorque.y, 1e-6);
near(observedTorque.z, expectedTorque.z, 1e-6);
assert.ok(
  poweredRun.session.telemetry().systems.massProperties.committedPartCount > 0,
  "delivered propellant did not commit a next-tick mass change",
);
const poweredCheckpoint = poweredRun.coordinator.capture(IDENTITIES);
for (let index = 0; index < 8; index++) poweredRun.session.stepFixed();
const expectedResumedCheckpoint = poweredRun.coordinator.capture(IDENTITIES);
poweredRun.coordinator.restore(poweredCheckpoint, IDENTITIES);
for (let index = 0; index < 8; index++) poweredRun.session.stepFixed();
assert.deepEqual(
  poweredRun.coordinator.capture(IDENTITIES),
  expectedResumedCheckpoint,
  "pressure-nozzle, material debit, mass frame, and telemetry diverged after exact checkpoint resume",
);
poweredRun.dispose();

function idealDeltaV(stepS) {
  const initialMassKg = 1_000,
    burnDurationS = 20,
    massFlowKgS = 10,
    performance = pressureNozzlePerformance(nozzle, massFlowKgS, 0);
  let massKg = initialMassKg,
    deltaV = 0;
  for (let time = 0; time < burnDurationS - 1e-12; time += stepS) {
    deltaV += (performance.thrustN / massKg) * stepS;
    massKg -= massFlowKgS * stepS;
  }
  const effectiveExhaustVelocity = performance.thrustN / massFlowKgS,
    exact =
      effectiveExhaustVelocity *
      Math.log(initialMassKg / (initialMassKg - massFlowKgS * burnDurationS));
  return { deltaV, exact, error: Math.abs(deltaV - exact) };
}

const coarse = idealDeltaV(1 / 30),
  fine = idealDeltaV(1 / 120);
assert.ok(fine.error < coarse.error / 3.5, "rocket equation did not refine");
near(fine.deltaV, fine.exact, 0.2, "fixed-step rocket equation");

console.log(
  `conserved propulsion passed (${seaLevel.thrustN.toFixed(0)} N sea-level, ${fine.error.toFixed(4)} m/s refinement error)`,
);
