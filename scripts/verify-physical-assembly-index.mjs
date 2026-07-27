import { assert } from "./lib/assert.mjs";
import { CommandBus } from "../src/simulation/command-bus.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { MobilityTelemetrySystem } from "../src/simulation/systems/mobility-telemetry-system.js";

const compiled = {
    bodies: [1, 2, 3, 4].map((partId) => ({
      id: `body:${partId}`,
      partId,
    })),
    constraints: [
      {
        id: "joint-a",
        kind: "fixed",
        a: 1,
        b: 2,
        sourceConnectionIds: ["connection-a"],
      },
      {
        id: "joint-b",
        kind: "revolute",
        a: 2,
        b: 3,
        sourcePartId: 20,
        sourceConnectionIds: ["connection-b"],
      },
      {
        id: "joint-c",
        kind: "fixed",
        a: 3,
        b: 4,
        sourceConnectionIds: ["connection-c"],
      },
      {
        id: "measurement",
        kind: "measurement",
        a: 1,
        b: 4,
        sourceConnectionIds: [],
      },
    ],
  },
  entries = compiled.constraints.map((descriptor) => ({
    descriptor,
    active: true,
  }));

function graph(events = []) {
  return {
    graphRevision: events.length,
    events: () => events,
  };
}

const initial = new PhysicalAssemblyIndex(compiled),
  initialSnapshot = initial.refresh({
    runGraph: graph(),
    constraintEntries: [...entries].reverse(),
    topologyRevision: 0,
  });
assert.equal(initialSnapshot.components.length, 1);
assert.deepEqual(initialSnapshot.components[0].bodyPartIds, [1, 2, 3, 4]);
assert.deepEqual(initialSnapshot.components[0].partIds, [1, 2, 20, 3, 4]);
assert.equal(initial.componentForPart(4), initialSnapshot.components[0]);

const initialFromDifferentOrder = new PhysicalAssemblyIndex({
  ...compiled,
  constraints: [...compiled.constraints].reverse(),
}).refresh({
  runGraph: graph(),
  constraintEntries: entries,
  topologyRevision: 0,
});
assert.equal(
  initialSnapshot.components[0].id,
  initialFromDifferentOrder.components[0].id,
  "physical identity depended on compiler/runtime iteration order",
);

entries.find((entry) => entry.descriptor.id === "joint-b").active = false;
const failureEvent = {
    graphRevision: 1,
    failedConnectionIds: ["connection-b"],
    detachedPartIds: [],
  },
  split = initial.refresh({
    runGraph: graph([failureEvent]),
    constraintEntries: entries,
    topologyRevision: 1,
  });
assert.deepEqual(
  split.components.map((component) => component.bodyPartIds),
  [
    [1, 2],
    [3, 4],
  ],
);
for (const component of split.components) {
  assert.deepEqual(component.lineage.parentIds, [
    initialSnapshot.components[0].id,
  ]);
  assert.deepEqual(component.lineage.splitFromIds, [
    initialSnapshot.components[0].id,
  ]);
  assert.deepEqual(component.lineage.structuralEventIds, ["structural:1"]);
}

const restored = new PhysicalAssemblyIndex(compiled).refresh({
  runGraph: graph([failureEvent]),
  constraintEntries: entries,
  topologyRevision: 1,
});
assert.deepEqual(
  restored,
  split,
  "physical split identity or lineage depended on prior in-memory history",
);
assert(Object.isFrozen(split.components[0].lineage));

