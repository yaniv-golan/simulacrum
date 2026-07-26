import assert from "node:assert/strict";
import {
  AssemblyModel,
  boundsDimensions,
  compileAssembly,
  geometryDescriptorForPart,
  MaterialResourceNetwork,
  MaterialResourceSystem,
  RunAssemblyGraph,
  SimulationSession,
  TYPES,
  materialMedium,
  materialStoreContract,
  normalizeBlueprint,
  portsCompatible,
  pressureNozzlePerformance,
  resolveWireComponentConfig,
} from "../src/core/index.js";
import { MaterialResourceCommitSystem } from "../src/simulation/systems/material-resource-system.js";

const transform = Object.freeze({
  orientation: [0, 0, 0, 1],
  scale: { x: 1, y: 1, z: 1 },
});
const part = (id, type, pos, config = {}) => ({
  id,
  type,
  pos,
  ...transform,
  config: resolveWireComponentConfig({ type, config }),
});
const tank = part(1, "propellanttank", [0, 1.5, 0]),
  engine = part(2, "rocket", [0, 0, 0]),
  feed = {
    id: "feed-1",
    a: tank.id,
    b: engine.id,
    kind: "resource",
    portA: "OUTLET",
    portB: "PROPELLANT",
  },
  snapshot = { parts: [tank, engine], connections: [feed] },
  blueprint = normalizeBlueprint({
    format: "simulacrum-blueprint",
    version: 1,
    name: "Finite resource fixture",
    parts: snapshot.parts,
    connections: snapshot.connections,
    remoteProfiles: {},
    defaultRemoteProfile: null,
  }),
  model = AssemblyModel.fromBlueprint(blueprint),
  compiled = compileAssembly(model.snapshot(), TYPES),
  tankBody = compiled.bodies.find((body) => body.partId === tank.id),
  engineBody = compiled.bodies.find((body) => body.partId === engine.id);

assert.deepEqual(compiled.networks.resource, [
  {
    id: feed.id,
    a: tank.id,
    b: engine.id,
    portA: "OUTLET",
    portB: "PROPELLANT",
    mediumId: "hydrogen-peroxide-90-v1",
    directions: ["source", "sink"],
  },
]);
assert.equal(tankBody.capabilities.materialStore.kind, "propellant-store-v1");
assert.equal(tankBody.capabilities.materialStore.initialUsableMassKg, 900);
assert.equal(
  tankBody.capabilities.materialStore.fillLaw.kind,
  "positive-displacement-bladder-v1",
);
assert.deepEqual(tankBody.capabilities.materialPorts, [
  {
    id: "OUTLET",
    mediumId: "hydrogen-peroxide-90-v1",
    direction: "source",
    multiplicity: "many",
  },
]);
assert.equal(
  pressureNozzlePerformance(
    engineBody.capabilities.propulsion,
    engineBody.capabilities.propulsion.maximumMassFlowKgS,
    101_325,
  ).thrustN,
  24_000,
);
assert.equal(
  engineBody.capabilities.materialPorts[0].mediumId,
  "hydrogen-peroxide-90-v1",
);

const runGraph = new RunAssemblyGraph(model.snapshot()),
  resources = new MaterialResourceNetwork(compiled).resolve(runGraph);
assert.equal(resources.remainingMass(tank.id), 900);
assert.equal(resources.remainingMass("missing-store"), null);
assert.deepEqual(resources.stores(), resources.telemetry().stores);
const connectedTelemetry = resources.telemetry();
assert.equal(connectedTelemetry.graphRevision, runGraph.graphRevision);
assert.equal(connectedTelemetry.components.length, 1);
assert.deepEqual(connectedTelemetry.components[0].partIds, [1, 2]);
assert.equal(
  connectedTelemetry.components[0].mediumId,
  "hydrogen-peroxide-90-v1",
);
assert.match(
  connectedTelemetry.components[0].id,
  /^resource:hydrogen-peroxide-90-v1:/,
);
assert.throws(() => connectedTelemetry.components.push({}), TypeError);
const checkpoint = resources.exportState();
resources.importState(checkpoint, runGraph);
assert.deepEqual(resources.exportState(), checkpoint);

for (const invalidRequests of [null, {}])
  assert.throws(
    () => resources.allocate(invalidRequests, { tick: 0, dt: 1 / 120 }),
    (error) => error?.code === "INVALID_MATERIAL_REQUESTS",
  );
