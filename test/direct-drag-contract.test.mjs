import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownsDragPointer,
  canReleaseDrag,
  dragBlueprintCurrent,
} from '../src/presentation/direct-drag.mjs';
test('only the owning pointer may release a drag inside the canvas', () => {
  const drag = { pointerId: 7 },
    rect = { left: 10, right: 110, top: 20, bottom: 120 };
  const inside = { pointerId: 7, clientX: 50, clientY: 50 };
  assert.equal(ownsDragPointer(drag, inside), true);
  assert.equal(canReleaseDrag(drag, inside, rect), true);
  assert.equal(ownsDragPointer(drag, { ...inside, pointerId: 8 }), false);
  for (const point of [
    { clientX: 9 },
    { clientX: 111 },
    { clientY: 19 },
    { clientY: 121 },
    { pointerId: 8 },
  ])
    assert.equal(canReleaseDrag(drag, { ...inside, ...point }, rect), false);
  assert.equal(ownsDragPointer(null, inside), false);
  assert.equal(canReleaseDrag(drag, null, rect), false);
});

test('a drag cannot overwrite an intervening authored edit', () => {
  const blueprint = { parts: [{ id: 'motor', rotation: [0, 0, 0] }] };
  const drag = { blueprint };
  assert.equal(dragBlueprintCurrent(drag, structuredClone(blueprint)), true);
  const edited = structuredClone(blueprint);
  edited.parts[0].rotation[1] = Math.PI / 2;
  assert.equal(dragBlueprintCurrent(drag, edited), false);
});
