import assert from "node:assert/strict";
import * as THREE from "three";
import { createCameraInteractionController } from "../src/presentation/camera-interaction-controller.js";
import { projectWorkshopAxes } from "../src/presentation/workshop-orientation-indicator.js";

globalThis.getComputedStyle = () => ({
  display: "block",
  visibility: "visible",
  opacity: "1",
});

const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 1000),
  machine = new THREE.Group(),
  partMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  ),
  animatedRotor = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.1, 0.4),
    new THREE.MeshBasicMaterial(),
  ),
  part = { id: 1, type: "beam", mesh: partMesh },
  target = new THREE.Vector3(),
  listeners = new Map(),
  element = {
    style: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
    }),
    setPointerCapture() {},
  },
  controls = new Map(),
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false },
  view = {
    notify() {},
    query(selector) {
      if (!controls.has(selector))
        controls.set(selector, {
          classList,
          style: {},
          getBoundingClientRect: element.getBoundingClientRect,
        });
      return controls.get(selector);
    },
  };
partMesh.add(animatedRotor);
machine.add(partMesh);
let cameraTool = null,
  running = false;
const controller = createCameraInteractionController({
  scene: {
    camera,
    element,
    machine,
    floor: new THREE.Object3D(),
    fieldSurface: null,
    target,
  },
  assembly: {
    parts: () => [part],
    selectedId: () => part.id,
    selectedIds: () => new Set([part.id]),
    running: () => running,
    focusedEnvironmentObject: () => null,
    partName: () => "Beam",
  },
  editor: {
    tool: () => cameraTool,
    setTool: (value) => {
      cameraTool = value;
    },
  },
  view,
});

const key = (code, value = code) => ({
  code,
  key: value,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  preventDefault() {},
});
controller.handleNavigationKey(key("Numpad1", "1"));
assert.equal(controller.snapshot().axisViewId, "front");
controller.handleNavigationKey(key("Equal", "+"));
assert.equal(
  controller.snapshot().axisViewId,
  "front",
  "zoom cleared axis view",
);
controller.handleNavigationKey(key("KeyA", "a"));
assert.equal(
  controller.snapshot().axisViewId,
  "front",
  "pan cleared axis view",
);
controller.frameSelection();
assert.equal(
  controller.snapshot().axisViewId,
  "front",
  "frame cleared axis view",
);
controller.handleNavigationKey(key("ArrowLeft", "ArrowLeft"));
assert.equal(controller.snapshot().axisViewId, null);
controller.handleNavigationKey(key("Numpad3", "3"));
assert.equal(controller.snapshot().axisViewId, "side");
cameraTool = "pan";
assert.equal(
  controller.beginPointer({
    button: 0,
    clientX: 20,
    clientY: 20,
    pointerId: 1,
  }),
  true,
);
controller.movePointer({ clientX: 40, clientY: 30 });
controller.endPointer();
assert.equal(
  controller.snapshot().axisViewId,
  "side",
  "pointer pan cleared view",
);
cameraTool = "orbit";
controller.beginPointer({ button: 0, clientX: 20, clientY: 20, pointerId: 2 });
controller.movePointer({ clientX: 40, clientY: 30 });
controller.endPointer();
assert.equal(
  controller.snapshot().axisViewId,
  null,
  "orbit retained axis view",
);
controller.handleNavigationKey(key("Numpad7", "7"));
assert.equal(controller.snapshot().axisViewId, "top");
controller.applyPreset({
  id: "overview",
  positionM: [18, 14, 18],
  targetM: [0, 1.5, 0],
  fovDeg: 52,
});
assert.equal(controller.snapshot().axisViewId, null);
assert.equal(controller.snapshot().presetId, "overview");
controller.handleNavigationKey(key("Home", "Home"));
assert.equal(controller.snapshot().presetId, null);
assert.equal(controller.snapshot().axisViewId, null);

running = true;
partMesh.position.set(100, 20, -50);
controller.update(1 / 120);
const translatedTarget = controller.snapshot().target.clone(),
  initialTrackingRadius = controller.snapshot().tracking.boundsRadius;
assert.deepEqual(
  translatedTarget.toArray(),
  partMesh.position.toArray(),
  "running camera tracked the static machine scene root instead of the physical part roots",
);
animatedRotor.rotation.y = Math.PI / 2;
controller.update(1 / 120);
assert.deepEqual(
  controller.snapshot().target.toArray(),
  translatedTarget.toArray(),
  "animated child geometry moved the running camera target",
);
assert.ok(
  controller.snapshot().tracking.boundsRadius >= initialTrackingRadius,
  "animated child geometry contracted the active tracking envelope",
);

const identityProjection = Object.fromEntries(
  projectWorkshopAxes(new THREE.Quaternion()).map((axis) => [axis.id, axis]),
);
assert.deepEqual(
  [identityProjection.x.x, identityProjection.x.y, identityProjection.x.depth],
  [1, 0, 0],
);
assert.deepEqual(
  [identityProjection.y.x, identityProjection.y.y, identityProjection.y.depth],
  [0, 1, 0],
);
assert.deepEqual(
  [identityProjection.z.x, identityProjection.z.y, identityProjection.z.depth],
  [0, 0, 1],
);
const roundedProjection = (quaternion) =>
    Object.fromEntries(
      projectWorkshopAxes(quaternion).map(({ id, x, y, depth }) => [
        id,
        [x, y, depth].map((value) => +value.toFixed(6)),
      ]),
    ),
  sideProjection = roundedProjection(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
  ),
  topProjection = roundedProjection(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
  ),
  obliqueProjection = roundedProjection(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.7, 0.1)),
  );
assert.deepEqual(sideProjection, {
  x: [0, 0, 1],
  y: [0, 1, 0],
  z: [-1, 0, 0],
});
assert.deepEqual(topProjection, {
  x: [1, 0, 0],
  y: [0, 0, 1],
  z: [0, -1, 0],
});
assert.deepEqual(obliqueProjection, {
  x: [0.761021, -0.076357, 0.644218],
  y: [-0.157664, 0.941505, 0.297844],
  z: [-0.629276, -0.328235, 0.704466],
});

partMesh.geometry.dispose();
partMesh.material.dispose();
animatedRotor.geometry.dispose();
animatedRotor.material.dispose();
console.log("camera interaction controller verification passed");
