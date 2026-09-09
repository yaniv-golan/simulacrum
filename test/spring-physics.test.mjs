import { springTopologyDomain as admitSpringTopology } from '../src/simulation/physics/spring-topology.mjs';
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
      w.prepareSprings();
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
      w.prepareSprings();
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
      w.prepareSprings();
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
        w.prepareSprings();
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
      w.prepareSprings();
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
    w.prepareSprings();
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
      w.prepareSprings();
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
    w.prepareSprings();
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
      w.prepareSprings();
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
    const unmodified = w.read();
    assert.throws(() => w.prepareSprings(), /frequency/);
    assert.deepEqual(w.read(), unmodified);
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
                w.prepareSprings();
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
    w.prepareSprings();
    w.applyPreparedConstraints();
    w.applySprings();
    // Elastic impulses now occur in the sole integration, alongside contacts.
    w.step();
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

test('ground-supported spring deflection is independent of damping and body ordering', async () => {
  for (const mass of [0.25, 1])
    for (const damping of [2, 30])
      for (const reversed of [false, true]) {
        const descriptions = [
          { ...body(0.05, 2), halfExtents: [0.05, 0.05, 0.05] },
          body(0.35, mass),
          { ...body(-0.1, 1, true), halfExtents: [1, 0.1, 1] },
        ];
        const order = reversed ? [2, 1, 0] : [0, 1, 2],
          a = order.indexOf(0),
          b = order.indexOf(1),
          floor = order.indexOf(2);
        const w = await createPhysicsWorld({
          gravity: [0, -9.81, 0],
          bodies: order.map((i) => descriptions[i]),
          joints: [{ ...spring, a, b, damping }],
        });
        try {
          let length = 0,
            reaction = 0;
          for (let tick = 0; tick < 2400; tick++) {
            w.prepareConstraints();
            w.prepareSprings();
            w.applyPreparedConstraints();
            w.applySprings();
            w.step();
            if (tick < 2280) continue;
            length += w.springs()[0].length / 120;
            const sample = w.contacts();
            assert.equal(sample.available, true);
            reaction += sample.rows.reduce((sum, row) => {
              if (row.a === a && row.b === floor) return sum - (row.normalImpulse?.[1] ?? 0);
              if (row.b === a && row.a === floor) return sum + (row.normalImpulse?.[1] ?? 0);
              return sum;
            }, 0); // 120 tick impulses cover exactly one second.
          }
          const expected = spring.restLength - (mass * 9.81) / spring.stiffness;
          assert.ok(
            Math.abs(length - expected) < 0.001,
            JSON.stringify({ mass, damping, reversed, length, expected }),
          );
          assert.ok(
            Math.abs(reaction - (2 + mass) * 9.81) < 0.01 * (2 + mass) * 9.81,
            'real floor supports both masses; the lower endpoint is not fixed',
          );
        } finally {
          w.dispose();
        }
      }
});

test('off-center damper kick conserves orbital plus spin momentum before integration', async () => {
  const descriptions = [
    { ...body(0), velocity: [0, 1, 0] },
    { ...body(0.35), position: [0.2, 0.35, 0], velocity: [0, -1, 0] },
  ].map((b) => ({ ...b, halfExtents: [0.1, 0.1, 0.1] }));
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: descriptions,
    joints: [{ ...spring, anchorA: [0.1, 0, 0], anchorB: [-0.1, 0, 0], stiffness: 0, damping: 30 }],
  });
  try {
    w.prepareConstraints();
    w.prepareSprings();
    w.applyPreparedConstraints();
    const before = angularMomentum(w.read(), descriptions, [0, 0, 0]);
    const receipt = w.applySprings();
    const after = angularMomentum(w.read(), descriptions, [0, 0, 0]);
    assert.ok(Math.hypot(...after.total.map((x, i) => x - before.total[i])) < 1e-7);
    assert.ok(Math.hypot(...after.rotational.map((x, i) => x - before.rotational[i])) > 1e-4);
    assert.ok(Math.hypot(...after.orbital.map((x, i) => x - before.orbital[i])) > 1e-4);
    assert.ok(receipt.dampingWorkJ > 0 && receipt.kineticDeltaJ < 0);
  } finally {
    w.dispose();
  }
});

