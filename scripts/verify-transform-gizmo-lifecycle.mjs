import assert from "node:assert/strict";
import * as THREE from "three";
import { createTransformControlsDomAdapter } from "../src/presentation/transform-controls-dom-adapter.js";
import { createTransformGizmoOperation } from "../src/presentation/transform-gizmo-operation.js";

class FakeElement {
  listeners = new Map();
  captured = new Set();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry !== listener),
    );
  }
  dispatch(type, pointerId) {
    for (const listener of [...(this.listeners.get(type) || [])])
      listener({ pointerId });
  }
  hasPointerCapture(pointerId) {
    return this.captured.has(pointerId);
  }
  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }
}

const element = new FakeElement(),
  calls = [],
  transform = {
    axis: "X",
    dragging: true,
    connect() {
      calls.push("connect");
    },
    disconnect() {
      calls.push("disconnect");
    },
    pointerUp(pointer) {
      assert.equal(pointer, null);
      calls.push("pointerUp");
      this.dragging = false;
      this.axis = null;
    },
  },
  adapter = createTransformControlsDomAdapter({ transform, element });
element.captured.add(11);
element.dispatch("pointerdown", 11);
element.dispatch("pointerdown", 22);
assert.equal(
  adapter.activePointer(),
  11,
  "a second pointer replaced the owner",
);
assert.equal(adapter.commitPointerCancel(22), false);
assert.deepEqual(calls, []);
assert.equal(adapter.commitPointerCancel(11), true);
assert.deepEqual(calls, ["disconnect", "pointerUp", "connect"]);
assert.equal(element.hasPointerCapture(11), false);
transform.dragging = true;
transform.axis = "Y";
element.dispatch("pointerdown", 33);
assert.equal(adapter.activePointer(), 33, "observers were not reinstalled");
assert.equal(adapter.commitActiveOperation(), true);
assert.equal(transform.dragging, false);
assert.equal(transform.axis, null);
assert.equal(adapter.beginDispose(), true);
assert.equal(adapter.beginDispose(), false);
assert.equal(adapter.commitActiveOperation(), false);

const mesh = new THREE.Object3D();
mesh.position.set(1, 2, 3);
const part = { id: 7, mesh, pos: [1, 2, 3], rot: 0 },
  groupPivot = new THREE.Object3D(),
  historySnapshot = { marker: "before" },
  events = [],
  operation = createTransformGizmoOperation({
    control: { mode: "translate", axis: "Y", object: mesh },
    groupPivot,
    model: {
      parts: () => [part],
      selectedId: () => part.id,
      selectedIds: () => new Set([part.id]),
    },
    actions: {
      captureHistorySnapshot: () => historySnapshot,
      appendCapturedHistory: (label, snapshot) =>
        events.push(["history", label, snapshot, [...part.pos]]),
      syncAssembly: () => events.push(["sync"]),
    },
    view: {
      showSelection: () => events.push(["selection"]),
      updateSelection: () => events.push(["update"]),
      drawConnections: () => events.push(["connections"]),
      refreshEngineering: () => events.push(["engineering"]),
    },
  });
assert.equal(operation.begin(), true);
mesh.position.y = 2.5;
assert.equal(operation.change(), true);
assert.strictEqual(events[0][2], historySnapshot);
assert.deepEqual(events[0][3], [1, 2, 3], "history captured changed state");
assert.deepEqual(part.pos, [1, 2.5, 3]);
assert.equal(operation.read().axis, "Y");
assert.deepEqual(operation.read().delta, [0, 0.5, 0]);
assert.equal(operation.finish("test"), true);
assert.equal(operation.finish("duplicate"), false);
assert.equal(events.filter(([kind]) => kind === "history").length, 1);
assert.equal(events.filter(([kind]) => kind === "sync").length, 1);

events.length = 0;
assert.equal(operation.begin(), true);
assert.equal(operation.finish("no-change"), false);
assert.equal(events.length, 0, "no-op handle press created side effects");

const leftMesh = new THREE.Object3D(),
  rightMesh = new THREE.Object3D(),
  multiPivot = new THREE.Object3D(),
  multiEvents = [];
leftMesh.position.set(0, 0, 0);
rightMesh.position.set(2, 0, 0);
multiPivot.position.set(1, 0, 0);
const multiParts = [
    { id: 1, mesh: leftMesh, pos: [0, 0, 0], rot: 0 },
    { id: 2, mesh: rightMesh, pos: [2, 0, 0], rot: 0 },
  ],
  multiOperation = createTransformGizmoOperation({
    control: { mode: "translate", axis: "Y", object: multiPivot },
    groupPivot: multiPivot,
    model: {
      parts: () => multiParts,
      selectedId: () => 1,
      selectedIds: () => new Set([1, 2]),
    },
    actions: {
      captureHistorySnapshot: () => ({
        parts: multiParts.map((entry) => [...entry.pos]),
      }),
      appendCapturedHistory: (_label, snapshot) =>
        multiEvents.push(["history", snapshot]),
      syncAssembly: () => multiEvents.push(["sync"]),
    },
    view: {
      showSelection() {},
      updateSelection() {},
      drawConnections() {},
      refreshEngineering() {},
    },
  });
assert.equal(multiOperation.begin(), true);
multiPivot.position.y = 1;
assert.equal(multiOperation.change(), true);
assert.deepEqual(
  multiParts.map((entry) => entry.pos),
  [
    [0, 1, 0],
    [2, 1, 0],
  ],
);
assert.deepEqual(multiOperation.read().pivot, [1, 1, 0]);
assert.deepEqual(multiOperation.read().delta, [0, 1, 0]);
assert.equal(multiOperation.finish("multi"), true);
assert.equal(multiEvents.filter(([kind]) => kind === "history").length, 1);
assert.equal(multiEvents.filter(([kind]) => kind === "sync").length, 1);

console.log("transform gizmo lifecycle verification passed");
