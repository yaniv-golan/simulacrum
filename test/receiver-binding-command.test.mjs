import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
test('receiver bindings are authored, undoable, and reject invalid edits atomically', async () => {
  const w = await createWorkshop();
  try {
    assert.equal(
      (await w.act({ type: 'place', partType: 'commandReceiver', id: 'r', position: [0, 1, 0] }))
        .ok,
      true,
    );
    const binding = {
      mode: 'hold',
      drive: { gain: 1, positiveKeys: ['KeyW'], negativeKeys: ['KeyS'] },
      steer: { gain: -1, positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
    };
    assert.equal((await w.act({ type: 'bind-control', id: 'r', binding })).ok, true);
    assert.deepEqual(w.observe().frames[0].metadata.blueprint.parts[0].controlBinding, binding);
    const before = w.observe();
    assert.equal(
      (await w.act({ type: 'bind-control', id: 'r', binding: { ...binding, mode: 'magic' } })).ok,
      false,
    );
    assert.deepEqual(w.observe(), before);
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.equal(w.observe().frames[0].metadata.blueprint.parts[0].controlBinding, undefined);
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.deepEqual(w.observe().frames[0].metadata.blueprint.parts[0].controlBinding, binding);
  } finally {
    w.dispose();
  }
});
