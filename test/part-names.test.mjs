import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
test('part names are distinct on addition and rename is undoable and saved', async () => {
  const w = await createWorkshop();
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await w.act({ type: 'place', partType: 'chassis', id: `p${i}`, position: [i, 1, 0] })).ok,
        true,
      );
    assert.deepEqual(
      w.save().parts.map((p) => p.name),
      ['Chassis', 'Chassis-2', 'Chassis-3'],
    );
    assert.equal((await w.act({ type: 'rename', id: 'p1', name: '  Rear frame  ' })).ok, true);
    assert.equal(w.save().parts[1].name, 'Rear frame');
    const saved = w.save();
    await w.act({ type: 'undo' });
    assert.equal(w.save().parts[1].name, 'Chassis-2');
    await w.act({ type: 'redo' });
    assert.deepEqual(w.save(), saved);
    assert.equal((await w.act({ type: 'rename', id: 'p1', name: '   ' })).ok, false);
    assert.deepEqual(w.save(), saved);
    assert.equal((await w.act({ type: 'rename', id: 'missing', name: 'Test' })).ok, false);
    const copy = structuredClone(w.save().parts[2]);
    copy.id = 'copy';
    copy.position = [5, 1, 0];
    await w.act({ type: 'insert', part: copy });
    assert.equal(w.save().parts.at(-1).name, 'Chassis-4');
    await w.act({ type: 'load', save: saved });
    assert.deepEqual(w.save(), saved);
  } finally {
    w.dispose();
  }
});
