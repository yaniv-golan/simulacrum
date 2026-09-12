import test from 'node:test';
import assert from 'node:assert/strict';
import { ropeWorkLedger } from '../src/simulation/physics/law/rope.mjs';
const close = (a, b, t = 1e-10) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
test('completed rope ledger separates dashpot, implicit geometry loss and signed force mismatch', () => {
  // Opposing segment work cancels; a genuine aggregate receipt must remain admissible.
  for (const dx of [1e-5, 1e-9]) {
    const dt = 1 / 120,
      segments = Array.from({ length: 32 }, (_, i) => {
        const change = dx * (1 + (i % 16) / 16) * (i < 16 ? 1 : -1),
          before = 1.01,
          after = before + change,
          force = Math.max(0, 1e6 * (after - 1) + (1e3 * (after - before)) / dt);
        return {
          before: [before, 0, 0],
          after: [after, 0, 0],
          impulse: [dt * force, 0, 0],
          restLength: 1,
          stiffness: 1e6,
          damping: 1e3,
        };
      }),
      r = ropeWorkLedger(segments, dt),
      terms = [
        r.ropeWorkJ,
        r.ropeElasticDeltaJ,
        r.ropeDampingWorkJ,
        r.ropeNumericalLossJ,
        -r.ropeSplitWorkJ,
      ],
      scale = Math.max(...terms.map(Math.abs));
    assert.ok(
      Math.abs(terms.reduce((sum, v) => sum + v / scale, 0)) <=
        8 * (segments.length + 5) * Number.EPSILON,
      `valid cancelling ledger must satisfy restore closure at dx=${dx}`,
    );
  }

  for (const [before, after, c, impulse] of [
    [[1.1, 0, 0], [1.1, 0, 0], 10, [3, 0, 0]],
    [[1.1, 0, 0], [1.2, 0, 0], 10, [0.2, 0, 0]],
    [[1.2, 0, 0], [1.1, 0, 0], 100, [0.1, 0, 0]],
    [[0.9, 0, 0], [1.1, 0, 0], 10, [0.2, 0, 0]],
    [[1.1, 0, 0], [0, 1.1, 0], 10, [0, 0.2, 0]],
    [[1.1, 0, 0], [1.2, 0, 0], 0, [0.2, 0, 0]],
  ]) {
    const k = 100,
      dt = 0.1,
      e0 = Math.max(0, Math.hypot(...before) - 1),
      e1 = Math.max(0, Math.hypot(...after) - 1),
      de = e1 - e0;
    const r = ropeWorkLedger(
      [{ before, after, impulse, restLength: 1, stiffness: k, damping: c }],
      dt,
    );
    const raw = -impulse.reduce((sum, x, i) => sum + (x * (after[i] - before[i])) / dt, 0),
      du = (k * (e1 * e1 - e0 * e0)) / 2;
    const reference = Math.max(0, k * e1 + (c * de) / dt),
      expectedD = (reference - k * e1) * de;
    close(r.ropeWorkJ, raw);
    close(r.ropeElasticDeltaJ, du);
    close(r.ropeDampingWorkJ, expectedD);
    const referenceWork =
      reference *
      after.reduce((sum, v, i) => sum + (v * (after[i] - before[i])) / Math.hypot(...after), 0);
    close(r.ropeNumericalLossJ, referenceWork - du - expectedD);
    close(r.ropeSplitWorkJ, raw + referenceWork);
    assert.ok(r.ropeDampingWorkJ >= 0);
    assert.ok(r.ropeNumericalLossJ >= 0);
    close(raw + du, -r.ropeDampingWorkJ - r.ropeNumericalLossJ + r.ropeSplitWorkJ);
    if (c === 0 || de === 0) close(r.ropeDampingWorkJ, 0);
    if (before.every((x, i) => x === after[i])) for (const v of Object.values(r)) close(v, 0);
  }
});

import { createSession } from '../src/simulation/session.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body = (position, fixed = false, velocity = [0, 0, 0]) => ({
  shape: 'sphere',
  position,
  rotation: [0, 0, 0, 1],
  velocity,
  mass: 1,
  halfExtents: [0.01, 0.01, 0.01],
  fixed,
  friction: 0,
  restitution: 0,
  collision: false,
});
const joint = {
  kind: 'rope',
  a: 0,
  b: 1,
  anchorA: [0, 0, 0],
  anchorB: [0, 0, 0],
  restLength: 1,
  stiffness: 100,
  damping: 10,
  strength: 1e6,
  maxStrain: 0.1,
};
const power = {
  cells: [],
  motors: [],
  wires: [],
  signalWires: [],
  receivers: [],
  controllers: [],
  sensors: [],
};
test('session rope ledger matches independent momentum-work and analytic native integration error', async () => {
  const gravity = [0, -9.81, 0],
    c = {
      gravity,
      bodies: [body([0, 1, 0]), body([1.01, 1, 0], false, [0.2, 0, 0])],
      joints: [joint],
      power,
    };
  const s = await createSession(c),
    dt = 1 / 120;
  try {
    const before = s.observe().frames[0];
    s.step(1);
    const after = s.observe().frames[0],
      e = after.energy;
    let work = 0,
      deltaKg = 0,
      native = 0;
    before.physics.forEach((b, i) => {
      const a = after.physics[i],
        force = a.velocity.map((v, k) => (v - b.velocity[k]) / dt - gravity[k]);
      work += force.reduce((sum, f, k) => sum + f * (a.position[k] - b.position[k]), 0);
      deltaKg += a.velocity.reduce(
        (sum, v, k) =>
          sum + (v * v - b.velocity[k] ** 2) / 2 - gravity[k] * (a.position[k] - b.position[k]),
        0,
      );
      native -= ((dt * dt) / 8) * force.reduce((sum, f, k) => sum + (f + gravity[k]) ** 2, 0);
    });
    assert.ok(Math.abs(work) > 1e-5);
    close(e.ropeWorkJ, work, 1e-10);
    close(deltaKg - work, native, 1e-10);
    close(e.integrationDeltaJ, native, 1e-10);
    const d0 = before.ropes[0].length - 1,
      d1 = after.ropes[0].length - 1;
    close(e.ropeElasticDeltaJ, 50 * (d1 * d1 - d0 * d0));
    close(e.ropeDampingWorkJ, (10 * (d1 - d0) ** 2) / dt);
    close(e.balanceResidualJ, 0);
    const cp = s.checkpoint();
    s.step(1);
    s.restore(cp);
    assert.deepEqual(s.observe().frames[0].energy, e);
  } finally {
    s.dispose();
  }
});
test('static hanging rope has no phantom work, damping or numerical loss and native receipt restores', async () => {
  const w = await createPhysicsWorld({
    gravity: [9.81, 0, 0],
    bodies: [body([0, 0, 0], true), body([1.0981, 0, 0])],
    joints: [{ ...joint, damping: 100 }],
  });
  try {
    for (let t = 0; t < 120; t++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.applyRopes();
      w.step();
      for (const v of Object.values(w.ropeEnergy())) close(v, 0, 1e-12);
    }
    const cp = w.snapshot(),
      receipt = w.ropeEnergy();
    w.applyImpulse(1, [-0.001, 0, 0]);
    w.prepareConstraints();
    w.applyPreparedConstraints();
    w.applyRopes();
    w.step();
    assert.ok(w.ropeEnergy().ropeDampingWorkJ > 0);
    w.restore(cp);
    assert.deepEqual(w.ropeEnergy(), receipt);
  } finally {
    w.dispose();
  }
});