test('zero stiffness and damping leave the admitted axial motion free', async () => {
  const w = await createPhysicsWorld({
    gravity: [0, 0, 0],
    bodies: [body(0, 1, true), { ...body(0.2), velocity: [0, 0.5, 0] }],
    joints: [{ ...spring, stiffness: 0, damping: 0 }],
  });
  try {
    const before = w.snapshot();
    assert.throws(() => w.step(), /spring preparation/);
    assert.deepEqual(w.snapshot(), before);
    for (let tick = 0; tick < 12; tick++) {
      w.prepareConstraints();
      w.prepareSprings();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
    }
    assert.ok(Math.abs(w.springs()[0].length - 0.25) < 1e-6);
    assert.ok(Math.abs(w.read()[1].velocity[1] - 0.5) < 1e-6);
  } finally {
    w.dispose();
  }
});

test('tiny admitted elastic stiffness preserves force units without a hard servo cutoff', async () => {
  for (const stiffness of [0, 1e-40, 1e-30, 1e-20, 1e-11, 4e-11, 1e-10, 1e-9, 2e-8, 1e-7]) {
    const w = await createPhysicsWorld({
      gravity: [0, 0, 0],
      bodies: [body(0), body(0.35)],
      joints: [{ ...spring, stiffness, damping: 0 }],
    });
    try {
      w.prepareConstraints();
      w.prepareSprings();
      w.applyPreparedConstraints();
      w.applySprings();
      w.step();
      const expected = (stiffness * 0.05) / 120,
        rows = w.read();
      for (const [i, sign] of [
        [0, 1],
        [1, -1],
      ]) {
        assert.ok(
          Math.abs(rows[i].velocity[1] - sign * expected) <= 0.02 * expected + 1e-18,
          JSON.stringify({ stiffness, expected, rows }),
        );
        assert.ok(Math.hypot(rows[i].velocity[0], rows[i].velocity[2]) < 1e-12);
      }
    } finally {
      w.dispose();
    }
  }
});

test('undamped discrete modified energy and frequency remain bounded for 240 seconds near admission limit', async () => {
  const omega = 35.9,
    h = 1 / 480;
  // Elastic integration uses the four frozen native subdivisions.
  // Freeze a 0.5% modified-energy drift budget and 0.1% discrete-period budget.
  // The semiimplicit recurrence has cos(theta)=1-(h*omega)^2/2.
  // Ordinary energy oscillates by O(h*omega/2); do not mistake that for drift.
  for (const mass of [0.04, 0.15]) {
    const stiffness = mass * omega ** 2;
    const w = await createPhysicsWorld({
      gravity: [0, 0, 0],
      bodies: [body(0, 1, true), body(0.31, mass)],
      joints: [{ ...spring, stiffness, damping: 0 }],
    });
    try {
      const e0 = w.mechanicalEnergy().springPotentialJ;
      let previous = w.springs()[0].extension,
        first = null,
        last = null,
        crossings = 0;
      for (let tick = 1; tick <= 28800; tick++) {
        w.prepareConstraints();
        w.prepareSprings();
        w.applyPreparedConstraints();
        assert.equal(w.applySprings().dampingWorkJ, 0);
        w.step();
        const state = w.springs()[0],
          energy = w.mechanicalEnergy(),
          modified =
            energy.kineticJ +
            energy.springPotentialJ -
            (h * stiffness * state.extension * state.speed) / 2;
        assert.ok(
          Math.abs(modified / e0 - 1) < 0.005,
          JSON.stringify({ mass, tick, ratio: modified / e0 }),
        );
        if (previous > 0 && state.extension <= 0) {
          first ??= tick / 120;
          last = tick / 120;
          crossings++;
        }
        previous = state.extension;
      }
      const period = (last - first) / (crossings - 1),
        expected = (2 * Math.PI * h) / (2 * Math.asin((h * omega) / 2));
      assert.ok(Math.abs(period / expected - 1) < 0.001);
    } finally {
      w.dispose();
    }
  }
});