for (const options of [
  {},
  { tick: -1, dt: 1 / 120 },
  { tick: 0.5, dt: 1 / 120 },
  { tick: 0, dt: 0 },
  { tick: 0, dt: Number.NaN },
])
  assert.throws(
    () => resources.allocate([], options),
    (error) => error?.code === "INVALID_MATERIAL_ALLOCATION_TICK",
  );
for (const request of [
  {
    consumerPartId: null,
    mediumId: "hydrogen-peroxide-90-v1",
    requestedMassKg: 1,
  },
  { consumerPartId: engine.id, mediumId: "bad medium", requestedMassKg: 1 },
  {
    consumerPartId: engine.id,
    mediumId: "hydrogen-peroxide-90-v1",
    requestedMassKg: Number.NaN,
  },
  {
    consumerPartId: engine.id,
    mediumId: "hydrogen-peroxide-90-v1",
    requestedMassKg: -1,
  },
])
  assert.throws(
    () => resources.allocate([request], { tick: 0, dt: 1 / 120 }),
    (error) => error?.code === "INVALID_MATERIAL_REQUEST",
  );

runGraph.failConnection(feed.id, {
  reason: "test partition",
  mode: "structural",
  time: 1,
});
resources.resolve(runGraph);
assert.equal(resources.telemetry().components.length, 2);
assert.deepEqual(
  resources.telemetry().components.map((component) => component.partIds),
  [[1], [2]],
);
assert.deepEqual(
  resources.telemetry().components.map((component) => component.mediumId),
  ["hydrogen-peroxide-90-v1", "hydrogen-peroxide-90-v1"],
);
const unreachableAllocation = resources.allocate(
  [
    {
      consumerPartId: engine.id,
      mediumId: "water-v1",
      requestedMassKg: 1,
    },
  ],
  { tick: 1, dt: 1 / 120 },
)[0];
assert.equal(unreachableAllocation.deliveredMassKg, 0);
assert.equal(unreachableAllocation.componentId, null);
assert.equal(unreachableAllocation.reason, "no reachable same-medium manifold");
assert.throws(
  () =>
    resources.importState(
      {
        ...checkpoint,
        stores: checkpoint.stores.map((store) => ({
          ...store,
          remainingMassKg: store.capacityKg + 1,
        })),
      },
      runGraph,
    ),
  /does not match store/,
);

const customCatalog = structuredClone(TYPES);
customCatalog.rocket.ports.find((port) => port.id === "PROPELLANT").mediumId =
  "water-v1";
assert.equal(
  portsCompatible(tank, "OUTLET", engine, "PROPELLANT", customCatalog),
  false,
);
customCatalog.rocket.ports.find((port) => port.id === "PROPELLANT").mediumId =
  "hydrogen-peroxide-90-v1";
customCatalog.rocket.ports.find((port) => port.id === "PROPELLANT").direction =
  "source";
assert.equal(
  portsCompatible(tank, "OUTLET", engine, "PROPELLANT", customCatalog),
  false,
);

assert.throws(
  () =>
    new AssemblyModel({
      parts: [
        {
          ...tank,
          config: { ...tank.config, initialUsableMassKg: 901 },
        },
      ],
      connections: [],
    }),
  /within capacity/,
);
assert.throws(
  () =>
    new AssemblyModel({
      parts: [tank, engine],
      connections: [{ ...feed, portB: "SIGNAL" }],
    }),
  /cannot connect/,
);

assert.equal(materialStoreContract(engine), null);
for (const [field, value] of [
  ["capacityKg", 0],
  ["initialUsableMassKg", Number.NaN],
  ["initialUsableMassKg", -1],
])
  assert.throws(
    () =>
      materialStoreContract({
        ...tank,
        config: { ...tank.config, [field]: value },
      }),
    /must be finite and positive|within capacity/,
  );
