import assert from "node:assert/strict";
import * as THREE from "three";
import { createAssemblyEditorFeature } from "../src/application/assembly-editor-feature.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";

const workspace = {
    parts: [],
    connections: [],
    running: false,
    selectedId: null,
    selectedIds: new Set(),
    selectedEntity: null,
    scriptControllerId: null,
    demo: null,
    activeChallenge: null,
    challengeStatus: "idle",
    challengeStartMode: null,
    lastTransformOperation: null,
  },
  historyRecords = [],
  history = {
    suspended: true,
    capture: () => ({
      partIds: workspace.parts.map((part) => part.id),
      connectionIds: workspace.connections.map((connection) => connection.id),
    }),
    record: (label, snapshot) => historyRecords.push({ label, snapshot }),
  },
  machine = new THREE.Group(),
  notifications = [];
let nextId = 1;
const editor = createAssemblyEditorFeature({
  workspace,
  history,
  controllers: { stopAll() {}, stopOne() {} },
  simulation: {
    destroyFlight() {},
    disposeTerrain() {},
    disposeMultibody() {},
    clearRuntimeTelemetry() {},
  },
  view: {
    machine,
    createMesh: componentMesh,
    newControllerSources: () => ({}),
    prepareFoot: (part) => part,
    resetExploded() {},
    select(ids, primary) {
      workspace.selectedIds = new Set(ids);
      workspace.selectedId = primary;
    },
    showSelection() {},
    clearEffect() {},
    syncAssembly() {},
    drawConnections() {},
    render() {},
    setMode() {},
    setMission() {},
    hideDriveHud() {},
    notify(message) {
      notifications.push(message);
    },
  },
  context: { resetChallenge() {}, assemblyReplaced() {} },
  getNextId: () => nextId,
  setNextId: (value) => {
    nextId = value;
  },
});

const left = editor.add("plate", [-2, 2, 0]),
  right = editor.add("plate", [2, 2, 0]);
history.suspended = false;
const rope = editor.addTwoEndedComponent({
  type: "rope",
  endpointPorts: ["END_A", "END_B"],
  targets: [
    { partId: left.id, port: "TOP", anchorLocalM: [0.4, 0, 0] },
    { partId: right.id, port: "TOP", anchorLocalM: [-0.4, 0, 0] },
  ],
  extraSlackM: 0.5,
});

assert.ok(rope, "atomic two-ended authoring did not create the Rope");
assert.equal(workspace.parts.length, 3);
assert.equal(workspace.connections.length, 2);
assert.deepEqual(
  workspace.connections.map((connection) => connection.portA),
  ["END_A", "END_B"],
);
assert.deepEqual(
  workspace.connections.map((connection) => connection.anchorB),
  [
    [0.4, 0, 0],
    [-0.4, 0, 0],
  ],
  "picked target surface anchors were not preserved",
);
assert.equal(rope.config.lengthM, 3.7);
assert.equal(
  historyRecords.length,
  1,
  "transaction created multiple undo entries",
);
assert.equal(historyRecords[0].label, "connect with Rope");
assert.deepEqual(historyRecords[0].snapshot.partIds, [left.id, right.id]);

const automaticallyAnchored = editor.addTwoEndedComponent({
  type: "rope",
  endpointPorts: ["END_A", "END_B"],
  targets: [{ partId: left.id }, { partId: right.id }],
  extraSlackM: 0.25,
});
assert.ok(
  automaticallyAnchored,
  "ordinary structural-surface targets could not derive their anchors",
);
assert.ok(
  workspace.connections
    .slice(-2)
    .every(
      (connection) =>
        connection.anchorB?.length === 3 &&
        connection.anchorB.every(Number.isFinite),
    ),
  "derived surface anchors did not use canonical editor orientations",
);

const beforeFailure = {
    partCount: workspace.parts.length,
    connectionCount: workspace.connections.length,
    nextId,
    historyCount: historyRecords.length,
  },
  failed = editor.addTwoEndedComponent({
    type: "rope",
    endpointPorts: ["END_A", "END_B"],
    targets: [
      { partId: left.id, port: "TOP", anchorLocalM: [0, 0, 0] },
      { partId: left.id, port: "TOP", anchorLocalM: [0, 0, 0] },
    ],
  });
assert.equal(failed, null, "duplicate second anchor did not abort transaction");
assert.deepEqual(
  {
    partCount: workspace.parts.length,
    connectionCount: workspace.connections.length,
    nextId,
    historyCount: historyRecords.length,
  },
  beforeFailure,
  "aborted two-ended transaction left partial state or history",
);
assert.ok(
  notifications.some((message) => /already has an attachment/.test(message)),
  "aborted transaction did not expose the exact validation cause",
);

console.log(
  "two-ended component authoring passed (atomic part plus connections, picked anchors, rollback, one history entry)",
);
