import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, validateBlueprint } from '../src/model/blueprint.mjs';
import { duplicatePart, DUPLICATE_GRID_M } from '../src/model/duplication.mjs';
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    actual.length === expected.length &&
      actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance),
    `${JSON.stringify(actual)} is not near ${JSON.stringify(expected)}`,
  );

function fixture(type = 'beam', position = [0, 2, 0]) {
  const blueprint = createEmptyBlueprint('workshop', 'Workshop');
  blueprint.parts = [createPart(type, 'original', position)];
  return blueprint;
}
test('duplicate preserves authored choices without mutating the original or copying connections', () => {
  const blueprint = fixture('poweredMotor'),
    original = blueprint.parts[0];
  original.name = 'Custom motor';
  original.parameters.defaultDuty = -0.7;
  original.parameters.currentLimit = 8;
  original.authoredMaterial.body = 'rubber';
  original.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  blueprint.parts.push(createPart('powerCell', 'cell', [4, 2, 0]));
  blueprint.connections.push({
    id: 'wire',
    kind: 'power',
    a: { part: 'original', port: 'power' },
    b: { part: 'cell', port: 'power' },
  });
  const before = structuredClone(blueprint),
    copy = duplicatePart(blueprint, 'original', 'copy', [0, 0, -8]);
  // The motor's 160 mm length now lies along Z; extent + 25 mm snaps outward to 0.2 m.
  near(copy.position, [0, 2, -0.2]);
  assert.deepEqual(
    { ...copy, position: null },
    { ...original, id: 'copy', name: 'Custom motor-2', position: null },
  );
  assert.deepEqual(blueprint, before);
  assert.equal(validateBlueprint({ ...blueprint, parts: [...blueprint.parts, copy] }).ok, true);
  copy.parameters.currentLimit = 9;
  copy.authoredMaterial.body = 'steel';
  copy.rotation[0] = 0.2;
  assert.deepEqual(blueprint, before);
});
test('a copy lands one extent plus clearance from the original, snapped outward to the grid', () => {
  // Beam 400 × 40 × 40 mm: sideways the extent is 40 mm → 65 mm snaps up to 75 mm;
  // along its own axis 400 mm → 425 mm. A cell is 200 mm long → 225 mm.
  near(duplicatePart(fixture(), 'original', 'copy', [0, 0, 1]).position, [0, 2, 0.075]);
  near(duplicatePart(fixture(), 'original', 'copy', [-1, 0, 0]).position, [-0.425, 2, 0]);
  near(duplicatePart(fixture('powerCell'), 'original', 'copy', [1, 0, 0]).position, [0.225, 2, 0]);
  // Wrong control: the old rule stepped a full metre.
  assert.ok(Math.abs(duplicatePart(fixture(), 'original', 'copy', [0, 0, 1]).position[2]) < 0.5);
  // The distance is a whole number of grid steps.
  const z = duplicatePart(fixture(), 'original', 'copy', [0, 0, 1]).position[2];
  assert.ok(Math.abs(z / DUPLICATE_GRID_M - Math.round(z / DUPLICATE_GRID_M)) < 1e-9);
});
test('the direction is quantised to one floor axis, never diagonal, with a stable tie-break', () => {
  near(duplicatePart(fixture(), 'original', 'copy', [3, 0, 4]).position, [0, 2, 0.075]);
  near(duplicatePart(fixture(), 'original', 'copy', [4, 0, -3]).position, [0.425, 2, 0]);
  near(duplicatePart(fixture(), 'original', 'copy', [1, 5, 1]).position, [0.425, 2, 0]); // tie → +X
  near(duplicatePart(fixture(), 'original', 'copy', [-0, 0, 0.5]).position, [0, 2, 0.075]);
  for (const vertical of [
    [0, 1, 0],
    [0, -3, 0],
  ])
    assert.throws(() => duplicatePart(fixture(), 'original', 'copy', vertical), {
      reasonCode: 'INVALID_VECTOR',
    });
});
test('an occupied candidate steps one grid at a time until the copy is clear', () => {
  const blueprint = fixture();
  // A beam obstacle centred 75 mm away spans 55–95 mm; 100 mm still overlaps it (80–120), 125 is free.
  blueprint.parts.push(createPart('beam', 'obstacle', [0, 2, 0.075]));
  near(duplicatePart(blueprint, 'original', 'copy', [0, 0, 1]).position, [0, 2, 0.125]);
});
test('rotated geometry of both selected and obstructing parts controls clearance', () => {
  const blueprint = fixture();
  // The beam stands along Z after a 90° turn, so its Z extent is 400 mm: 425 mm first.
  blueprint.parts[0].rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  blueprint.parts.push(createPart('beam', 'obstacle', [0, 2, 0.6]));
  blueprint.parts[1].rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  // The rotated obstacle spans 0.4–0.8 m along Z; a 400 mm copy touches it up to a centre of 1.0
  // (the overlap test is inclusive), so the first clear candidate is 1.025.
  near(duplicatePart(blueprint, 'original', 'copy', [0, 0, 1]).position, [0, 2, 1.025]);
  blueprint.parts.forEach((part) => {
    part.rotation = [0, 0, 0, 1];
  });
  // Unrotated, both are 40 mm deep in Z: the obstacle at 0.6 no longer touches 0.075.
  near(duplicatePart(blueprint, 'original', 'copy', [0, 0, 1]).position, [0, 2, 0.075]);
});
test('invalid direction, unknown source, and duplicate or invalid identity fail explicitly', () => {
  const blueprint = fixture();
  for (const direction of [[0, 0, 0], [NaN, 0, 1], [Infinity, 0, 0], [1, 0], null])
    assert.throws(() => duplicatePart(blueprint, 'original', 'copy', direction), {
      reasonCode: 'INVALID_VECTOR',
    });
  assert.throws(() => duplicatePart(blueprint, 'missing', 'copy', [1, 0, 0]), {
    reasonCode: 'UNKNOWN_PART',
  });
  assert.throws(() => duplicatePart(blueprint, 'original', 'original', [1, 0, 0]), {
    reasonCode: 'DUPLICATE_ID',
  });
  assert.throws(() => duplicatePart(blueprint, 'original', 'bad id', [1, 0, 0]), {
    reasonCode: 'INVALID_BLUEPRINT',
  });
});
test('occupied search limit and blueprint position bounds never produce an overlapping or invalid copy', () => {
  const blueprint = fixture();
  // A wall of beams every grid step along +X covers every candidate of a 256-step search.
  for (let i = 1; i <= 300; i++)
    blueprint.parts.push(createPart('beam', `obstacle-${i}`, [0.4 + i * DUPLICATE_GRID_M, 2, 0]));
  assert.throws(() => duplicatePart(blueprint, 'original', 'copy', [1, 0, 0]), {
    reasonCode: 'INVALID_COMMAND',
  });
  const edge = fixture('beam', [10000, 2, 0]);
  assert.throws(() => duplicatePart(edge, 'original', 'copy', [1, 0, 0]), {
    reasonCode: 'INVALID_COMMAND',
  });
  near(duplicatePart(edge, 'original', 'copy', [-1, 0, 0]).position, [9999.575, 2, 0], 1e-6);
});
test('long names still produce a valid authored copy and tiny finite directions normalize', () => {
  const blueprint = fixture();
  blueprint.parts[0].name = 'x'.repeat(128);
  const copy = duplicatePart(blueprint, 'original', 'copy', [1e-300, 0, 0]);
  assert.ok(copy.name.endsWith('-2'));
  assert.equal(copy.name.length, 128);
  near(copy.position, [0.425, 2, 0]);
  assert.equal(validateBlueprint({ ...blueprint, parts: [...blueprint.parts, copy] }).ok, true);
});
