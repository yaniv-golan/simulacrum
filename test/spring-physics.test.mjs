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

// Independent rigid-box inertia and world-space angular momentum oracle.
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const rotate3 = (q, v) => {
  const t = cross3(q.slice(0, 3), v).map((x) => 2 * x),
    u = cross3(q.slice(0, 3), t);
  return v.map((x, i) => x + q[3] * t[i] + u[i]);
};
function angularMomentum(rows, descriptions, origin) {
  const orbital = [0, 0, 0],
    rotational = [0, 0, 0];
  rows.forEach((row, i) => {
    const h = descriptions[i].halfExtents,
      m = descriptions[i].mass;
    const inertia = [
      (m * (h[1] ** 2 + h[2] ** 2)) / 3,
      (m * (h[0] ** 2 + h[2] ** 2)) / 3,
      (m * (h[0] ** 2 + h[1] ** 2)) / 3,
    ];
    const localW = rotate3(
      [...row.rotation.slice(0, 3).map((x) => -x), row.rotation[3]],
      row.angularVelocity,
    );
    const spin = rotate3(
      row.rotation,
      localW.map((x, k) => x * inertia[k]),
    );
    const orbit = cross3(
      row.position.map((x, k) => x - origin[k]),
      row.velocity.map((x) => m * x),
    );
    for (let k = 0; k < 3; k++) {
      orbital[k] += orbit[k];
      rotational[k] += spin[k];
    }
  });
  return { orbital, rotational, total: orbital.map((x, k) => x + rotational[k]) };
}
test('offset spring chains conserve orbital plus rotational angular momentum under body and joint ordering', async () => {
  for (const offset of [0, 0.1])
    for (const angle of [0, 0.7]) {
      const q = [1, 2, 3]
        .map((x) => (x / Math.sqrt(14)) * Math.sin(angle / 2))
        .concat(Math.cos(angle / 2));
      const bodies = [0, 1, 2].map((i) => ({
        ...body(i * 0.35, i + 1),
        position: rotate3(q, [2 * offset * i, i * 0.35, 0]).map((x, k) => x + [1, 2, -1][k]),
        rotation: q,
        halfExtents: [0.08, 0.1, 0.12],
        velocity: [0.3, -0.2, 0.1],
      }));
      const joints = [0, 1].map((i) => ({
        ...spring,
        a: i,
        b: i + 1,
        anchorA: [offset, 0, 0],
        anchorB: [-offset, 0, 0],
        stiffness: 80,
        damping: 3,
      }));
      const outcomes = [];
      for (const order of [
        [0, 1, 2],
        [2, 0, 1],
      ])
        for (const reverseJoints of [false, true])
          for (const reverseEnds of [false, true]) {
            const descriptions = order.map((i) => bodies[i]);
            let mapped = joints.map((j) => ({
              ...j,
              a: order.indexOf(j.a),
              b: order.indexOf(j.b),
            }));
            if (reverseJoints) mapped.reverse();
            if (reverseEnds)
              mapped = mapped.map((j) => ({
                ...j,
                a: j.b,
                b: j.a,
                anchorA: j.anchorB,
                anchorB: j.anchorA,
                axisA: [0, -1, 0],
                axisB: [0, -1, 0],
              }));
            const w = await createPhysicsWorld({
              gravity: [0, 0, 0],
              bodies: descriptions,
              joints: mapped,
            });
            try {
              const origins = [
                  [0, 0, 0],
                  [4, -2, 3],
                ],
                initial = origins.map((o) => angularMomentum(w.read(), descriptions, o));
              let largestSpin = 0;
              for (let tick = 0; tick < 60; tick++) {
                w.prepareConstraints();
                w.applyPreparedConstraints();
                const before = origins.map((o) => angularMomentum(w.read(), descriptions, o));
                w.applySprings();
                origins.forEach((o, i) => {
                  const after = angularMomentum(w.read(), descriptions, o);
                  assert.ok(
                    Math.hypot(...after.total.map((x, k) => x - before[i].total[k])) < 2e-6,
                    'spring impulse conserves total L',
                  );
                });
                w.step();
                origins.forEach((o, i) => {
                  const after = angularMomentum(w.read(), descriptions, o);
                  assert.ok(
                    Math.hypot(...after.total.map((x, k) => x - initial[i].total[k])) < 1e-4,
                    JSON.stringify({ offset, angle, tick, before: initial[i], after }),
                  );
                });
                const state = angularMomentum(w.read(), descriptions, origins[0]);
                largestSpin = Math.max(largestSpin, Math.hypot(...state.rotational));
              }
              if (offset)
                assert.ok(
                  largestSpin > 1e-3,
                  'offset spring must exchange orbital and spin angular momentum',
                );
              else
                assert.ok(
                  largestSpin < 1e-4,
                  JSON.stringify({
                    message: 'centered positive control needs no spin',
                    largestSpin,
                    angle,
                    order,
                    reverseEnds,
                  }),
                );
              const rows = w.read();
              outcomes.push([0, 1, 2].map((i) => rows[order.indexOf(i)]));
            } finally {
              w.dispose();
            }
          }
      for (const rows of outcomes.slice(1))
        rows.forEach((r, i) => {
          for (const key of ['position', 'velocity'])
            assert.ok(
              Math.hypot(...r[key].map((x, k) => x - outcomes[0][i][key][k])) < 1e-4,
              JSON.stringify({
                message: `ordering changed ${key}`,
                offset,
                angle,
                actual: r[key],
                expected: outcomes[0][i][key],
              }),
            );
          const spin = angularMomentum([r], [bodies[i]], r.position).rotational,
            expectedSpin = angularMomentum(
              [outcomes[0][i]],
              [bodies[i]],
              outcomes[0][i].position,
            ).rotational;
          assert.ok(
            Math.hypot(...spin.map((x, k) => x - expectedSpin[k])) < 1e-4,
            'ordering preserves spin angular momentum',
          );
        });
    }
});

test('off-center spring impulse transfers equal orbital and spin angular momentum', async () => {
  const descriptions = [body(0), { ...body(0.35), position: [0.2, 0.35, 0] }].map((b) => ({
    ...b,
    halfExtents: [0.1, 0.1, 0.1],
  }));
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: descriptions,
    joints: [{ ...spring, anchorA: [0.1, 0, 0], anchorB: [-0.1, 0, 0], damping: 0 }],
  });
  try {
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applySprings();
    const state = angularMomentum(w.read(), descriptions, [0, 0, 0]);
    assert.ok(
      Math.hypot(...state.total) < 1e-7,
      'retained two-body probe conserves total angular momentum',
    );
    assert.ok(Math.hypot(...state.rotational) > 1e-4, 'offset impulse produces spin');
    assert.ok(Math.hypot(...state.orbital) > 1e-4, 'orbital contribution cannot be omitted');
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(state.orbital[k] + state.rotational[k]) < 1e-7);
  } finally {
    w.dispose();
  }
});