const mobilityCompiled = {
    bodies: [10, 11, 12, 20, 21].map((partId) => ({
      id: `mobility-body:${partId}`,
      partId,
    })),
    constraints: [
      {
        id: "left-front",
        kind: "fixed",
        a: 10,
        b: 11,
        sourceConnectionIds: ["left-front-connection"],
      },
      {
        id: "left-rear",
        kind: "fixed",
        a: 10,
        b: 12,
        sourceConnectionIds: ["left-rear-connection"],
      },
      {
        id: "right-wheel",
        kind: "fixed",
        a: 20,
        b: 21,
        sourceConnectionIds: ["right-wheel-connection"],
      },
    ],
    contactRegions: [11, 12, 21].map((sourcePartId) => ({
      kind: "rolling-contact-v1",
      sourcePartId,
    })),
  },
  mobilityEntries = mobilityCompiled.constraints.map((descriptor) => ({
    descriptor,
    active: true,
  })),
  mobilityIndex = new PhysicalAssemblyIndex(mobilityCompiled),
  mobilityGraph = graph(),
  commandBus = new CommandBus(),
  wheelPartIds = new Set([11, 12, 21]),
  runtime = {
    compiled: mobilityCompiled,
    hasWheels: () => true,
    mobilityTelemetryFor(component, context) {
      const wheels = component.bodyPartIds.filter((id) => wheelPartIds.has(id));
      if (!wheels.length) return null;
      const targetId = component.bodyPartIds.includes(10)
        ? 10
        : component.bodyPartIds.includes(20)
          ? 20
          : null;
      return {
        assemblyId: component.id,
        framePartId: component.framePartId,
        memberPartIds: component.supportPartIds,
        wheelStates: wheels.map((partId) => ({ partId })),
        requestedThrottle:
          targetId == null
            ? 0
            : context.commandBus.read(targetId, "command").value,
        lineage: component.lineage,
      };
    },
  },
  mobilityContext = {
    commandBus,
    services: {
      multibodyRuntime: runtime,
      physicalAssemblyIndex: mobilityIndex,
    },
    telemetry: {},
  },
  mobilitySystem = new MobilityTelemetrySystem();
mobilityIndex.refresh({
  runGraph: mobilityGraph,
  constraintEntries: mobilityEntries,
  topologyRevision: 0,
});
commandBus.writeRemote(10, "command", 1);
mobilitySystem.step(mobilityContext, 1 / 120);
assert.equal(mobilityContext.telemetry.mobility.assemblies.length, 2);
assert.ok(
  mobilityContext.telemetry.mobility.assemblies.every(
    (record) => record.driveForce.motors.length === 0,
  ),
  "minimal mobility runtime invented motor evidence",
);
assert.deepEqual(
  mobilityContext.telemetry.mobility.assemblies.map((record) => ({
    members: record.memberPartIds,
    throttle: record.requestedThrottle,
  })),
  [
    { members: [10, 11, 12], throttle: 1 },
    { members: [20, 21], throttle: 0 },
  ],
  "an exact command leaked into an independent wheeled assembly",
);
assert.equal(Object.hasOwn(mobilityContext.telemetry, "rover"), false);
assert.equal(Object.hasOwn(mobilityContext.telemetry, "wheels"), false);

mobilityEntries.find((entry) => entry.descriptor.id === "left-front").active =
  false;
const mobilityFailure = {
  graphRevision: 1,
  failedConnectionIds: ["left-front-connection"],
  detachedPartIds: [],
};
mobilityIndex.refresh({
  runGraph: graph([mobilityFailure]),
  constraintEntries: mobilityEntries,
  topologyRevision: 1,
});
mobilityContext.telemetry = {};
mobilitySystem.step(mobilityContext, 1 / 120);
assert.equal(mobilityContext.telemetry.mobility.assemblies.length, 3);
const commandedChild = mobilityContext.telemetry.mobility.assemblies.find(
    (record) => record.memberPartIds.includes(10),
  ),
  detachedWheel = mobilityContext.telemetry.mobility.assemblies.find((record) =>
    record.memberPartIds.includes(11),
  ),
  untouchedAssembly = mobilityContext.telemetry.mobility.assemblies.find(
    (record) => record.memberPartIds.includes(20),
  );
assert.equal(commandedChild.requestedThrottle, 1);
assert.equal(detachedWheel.requestedThrottle, 0);
assert.equal(untouchedAssembly.requestedThrottle, 0);
assert.deepEqual(
  commandedChild.lineage.splitFromIds,
  detachedWheel.lineage.splitFromIds,
  "structural children did not retain the same explicit split ancestor",
);
assert.equal(
  mobilityIndex.componentForPart(10).id,
  commandedChild.assemblyId,
  "exact target following did not resolve through the canonical index child",
);

console.log(
  "physical assembly index passed (canonical identity, per-assembly mobility, deterministic split lineage)",
);
