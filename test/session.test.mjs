import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
const config = {
  power: {
    cells: [],
    motors: [],
    wires: [],
    signalWires: [],
    receivers: [],
    controllers: [],
    sensors: [],
  },
  gravity: [0, -9.81, 0],
  joints: [],
  bodies: [
    {
      position: [0, 10, 0],
      velocity: [0, 0, 0],
      mass: 1,
      shape: 'box',
      halfExtents: [0.1, 0.1, 0.1],
      fixed: false,
      rotation: [0, 0, 0, 1],
      friction: 0.5,
      restitution: 0,
    },
  ],
};
test('one fixed clock yields identical state under elapsed and tick drivers', async () => {
  const a = await createSession(config),
    b = await createSession(config);
  try {
    a.step(120);
    for (let i = 0; i < 60; i++) b.advanceTime(1000 / 60);
    assert.deepEqual(a.observe().frames.at(-1).physics, b.observe().frames.at(-1).physics);
    assert.equal(b.observe().cursor.tick, 120);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('checkpoint restores tick and future physics but advances observation epoch', async () => {
  const a = await createSession(config);
  try {
    a.step(12);
    const cp = a.checkpoint(),
      cursor = a.observe().cursor;
    a.step(20);
    const expected = a.observe().frames.at(-1).physics;
    a.restore(cp);
    assert.equal(a.observe('scene', 'full', cursor).reasonCode, 'RESYNC_REQUIRED');
    a.step(20);
    assert.deepEqual(a.observe().frames.at(-1).physics, expected);
  } finally {
    a.dispose();
  }
});
test('impulses are scheduled once and command rejection does not mutate state', async () => {
  const a = await createSession(config);
  try {
    const before = a.observe().cursor;
    assert.equal(a.act({ type: 'impulse', body: 99, value: [1, 0, 0] }).ok, false);
    assert.deepEqual(a.observe().cursor, before);
    assert.equal(a.act({ type: 'impulse', body: 0, value: [1, 0, 0] }).ok, true);
    a.step(2);
    assert.equal(a.observe().frames.at(-1).physics[0].velocity[0], 1);
  } finally {
    a.dispose();
  }
});
test('a physics numeric failure poisons advancement and preserves replay inputs', async () => {
  const a = await createSession(config);
  try {
    a.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    assert.throws(() => a.step(1), /physics numeric range/);
    assert.equal(a.failureBundle().reasonCode, 'PHYSICS_FAILURE');
    assert.equal(a.failureBundle().failedTick, 1);
    assert.equal(a.failureBundle().inputs.length, 1);
    assert.throws(() => a.step(1), /SESSION_FAILED/);
    assert.throws(() => a.checkpoint(), /SESSION_FAILED/);
  } finally {
    a.dispose();
  }
});
test('checkpoint rejection is atomic for malformed clocks inputs sensors and identity', async () => {
  const a = await createSession(config, { build: 'frozen' });
  try {
    a.step(2);
    const original = a.checkpoint(),
      cursor = a.observe().cursor;
    const edits = [
      (cp) => (cp.sequence = -1),
      (cp) => (cp.sequence = 0.5),
      (cp) => (cp.sensors = null),
      (cp) => (cp.sensors.tick = 99),
      (cp) => (cp.sensors.bodies[0].mass = -1),
      (cp) => (cp.extra = 1),
      (cp) => (cp.identity.build = 'other'),
      (cp) =>
        (cp.pending = [
          { tick: 3, sequence: 0, command: { type: 'impulse', body: 999, value: [1, 0, 0] } },
        ]),
      (cp) =>
        (cp.pending = Array(65).fill({
          tick: 3,
          sequence: 0,
          command: { type: 'impulse', body: 0, value: [1, 0, 0] },
        })),
    ];
    for (const edit of edits) {
      const cp = structuredClone(original);
      edit(cp);
      assert.throws(() => a.restore(cp));
      assert.deepEqual(a.checkpoint(), original);
      assert.deepEqual(a.observe().cursor, cursor);
    }
  } finally {
    a.dispose();
  }
});
test('identity is owned and huge elapsed calls reject without clock mutation', async () => {
  const identity = { build: 'original' },
    a = await createSession(config, identity);
  try {
    identity.build = 'mutated';
    assert.equal(a.checkpoint().identity.build, 'original');
    const cp = a.checkpoint();
    assert.throws(() => a.advanceTime(Number.MAX_VALUE));
    assert.deepEqual(a.checkpoint(), cp);
  } finally {
    a.dispose();
  }
});
test('failure at anchor boundary preserves previous interval inputs', async () => {
  const a = await createSession(config);
  try {
    a.act({ type: 'impulse', body: 0, value: [1, 0, 0] });
    a.step(1200);
    a.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    assert.throws(() => a.step(1));
    const bundle = a.failureBundle();
    assert.equal(bundle.anchor.tick, 0);
    assert.equal(bundle.inputs.length, 2);
  } finally {
    a.dispose();
  }
});
test('bounded runUntil uses declarative telemetry predicates', async () => {
  const a = await createSession(config);
  try {
    const result = a.runUntil({ quantity: 'tick', operator: 'gte', value: 3 }, 10);
    assert.equal(result.matched, true);
    assert.equal(result.ticks, 3);
    const stop = a.runUntil(
      { quantity: 'position', body: 0, axis: 1, operator: 'lte', value: -100 },
      2,
    );
    assert.equal(stop.matched, false);
    assert.equal(stop.ticks, 2);
    assert.throws(() => a.runUntil(() => true, 2));
    assert.throws(() => a.runUntil({ quantity: 'tick', operator: 'gte', value: 100 }, Infinity));
  } finally {
    a.dispose();
  }
});

test('pending inputs survive restore exactly once and poison can recover by restore', async () => {
  const a = await createSession(config);
  try {
    a.act({ type: 'impulse', body: 0, value: [2, 0, 0] });
    const cp = a.checkpoint();
    a.step(1);
    const expected = a.observe().frames[0].physics;
    a.restore(cp);
    a.step(1);
    assert.deepEqual(a.observe().frames[0].physics, expected);
    a.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    assert.throws(() => a.step(1));
    const cursor = a.observe().cursor;
    assert.throws(() => a.advanceTime(100), /SESSION_FAILED/);
    assert.deepEqual(a.observe().cursor, cursor);
    a.restore(cp);
    assert.equal(a.failureBundle(), null);
    a.step(1);
    assert.deepEqual(a.observe().frames[0].physics, expected);
  } finally {
    a.dispose();
  }
});
test('metadata is immutable telemetry data and checkpoint compatibility is enforced', async () => {
  const metadata = { blueprint: { name: 'authored' }, selection: null },
    a = await createSession(config, {}, metadata);
  try {
    metadata.blueprint.name = 'mutated';
    assert.equal(a.observe().frames[0].metadata.blueprint.name, 'authored');
    assert.throws(() => {
      a.observe().frames[0].metadata.blueprint.name = 'changed';
    });
    const cp = a.checkpoint();
    cp.metadata.blueprint.name = Infinity;
    assert.throws(() => a.restore(cp));
    const before = a.observe().cursor;
    a.setMetadata({ blueprint: { name: 'other' }, selection: 0 });
    assert.equal(a.observe().cursor.tick, before.tick);
    assert.equal(a.observe().cursor.epoch, before.epoch);
    assert.equal(a.observe().cursor.revision, before.revision + 1);
    assert.equal(a.observe().frames[0].metadata.selection, 0);
  } finally {
    a.dispose();
  }
});
test('reconfiguration resets owned state through same readmodel with fresh epoch', async () => {
  const a = await createSession(config, {}, { blueprint: 'first' });
  try {
    a.step(12);
    a.act({ type: 'impulse', body: 0, value: [1, 0, 0] });
    const before = a.observe().cursor;
    const replacement = { ...config, bodies: [{ ...config.bodies[0], position: [0, 20, 0] }] };
    await a.replaceConfiguration(replacement, { blueprint: 'second' });
    const after = a.observe();
    assert.equal(after.cursor.session, before.session);
    assert.equal(after.cursor.epoch, before.epoch + 1);
    assert.equal(after.cursor.revision, before.revision + 1);
    assert.equal(after.cursor.tick, 0);
    assert.equal(after.frames[0].physics[0].position[1], 20);
    assert.equal(after.frames[0].metadata.blueprint, 'second');
    assert.equal(a.checkpoint().pending.length, 0);
    assert.equal(a.checkpoint().sequence, 0);
    assert.equal(a.observe('scene', 'full', before).reasonCode, 'RESYNC_REQUIRED');
    a.step(1);
    assert.equal(a.observe().frames[0].physics[0].velocity[0], 0);
  } finally {
    a.dispose();
  }
});
test('invalid configuration or metadata replacement leaves checkpoint and cursor intact', async () => {
  const a = await createSession(config, {}, { blueprint: 'first' });
  try {
    a.step(2);
    const cp = a.checkpoint(),
      cursor = a.observe().cursor;
    await assert.rejects(a.replaceConfiguration({ ...config, gravity: [0, NaN, 0] }, {}));
    await assert.rejects(a.replaceConfiguration(config, { bad: Infinity }));
    assert.throws(() => a.setMetadata({ bad: undefined }));
    assert.deepEqual(a.checkpoint(), cp);
    assert.deepEqual(a.observe().cursor, cursor);
  } finally {
    a.dispose();
  }
});
test('checkpoint restores admitted metadata across later display mode changes', async () => {
  const a = await createSession(config, {}, { mode: 'paused', selection: 0 });
  try {
    const cp = a.checkpoint();
    a.setMetadata({ mode: 'running', selection: null });
    a.step(2);
    a.restore(cp);
    assert.deepEqual(a.observe().frames[0].metadata, { mode: 'paused', selection: 0 });
    assert.equal(a.observe().cursor.tick, 0);
    const malformed = a.checkpoint();
    malformed.metadata.bad = Infinity;
    const before = a.observe().cursor;
    assert.throws(() => a.restore(malformed));
    assert.deepEqual(a.observe().cursor, before);
  } finally {
    a.dispose();
  }
});
