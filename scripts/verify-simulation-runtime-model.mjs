import { assert } from "./lib/assert.mjs";
import { BodyRegistry } from "../src/simulation/body-registry.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";

const editor = {
  revision: 7,
  parts: [
    {
      id: 1,
      type: "battery",
      storedEnergyWh: 100,
      config: { capacityWh: 100 },
      pos: [0, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
    },
    {
      id: 2,
      type: "computer",
      config: {},
      pos: [1, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
    },
    {
      id: 3,
      type: "motor",
      config: { power: 4 },
      pos: [2, 1, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
    },
  ],
  connections: [
    {
      id: "power",
      a: 1,
      b: 2,
      portA: "POWER",
      portB: "POWER",
      kind: "power",
    },
    {
      id: "signal",
      a: 2,
      b: 3,
      portA: "OUT",
      portB: "CONTROL",
      kind: "signal",
    },
  ],
};
const editorBefore = structuredClone(editor),
  graph = new RunAssemblyGraph(editor);
assert.ok(Object.isFrozen(graph.startSnapshot()));
assert.deepEqual(editor, editorBefore, "run graph mutated its editor source");
assert.deepEqual(graph.connectedPartIds(2, "power"), [1]);
assert.deepEqual(graph.connectedPartIds(2, "signal"), [3]);

graph.consumeEnergy(1, 12.5 * 3600);
graph.setControllerState(2, { ready: true, commands: { throttle: 0.5 } });
graph.applyLoad("signal", {
  loadN: 400,
  stress: 0.4,
  fatigueDelta: 0.2,
  time: 1,
});
assert.equal(graph.part(1).energyWh, 87.5);
assert.equal(graph.part(1).energyJ, 87.5 * 3600);
assert.equal(graph.controllerState(2).commands.throttle, 0.5);
assert.equal(graph.connection("signal").peakLoadN, 400);
assert.deepEqual(editor, editorBefore, "runtime mutations leaked into editor");

const beforeFailureRevision = graph.graphRevision,
  failure = graph.applyStructuralEvent({
    failedConnectionIds: ["signal"],
    detachedPartIds: [3],
    reason: "test overload",
    time: 2,
  });
assert.equal(failure.graphRevision, beforeFailureRevision + 1);
assert.equal(graph.graphRevision, beforeFailureRevision + 1);
assert.equal(graph.connection("signal").failed, true);
assert.equal(graph.part(3).detached, true);
assert.deepEqual(graph.connectedPartIds(2, "signal"), []);
assert.equal(
  graph.applyStructuralEvent({
    failedConnectionIds: ["signal"],
    detachedPartIds: [3],
  }).changed,
  false,
  "idempotent structural replay changed graph revision",
);
const graphSnapshot = graph.snapshot();
assert.ok(
  Object.isFrozen(graphSnapshot) && Object.isFrozen(graphSnapshot.parts[0]),
  "run graph snapshot is mutable",
);
assert.throws(() => graphSnapshot.parts.push({}), TypeError);
assert.equal(
  graph.snapshot(),
  graphSnapshot,
  "unchanged run snapshots must be structurally shared",
);
const restartedGraph = new RunAssemblyGraph(graph.startSnapshot());
assert.equal(restartedGraph.part(1).energyWh, 100);
assert.equal(restartedGraph.connection("signal").failed, false);
assert.deepEqual(
  editor,
  editorBefore,
  "stop/retry reconstruction leaked runtime state into the editor",
);

const registry = new BodyRegistry(editor);
assert.equal(registry.snapshot().bodies.length, 3);
assert.equal(registry.bodyForPart(1).bound, false);
registry.registerBody("vehicle", [1, 2, 3], {
  engineBody: { opaque: true },
  constraintIds: ["power", "signal"],
  pose: {
    position: { x: 0, y: 1, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 2 },
  },
});
assert.equal(registry.snapshot().bodies.length, 1);
assert.equal(registry.bodyForPart(1).bound, true);
assert.equal(registry.bodyForPart(3).bodyId, "vehicle");
assert.deepEqual(registry.engineBody("vehicle"), { opaque: true });
registry.beginTick(1);
registry.updateKinematics(
  "vehicle",
  {
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 4, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 1, z: 0 },
  },
  0.5,
);
registry.recordContact("vehicle", {
  point: { x: 1, y: 0, z: 3 },
  normal: { x: 0, y: 1, z: 0 },
  forceN: 900,
  impulseNs: 7.5,
  relativeVelocity: { x: 0.5, y: -1.25, z: 0 },
  otherBodyId: "ground",
  surface: "field",
});
registry.recordLoad("vehicle", {
  connectionId: "signal",
  forceN: 400,
  torqueNm: 12,
});
registry.setThermal("vehicle", { temperatureK: 420 });
const body = registry.body("vehicle");
assert.deepEqual(body.acceleration, { x: 8, y: 0, z: 0 });
assert.equal(body.contacts[0].forceN, 900);
assert.equal(body.contacts[0].impulseNs, 7.5);
assert.deepEqual(body.contacts[0].relativeVelocity, {
  x: 0.5,
  y: -1.25,
  z: 0,
});
assert.equal(body.contacts[0].otherBodyId, "ground");
assert.equal(body.loads[0].torqueNm, 12);
assert.equal(body.thermal.temperatureK, 420);
assert.ok(registry.removeConstraint("signal"));
assert.deepEqual(registry.body("vehicle").constraintIds, ["power"]);
registry.registerConstraint("virtual:controller", 3, {
  sourceConnectionIds: ["signal"],
  pose: {
    position: { x: 1, y: 2.5, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  },
  angle: 0.2,
  angularVelocity: 0.4,
  reactionTorque: 12,
});
assert.equal(registry.bodyForPart(3), null);
assert.equal(registry.constraintForPart(3).angle, 0.2);
assert.deepEqual(registry.constraintBindings(), [
  { constraintId: "virtual:controller", partId: 3 },
]);
registry.updateConstraint("virtual:controller", {
  angle: 0.35,
  detached: true,
});
assert.equal(registry.constraint("virtual:controller").angle, 0.35);
assert.equal(registry.constraint("virtual:controller").detached, true);
assert.equal(registry.snapshot().constraints.length, 1);
assert.ok(Object.isFrozen(registry.snapshot()));
assert.equal(
  registry.snapshot(),
  registry.snapshot(),
  "unchanged body snapshots must be structurally shared",
);
registry.beginTick(2);
assert.deepEqual(registry.body("vehicle").contacts, []);

console.log(
  `simulation runtime model passed (${graph.revision} state revisions, ${registry.snapshot().bodies.length} body)`,
);
