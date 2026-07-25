import assert from "node:assert/strict";
import * as THREE from "three";
import { createSelectedContextCommandCatalog } from "../src/application/component-action-catalog.js";
import { createKeyboardActionRegistry } from "../src/application/keyboard-action-registry.js";
import { selectionCameraFrame } from "../src/presentation/selection-camera-frame.js";
import { createSelectionVisibilityController } from "../src/presentation/selection-visibility-controller.js";
import { replaceSelectOptions } from "../src/presentation/select-options.js";

const invoked = [],
  catalog = createSelectedContextCommandCatalog(),
  keyboard = createKeyboardActionRegistry();
catalog.setKeyboardRegistry(keyboard);
catalog.bind({
  "selection.duplicate": () => invoked.push("duplicate"),
});

const described = catalog.describe({
    selectedPartIds: [9, 3],
    impact: {
      externalConnectionCount: 2,
      externalControllerBindingCount: 1,
    },
  }),
  duplicate = described.find(({ id }) => id === "selection.duplicate"),
  frame = described.find(({ id }) => id === "selection.frame"),
  isolate = described.find(({ id }) => id === "selection.isolate"),
  showAll = described.find(({ id }) => id === "selection.show-all");

assert.deepEqual(duplicate.scope.selectedPartIds, [3, 9]);
assert.equal(duplicate.label, "Duplicate 2 components");
assert.match(duplicate.accessibleLabel, /2 external connections/);
assert.match(duplicate.accessibleLabel, /1 cross-selection controller binding/);
assert.deepEqual(duplicate.shortcutBindings, ["KeyC", "Primary+KeyD"]);
assert.equal(frame.label, "Frame 2 components");
assert.deepEqual(frame.shortcutBindings, ["KeyF"]);
assert.equal(isolate.visible, true);
assert.equal(isolate.availability, "available");
assert.equal(showAll.visible, false);
assert.equal(showAll.availability, "disabled");

const running = catalog.describe({ selectedPartIds: [3], running: true });
assert.equal(
  running.find(({ id }) => id === "selection.remove").availability,
  "disabled",
);
assert.equal(
  running.find(({ id }) => id === "selection.frame").availability,
  "available",
);
assert.equal(
  running.find(({ id }) => id === "selection.isolate").availability,
  "available",
);

const isolated = catalog.describe({
  selectedPartIds: [3],
  isolationActive: true,
});
assert.equal(
  isolated.find(({ id }) => id === "selection.isolate").visible,
  false,
);
assert.equal(
  isolated.find(({ id }) => id === "selection.show-all").visible,
  true,
);
assert.equal(
  isolated.find(({ id }) => id === "selection.show-all").availability,
  "available",
);

const revisionBeforeRemap = catalog.revision();
keyboard.setBinding("selection.frame", 0, "KeyJ");
assert.notEqual(catalog.revision(), revisionBeforeRemap);
assert.deepEqual(
  catalog
    .describe({ selectedPartIds: [3] })
    .find(({ id }) => id === "selection.frame").shortcutBindings,
  ["KeyJ"],
);

catalog.execute("selection.duplicate");
assert.deepEqual(invoked, ["duplicate"]);
assert.throws(
  () => catalog.execute("selection.remove"),
  /Selected-context command selection.remove is not bound/,
);

const renderedOptions = [],
  fakeSelect = {
    ownerDocument: { createElement: (tagName) => ({ tagName }) },
    replaceChildren: (...children) => renderedOptions.push(...children),
  };
replaceSelectOptions(
  fakeSelect,
  [{ key: 7, label: '<img src=x onerror="throw 1"> #7' }],
  7,
);
assert.deepEqual(renderedOptions, [
  {
    tagName: "option",
    value: "7",
    textContent: '<img src=x onerror="throw 1"> #7',
    selected: true,
  },
]);

const meshAt = (x) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.x = x;
    mesh.updateMatrixWorld(true);
    return mesh;
  },
  cameraFrame = selectionCameraFrame({
    parts: [
      { id: 1, type: "frame", mesh: meshAt(-10) },
      { id: 2, type: "motor", mesh: meshAt(10) },
      { id: 3, type: "sensor", mesh: meshAt(100) },
    ],
    selectedIds: new Set([1, 2]),
    machine: new THREE.Group(),
    camera: { fov: 50 },
    partName: (type) => type,
  });
assert.equal(cameraFrame.message, "Framed 2 selected components");
assert.equal(cameraFrame.target.x, 0);
assert.ok(
  cameraFrame.distance > 20,
  "multi-selection framing ignored the complete selected bounds",
);

const visibilityParts = [
    { id: 1, mesh: { visible: true } },
    { id: 2, mesh: { visible: false } },
    { id: 3, mesh: { visible: true } },
  ],
  visibilityEvents = [];
let selectedVisibilityIds = [1];
const visibility = createSelectionVisibilityController({
  model: {
    parts: () => visibilityParts,
    selectedIds: () => selectedVisibilityIds,
  },
  scene: { wires: { visible: true } },
  camera: {
    snapshot: () => ({ id: "original-camera" }),
    frameSelection: () => visibilityEvents.push("frame"),
    restoreSnapshot: (value) => visibilityEvents.push(value.id),
  },
  actions: {
    renderInspector: () => visibilityEvents.push("render"),
    notify: (message) => visibilityEvents.push(message),
  },
});
visibility.isolate();
assert.deepEqual(
  visibilityParts.map(({ mesh }) => mesh.visible),
  [true, false, false],
  "isolation did not hide every non-selected component",
);
assert.deepEqual(visibility.snapshot().isolatedPartIds, [1]);
visibility.showAll();
assert.deepEqual(
  visibilityParts.map(({ mesh }) => mesh.visible),
  [true, false, true],
  "Show All did not restore the pre-isolation visibility snapshot",
);
assert.ok(visibilityEvents.includes("original-camera"));
visibility.isolate();
selectedVisibilityIds = [3];
visibility.selectionChanged();
assert.equal(
  visibility.active(),
  false,
  "changing selection left a newly selected hidden component isolated",
);

console.log(
  "component selection actions passed (scope, impact, bindings, framing, transient isolation)",
);
