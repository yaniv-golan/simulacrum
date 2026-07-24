import { assert } from "./lib/assert.mjs";
import * as THREE from "three";
import { AssemblyModel } from "../src/model/assembly-model.js";
import { TYPES } from "../src/model/component-catalog.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "../src/model/connection-contracts.js";
import {
  componentDefaults,
  resolveComponentConfig,
  splitComponentConfig,
} from "../src/model/component-resolver.js";
import {
  geometryDescriptorForPart,
  geometryDescriptorForType,
} from "../src/model/geometry-descriptors.js";
import {
  canonicalizeQuaternion,
  DomainValidationError,
  normalizeTransform,
  stableStringify,
} from "../src/model/primitives.js";
import {
  compatibleTargetPorts,
  connectionUsesPort,
  portDefinition,
  portIds,
  portsCompatible,
  validatePortConnection,
} from "../src/model/ports.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import {
  componentVisualDescriptor,
  registeredComponentVisualTypes,
} from "../src/presentation/component-visual-descriptor.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { finiteOr } from "../src/model/finite-or.js";

function expectDomainError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof DomainValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

assert.equal(finiteOr("12.5", -1), 12.5);
assert.equal(finiteOr(Number.NaN, -1), -1);
assert.equal(finiteOr(Number.POSITIVE_INFINITY, 7), 7);
assert.equal(
  finiteOr(undefined, Infinity),
  Infinity,
  "runtime fallbacks may intentionally represent an unbounded measurement",
);

assert.equal(
  stableStringify({ z: 1, a: { y: 2, x: 3 } }),
  '{"a":{"x":3,"y":2},"z":1}',
  "stable serialization did not canonicalize object keys",
);
expectDomainError(
  () => stableStringify({ bad: Number.NaN }),
  "INVALID_FINITE_NUMBER",
);
expectDomainError(
  () => stableStringify({ bad: Number.POSITIVE_INFINITY }),
  "INVALID_FINITE_NUMBER",
);
const cyclic = {};
cyclic.self = cyclic;
expectDomainError(() => stableStringify(cyclic), "CYCLIC_VALUE");
expectDomainError(() => stableStringify(new Date()), "UNSERIALIZABLE_VALUE");
assert.deepEqual(
  normalizeTransform({ pos: [1, 2, 3], scale: { x: 2, y: 3, z: 4 } }),
  {
    position: [1, 2, 3],
    orientation: [0, 0, 0, 1],
    scale: [2, 3, 4],
  },
  "transform normalization changed canonical runtime fields",
);
expectDomainError(
  () => normalizeTransform({ rotation: [0, 0, 0] }),
  "UNSUPPORTED_EULER_ROTATION",
);
assert.deepEqual(
  canonicalizeQuaternion([0, 0, -1, 0]),
  [0, 0, 1, 0],
  "live quaternion producer did not canonicalize equivalent negative sign",
);
expectDomainError(
  () => normalizeTransform({ position: [0, Number.NaN, 0] }),
  "INVALID_FINITE_NUMBER",
);
expectDomainError(
  () => normalizeTransform({ scale: [1, 0, 1] }),
  "INVALID_SCALE",
);

const defaults = componentDefaults("motor"),
  compact = splitComponentConfig("motor", {
    ...TYPES.motor,
    power: 37,
    futureCalibration: { gain: 1.25 },
  });
assert.equal(defaults.power, 4, "catalog defaults were not version resolved");
assert.deepEqual(
  compact.overrides,
  { power: 37 },
  "instance compaction retained catalog defaults",
);
assert.deepEqual(
  compact.extensions,
  { futureCalibration: { gain: 1.25 } },
  "unknown instance configuration was not preserved",
);
const resolved = resolveComponentConfig("motor", {
  ...compact.overrides,
  ...compact.extensions,
});
assert.equal(resolved.power, 37, "override did not replace catalog default");
assert.equal(
  resolved.futureCalibration.gain,
  1.25,
  "extension field did not survive resolution",
);
assert.ok(Object.isFrozen(resolved), "resolved component config is mutable");

