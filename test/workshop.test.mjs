import { assertRejectedEditUnchanged } from './contracts/editing.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
test('place connect run and restore use one observable command surface', async () => {
  const workshop = await createWorkshop();
  try {
    const cursor = workshop.observe().cursor;
    assert.equal(
      (await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] })).ok,
      true,
    );
    assert.notDeepEqual(workshop.observe().cursor, cursor);
    assert.equal(
      (await workshop.act({ type: 'place', partType: 'beam', id: 'b', position: [1, 2, 0] })).ok,
      true,
    );
    assert.equal(
      (
        await workshop.act({
          type: 'connect',
          id: 'ab',
          a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
          b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
        })
      ).ok,
      true,
    );
    assert.equal(workshop.observe().frames[0].metadata.blueprint.connections.length, 1);
    assert.equal((await workshop.act({ type: 'run' })).ok, true);
    workshop.step(10);
    assert.equal(workshop.observe().cursor.tick, 10);
    assert.equal(
      (await workshop.act({ type: 'place', partType: 'beam', id: 'c', position: [2, 2, 0] }))
        .reasonCode,
      'EDIT_REQUIRES_BUILD',
    );
    const cp = workshop.checkpoint();
    workshop.step(5);
    workshop.restore(cp);
    assert.equal(workshop.observe().cursor.tick, 10);
  } finally {
    workshop.dispose();
  }
});
test('malformed authoring is rejected without altering model or cursor', async () => {
  const workshop = await createWorkshop();
  try {
    await assertRejectedEditUnchanged(workshop, {
      type: 'place',
      partType: 'magic',
      id: 'x',
      position: [0, 0, 0],
    });
    await assertRejectedEditUnchanged(workshop, { type: 'delete', id: 'missing' });
  } finally {
    workshop.dispose();
  }
});
test('transform inputs are captured before async construction and cannot mutate saved state', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const position = [1, 2, 0],
      rotation = [0, 0, 0, 1];
    const accepted = workshop.act({ type: 'transform', id: 'a', position, rotation });
    position[0] = 99;
    rotation[3] = 0;
    assert.equal((await accepted).ok, true);
    assert.deepEqual(workshop.save(), workshop.observe().frames[0].metadata.blueprint);
    assert.deepEqual(workshop.save().parts[0].position, [1, 2, 0]);
  } finally {
    workshop.dispose();
  }
});
test('connection endpoints are captured and cannot mutate accepted authored metadata', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    await workshop.act({ type: 'place', partType: 'beam', id: 'b', position: [1, 2, 0] });
    const a = { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b = { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } };
    const accepted = workshop.act({ type: 'connect', id: 'ab', a, b });
    a.part = 'missing';
    b.port = 'wrong';
    assert.equal((await accepted).ok, true);
    assert.deepEqual(workshop.save(), workshop.observe().frames[0].metadata.blueprint);
  } finally {
    workshop.dispose();
  }
});
test('checkpoint restore across pause restores mode from the same read model', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    await workshop.act({ type: 'run' });
    workshop.step(2);
    const checkpoint = workshop.checkpoint();
    await workshop.act({ type: 'pause' });
    workshop.restore(checkpoint);
    assert.equal(workshop.observe().frames[0].metadata.mode, 'run');
    assert.equal(workshop.observe().cursor.tick, 2);
  } finally {
    workshop.dispose();
  }
});
test('commands reject accessors without invoking them and preserve observation', async () => {
  const workshop = await createWorkshop();
  try {
    let invoked = false;
    const before = workshop.observe();
    const command = {
      get type() {
        invoked = true;
        throw Object.assign(Error('injected'), { reasonCode: 'UNREGISTERED' });
      },
    };
    const result = await workshop.act(command);
    assert.equal(result.reasonCode, 'INVALID_COMMAND');
    assert.equal(invoked, false);
    assert.deepEqual(workshop.observe(), before);
  } finally {
    workshop.dispose();
  }
});
test('save exports are immutable copies of the observable blueprint', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const save = workshop.save();
    assert.throws(() => {
      save.parts[0].position[0] = 50;
    });
    assert.deepEqual(save, workshop.observe().frames[0].metadata.blueprint);
  } finally {
    workshop.dispose();
  }
});
test('restore rejects blueprint/config disagreement atomically', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const before = workshop.observe(),
      checkpoint = workshop.checkpoint();
    checkpoint.metadata.blueprint.parts[0].authoredMaterial.body = 'steel';
    assert.throws(() => workshop.restore(checkpoint), /INVALID_CHECKPOINT/);
    assert.deepEqual(workshop.observe(), before);
  } finally {
    workshop.dispose();
  }
});
test('restored valid renamed metadata is the sole source for saves and next edits', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const checkpoint = workshop.checkpoint();
    checkpoint.metadata.blueprint.name = 'Renamed machine';
    workshop.restore(checkpoint);
    assert.equal(workshop.save().name, 'Renamed machine');
    await workshop.act({ type: 'material', id: 'a', primitive: 'body', material: 'steel' });
    assert.equal(workshop.observe().frames[0].metadata.blueprint.name, 'Renamed machine');
  } finally {
    workshop.dispose();
  }
});
test('unknown material primitive cannot turn prototype assignment into a false success', async () => {
  const workshop = await createWorkshop();
  try {
    await workshop.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    const before = workshop.observe();
    assert.equal(
      (await workshop.act({ type: 'material', id: 'a', primitive: '__proto__', material: 'steel' }))
        .ok,
      false,
    );
    assert.deepEqual(workshop.observe(), before);
  } finally {
    workshop.dispose();
  }
});
test('disconnect undo redo preserve authored history and reject bad edits atomically', async () => {
  const w = await createWorkshop();
  try {
    for (const id of ['a', 'b'])
      assert.equal(
        (
          await w.act({
            type: 'place',
            partType: 'beam',
            id,
            position: [id.charCodeAt(0) - 97, 2, 0],
          })
        ).ok,
        true,
      );
    await w.act({
      type: 'connect',
      id: 'ab',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    });
    const joined = w.save();
    assert.equal((await w.act({ type: 'disconnect', id: 'ab' })).ok, true);
    assert.equal(w.save().connections.length, 0);
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.deepEqual(w.save(), joined);
    const before = w.observe(),
      history = w.observe().frames[0].metadata.editing;
    assert.equal(
      (await w.act({ type: 'disconnect', id: 'missing' })).reasonCode,
      'UNKNOWN_CONNECTION',
    );
    assert.deepEqual(w.observe(), before);
    assert.deepEqual(w.observe().frames[0].metadata.editing, history);
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.equal(w.save().connections.length, 0);
    await w.act({ type: 'run' });
    assert.equal((await w.act({ type: 'undo' })).reasonCode, 'EDIT_REQUIRES_BUILD');
    await w.act({ type: 'build' });
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.deepEqual(w.save(), joined);
    await w.act({ type: 'parameter', id: 'a', key: 'bogus', value: 1 });
    assert.equal(w.observe().frames[0].metadata.editing.redoCount, 1);
    await w.act({ type: 'delete', id: 'b' });
    assert.equal(w.observe().frames[0].metadata.editing.redoCount, 0);
    const cp = w.checkpoint();
    w.restore(cp);
    assert.deepEqual(w.observe().frames[0].metadata.editing, { undoCount: 0, redoCount: 0 });
    assert.equal((await w.act({ type: 'undo' })).reasonCode, 'NOTHING_TO_UNDO');
    assert.equal((await w.act({ type: 'redo' })).reasonCode, 'NOTHING_TO_REDO');
  } finally {
    w.dispose();
  }
});
test('rigid transform preserves connected group and leaves only wired part still', async () => {
  const w = await createWorkshop();
  try {
    for (const id of ['a', 'b', 'c'])
      await w.act({ type: 'place', partType: 'beam', id, position: [id.charCodeAt(0) - 97, 2, 0] });
    await w.act({
      type: 'connect',
      id: 'ab',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    });
    const old = w.save(),
      delta = old.parts[1].position.map((v, i) => v - old.parts[0].position[i]);
    assert.equal(
      (
        await w.act({
          type: 'transform',
          id: 'a',
          position: [1, 3, 2],
          rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        })
      ).ok,
      true,
    );
    const next = w.save();
    for (let i = 0; i < 3; i++)
      assert.ok(
        Math.abs(next.parts[1].position[i] - [1 - delta[1], 3 + delta[0], 2 + delta[2]][i]) < 1e-10,
      );
    assert.deepEqual(next.parts[2], old.parts[2]);
    assert.equal(w.observe().frames[0].metadata.connections[0].reasonCode, 'OK');
    const before = w.observe();
    assert.equal(
      (await w.act({ type: 'transform', id: 'a', position: [0, 0], rotation: [0, 0, 0, 0] })).ok,
      false,
    );
    assert.deepEqual(w.observe(), before);
    await w.act({ type: 'undo' });
    assert.deepEqual(w.save(), old);
  } finally {
    w.dispose();
  }
});
test('history is bounded and successful load resets it', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'a', position: [0, 2, 0] });
    for (let i = 0; i < 53; i++)
      await w.act({ type: 'transform', id: 'a', position: [i + 1, 2, 0], rotation: [0, 0, 0, 1] });
    assert.equal(w.observe().frames[0].metadata.editing.undoCount, 50);
    assert.throws(() => {
      w.observe().frames[0].metadata.editing.undoCount = 99;
    });
    const saved = w.save();
    await w.act({ type: 'load', save: {} });
    assert.equal(w.observe().frames[0].metadata.editing.undoCount, 50);
    assert.equal((await w.act({ type: 'load', save: saved })).ok, true);
    assert.equal(w.observe().frames[0].metadata.editing.undoCount, 0);
  } finally {
    w.dispose();
  }
});

