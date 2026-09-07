import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
test('solid overlap cannot be committed by placement, transforms or loads; touching is allowed', async () => {
  const w = await createWorkshop();
  try {
    assert.equal(
      (await w.act({ type: 'place', partType: 'chassis', id: 'base', position: [0, 1, 0] })).ok,
      true,
    );
    const before = w.observe();
    assert.equal(
      (await w.act({ type: 'place', partType: 'poweredMotor', id: 'motor', position: [0, 1, 0] }))
        .reasonCode,
      'SURFACE_OVERLAP',
    );
    assert.deepEqual(w.observe(), before);
    assert.equal(
      (
        await w.act({
          type: 'place',
          partType: 'poweredMotor',
          id: 'motor',
          position: [0, 1.08, 0],
        })
      ).ok,
      true,
    );
    const valid = w.observe();
    assert.equal(
      (await w.act({ type: 'transform', id: 'motor', position: [0, 1, 0], rotation: [0, 0, 0, 1] }))
        .reasonCode,
      'SURFACE_OVERLAP',
    );
    assert.deepEqual(w.observe(), valid);
    const bad = createEmptyBlueprint('bad', 'bad');
    bad.parts = [createPart('chassis', 'a', [0, 1, 0]), createPart('poweredMotor', 'b', [0, 1, 0])];
    assert.equal(loadSave(bad).reasonCode, 'SURFACE_OVERLAP');
    assert.equal(
      (await w.act({ type: 'load', save: JSON.stringify(bad) })).reasonCode,
      'SURFACE_OVERLAP',
    );
    assert.deepEqual(w.observe(), valid);
  } finally {
    w.dispose();
  }
});

test('wheel bounds corners are empty while real cylinder intersections are blocked', () => {
  const bp = createEmptyBlueprint('corners', 'corners');
  bp.parts = [
    createPart('gripWheel', 'wheel', [0, 1, 0]),
    createPart('beam', 'beam', [0, 1.095, 0.095]),
  ];
  assert.equal(loadSave(bp).ok, true);
  bp.parts[1].position = [0, 1.02, 0.02];
  assert.equal(loadSave(bp).reasonCode, 'SURFACE_OVERLAP');
});
