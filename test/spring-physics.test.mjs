import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (y, mass = 1, fixed = false) => ({
  shape: 'box',
  position: [0, y, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.01, 0.01, 0.01],
  fixed,
  friction: 0,
  restitution: 0,
});
const spring = {
  kind: 'spring',
  a: 0,
  b: 1,
  anchorA: [0, 0, 0],
  anchorB: [0, 0, 0],
  axisA: [0, 1, 0],
  axisB: [0, 1, 0],
  limits: [0.08, 0.4],
  restLength: 0.3,
  stiffness: 100,
  damping: 2,
};
test('guided spring oscillates, locks five DOFs, restores exactly and supports a load', async () => {
  const config = {
    gravity: [0, -9.81, 0],
    bodies: [body(0, 1, true), body(0.3)],
    joints: [spring],
  };
  const w = await createPhysicsWorld(config);
  try {
    const step = () => {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
    };
    for (let i = 0; i < 1200; i++) step();
    assert.ok(Math.abs(w.springs()[0].length - (0.3 - 0.0981)) < 0.001);
    assert.ok(Math.abs(w.read()[1].position[0]) < 1e-6);
    const cp = w.snapshot();
    step();
    const expected = w.read();
    w.restore(cp);
    step();
    assert.deepEqual(w.read(), expected);
  } finally {
    w.dispose();
  }
});

test('undamped oscillator retains bounce, analytical frequency and bounded energy', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, 1, true), body(0.35)],
    joints: [{ ...spring, damping: 0 }],
  });
  try {
    let previous = 0.05,
      crossings = [],
      lo = Infinity,
      hi = 0;
    for (let i = 0; i < 2400; i++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
      const s = w.springs()[0],
        e = w.mechanicalEnergy();
      const total = e.kineticJ + e.springPotentialJ;
      lo = Math.min(lo, total);
      hi = Math.max(hi, total);
      if (previous > 0 && s.extension <= 0) crossings.push((i + 1) / 120);
      previous = s.extension;
    }
    assert.ok(hi < 0.132 && lo > 0.118, JSON.stringify({ lo, hi }));
    assert.ok(Math.abs((crossings[20] - crossings[0]) / 20 - (2 * Math.PI) / 10) < 0.001);
  } finally {
    w.dispose();
  }
});

test('free spring pair conserves momentum and accepts arbitrary shared rotation', async () => {
  const q = [0, 0, Math.sin(0.43), Math.cos(0.43)],
    axis = [-Math.sin(0.86), Math.cos(0.86), 0];
  const a = body(0, 2),
    b = body(0.35, 1);
  a.rotation = q;
  b.rotation = q;
  b.position = axis.map((x) => x * 0.35);
  a.velocity = b.velocity = [0.7, -0.2, 0.3];
  const w = await createPhysicsWorld({ gravity: [0, 0, 0], bodies: [a, b], joints: [spring] });
  try {
    for (let i = 0; i < 600; i++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
    }
    const rows = w.read();
    for (let d = 0; d < 3; d++)
      assert.ok(
        Math.abs(rows[0].velocity[d] * 2 + rows[1].velocity[d] - 3 * a.velocity[d]) < 0.0001,
      );
    const state = w.springs()[0];
    assert.ok(state.length > 0.08 && state.length < 0.4);
  } finally {
    w.dispose();
  }
});

test('damping does not change static deflection and stops retain bounded restored state', async () => {
  for (const damping of [2, 100]) {
    const w = await createPhysicsWorld({
      gravity: [0, -9.81, 0],
      bodies: [body(0, 1, true), body(0.3)],
      joints: [{ ...spring, damping }],
    });
    try {
      for (let i = 0; i < 3600; i++) {
        w.prepareConstraints();
        w.applyPreparedConstraints();
        w.applySprings();
        w.step();
      }
      assert.ok(Math.abs(w.springs()[0].length - 0.2019) < 0.0001);
    } finally {
      w.dispose();
    }
  }
  const w = await createPhysicsWorld({
    gravity: [0, -9.81, 0],
    bodies: [body(0, 1, true), body(0.3, 10)],
    joints: [spring],
  });
  try {
    for (let i = 0; i < 600; i++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
    }
    assert.ok(Math.abs(w.springs()[0].length - 0.08) < 0.002);
    const saved = w.snapshot();
    w.restore(saved);
    assert.ok(w.read().every((r) => r.position.every(Number.isFinite)));
  } finally {
    w.dispose();
  }
});

