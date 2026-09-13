import test from 'node:test';
import assert from 'node:assert/strict';
import { createJointReactions } from '../src/simulation/physics/joint-reactions.mjs';
test('reaction receipts sum applied sources, preserve ticks, and reject bypasses', () => {
  const joints = [
    { kind: 'fixed', a: 0, b: 1 },
    { kind: 'fixed', a: 1, b: 2 },
  ];
  const r = createJointReactions(joints);
  assert.deepEqual(r.read(0), { tick: 0, status: 'initializing' });
  r.add([0, 1], [1, 2, 3, 4, 5, 6], 2);
  r.complete((i) => [i + 1, 0, 0]);
  assert.deepEqual(r.read(0), { tick: 1, status: 'ok', impulse: [-3, -4, -6] });
  assert.deepEqual(r.read(1), { tick: 1, status: 'ok', impulse: [-10, -10, -12] });
  const cp = r.snapshot();
  r.complete(() => [0, 0, 0]);
  assert.deepEqual(r.read(0).impulse, [0, 0, 0]);
  r.restore(cp);
  assert.deepEqual(r.read(1).impulse, [-10, -10, -12]);
  cp.impulses[1][0] = 100;
  assert.equal(r.read(1).impulse[0], -10);
  assert.throws(() => r.restore({ tick: 3, impulses: [[0, 0, 0]] }));
  assert.equal(r.read(1).tick, 1);
  const loop = createJointReactions([...joints, { kind: 'revolute', a: 0, b: 2 }]);
  loop.complete(() => [1, 2, 3]);
  assert.deepEqual(loop.read(0), { tick: 1, status: 'unavailable' });
  assert.throws(() => r.read(-1));
});

test('reaction snapshot rejects pending contributions instead of losing them on restore', () => {
  const r = createJointReactions([{ kind: 'fixed', a: 0, b: 1 }]);
  r.add([0], [1, 2, 3]);
  assert.throws(() => r.snapshot(), /completed/);
  r.complete(() => [0, 0, 0]);
  assert.equal(r.snapshot().tick, 1);
});