test('rotating offset spring chains retain total angular momentum across mass ratios', async () => {
  for (const middle of [0.01, 0.1, 1])
    for (const damping of [0, 3])
      for (const kick of [
        [0, 0.2, 0],
        [0, 0, 0.2],
      ]) {
        const bodies = [body(0), body(0.32, middle), body(0.6)];
        bodies.forEach((b, i) => {
          b.position[0] = 0.1 * i;
        });
        const w = await createPhysicsWorld({
          gravity: [0, 0, 0],
          bodies,
          joints: [0, 1].map((i) => ({
            ...spring,
            a: i,
            b: i + 1,
            anchorA: [0.05, 0, 0],
            anchorB: [-0.05, 0, 0],
            stiffness: 3,
            damping,
          })),
        });
        try {
          w.applyImpulse(2, kick);
          const initial = angularMomentum(w.read(), bodies, [0, 0, 0]).total;
          assert.ok(Math.hypot(...initial) > 0.03, 'positive control must rotate');
          for (let tick = 0; tick < 600; tick++) {
            w.prepareConstraints();
            w.prepareSprings();
            w.applyPreparedConstraints();
            w.applySprings();
            w.step();
            const value = angularMomentum(w.read(), bodies, [0, 0, 0]).total;
            assert.ok(
              Math.hypot(...value.map((x, i) => x - initial[i])) < 2e-6,
              JSON.stringify({ middle, damping, kick, tick, value, initial }),
            );
            assert.equal(w.contacts().rows.length, 0);
          }
        } finally {
          w.dispose();
        }
      }
});