expectDomainError(
  () => new AssemblyModel({ parts: {}, connections: [] }),
  "INVALID_PARTS_COLLECTION",
);
expectDomainError(
  () =>
    new AssemblyModel({
      parts: [{ id: 1, type: "beam", rotation: [0, 0, 0] }],
    }),
  "UNSUPPORTED_EULER_ROTATION",
);
expectDomainError(
  () => new AssemblyModel({ parts: [{ id: 1, type: "beam" }] }),
  "INVALID_QUATERNION",
);
expectDomainError(
  () =>
    new AssemblyModel({
      parts: [
        { id: 1, type: "beam", orientation: [0, 0, 0, 1] },
        { id: 1, type: "plate", orientation: [0, 0, 0, 1] },
      ],
    }),
  "DUPLICATE_PART_ID",
);
const model = new AssemblyModel({
  parts: [
    { id: 1, type: "battery", orientation: [0, 0, 0, 1] },
    {
      id: 2,
      type: "motor",
      orientation: [0, 0, 0, 1],
      config: { power: 8 },
    },
  ],
  connections: [],
});
const firstRead = model.snapshot();
assert.ok(
  Object.isFrozen(firstRead) && Object.isFrozen(firstRead.parts[0]),
  "assembly snapshot is not deeply immutable",
);
assert.throws(() => firstRead.parts.push({ id: 3, type: "beam" }), TypeError);
model.addPart({
  id: 3,
  type: "wheel",
  orientation: [0, 0, 0, 1],
  mechanism: mechanismComponentDefinition("wheel"),
});
assert.equal(model.revision, 1, "part addition did not increment revision");
expectDomainError(
  () =>
    model.addPart({
      id: 3,
      type: "wheel",
      orientation: [0, 0, 0, 1],
      mechanism: mechanismComponentDefinition("wheel"),
    }),
  "DUPLICATE_PART_ID",
);
model.updatePart(3, (part) => {
  const mechanism = structuredClone(part.mechanism);
  mechanism.config.radiusM = 0.7;
  mechanism.collisionRegions[0].geometry.radiusM = 0.7;
  return { mechanism };
});
assert.equal(model.revision, 2, "part update did not increment revision");
expectDomainError(() => model.updatePart(3, null), "INVALID_PART_UPDATE");
expectDomainError(
  () => model.addConnection({ a: 1, b: 2, kind: "power" }),
  "MISSING_ENDPOINT_PORT",
);
expectDomainError(
  () =>
    model.addConnection({
      a: 1,
      b: 2,
      kind: "power",
      portA: "UNKNOWN",
      portB: "POWER",
    }),
  "UNKNOWN_PORT",
);
expectDomainError(
  () =>
    model.addConnection({
      a: 1,
      b: 2,
      kind: "mechanical",
      portA: "POWER",
      portB: "POWER",
    }),
  "CONNECTION_KIND_MISMATCH",
);
const generated = model.addConnection({
  a: 1,
  b: 2,
  kind: "power",
  portA: "POWER",
  portB: "POWER",
});
assert.match(
  String(generated.id),
  /1:POWER.*2:POWER/,
  "generated connection identity omitted endpoint ports",
);
assert.equal(
  model.revision,
  3,
  "connection addition did not increment revision",
);
assert.equal(
  model.revision,
  3,
  "persistent model revision changed without an edit",
);
assert.equal(
  typeof model.failConnection,
  "undefined",
  "runtime failure mutation leaked into the persistent model",
);
assert.equal(model.connectedComponents().length, 2);
const detachedAdjacency = model.adjacency();
detachedAdjacency.delete(1);
assert.ok(
  model.adjacency().has(1),
  "external adjacency mutation corrupted the graph cache",
);
assert.throws(() => model.adjacency().get(1).push({}), TypeError);
const beforeInvalidReplace = model.snapshot();
expectDomainError(
  () =>
    model.replace({
      parts: [{ id: 8, type: "beam", orientation: [0, 0, 0, 1] }],
      connections: [{ id: "dangling", a: 8, b: 9, kind: "mechanical" }],
    }),
  "DANGLING_CONNECTION",
);
assert.deepEqual(
  model.snapshot(),
  beforeInvalidReplace,
  "invalid replacement partially mutated the assembly",
);
model.removeParts([3]);
assert.equal(model.revision, 4, "part removal did not increment revision");

const battery = { id: 1, type: "battery" },
  battery2 = { id: 9, type: "battery" },
  motor = { id: 2, type: "motor" },
  wheel = { id: 3, type: "wheel" },
  axle = { id: 4, type: "axle" },
  sensor = { id: 5, type: "sensor", config: TYPES.sensor },
  computer = { id: 6, type: "computer" };