test('Build reset retains f64 transforms; JSON text canonicalizes signed zero only', async () => {
  const w = await createWorkshop();
  try {
    assert.equal(
      (
        await w.act({
          type: 'place',
          partType: 'beam',
          id: 'precise',
          position: [0.10000000000000003, 2, -0],
        })
      ).ok,
      true,
    );
    const before = w
      .observe()
      .frames[0].physics.map((body) => ({ position: body.position, rotation: body.rotation }));
    assert.notEqual(before[0].position[0], Math.fround(before[0].position[0]));
    assert.equal((await w.act({ type: 'run' })).ok, true);
    w.step(3);
    assert.equal((await w.act({ type: 'build' })).ok, true);
    const after = w
      .observe()
      .frames[0].physics.map((body) => ({ position: body.position, rotation: body.rotation }));
    assert.deepEqual(after, before);
    assert.throws(() =>
      assert.deepEqual(
        after.map((b) => ({ ...b, position: b.position.map(Math.fround) })),
        before,
      ),
    );
    const raw = { ...w.observe().frames[0], signedZero: -0 };
    const text = JSON.parse(JSON.stringify(raw));
    assert.equal(Object.is(raw.signedZero, -0), true);
    assert.equal(Object.is(text.signedZero, 0), true);
    assert.deepEqual(text.physics, JSON.parse(JSON.stringify(raw.physics)));
  } finally {
    w.dispose();
  }
});
test('catalog placement accepts its current cursor and rejects stale proposals unchanged', async () => {
  const workshop = await createWorkshop();
  try {
    const cursor = workshop.observe().cursor;
    const command = {
      type: 'place',
      partType: 'beam',
      id: 'catalog-a',
      position: [0, 2, 0],
      expectedCursor: cursor,
    };
    assert.equal((await workshop.act(command)).ok, true);
    const before = workshop.observe();
    const rejected = await workshop.act({ ...command, id: 'catalog-b', position: [2, 2, 0] });
    assert.equal(rejected.reasonCode, 'STALE_PROPOSAL');
    assert.deepEqual(workshop.observe(), before);
  } finally {
    workshop.dispose();
  }
});