test('free spring stops bound completed-tick impacts and preserve the isolated energy and momentum accounts', async () => {
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  for (const side of [-1, 1])
    for (const mass of [0.01, 1, 100])
      for (const speed of [1])
        for (const stiffness of [0, 3])
          for (const tilted of [false, true])
            for (const reverse of [false, true]) {
              const q = tilted ? [0.2, 0.3, 0.4, Math.sqrt(0.71)] : [0, 0, 0, 1],
                n = rotate3(q, [0, 1, 0]),
                start = 0.30037;
              const old = [1, mass].map((m, i) => ({
                shape: 'box',
                position: n.map((x) => x * start * (i - mass / (1 + mass))),
                rotation: q,
                mass: m,
                velocity: n.map((x) => x * side * speed * (i - mass / (1 + mass))),
                halfExtents: [0.01, 0.02, 0.03],
                fixed: false,
                friction: 0,
                restitution: 0,
              }));
              const order = reverse ? [1, 0] : [0, 1],
                bodies = order.map((i) => old[i]);
              const j = {
                kind: 'spring',
                a: order.indexOf(0),
                b: order.indexOf(1),
                anchorA: [0, 0, 0],
                anchorB: [0, 0, 0],
                axisA: [0, 1, 0],
                axisB: [0, 1, 0],
                limits: [0.27, 0.33],
                restLength: 0.3,
                stiffness,
                damping: 0,
              };
              const w = await createPhysicsWorld({
                gravity: [0, 0, 0],
                bodies,
                joints: [j],
              });
              try {
                const read = () => {
                  const rr = w.read(),
                    a = rr[j.a],
                    b = rr[j.b],
                    nn = rotate3(a.rotation, [0, 1, 0]),
                    d = b.position.map((x, k) => x - a.position[k]);
                  let E = 0,
                    L = [0, 0, 0];
                  for (let i = 0; i < 2; i++) {
                    const r = rr[i],
                      m = bodies[i].mass,
                      h = bodies[i].halfExtents,
                      il = [
                        (m * (h[1] ** 2 + h[2] ** 2)) / 3,
                        (m * (h[0] ** 2 + h[2] ** 2)) / 3,
                        (m * (h[0] ** 2 + h[1] ** 2)) / 3,
                      ],
                      wl = rotate3(
                        [...r.rotation.slice(0, 3).map((x) => -x), r.rotation[3]],
                        r.angularVelocity,
                      ),
                      spin = rotate3(
                        r.rotation,
                        wl.map((x, k) => x * il[k]),
                      ),
                      orbit = cross3(
                        r.position,
                        r.velocity.map((x) => x * m),
                      );
                    E +=
                      0.5 * m * dot(r.velocity, r.velocity) +
                      0.5 *
                        dot(
                          wl,
                          wl.map((x, k) => x * il[k]),
                        );
                    L = L.map((x, k) => x + spin[k] + orbit[k]);
                  }
                  E += 0.5 * stiffness * (dot(nn, d) - 0.3) ** 2;
                  const P = rr.reduce(
                    (p, r, i) => p.map((x, k) => x + bodies[i].mass * r.velocity[k]),
                    [0, 0, 0],
                  );
                  return {
                    P,
                    length: dot(nn, d),
                    speed:
                      dot(
                        nn,
                        b.velocity.map((x, k) => x - a.velocity[k]),
                      ) + dot(cross3(a.angularVelocity, nn), d),
                    E,
                    L,
                  };
                };
                const initial = read(),
                  trace = [];
                let maxPen = 0,
                  maxL = 0,
                  maxE = initial.E,
                  maxP = 0;
                for (let tick = 0; tick < 120; tick++) {
                  w.prepareConstraints();
                  w.prepareSprings();
                  w.applyPreparedConstraints();
                  w.applySprings();
                  w.step();
                  const s = read();
                  maxPen = Math.max(maxPen, side < 0 ? 0.27 - s.length : s.length - 0.33);
                  maxL = Math.max(maxL, Math.hypot(...s.L.map((x, i) => x - initial.L[i])));
                  maxE = Math.max(maxE, s.E);
                  maxP = Math.max(maxP, Math.hypot(...s.P.map((x, k) => x - initial.P[k])));
                  trace.push({ tick: tick + 1, ...s });
                }
                const h = 1 / 480,
                  mu = mass / (1 + mass),
                  rhoBound = (h * Math.sqrt(stiffness / mu)) / 2,
                  freeFlightEnergyBound = (initial.E * (1 + rhoBound)) / (1 - rhoBound),
                  vmax = Math.sqrt((2 * freeFlightEnergyBound) / mu),
                  amax = (stiffness * 0.22) / mu,
                  u = 2 ** -24,
                  gamma = (n) => (n * u) / (1 - n * u),
                  roundoff = 2 * gamma(480) * 0.4 + gamma(32) * 0.8,
                  tol = vmax * h + 0.5 * amax * h * h + roundoff;
                const context = JSON.stringify({
                  side,
                  mass,
                  stiffness,
                  tilted,
                  reverse,
                  tol,
                  maxPen,
                  maxL,
                  maxP,
                  initial,
                  final: trace.at(-1),
                  trace,
                });
                // Energy sufficient to cross the selected stop in the unconstrained oscillator.
                assert.ok(initial.E > 0.5 * stiffness * 0.03 ** 2, context);
                // The completed-tick excursion bound is fixed by travel per substep, not measured extrema.
                assert.ok(maxPen <= tol, context);
                assert.ok(maxL < 2e-6, context);
                assert.ok(maxP < 2e-6, context);
                const rho = (h * Math.sqrt(stiffness / mu)) / 2;
                // Symplectic Euler's conserved quadratic has eigenvalues 1 +/- rho relative to physical energy.
                const energyEnvelope = (initial.E * (1 + rho)) / (1 - rho) + 1e-6;
                assert.ok(maxE <= energyEnvelope, context);
                assert.ok(
                  trace.some((s) => Math.abs(s.length - (side < 0 ? 0.27 : 0.33)) <= tol),
                  context,
                );
                if (stiffness === 0) {
                  // A central, zero-restitution hit leaves only COM motion, initially zero here.
                  assert.ok(Math.abs(trace.at(-1).speed) < 1e-5, context);
                  assert.ok(trace.at(-1).E < 1e-10, context);
                }
              } finally {
                w.dispose();
              }
            }
});

