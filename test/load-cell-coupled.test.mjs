import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../src/model/tick.mjs';

const q = [0, 0, 0, 1];
const body = (x, fixed = false) => ({
  shape: 'box',
  position: [x, 3, 0],
  rotation: q,
  velocity: [0, 0, 0],
  mass: 1,
  halfExtents: [0.02, 0.02, 0.02],
  fixed,
  friction: 0,
  restitution: 0,
});
const joint = (a, b, span = 0.1) => ({
  kind: 'fixed',
  a,
  b,
  anchorA: [span / 2, 0, 0],
  anchorB: [-span / 2, 0, 0],
  rotationA: q,
  rotationB: q,
});
const physical = () => ({
  gravity: [9.81, 0, 0],
  bodies: [body(0, true), body(0.1), body(0.2)],
  joints: [joint(0, 1), joint(1, 2)],
});
const advance = (w) => {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  w.applyRopes();
  w.step();
};

test('rope prepared reactions close the measured bridge momentum account with omitted and doubled controls', async () => {
  const c = physical();
  c.bodies.push(body(0.7));
  c.joints.push({
    kind: 'rope',
    a: 2,
    b: 3,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    restLength: 0.49,
    stiffness: 1000,
    damping: 10,
    strength: 1000,
    maxStrain: 0.1,
  });
  const w = await createPhysicsWorld(c);
  try {
    const check = (actual, expected) =>
      assert.ok(
        Math.abs(actual - expected) <= Math.max(1e-4, Math.abs(expected) * 0.02),
        `bridge impulse ${actual}, independent impulse ${expected}`,
      );
    let loaded = 0;
    for (let tick = 0; tick < 120; tick++) {
      const before = w.read();
      advance(w);
      const after = w.read();
      const expected = [2, 3].reduce(
        (s, i) =>
          s + c.bodies[i].mass * (after[i].velocity[0] - before[i].velocity[0] - c.gravity[0] * DT),
        0,
      );
      const receipt = w.jointReaction(1);
      assert.equal(receipt.status, 'ok');
      check(receipt.impulse[0], expected);
      if (Math.abs(expected) > 0.01) {
        loaded++;
        assert.throws(() => check(0, expected), assert.AssertionError);
        assert.throws(() => check(2 * receipt.impulse[0], expected), assert.AssertionError);
      }
    }
    assert.ok(loaded > 100, 'rope fixture must remain physically loaded');
  } finally {
    w.dispose();
  }
});

