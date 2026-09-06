import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyM1, compareRuns } from '../scripts/verify-m1.mjs';
import { replayBundle } from '../scripts/replay.mjs';
import { createSession } from '../src/simulation/session.mjs';
const configuration = {
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
test('four fresh processes agree at every tick under both Node clock drivers', async () => {
  const result = await verifyM1();
  assert.equal(result.nodeClocksVerified, true);
  assert.equal(result.browserRafVerified, false);
  assert.equal(new Set(result.runs.map((run) => run.pid)).size, 4);
  assert.equal(
    result.runs.every((run) => run.hashes.length === 120),
    true,
  );
  assert.equal(result.runs[0].hashes[0].tick, 1);
  assert.equal(result.runs[0].hashes.at(-1).tick, 120);
});
test('comparison names first divergent tick and rejects missing ticks', () => {
  const baseline = {
    hashes: [
      { tick: 1, hash: 'a' },
      { tick: 2, hash: 'b' },
    ],
  };
  assert.throws(
    () =>
      compareRuns(baseline, {
        hashes: [
          { tick: 1, hash: 'a' },
          { tick: 2, hash: 'wrong' },
        ],
      }),
    /tick 2/,
  );
  assert.throws(() => compareRuns(baseline, { hashes: [{ tick: 1, hash: 'a' }] }), /length/);
});
test('failure replay reproduces cause and completed projection; wrong trace fails', async () => {
  const session = await createSession(configuration, { build: 'test-only' });
  try {
    session.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    assert.throws(() => session.step(1));
    const bundle = session.failureBundle();
    assert.ok(bundle);
    const replay = await replayBundle(bundle);
    assert.equal(replay.matched, true);
    assert.equal(replay.failedTick, 1);
    const wrong = structuredClone(bundle);
    wrong.inputs[0].command.value = [0, 0, 0];
    await assert.rejects(() => replayBundle(wrong), /did not fail/);
  } finally {
    session.dispose();
  }
});
test('replay rejects a changed failure reason', async () => {
  const session = await createSession(configuration, { build: 'test-only' });
  try {
    session.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    assert.throws(() => session.step());
    const bundle = session.failureBundle();
    bundle.reasonCode = 'WRONG';
    await assert.rejects(() => replayBundle(bundle), /reason/);
  } finally {
    session.dispose();
  }
});
test('replay restores already queued anchor inputs exactly once', async () => {
  const session = await createSession(configuration, { build: 'test-only' });
  try {
    session.act({ type: 'impulse', body: 0, value: [1e39, 0, 0] });
    const checkpoint = session.checkpoint();
    session.restore(checkpoint);
    assert.throws(() => session.step());
    const bundle = session.failureBundle();
    assert.equal(bundle.anchor.pending.length, 1);
    assert.equal(bundle.inputs.length, 0);
    assert.equal((await replayBundle(bundle)).matched, true);
  } finally {
    session.dispose();
  }
});