for (const patch of [
  { kind: "unknown-store" },
  { fillLaw: { kind: "unknown-fill" } },
  { storageSolid: { kind: "sphere-v1" } },
]) {
  const catalog = structuredClone(TYPES);
  Object.assign(catalog.propellanttank.materialStore, patch);
  assert.throws(() => materialStoreContract(tank, catalog), /supported/);
}
for (const axis of [
  [0, 0],
  [0, 0, Number.NaN],
  [0, 0, 0],
  [1e-9, 0, 0],
]) {
  const catalog = structuredClone(TYPES);
  catalog.propellanttank.materialStore.storageAxisPart = axis;
  assert.throws(() => materialStoreContract(tank, catalog), /storage axis/);
}
for (const [field, value] of [
  ["sizeFraction", null],
  ["sizeFraction", [0.8, 0.9]],
  ["sizeFraction", [Number.NaN, 0.9, 0.8]],
  ["sizeFraction", [0, 0.9, 0.8]],
  ["sizeFraction", [1.01, 0.9, 0.8]],
  ["centerFraction", null],
  ["centerFraction", [0, 0]],
  ["centerFraction", [Number.NaN, 0, 0]],
  ["centerFraction", [0.2, 0, 0]],
]) {
  const catalog = structuredClone(TYPES);
  catalog.propellanttank.materialStore.storageSolid[field] = value;
  assert.throws(
    () => materialStoreContract(tank, catalog),
    (error) => error?.code === "INVALID_MATERIAL_STORAGE_SOLID",
  );
}
for (const dimensions of [null, [1, 2], [Number.NaN, 2, 1], [1, 0, 1]])
  assert.throws(
    () =>
      materialStoreContract(tank, TYPES, {
        dimensions,
        portFrames: { OUTLET: { position: [0, -1.2, 0] } },
      }),
    (error) => error?.code === "INVALID_MATERIAL_STORAGE_SOLID",
  );
for (const mutate of [
  (catalog) => (catalog.propellanttank.materialStore.mediumId = "bad medium"),
  (catalog) => (catalog.propellanttank.materialStore.mediumId = " bad"),
  (catalog) => (catalog.propellanttank.materialStore.mediumId = "bad "),
  (catalog) =>
    (catalog.propellanttank.ports.find((port) => port.id === "OUTLET").kind =
      "signal"),
  (catalog) =>
    (catalog.propellanttank.ports.find(
      (port) => port.id === "OUTLET",
    ).behavior = "signal-network"),
  (catalog) =>
    (catalog.propellanttank.ports.find(
      (port) => port.id === "OUTLET",
    ).direction = "sink"),
  (catalog) =>
    (catalog.propellanttank.ports.find(
      (port) => port.id === "OUTLET",
    ).mediumId = "water-v1"),
]) {
  const catalog = structuredClone(TYPES);
  mutate(catalog);
  assert.throws(() => materialStoreContract(tank, catalog), /same-medium/);
}
assert.throws(
  () =>
    materialStoreContract({
      ...tank,
      config: { ...tank.config, size: [1, 0, 1] },
    }),
  (error) => error.code === "INVALID_GEOMETRY_DIMENSION",
  "material storage accepted a non-positive canonical body dimension",
);
assert.throws(
  () =>
    materialStoreContract({
      ...tank,
      config: {
        ...tank.config,
        capacityKg: 10_000,
        initialUsableMassKg: 10_000,
      },
    }),
  /exceed the authored storage solid/,
);
const syntheticGeometry = (dimensions, outletPosition) => ({
    bodyBoundsPartM: {
      minimumM: dimensions.map((value) => -value / 2),
      maximumM: dimensions.map((value) => value / 2),
    },
    portFrames: {
      OUTLET: { framePart: { positionM: outletPosition } },
    },
  }),
  scaledStore = materialStoreContract(
    tank,
    TYPES,
    syntheticGeometry([2, 3, 2], [0, -1.5, 0]),
  );
assert.deepEqual(scaledStore.storageSolid.fullSizeM, [1.64, 2.7, 1.64]);
for (const position of [null, [0, -1], [0.1, -1.5, 0]])
  assert.throws(
    () =>
      materialStoreContract(tank, TYPES, {
        ...syntheticGeometry([2, 3, 2], position),
      }),
    (error) =>
      [
        "INVALID_MATERIAL_STORE_OUTLET_GEOMETRY",
        "MISALIGNED_MATERIAL_STORE_OUTLET",
      ].includes(error?.code),
  );
