import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import {
  assertRejectedEditUnchanged,
  assertEditRoundTrip,
  assertNoOpEditUnchanged,
  assertAccumulatedEditHistory,
} from './contracts/editing.mjs';
const fixture = () => {
  const bp = createEmptyBlueprint('contracts', 'Contracts');
  bp.parts = [
    ['chassis', 'base'],
    ['poweredMotor', 'motor'],
    ['gripWheel', 'wheel'],
    ['powerCell', 'cell'],
    ['commandReceiver', 'receiver'],
  ].map(([type, id], i) => createPart(type, id, [i * 2, 2, 0]));
  return bp;
};
const edits = [
  { type: 'rename', id: 'motor', name: 'Traction motor' },
  { type: 'parameter', id: 'wheel', key: 'diameter', value: 0.3 },
  { type: 'material', id: 'base', primitive: 'body', material: 'rubber' },
  { type: 'transform', id: 'motor', position: [2, 3, 0], rotation: [0, 0, 0, 1] },
  {
    type: 'connect',
    id: 'shaft',
    a: { part: 'motor', port: 'shaft' },
    b: { part: 'wheel', port: 'axle' },
  },
  {
    type: 'connect',
    id: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'motor', port: 'power' },
  },
  { type: 'delete', id: 'cell' },
  { type: 'place', id: 'beam', partType: 'beam', position: [12, 2, 0] },
];
test('registered edit examples share rejection and round-trip behavioral contracts', async () => {
  for (const command of edits) {
    const w = await createWorkshop(fixture());
    try {
      await assertRejectedEditUnchanged(w, { ...command, unknownField: true });
      await assertEditRoundTrip(w, command);
    } finally {
      w.dispose();
    }
  }
});
test('mixed resize, axle attachment, rotation, undo and reload preserve connections', async () => {
  const w = await createWorkshop(fixture());
  try {
    for (const command of [
      edits[1],
      edits[4],
      { ...edits[3], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
    ]) {
      await assertEditRoundTrip(w, command);
      assert.ok(w.observe().frames[0].metadata.connections.every((c) => c.reasonCode === 'OK'));
    }
    await assertRejectedEditUnchanged(w, {
      type: 'parameter',
      id: 'wheel',
      key: 'diameter',
      value: 100,
    });
  } finally {
    w.dispose();
  }
});

function wrongCursorWorkshop() {
  let blueprint = { parts: [{ id: 'motor', name: 'before' }] },
    previous;
  return {
    observe: () => ({
      cursor: { session: 'fake', epoch: 0, revision: 0, tick: 0 },
      frames: [{ metadata: { blueprint } }],
    }),
    async act(command) {
      if (command.type === 'rename') {
        previous = blueprint;
        blueprint = { parts: [{ id: 'motor', name: command.name }] };
      } else if (command.type === 'undo' || command.type === 'redo')
        [blueprint, previous] = [previous, blueprint];
      else if (command.type === 'load') blueprint = command.save;
      return { ok: true };
    },
  };
}
test('success contract rejects a blueprint-correct implementation that never advances its cursor', async () => {
  await assert.rejects(() => assertEditRoundTrip(wrongCursorWorkshop(), edits[0]), /revision/);
});
test('no-op contract rejects publication and preserves real redo history', async () => {
  let revision = 0;
  const wrong = {
    observe: () => ({ cursor: { revision }, frames: [] }),
    act: async () => {
      revision++;
      return { ok: true };
    },
  };
  await assert.rejects(() => assertNoOpEditUnchanged(wrong, {}), /no-op/);
  const w = await createWorkshop(fixture());
  try {
    assert.equal((await w.act(edits[0])).ok, true);
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    const part = w.save().parts.find((p) => p.id === 'motor');
    await assertNoOpEditUnchanged(w, { type: 'rename', id: part.id, name: part.name });
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.equal(w.save().parts.find((p) => p.id === 'motor').name, 'Traction motor');
  } finally {
    w.dispose();
  }
});
test('accumulated heterogeneous edits undo to every prior state before redo and load', async () => {
  const w = await createWorkshop(fixture());
  try {
    await assertAccumulatedEditHistory(w, [
      edits[1],
      edits[4],
      { ...edits[3], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
    ]);
    assert.equal(w.save().parts.find((p) => p.id === 'wheel').parameters.diameter, 0.3);
    assert.equal(w.save().connections.length, 1);
  } finally {
    w.dispose();
  }
});
