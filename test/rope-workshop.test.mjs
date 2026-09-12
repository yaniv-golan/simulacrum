import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
const fixture = () => {
  const bp = createEmptyBlueprint('rope', 'Rope');
  bp.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [1, 3, 0])];
  return bp;
};
const connection = {
  id: 'rope-1',
  kind: 'rope',
  a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
  b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
  rope: { restLength: 1.5, diameter: 0.02, segments: 8, material: 'nylon' },
};
test('rope creation, length edit, rejected edit, undo/redo, save, deletion and Build recovery', async () => {
  const w = await createWorkshop(fixture());
  try {
    assert.equal((await w.act({ type: 'rope', connection })).ok, true);
    assert.equal(w.observe().frames[0].ropes?.length, 8);
    const saved = w.save();
    assert.equal(saved.connections[0].rope.restLength, 1.5);
    const edited = structuredClone(connection);
    edited.rope.restLength = 2;
    assert.equal((await w.act({ type: 'rope', connection: edited })).ok, true);
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.deepEqual(w.save(), saved);
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.equal(w.save().connections[0].rope.restLength, 2);
    const before = w.save();
    edited.rope.restLength = 0;
    assert.equal((await w.act({ type: 'rope', connection: edited })).ok, false);
    assert.deepEqual(w.save(), before);
    assert.equal((await w.act({ type: 'run' })).ok, true);
    w.step(10);
    assert.equal(w.observe().frames[0].ropes.length, 8);
    assert.equal((await w.act({ type: 'build' })).ok, true);
    assert.deepEqual(w.save(), before);
    assert.equal((await w.act({ type: 'delete', id: 'b' })).ok, true);
    assert.equal(w.save().connections.length, 0);
    assert.equal((await w.act({ type: 'load', save: JSON.stringify(saved) })).ok, true);
    assert.deepEqual(w.save(), saved);
  } finally {
    w.dispose();
  }
});