test('transverse impulse is rejected by sliding projection while axial motion survives', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, 1, true), body(0.3)],
    joints: [{ ...spring, stiffness: 0, damping: 0 }],
  });
  try {
    w.applyImpulse(1, [1, 1, 0]);
    w.prepareConstraints();
    w.applyPreparedConstraints();
    assert.ok(Math.abs(w.read()[1].velocity[0]) < 1e-5);
    assert.ok(w.read()[1].velocity[1] > 0.99);
  } finally {
    w.dispose();
  }
});

test('coupled damping matches the independent simultaneous solution under reversed connection order', async () => {
  const joints = [
    { ...spring, stiffness: 0, damping: 100 },
    { ...spring, a: 1, b: 2, stiffness: 0, damping: 100 },
  ];
  const config = { gravity: [0, 0, 0], bodies: [body(0), body(0.15), body(0.3)], joints };
  config.bodies[0].velocity = [0, 1, 0];
  const forward = await createPhysicsWorld(config),
    reverse = await createPhysicsWorld({ ...config, joints: [...joints].reverse() });
  try {
    const outcomes = [];
    for (const w of [forward, reverse]) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      const receipt = w.applySprings();
      outcomes.push({ v: w.read().map((b) => b.velocity[1]), work: receipt.dampingWorkJ });
    }
    // (I + a L) v' = [1,0,0], a=100/120 and path-graph L.
    const a = 100 / 120,
      v2 = (a * a) / ((1 + a) * (1 + 3 * a)),
      v1 = a / (1 + 3 * a),
      v0 = 1 - v1 - v2;
    for (const result of outcomes)
      result.v.forEach((v, i) => assert.ok(Math.abs(v - [v0, v1, v2][i]) < 1e-6));
    outcomes[0].v.forEach((v, i) => assert.ok(Math.abs(v - outcomes[1].v[i]) < 1e-7));
    assert.ok(Math.abs(outcomes[0].work - outcomes[1].work) < 1e-10);
  } finally {
    forward.dispose();
    reverse.dispose();
  }
});

test('inverted gravity and freefall obey load direction instead of spring identity', async () => {
  const tick = (w) => {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applySprings();
    w.step();
  };
  const inverted = await createPhysicsWorld({
    gravity: [0, 9.81, 0],
    bodies: [body(0, 1, true), body(0.3)],
    joints: [{ ...spring, damping: 20 }],
  });
  const a = body(0, 2),
    b = body(0.3);
  a.position[1] += 100;
  b.position[1] += 100;
  const falling = await createPhysicsWorld({
    gravity: [0, -9.81, 0],
    bodies: [a, b],
    joints: [spring],
  });
  try {
    for (let i = 0; i < 1200; i++) tick(inverted);
    assert.ok(Math.abs(inverted.springs()[0].length - 0.3981) < 0.0002);
    for (let i = 0; i < 120; i++) tick(falling);
    assert.ok(Math.abs(falling.springs()[0].length - 0.3) < 0.0002);
    assert.ok(Math.abs(falling.read()[1].velocity[1] + 9.81) < 0.001);
  } finally {
    inverted.dispose();
    falling.dispose();
  }
});

test('damped displacement follows the independent underdamped oscillator solution', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, 1, true), body(0.35)],
    joints: [{ ...spring, damping: 2 }],
  });
  try {
    for (let i = 0; i < 240; i++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
      const t = (i + 1) / 120,
        omega = Math.sqrt(99);
      const analytical = 0.05 * Math.exp(-t) * (Math.cos(omega * t) + Math.sin(omega * t) / omega);
      assert.ok(Math.abs(w.springs()[0].extension - analytical) < 0.003);
    }
  } finally {
    w.dispose();
  }
});

test('excess spring frequency rejects before impulses and eight is the assembly bound', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, 1, true), body(0.35, 0.001)],
    joints: [{ ...spring, stiffness: 300 }],
  });
  try {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    const before = w.read();
    assert.throws(() => w.applySprings(), /frequency/);
    assert.deepEqual(w.read(), before);
  } finally {
    w.dispose();
  }
  const bodies = [],
    joints = [];
  for (let i = 0; i < 9; i++) {
    const a = body(0, 1, true),
      b = body(0.3);
    a.position[0] = b.position[0] = i;
    bodies.push(a, b);
    joints.push({ ...spring, a: 2 * i, b: 2 * i + 1 });
  }
  await assert.rejects(createPhysicsWorld({ gravity: [0, 0, 0], bodies, joints }), /at most 8/);
  const admitted = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: bodies.slice(0, 16),
    joints: joints.slice(0, 8),
  });
  admitted.dispose();
});
