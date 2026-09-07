import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { palettePlacement } from '../src/model/palette-placement.mjs';
import { findPlacementOverlap } from '../src/model/surfaces.mjs';
test('palette click skips occupied slots without moving existing authored parts', () => {
  const b = createEmptyBlueprint('x', 'x');
  b.parts.push(createPart('chassis', 'frame', [-0.9, 0.4, 0]));
  const before = structuredClone(b);
  const result = palettePlacement(b, 'gripWheel', 'wheel', 0);
  assert.ok(result.index > 0);
  assert.equal(
    findPlacementOverlap([...b.parts, createPart('gripWheel', 'wheel', result.position)]),
    null,
  );
  assert.deepEqual(b, before);
  assert.deepEqual(palettePlacement(createEmptyBlueprint('y', 'y'), 'gripWheel', 'w', 0), {
    position: [-0.9, 0.4, 0],
    index: 0,
  });
});