{
  const bodies = (n) => Array.from({ length: n }, () => ({ fixed: false }));
  const fixed = (a, b) => ({ kind: 'fixed', a, b });
  const hinge = (a, b) => ({ kind: 'revolute', a, b });
  const spring = (a, b, stiffness = 3) => ({ kind: 'spring', a, b, stiffness });
  const reject = (b, j) =>
    assert.throws(
      () => admitSpringTopology(b, j),
      (e) =>
        e instanceof RangeError &&
        e.reasonCode === 'SPRING_TOPOLOGY_UNQUALIFIED' &&
        Number.isInteger(e.jointIndex),
    );
  test('active tree, zero authored stiffness, and exact fixed-component inactivity', () => {
    assert.deepEqual(admitSpringTopology(bodies(3), [spring(0, 1), hinge(1, 2)]).activeElastic, [
      0,
    ]);
    assert.deepEqual(admitSpringTopology(bodies(2), [spring(0, 1, 0)]).activeElastic, []);
    assert.deepEqual(
      admitSpringTopology(bodies(3), [fixed(0, 1), fixed(1, 2), spring(0, 2)]).activeElastic,
      [],
    );
  });
  test('movable interruption cannot certify zero elastic mobility', () => {
    const j = [fixed(0, 1), hinge(1, 2), spring(0, 2)];
    reject(bodies(3), j);
    assert.deepEqual(admitSpringTopology(bodies(3), [fixed(0, 1), spring(1, 2)]).activeElastic, [
      1,
    ]);
  });
  test('ground closes an otherwise tree-shaped spring path', () => {
    const b = bodies(3);
    b[0].fixed = b[2].fixed = true;
    reject(b, [spring(0, 1), spring(1, 2)]);
    b[2].fixed = false;
    assert.deepEqual(admitSpringTopology(b, [spring(0, 1), spring(1, 2)]).activeElastic, [0, 1]);
  });
  test('inactive internal guide and fixed cycles remain native edges near active spring', () => {
    reject(bodies(4), [fixed(0, 1), spring(0, 1), spring(1, 2), hinge(2, 3)]);
    reject(bodies(4), [fixed(0, 1), fixed(1, 2), fixed(2, 0), spring(2, 3)]);
    reject(bodies(3), [spring(0, 1), spring(1, 2), spring(2, 0, 0)]);
  });
  test('unrelated cyclic nonelastic component stays supported, including shared fixed ground', () => {
    const b = bodies(5);
    b[0].fixed = b[2].fixed = true;
    assert.deepEqual(
      admitSpringTopology(b, [spring(0, 1), fixed(2, 3), hinge(3, 4), hinge(4, 2)]).activeElastic,
      [0],
    );
  });
  test('body, edge and endpoint ordering preserve physical admission decisions', () => {
    const cases = [
      { b: bodies(3), j: [spring(0, 1), fixed(1, 2)], ok: true },
      { b: bodies(3), j: [spring(0, 1), hinge(1, 2), hinge(2, 0)], ok: false },
      { b: bodies(3), j: [fixed(0, 1), fixed(1, 2), spring(0, 2)], ok: true },
    ];
    for (const c of cases)
      for (const order of [
        [0, 1, 2],
        [2, 0, 1],
        [2, 1, 0],
      ])
        for (const reverse of [false, true])
          for (const swap of [false, true]) {
            const b = order.map((i) => c.b[i]),
              js = (reverse ? [...c.j].reverse() : c.j).map((j) => ({
                ...j,
                a: order.indexOf(swap ? j.b : j.a),
                b: order.indexOf(swap ? j.a : j.b),
              }));
            if (!c.ok) reject(b, js);
            else {
              const result = admitSpringTopology(b, js);
              const expected = js.flatMap((j, i) =>
                j.kind === 'spring' && c.j.length === 2 ? [i] : [],
              );
              assert.deepEqual(result.activeElastic, expected);
              assert.ok(Object.isFrozen(result) && Object.isFrozen(result.activeElastic));
            }
          }
  });
  test('analysis does not mutate caller descriptors', () => {
    const b = bodies(3),
      j = [spring(0, 1), hinge(1, 2)],
      before = JSON.stringify({ b, j });
    admitSpringTopology(b, j);
    assert.equal(JSON.stringify({ b, j }), before);
  });

  test('separate grounded fixed components prove zero relative mobility', () => {
    const b = bodies(4);
    b[0].fixed = b[3].fixed = true;
    assert.deepEqual(
      admitSpringTopology(b, [fixed(0, 1), spring(1, 2), fixed(2, 3)]).activeElastic,
      [],
    );
    b[3].fixed = false;
    assert.deepEqual(
      admitSpringTopology(b, [fixed(0, 1), spring(1, 2), fixed(2, 3)]).activeElastic,
      [1],
    );
  });
}

