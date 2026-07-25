import assert from "node:assert/strict";
import * as THREE from "three";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import { WORKSHOP_AXIS_CONVENTION } from "../src/model/workshop-axis-convention.js";
import { createSelectionArranger } from "../src/presentation/selection-arranger.js";
import {
  WORKSHOP_AXIS_PRESENTATION,
  workshopCoordinateFrames,
  workshopCoordinateSystemSummary,
} from "../src/presentation/workshop-axis-presentation.js";

assert.equal(WORKSHOP_AXIS_CONVENTION.id, "x-east-y-up-z-north");
assert.equal(WORKSHOP_AXIS_CONVENTION.units, "m");
assert.equal(WORKSHOP_AXIS_CONVENTION.upAxis, "y");
assert.deepEqual(WORKSHOP_AXIS_CONVENTION.groundPlane, ["x", "z"]);
assert.deepEqual(
  WORKSHOP_AXIS_CONVENTION.axes.map(({ id, positive, negative }) => ({
    id,
    positive,
    negative,
  })),
  [
    { id: "x", positive: "east", negative: "west" },
    { id: "y", positive: "up", negative: "down" },
    { id: "z", positive: "north", negative: "south" },
  ],
);
assert.equal(
  WORKSHOP_TEST_SITE.coordinateFrame.axes,
  WORKSHOP_AXIS_CONVENTION.id,
);
assert.equal(
  WORKSHOP_TEST_SITE.coordinateFrame.units,
  WORKSHOP_AXIS_CONVENTION.units,
);
assert.equal(
  workshopCoordinateSystemSummary(),
  "meters, Y up, 0.25m move snap, 15deg rotation snap",
);
assert.deepEqual(workshopCoordinateFrames(), {
  version: 1,
  workshopAuthored: {
    axes: "x-east-y-up-z-north",
    units: "m",
    origin: "workshop-board-center",
    rebased: false,
    fields: [
      "parts[].position",
      "transformGizmo.startPivot",
      "transformGizmo.pivot",
    ],
  },
});
assert.deepEqual(
  WORKSHOP_AXIS_PRESENTATION.map(({ letter, meaning, short }) => ({
    letter,
    meaning,
    short,
  })),
  [
    { letter: "X", meaning: "EAST / WEST", short: "E/W" },
    { letter: "Y", meaning: "UP / DOWN", short: "U/D" },
    { letter: "Z", meaning: "NORTH / SOUTH", short: "N/S" },
  ],
);

const part = { id: 1, pos: [0, 0, 0], mesh: new THREE.Object3D() },
  arranger = createSelectionArranger({
    state: { running: false, editor: { selected: part.id }, parts: [part] },
    $$: () => [],
    selectedParts: () => [part],
    recordHistory() {},
    syncAssembly() {},
    drawWires() {},
    updateSelectionVisuals() {},
    showSelection() {},
    renderInspector() {},
    toast() {},
  }),
  markup = arranger.markup([part]);
assert.match(markup, /WORKSHOP POSITION · PIVOT · m/);
assert.match(markup, /X<\/b> EAST \/ WEST/);
assert.match(markup, /Y<\/b> UP \/ DOWN/);
assert.match(markup, /Z<\/b> NORTH \/ SOUTH/);
assert.match(markup, /Workshop Y position, up positive, metres/);
assert.match(markup, /YAW · ABOUT Y/);

console.log("workshop axis contract verification passed");