const inwardOutlet = [...scaledStore.storageSolid.outletAnchorPartM];
inwardOutlet[1] += 0.1;
assert.throws(
  () =>
    materialStoreContract(
      tank,
      TYPES,
      syntheticGeometry([2, 3, 2], inwardOutlet),
    ),
  (error) => error?.code === "MISALIGNED_MATERIAL_STORE_OUTLET",
);
const normalizedAxisCatalog = structuredClone(TYPES);
normalizedAxisCatalog.propellanttank.materialStore.storageAxisPart = [0, -2, 0];
assert.deepEqual(
  materialStoreContract(tank, normalizedAxisCatalog).storageAxisPart,
  [0, -1, 0],
);
assert.equal(
  materialStoreContract({
    ...tank,
    config: { ...tank.config, initialUsableMassKg: 0 },
  }).initialUsableMassKg,
  0,
);
const tankBodyDimensions = boundsDimensions(
    geometryDescriptorForPart(tank).bodyBoundsPartM,
  ),
  exactVolumeCapacityKg =
    tankBodyDimensions[0] *
    0.82 *
    (tankBodyDimensions[1] * 0.9) *
    (tankBodyDimensions[2] * 0.82) *
    materialMedium("hydrogen-peroxide-90-v1").densityKgM3;
assert.equal(
  materialStoreContract({
    ...tank,
    config: {
      ...tank.config,
      capacityKg: exactVolumeCapacityKg,
      initialUsableMassKg: exactVolumeCapacityKg,
    },
  }).capacityKg,
  exactVolumeCapacityKg,
);

assert.throws(
  () => resources.importState(null, runGraph),
  /must use version 1/,
);
assert.throws(
  () => resources.importState({ ...checkpoint, stores: [] }, runGraph),
  /store set changed/,
);
for (const patch of [
  { mediumId: "water-v1" },
  { capacityKg: checkpoint.stores[0].capacityKg + 1 },
  { remainingMassKg: Number.NaN },
  { remainingMassKg: -1 },
])
  assert.throws(
    () =>
      resources.importState(
        {
          ...checkpoint,
          stores: [{ ...checkpoint.stores[0], ...patch }],
        },
        runGraph,
      ),
    /does not match store/,
  );
resources.importState(
  {
    ...checkpoint,
    stores: [{ ...checkpoint.stores[0], remainingMassKg: 0 }],
  },
  runGraph,
);
assert.equal(resources.remainingMass(tank.id), 0);
resources.importState(checkpoint, runGraph);

const secondTank = part(3, "propellanttank", [2, 1.5, 0]),
  multiSnapshot = {
    parts: [tank, engine, secondTank],
    connections: [feed],
  },
  multiCompiled = compileAssembly(multiSnapshot, TYPES),
  multiGraph = new RunAssemblyGraph(multiSnapshot),
  multiResources = new MaterialResourceNetwork(multiCompiled).resolve(
    multiGraph,
  ),
  multiCheckpoint = multiResources.exportState();
assert.equal(multiCheckpoint.stores.length, 2);
assert.throws(
  () =>
    multiResources.importState(
      {
        ...multiCheckpoint,
        stores: multiCheckpoint.stores.map((store, index) =>
          index === 0
            ? { ...store, remainingMassKg: 1 }
            : { ...store, mediumId: "wrong-v1" },
        ),
      },
      multiGraph,
    ),
  /does not match store/,
);
assert.deepEqual(
  multiResources.exportState(),
  multiCheckpoint,
  "invalid multi-store checkpoint partially mutated the resource ledger",
);

const branchedSnapshot = {
    parts: [tank, engine, part(4, "rocket", [2, 0, 0])],
    connections: [feed, { ...feed, id: "feed-2", b: 4 }],
  },
  branchedGraph = new RunAssemblyGraph(branchedSnapshot),
  branchedResources = new MaterialResourceNetwork(
    compileAssembly(branchedSnapshot, TYPES),
  ).resolve(branchedGraph);