assert.ok(portsCompatible(battery, "POWER", motor, "POWER"));
assert.ok(!portsCompatible(battery, "POWER", battery2, "POWER"));
assert.ok(portsCompatible(wheel, "AXLE", axle, "LEFT"));
assert.ok(portsCompatible(sensor, "SIGNAL", computer, "IN A"));
assert.ok(!portsCompatible(motor, "CONTROL", computer, "IN A"));
assert.ok(!portsCompatible({ id: 7, type: "beam" }, "A", wheel, "AXLE"));
assert.deepEqual(portIds("rocket"), ["MOUNT", "SIGNAL", "PROPELLANT"]);
assert.equal(portDefinition({ type: "plate" }, "TOP").multiplicity, "many");
assert.equal(
  portDefinition({ type: "plate" }, "TOP").behavior,
  "structural-surface",
);
for (const [type, definition] of Object.entries(TYPES)) {
  const ids = new Set();
  for (const descriptor of definition.ports) {
    const expectedKeys = [
      "behavior",
      "direction",
      "id",
      "kind",
      ...(descriptor.localFramePart ? ["localFramePart"] : []),
      ...(descriptor.mediumId ? ["mediumId"] : []),
      "multiplicity",
    ].sort();
    assert.deepEqual(
      Object.keys(descriptor).sort(),
      expectedKeys,
      `${type}.${descriptor.id} has an incomplete port contract`,
    );
    if (descriptor.localFramePart) {
      assert.equal(descriptor.localFramePart.positionM.length, 3);
      assert.equal(descriptor.localFramePart.orientation.length, 4);
    }
    assert.ok(!ids.has(descriptor.id), `${type} repeats port ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}
const canonicalPortBehaviors = new Set([
    "fixed",
    "structural-surface",
    "flexible-termination",
    "rotary-coupling",
    "revolute-support",
    "rotary-actuator-output",
    "rotary-position-actuator-output",
    "linear-guide-output",
    "linear-position-actuator-output",
    "rotary-measurement",
    "gear",
    "electrical-network",
    "signal-network",
    "material-resource",
  ]),
  canonicalDirections = new Set(["source", "sink", "bidirectional"]),
  canonicalMultiplicities = new Set(["one", "many"]),
  catalogDescriptors = Object.values(TYPES).flatMap(
    (definition) => definition.ports,
  );
assert.deepEqual(
  new Set(catalogDescriptors.map((descriptor) => descriptor.behavior)),
  canonicalPortBehaviors,
  "the catalog behavior matrix changed without a policy assertion",
);
for (const descriptor of catalogDescriptors) {
  assert.ok(
    canonicalDirections.has(descriptor.direction),
    `${descriptor.id} has an unreviewed port direction`,
  );
  assert.ok(
    canonicalMultiplicities.has(descriptor.multiplicity),
    `${descriptor.id} has an unreviewed multiplicity`,
  );
}
const kindForBehavior = {
    fixed: "mechanical",
    "structural-surface": "mechanical",
    "flexible-termination": "mechanical",
    "rotary-coupling": "mechanical",
    "revolute-support": "mechanical",
    "rotary-actuator-output": "mechanical",
    "rotary-measurement": "mechanical",
    gear: "mesh",
    "electrical-network": "power",
    "signal-network": "signal",
    "material-resource": "resource",
  },
  allowedBehaviorPairs = new Set([
    "fixed:fixed",
    "fixed:structural-surface",
    "structural-surface:fixed",
    "structural-surface:structural-surface",
    "flexible-termination:fixed",
    "fixed:flexible-termination",
    "flexible-termination:structural-surface",
    "structural-surface:flexible-termination",
    "rotary-coupling:rotary-coupling",
    "revolute-support:rotary-coupling",
    "rotary-coupling:revolute-support",
    "rotary-actuator-output:rotary-coupling",
    "rotary-coupling:rotary-actuator-output",
    "rotary-measurement:rotary-coupling",
    "rotary-coupling:rotary-measurement",
    "gear:gear",
    "electrical-network:electrical-network",
    "signal-network:signal-network",
    "material-resource:material-resource",
  ]);
for (const leftBehavior of canonicalPortBehaviors)
  for (const rightBehavior of canonicalPortBehaviors) {
    const matrixCatalog = {
      left: {
        ports: [
          {
            id: "P",
            kind: kindForBehavior[leftBehavior],
            behavior: leftBehavior,
            direction: "bidirectional",
            ...(leftBehavior === "material-resource"
              ? { mediumId: "test-medium-v1" }
              : {}),
            multiplicity: "many",
          },
        ],
      },
      right: {
        ports: [
          {
            id: "P",
            kind: kindForBehavior[rightBehavior],
            behavior: rightBehavior,
            direction: "bidirectional",
            ...(rightBehavior === "material-resource"
              ? { mediumId: "test-medium-v1" }
              : {}),
            multiplicity: "many",
          },
        ],
      },
    };
    assert.equal(
      portsCompatible(
        { id: 1, type: "left" },
        "P",
        { id: 2, type: "right" },
        "P",
        matrixCatalog,
      ),
      allowedBehaviorPairs.has(`${leftBehavior}:${rightBehavior}`),
      `unreviewed compatibility result for ${leftBehavior}:${rightBehavior}`,
    );
  }
assert.equal(
  portsCompatible(
    { id: 1, type: "rope" },
    "END_A",
    { id: 2, type: "wheel" },
    "AXLE",
  ),
  false,
  "a Rope termination connected to an internal rotary shaft port",
);
assert.equal(
  portsCompatible(
    { id: 1, type: "rope" },
    "END_A",
    { id: 2, type: "wheel" },
    "SURFACE",
  ),
  true,
  "the wheel exposes no ordinary surface attachment for Rope",
);
for (const leftDirection of canonicalDirections)
  for (const rightDirection of canonicalDirections) {
    const directionCatalog = Object.fromEntries(
      [
        ["left", leftDirection],
        ["right", rightDirection],
      ].map(([type, direction]) => [
        type,
        {
          ports: [
            {
              id: "P",
              kind: "signal",
              behavior: "signal-network",
              direction,
              multiplicity: "many",
            },
          ],
        },
      ]),
    );
    assert.equal(
      portsCompatible(
        { id: 1, type: "left" },
        "P",
        { id: 2, type: "right" },
        "P",
        directionCatalog,
      ),
      leftDirection === "bidirectional" ||
        rightDirection === "bidirectional" ||
        (leftDirection === "source" && rightDirection === "sink") ||
        (leftDirection === "sink" && rightDirection === "source"),
      `unreviewed direction result for ${leftDirection}:${rightDirection}`,
    );
  }
const surfaceConnection = completeConnectionContract(
  {
    id: "surface-a",
    a: 10,
    b: 11,
    kind: "mechanical",
    portA: "TOP",
    portB: "MOUNT",
  },
  {
    id: 10,
    type: "plate",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
  },
  {
    id: 11,
    type: "motor",
    pos: [1, 0.5, 0],
    orientation: [0, 0, 0, 1],
  },
  { capacity: CONNECTION_CAPACITIES.standard },
);
assert.deepEqual(surfaceConnection.anchorA, [1, 0.5, 0]);
const rotatedSurfaceConnection = completeConnectionContract(
  {
    id: "rotated-surface-a",
    a: 10,
    b: 11,
    kind: "mechanical",
    portA: "TOP",
    portB: "MOUNT",
  },
  {
    id: 10,
    type: "plate",
    pos: [0, 0, 0],
    orientation: [0, 0, 1, 0],
  },
  {
    id: 11,
    type: "motor",
    pos: [1, 0, 0],
    orientation: [0, 0, 0, 1],
  },
  { capacity: CONNECTION_CAPACITIES.standard },
);
assert.deepEqual(
  rotatedSurfaceConnection.anchorA,
  [-1, 0, 0],
  "derived inverse quaternion was treated as noncanonical wire data",
);
expectDomainError(
  () =>
    completeConnectionContract(
      {
        id: "missing-capacity",
        a: 10,
        b: 11,
        kind: "mechanical",
        portA: "TOP",
        portB: "MOUNT",
      },
      { id: 10, type: "plate", pos: [0, 0, 0] },
      { id: 11, type: "motor", pos: [1, 0, 0] },
    ),
  "INVALID_CONNECTION_CAPACITY",
);
expectDomainError(
  () =>
    completeConnectionContract(
      {
        id: "network-capacity",
        a: 1,
        b: 2,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      battery,
      motor,
      { capacity: CONNECTION_CAPACITIES.standard },
    ),
  "NETWORK_CAPACITY_FORBIDDEN",
);
expectDomainError(
  () =>
    validatePortConnection(
      { id: 10, type: "plate" },
      "TOP",
      { id: 12, type: "motor" },
      "MOUNT",
      [surfaceConnection],
      TYPES,
      { ...surfaceConnection, id: "surface-b", b: 12 },
    ),
  "SURFACE_ANCHOR_OCCUPIED",
);
const leftConnection = {
  id: "left",
  a: axle.id,
  b: wheel.id,
  kind: "mechanical",
  portA: "LEFT",
  portB: "AXLE",
};
const powerFanout = {
  id: "power-a",
  a: battery.id,
  b: motor.id,
  kind: "power",
  portA: "POWER",
  portB: "POWER",
};
assert.equal(
  validatePortConnection(battery, "POWER", { id: 8, type: "motor" }, "POWER", [
    powerFanout,
  ]),
  true,
  "many-use battery output rejected legitimate fan-out",
);
expectDomainError(
  () =>
    validatePortConnection(battery2, "POWER", motor, "POWER", [powerFanout]),
  "PORT_OCCUPIED",
);
assert.deepEqual(
  compatibleTargetPorts({ id: 7, type: "wheel" }, "AXLE", axle, TYPES, [
    leftConnection,
  ]),
  ["RIGHT", "JOURNAL"],
  "occupied axle end was offered for a second wheel",
);
expectDomainError(
  () =>
    validatePortConnection({ id: 7, type: "wheel" }, "AXLE", axle, "LEFT", [
      leftConnection,
    ]),
  "PORT_OCCUPIED",
);
assert.ok(
  connectionUsesPort(leftConnection, wheel, "AXLE") &&
    !connectionUsesPort(leftConnection, wheel, "MOUNT"),
  "endpoint-B port lookup fell back to the broad connection kind",
);
assert.ok(
  connectionUsesPort(leftConnection, axle, "LEFT") &&
    !connectionUsesPort(leftConnection, axle, "RIGHT"),
  "endpoint-A port lookup was not exact",
);

assert.deepEqual(
  [...registeredComponentVisualTypes].sort(),
  Object.keys(TYPES).sort(),
  "visual descriptor registry must cover the catalog exactly",
);
assert.throws(
  () => componentVisualDescriptor("missing-component"),
  /Unknown component type/,
);
assert.throws(
  () => componentVisualDescriptor("beam", -1),
  /24-bit RGB integer/,
);

for (const type of Object.keys(TYPES)) {
  const flexible = Boolean(TYPES[type].flexibleLine),
    descriptor = flexible ? null : geometryDescriptorForType(type),
    visualDescriptor = componentVisualDescriptor(type),
    renderObject = componentMesh(type);
  if (descriptor)
    assert.ok(Object.isFrozen(descriptor), `${type} descriptor is mutable`);
  assert.ok(
    Object.isFrozen(visualDescriptor) &&
      (flexible || Object.isFrozen(visualDescriptor.geometry)),
    `${type} visual descriptor is mutable`,
  );
  assert.equal(
    stableStringify(renderObject.userData.visualDescriptor),
    stableStringify(visualDescriptor),
    `${type} did not expose its immutable visual descriptor`,
  );
  assert.equal(
    renderObject.userData.renderResourceOwnership,
    "object3d-tree-v1",
    `${type} did not declare render-resource ownership`,
  );
  if (descriptor)
    assert.ok(
      descriptor.collisionPrimitives.length > 0 &&
        descriptor.dimensions.every(Number.isFinite) &&
        descriptor.massKg > 0 &&
        descriptor.displacementM3 > 0,
      `${type} descriptor is physically incomplete`,
    );
  assert.equal(
    stableStringify(renderObject.userData.geometryDescriptor),
    stableStringify(descriptor),
    `${type} presentation did not consume the canonical descriptor`,
  );
  if (TYPES[type].mechanism && descriptor) {
    renderObject.updateMatrixWorld(true);
    const renderedSize = new THREE.Box3()
      .setFromObject(renderObject)
      .getSize(new THREE.Vector3())
      .toArray();
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(renderedSize[axis] - descriptor.dimensions[axis]) <= 1e-6,
        `${type} rendered extent ${axis} diverged from canonical collision geometry`,
      );
  }
  renderObject.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material?.dispose();
  });
}
const motorGeometry = geometryDescriptorForType("motor"),
  axleGeometry = geometryDescriptorForType("axle"),
  gearGeometry = geometryDescriptorForType("gear12"),
  wheelGeometry = geometryDescriptorForType("wheel");
assert.deepEqual(motorGeometry.portFrames.SHAFT.position, [0, 0, 0.82]);
assert.deepEqual(axleGeometry.portFrames.LEFT.position, [0, 0, -1]);
assert.equal(gearGeometry.collisionPrimitives[0].radius, 0.48);
assert.equal(gearGeometry.collisionPrimitives[0].length, 0.22);
assert.equal(wheelGeometry.collisionPrimitives[0].radius, 0.65);
assert.equal(wheelGeometry.collisionPrimitives[0].length, 0.42);
const scaledBeam = geometryDescriptorForPart({
  id: 20,
  type: "beam",
  scale: { x: 2, y: 0.5, z: 1 },
});
assert.deepEqual(
  scaledBeam.collisionPrimitives[0].size,
  [4.8, 0.175, 0.35],
  "component scaling was not applied by the geometry authority",
);
const compiled = compileAssembly(
  {
    parts: [
      {
        id: 20,
        type: "beam",
        orientation: [0, 0, 0, 1],
        scale: [2, 0.5, 1],
      },
    ],
  },
  TYPES,
);
assert.equal(
  Object.hasOwn(compiled.bodies[0], "shape"),
  false,
  "compiler retained a second collision-dimension authority",
);
assert.deepEqual(
  compiled.bodies[0].geometry.collisionPrimitives[0].size,
  [4.8, 0.175, 0.35],
);

expectDomainError(
  () => new SimulationSession({ systems: [{ phase: "mystery" }] }),
  "UNKNOWN_SIMULATION_PHASE",
);
expectDomainError(
  () => new SimulationSession({ fixedDt: Number.NaN }),
  "INVALID_FIXED_TIMESTEP",
);
const phaseOrder = [];
new SimulationSession({
  systems: [
    { phase: "thermal", initialize: () => phaseOrder.push("thermal") },
    { phase: "sensors", initialize: () => phaseOrder.push("sensor-a") },
    { phase: "sensors", initialize: () => phaseOrder.push("sensor-b") },
  ],
})
  .start({ parts: [], connections: [] })
  .dispose();
assert.deepEqual(
  phaseOrder,
  ["sensor-a", "sensor-b", "thermal"],
  "phase sort was not stable",
);

const rollbackEvents = [],
  initFailure = new Error("initialize failed"),
  cleanupFailure = new Error("cleanup failed"),
  rollbackSession = new SimulationSession({
    systems: [
      {
        phase: "sensors",
        initialize: () => rollbackEvents.push("init-a"),
        dispose: () => rollbackEvents.push("dispose-a"),
      },
      {
        phase: "controllers",
        initialize: () => {
          rollbackEvents.push("init-b");
          throw initFailure;
        },
        dispose: () => {
          rollbackEvents.push("dispose-b");
          throw cleanupFailure;
        },
      },
      {
        phase: "networks",
        initialize: () => rollbackEvents.push("unreachable"),
      },
    ],
  });
assert.throws(
  () => rollbackSession.start({ parts: [], connections: [] }),
  (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [initFailure, cleanupFailure]);
    return true;
  },
);
assert.deepEqual(rollbackEvents, [
  "init-a",
  "init-b",
  "dispose-b",
  "dispose-a",
]);
assert.equal(rollbackSession.context, null);
assert.equal(rollbackSession.time, 0);

const disposeEvents = [],
  firstDisposeFailure = new Error("first dispose"),
  secondDisposeFailure = new Error("second dispose"),
  disposeSession = new SimulationSession({
    systems: [
      {
        phase: "sensors",
        dispose: () => {
          disposeEvents.push("sensor");
          throw firstDisposeFailure;
        },
      },
      {
        phase: "thermal",
        dispose: () => {
          disposeEvents.push("thermal");
          throw secondDisposeFailure;
        },
      },
    ],
  }).start({ parts: [], connections: [] });
assert.throws(
  () => disposeSession.dispose(),
  (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [secondDisposeFailure, firstDisposeFailure]);
    return true;
  },
);
assert.deepEqual(disposeEvents, ["thermal", "sensor"]);
assert.equal(disposeSession.context, null);
assert.equal(disposeSession.accumulator, 0);
assert.equal(disposeSession.time, 0);

console.log("model, port, geometry, and lifecycle contracts passed");