test('coupled offset elasticity retains its subdivision energy envelope without projection loss', async () => {
  const masses = [1, 0.01, 1],
    stiffness = 3;
  for (const reversed of [false, true]) {
    const order = reversed ? [2, 1, 0] : [0, 1, 2];
    const descriptions = masses.map((mass, i) => ({
      ...body([0, 0.32, 0.6][i], mass),
      position: [i * 0.1, [0, 0.32, 0.6][i], 0],
    }));
    const w = await createPhysicsWorld({
      gravity: [0, 0, 0],
      bodies: order.map((i) => descriptions[i]),
      joints: (reversed ? [1, 0] : [0, 1]).map((i) => ({
        ...spring,
        a: order.indexOf(i),
        b: order.indexOf(i + 1),
        anchorA: [0.05, 0, 0],
        anchorB: [-0.05, 0, 0],
        stiffness,
        damping: 0,
      })),
    });
    try {
      const initial = w.mechanicalEnergy().springPotentialJ;
      // The existing admission bound is DT² trace(KW)<=.09. Four elastic
      // subdivisions give rho<=sqrt(.09)/8 in the symplectic quadratic form.
      // Keep the established 0.5% long-run modified-energy drift allocation.
      const rho = Math.sqrt(0.09) / 8,
        lower = 0.995 / (1 + rho),
        upper = 1.005 / (1 - rho);
      let lost = 0;
      for (let tick = 0; tick < 1200; tick++) {
        w.prepareConstraints();
        w.prepareSprings();
        lost += w.applyPreparedConstraints();
        assert.equal(w.applySprings().dampingWorkJ, 0);
        w.step();
        const e = w.mechanicalEnergy(),
          ratio = (e.kineticJ + e.springPotentialJ) / initial;
        assert.ok(
          ratio >= lower && ratio <= upper,
          JSON.stringify({ reversed, tick, ratio, lower, upper }),
        );
        assert.equal(w.contacts().rows.length, 0);
      }
      assert.ok(
        lost < initial * 1e-5,
        'passive guide projection must not erase the elastic oscillation',
      );
    } finally {
      w.dispose();
    }
  }
});

test('fixed-path spring inactivity preserves authored energy and rejects a forged active native motor on restore', async () => {
  const configuration = {
    gravity: [0, 0, 0],
    bodies: [body(0), { ...body(0.32), position: [0.1, 0.32, 0] }],
    joints: [
      {
        kind: 'fixed',
        a: 0,
        b: 1,
        anchorA: [0.1, 0.32, 0],
        anchorB: [0, 0, 0],
        rotationA: [0, 0, 0, 1],
        rotationB: [0, 0, 0, 1],
      },
      { ...spring, anchorA: [0.05, 0, 0], anchorB: [-0.05, 0, 0], stiffness: 3, damping: 0 },
    ],
  };
  const a = await createPhysicsWorld(configuration),
    b = await createPhysicsWorld(configuration);
  const { default: R } = await import('@dimforge/rapier3d-deterministic-compat');
  const advance = (w) => {
    w.prepareConstraints();
    w.prepareSprings();
    w.applyPreparedConstraints();
    w.applySprings();
    w.step();
  };
  let raw;
  try {
    for (let tick = 0; tick < 60; tick++) advance(a);
    assert.ok(a.springs()[0].potentialJ > 0, 'authored prestress energy must remain visible');
    const saved = a.snapshot(),
      size = new DataView(saved.buffer, saved.byteOffset, saved.byteLength).getUint32(4);
    raw = R.World.restoreSnapshot(saved.slice(12 + size));
    let nativeSpring;
    raw.impulseJoints.forEach((j) => {
      if (j.type() === R.JointType.Prismatic) nativeSpring = j;
    });
    b.restore(saved);
    for (let tick = 0; tick < 120; tick++) {
      advance(a);
      advance(b);
      assert.deepEqual(a.read(), b.read());
      assert.deepEqual(a.springs(), b.springs());
    }
    nativeSpring.configureMotorModel(R.MotorModel.SymplecticSpring);
    nativeSpring.configureMotorPosition(0.3, 3, 0);
    const payload = raw.takeSnapshot(),
      forged = new Uint8Array(12 + size + payload.length);
    forged.set(saved.slice(0, 12 + size));
    forged.set(payload, 12 + size);
    let checksum = 2166136261;
    for (const byte of forged.subarray(12)) checksum = Math.imul(checksum ^ byte, 16777619);
    new DataView(forged.buffer).setUint32(8, checksum >>> 0);
    const before = b.read();
    assert.throws(() => b.restore(forged), /snapshot physical plant mismatch/);
    assert.deepEqual(b.read(), before);
  } finally {
    raw?.free();
    a.dispose();
    b.dispose();
  }
});
