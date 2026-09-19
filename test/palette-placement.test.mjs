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

test('palette click skips authored scene solids', () => {
  const b = createEmptyBlueprint('scene', 'Scene');
  b.environment = {
    ground: { friction: 0.6, restitution: 0 },
    objects: [
      {
        id: 'block',
        name: 'Block',
        shape: 'box',
        halfExtents: [0.5, 0.4, 0.5],
        position: [-0.9, 0.4, 0],
        rotation: [0, 0, 0, 1],
        material: 'steel',
        friction: 0.4,
        restitution: 0,
        fixed: true,
      },
    ],
  };
  const result = palettePlacement(b, 'gripWheel', 'wheel', 0);
  assert.ok(result.index > 0);
  assert.notDeepEqual(result.position, [-0.9, 0.4, 0]);
});
