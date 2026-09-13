import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
const body = (x, mass = 1, fixed = false) => ({
  shape: 'box',
  position: [x, 3, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.05, 0.05, 0.05],
  fixed,
  friction: 0,
  restitution: 0,
});
const fixed = (a, b) => ({
  kind: 'fixed',
  a,
  b,
  anchorA: [0.05, 0, 0],
  anchorB: [-0.05, 0, 0],
  rotationA: [0, 0, 0, 1],
  rotationB: [0, 0, 0, 1],
});
export const configuration = () => ({
  gravity: [9.81, 0, 0],
  bodies: [body(0, 1, true), body(0.1), body(0.2), body(1, 1, true)],
  joints: [fixed(0, 1), fixed(1, 2)],
  power: {
    cells: [{ node: 3, voltage: 6, capacityJ: 100, initialJ: 100, resistance: 2, currentLimit: 1 }],
    sensors: [{ node: 1, body: 1, kind: 'loadCell', joint: 1, support: 0, sign: -1 }],
    motors: [],
    receivers: [],
    controllers: [],
    wires: [[3, 1]],
    signalWires: [],
  },
});
test('load cell stores the right two receipt ages and restores exact next-tick sensing', async () => {
  const s = await createSession(configuration());
  try {
    s.step(7);
    const f = s.observe().frames[0],
      r = f.sensors.readings[0];
    assert.equal(r.tick, f.tick - 1);
    assert.equal(r.channels.axialForce.status, 'ok');
    assert.ok(Math.abs(r.channels.load.value - 9.81) < 0.2);
    const cp = s.checkpoint();
    assert.equal(cp.sensors.reactions[0].tick, cp.tick - 1);
    s.step(5);
    const expected = deterministicProjection(s.observe().frames[0]);
    s.restore(cp);
    s.step(5);
    assert.deepEqual(deterministicProjection(s.observe().frames[0]), expected);
    for (const change of [
      (c) => c.sensors.reactions[0].tick++,
      (c) => (c.sensors.reactions[0].joint = 0),
      (c) => (c.sensors.reactions[0].impulse[0] += 1),
      (c) => (c.sensors.readings[0].channels.load.value += 1),
      (c) => delete c.sensors.reactions,
    ]) {
      const before = s.checkpoint(),
        bad = structuredClone(cp);
      change(bad);
      assert.throws(() => s.restore(bad));
      assert.deepEqual(s.checkpoint(), before);
    }
  } finally {
    s.dispose();
  }
});
test('load cell rejects wrong joint side and stays disconnected without either mount', async () => {
  const bad = configuration();
  bad.power.sensors[0].sign = 1;
  await assert.rejects(createSession(bad));
  for (const key of ['joint', 'support']) {
    const c = configuration();
    c.power.sensors[0][key] = -1;
    const s = await createSession(c);
    try {
      s.step(3);
      assert.equal(s.observe().frames[0].sensors.readings[0].channels.load.status, 'disconnected');
    } finally {
      s.dispose();
    }
  }
});
test('restoring historical valid force on a bypass is rejected even with matching channel values', async () => {
  const c = configuration();
  c.joints.push({
    kind: 'fixed',
    a: 0,
    b: 2,
    anchorA: [0.15, 0, 0],
    anchorB: [-0.05, 0, 0],
    rotationA: [0, 0, 0, 1],
    rotationB: [0, 0, 0, 1],
  });
  const s = await createSession(c);
  try {
    s.step(6);
    const before = s.checkpoint(),
      bad = structuredClone(before);
    assert.equal(bad.sensors.readings[0].channels.load.status, 'unavailable');
    bad.sensors.reactions[0] = { joint: 1, tick: 5, status: 'ok', impulse: [0, 0, 0] };
    bad.sensors.readings[0].channels = {
      axialForce: { status: 'ok', value: 0 },
      load: { status: 'ok', value: 0 },
    };
    assert.throws(() => s.restore(bad));
    assert.deepEqual(s.checkpoint(), before);
  } finally {
    s.dispose();
  }
});