function configuration(which) {
  const c = physical();
  c.bodies.push(body(2, true), body(3, true));
  if (which === 'bypass') c.joints.push(joint(0, 2, 0.2));
  const releaseJoint = { A: 0, B: 1, bypass: 2 }[which];
  const node = which === 'B' ? 2 : 0;
  c.power = {
    cells: [
      { node: 3, voltage: 24, capacityJ: 100, initialJ: 100, resistance: 0.1, currentLimit: 20 },
    ],
    sensors: [{ node: 1, body: 1, kind: 'loadCell', joint: 1, support: 0, sign: -1 }],
    motors: [],
    receivers: [{ node: 4, duty: 0 }],
    controllers: [],
    couplers: [{ node, joint: releaseJoint, resistance: 24, minVoltage: 12, energyJ: 1 }],
    wires: [
      [3, 1],
      [3, node],
    ],
    signalWires: [[4, node]],
  };
  return c;
}
function editPhysics(cp, edit) {
  const bytes = Uint8Array.from(cp.physics),
    size = new DataView(bytes.buffer).getUint32(4);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size)));
  edit(meta);
  const data = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(12 + data.length + bytes.length - 12 - size),
    view = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12));
  view.setUint32(4, data.length);
  out.set(data, 12);
  out.set(bytes.subarray(12 + size), 12 + data.length);
  let hash = 2166136261;
  for (const b of out.subarray(12)) hash = Math.imul(hash ^ b, 16777619);
  view.setUint32(8, hash >>> 0);
  cp.physics = [...out];
}
const frame = (s) => s.observe().frames[0];
const reading = (s) => frame(s).sensors.readings[0].channels.load;
for (const which of ['A', 'B', 'bypass'])
  test(`released ${which} updates load-cell connectivity and preserves both checkpoint topology ages`, async () => {
    const s = await createSession(configuration(which));
    try {
      const cold = s.checkpoint();
      s.step(4);
      const closed = s.checkpoint();
      assert.equal(reading(s).status, which === 'bypass' ? 'unavailable' : 'ok');
      s.act({ type: 'receiver', node: 4, duty: 1 });
      let count = 0;
      while (!frame(s).power.couplers[0].opened && count++ < 30) s.step();
      assert.ok(frame(s).power.couplers[0].opened, 'powered coupler must physically open');
      const transition = s.checkpoint();
      assert.equal(
        reading(s).status,
        which === 'bypass' ? 'unavailable' : 'ok',
        'sensor still describes pre-release interval',
      );
      s.step();
      const expectedStatus = which === 'bypass' ? 'ok' : 'disconnected';
      assert.equal(reading(s).status, expectedStatus);
      if (expectedStatus !== 'ok') assert.equal(Object.hasOwn(reading(s), 'value'), false);
      const opened = s.checkpoint();
      assert.deepEqual(transition.sensors.openedJoints, []);
      assert.deepEqual(opened.sensors.openedJoints, [configuration(which).power.couplers[0].joint]);
      for (const cp of [cold, closed, transition, opened]) {
        s.restore(cp);
        s.step(5);
        const expected = deterministicProjection(frame(s));
        s.restore(opened);
        s.step(2);
        s.restore(cp);
        s.advanceTime(DT * 5000);
        assert.deepEqual(deterministicProjection(frame(s)), expected);
      }
      s.restore(opened);
      for (const edit of [
        (cp) => delete cp.sensors.openedJoints,
        (cp) => cp.sensors.openedJoints.push(cp.sensors.openedJoints[0]),
        (cp) => cp.sensors.openedJoints.push(999),
        (cp) => {
          cp.sensors.openedJoints = [];
        },
        (cp) =>
          editPhysics(cp, (m) => {
            m.reactions.opened = [];
            m.reactions.impulses = m.reactions.impulses.map(() => null);
          }),
      ]) {
        const bad = structuredClone(opened);
        edit(bad);
        assert.throws(() => s.restore(bad));
        assert.deepEqual(s.checkpoint(), opened);
      }
      // A future historical opening cannot be admitted just because the live
      // session currently has that joint open. Match invalid channel/receipt shapes
      // so this challenges topology history admission rather than numeric equality.
      for (const base of [cold, closed]) {
        const future = structuredClone(base),
          releaseJoint = configuration(which).power.couplers[0].joint;
        future.sensors.openedJoints = [releaseJoint];
        future.sensors.readings[0].channels = {
          axialForce: { status: 'no-power' },
          load: { status: 'no-power' },
        };
        if (which === 'B')
          future.sensors.reactions[0] = {
            joint: 1,
            tick: future.sensors.tick,
            status: 'unavailable',
          };
        assert.throws(() => s.restore(future));
        assert.deepEqual(s.checkpoint(), opened);
      }
      // A fresh configuration (the same owner used by Retry) resets released topology.
      await s.replaceConfiguration(configuration(which), {});
      assert.equal(frame(s).tick, 0);
      assert.deepEqual(frame(s).sensors.openedJoints, []);
      s.step(4);
      assert.equal(reading(s).status, which === 'bypass' ? 'unavailable' : 'ok');
    } finally {
      s.dispose();
    }
  });

for (const field of ['opened', 'gearState', 'ropeState', 'ropeWork'])
  test(`physics envelope rejects null mandatory ${field} without normalizing absent feature state`, async () => {
    const s = await createSession(configuration('A'));
    try {
      s.step(4);
      const checkpoint = s.checkpoint();
      s.step(2);
      s.restore(checkpoint);
      assert.deepEqual(s.checkpoint(), checkpoint, 'ordinary empty feature state restores exactly');
      const before = s.checkpoint(),
        cursor = s.observe().cursor;
      const bad = structuredClone(checkpoint);
      editPhysics(bad, (meta) => {
        meta[field] = null;
      });
      assert.throws(() => s.restore(bad), `null ${field} must not become valid empty state`);
      assert.deepEqual(s.checkpoint(), before);
      assert.deepEqual(s.observe().cursor, cursor);
    } finally {
      s.dispose();
    }
  });