assert.deepEqual(
  branchedResources.telemetry().components[0].partIds,
  [1, 2, 4],
);
const zeroAllocation = branchedResources.allocate(
  [
    {
      consumerPartId: 2,
      mediumId: "hydrogen-peroxide-90-v1",
      requestedMassKg: 0,
    },
  ],
  { tick: 0, dt: 1 / 120 },
)[0];
assert.equal(zeroAllocation.availabilityFraction, 1);
assert.equal(zeroAllocation.specificAvailableEnergyJkg, 0);
assert.equal(zeroAllocation.reason, "zero request");
const allocations = branchedResources.allocate(
  [
    {
      consumerPartId: 4,
      mediumId: "hydrogen-peroxide-90-v1",
      requestedMassKg: 600,
    },
    {
      consumerPartId: 2,
      mediumId: "hydrogen-peroxide-90-v1",
      requestedMassKg: 600,
    },
  ],
  { tick: 1, dt: 1 / 120 },
);
assert.deepEqual(
  allocations.map((allocation) => allocation.consumerPartId),
  [2, 4],
);
assert.deepEqual(
  allocations.map((allocation) => allocation.deliveredMassKg),
  [450, 450],
);
assert.ok(
  allocations.every(
    (allocation) =>
      allocation.availabilityFraction === 0.75 &&
      allocation.allocatedChemicalEnergyJ > 0,
  ),
);
assert.equal(branchedResources.remainingMass(tank.id), 0);
const emptyStoreAllocation = branchedResources.allocate(
  [
    {
      consumerPartId: 2,
      mediumId: "hydrogen-peroxide-90-v1",
      requestedMassKg: 1,
    },
  ],
  { tick: 2, dt: 1 / 120 },
)[0];
assert.equal(emptyStoreAllocation.deliveredMassKg, 0);
assert.equal(emptyStoreAllocation.reason, "reachable stores empty");
assert.equal(branchedResources.telemetry().allocations.length, 1);
assert.throws(
  () =>
    branchedResources.allocate(
      [
        {
          consumerPartId: 2,
          mediumId: "hydrogen-peroxide-90-v1",
          requestedMassKg: 1,
        },
        {
          consumerPartId: 2,
          mediumId: "hydrogen-peroxide-90-v1",
          requestedMassKg: 1,
        },
      ],
      { tick: 3, dt: 1 / 120 },
    ),
  (error) => error?.code === "DUPLICATE_MATERIAL_REQUEST",
);

const sharedStoreSnapshot = {
    parts: [tank, secondTank, engine],
    connections: [feed, { ...feed, id: "feed-shared", a: secondTank.id }],
  },
  sharedStoreResources = new MaterialResourceNetwork(
    compileAssembly(sharedStoreSnapshot, TYPES),
  ).resolve(new RunAssemblyGraph(sharedStoreSnapshot)),
  sharedStoreAllocation = sharedStoreResources.allocate(
    [
      {
        consumerPartId: engine.id,
        mediumId: "hydrogen-peroxide-90-v1",
        requestedMassKg: 900,
      },
    ],
    { tick: 1, dt: 1 / 120 },
  )[0];
assert.equal(sharedStoreAllocation.reason, "delivered");
assert.deepEqual(
  sharedStoreAllocation.storeDebits.map((debit) => debit.massKg),
  [450, 450],
);
assert.deepEqual(
  sharedStoreResources.stores().map((store) => store.remainingMassKg),
  [450, 450],
);

const emptyResources = new MaterialResourceNetwork({
  bodies: [],
  networks: { resource: [] },
});
emptyResources.resolve(new RunAssemblyGraph({ parts: [], connections: [] }));
assert.deepEqual(emptyResources.telemetry().stores, []);

const session = new SimulationSession({
  systems: [new MaterialResourceSystem()],
});
session.start(model.snapshot(), { compiledAssembly: compiled });
session.stepFixed();
assert.equal(session.telemetry().systems.materialResources.stores.length, 1);
assert.equal(
  session.telemetry().systems.materialResources.allocationPolicy,
  "ideal-manifold-v1",
);
session.dispose();

const committedSession = new SimulationSession({
  systems: [
    new MaterialResourceSystem(),
    {
      phase: "structures",
      step(context) {
        context.runGraph.failConnection(feed.id, {
          reason: "same-tick partition test",
          mode: "structural",
          time: context.time,
        });
      },
    },
    new MaterialResourceCommitSystem(),
  ],
});
committedSession.start(model.snapshot(), { compiledAssembly: compiled });
committedSession.stepFixed();
assert.deepEqual(
  committedSession
    .telemetry()
    .systems.materialResources.components.map((component) => component.partIds),
  [[1], [2]],
);
committedSession.dispose();

console.log(
  `material resource authority passed (${compiled.networks.resource.length} feed, ${checkpoint.stores[0].remainingMassKg} kg stored)`,
);
