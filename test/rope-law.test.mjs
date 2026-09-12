import test from 'node:test';
import assert from 'node:assert/strict';
import { ropeVectorImpulses } from '../src/simulation/physics/law/rope.mjs';
const close = (a, b, t = 1e-11) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const solve = (
  extensions,
  speeds,
  mobility,
  stiffnesses = extensions.map(() => 100),
  dampings = extensions.map(() => 0),
) => {
  const n = extensions.length,
    dt = 1 / 120;
  const r = ropeVectorImpulses({
    vectors: extensions.map((x, i) => [1 + x + dt * speeds[i], 0, 0]),
    extensions,
    restLengths: extensions.map(() => 1),
    stiffnesses,
    dampings,
    mobility: Array.from({ length: 3 * n }, (_, i) =>
      Array.from({ length: 3 * n }, (_, j) =>
        i % 3 === 0 && j % 3 === 0 ? mobility[i / 3][j / 3] : 0,
      ),
    ),
    dt,
    positionFactor: 1,
  });
  const impulses = r.impulses.map((v) => v[0]),
    delta = mobility.map((row) => -row.reduce((s, v, j) => s + v * impulses[j], 0)),
    next = extensions.map((x, i) => x + dt * (speeds[i] + delta[i]));
  const dampingWorkJ = extensions.reduce(
    (s, x, i) =>
      s +
      (impulses[i] / dt - stiffnesses[i] * Math.max(0, next[i])) *
        (Math.max(0, next[i]) - Math.max(0, x)),
    0,
  );
  const numericalLossJ =
    -impulses.reduce((s, p, i) => s - p * (speeds[i] + 0.5 * delta[i]), 0) -
    extensions.reduce(
      (s, x, i) => s + 0.5 * stiffnesses[i] * (Math.max(0, next[i]) ** 2 - Math.max(0, x) ** 2),
      0,
    ) -
    dampingWorkJ;
  assert.ok(dampingWorkJ >= -1e-11);
  return { impulses, dampingWorkJ: Math.max(0, dampingWorkJ), numericalLossJ };
};
test('slack chain has no compression; extended positive control pulls', () => {
  assert.deepEqual(solve([-0.1], [0], [[2]]).impulses, [0]);
  assert.deepEqual(solve([-0.1], [-1], [[2]]).impulses, [0]);
  const p = solve([0.1], [0], [[2]]).impulses[0];
  close(p, (100 * 0.1) / 120 / (1 + (100 * 2) / 120 ** 2));
  assert.ok(p > 0);
});
test('simultaneous adjacent links match independent symmetric analytical solution', () => {
  const r = solve(
    [0.1, 0.1],
    [0, 0],
    [
      [2, -1],
      [-1, 2],
    ],
  );
  const p = (100 * 0.1) / 120 / (1 + 100 / 120 ** 2);
  r.impulses.forEach((v) => close(v, p));
  assert.ok(Math.abs(p - solve([0.1], [0], [[2]]).impulses[0]) > 1e-4);
});
test('energy includes elastic release, gravity-free impulse work and damping', () => {
  for (const x of [-0.1, 0, 0.1])
    for (const v of [-20, -1, 0, 1, 20])
      for (const c of [0, 2, 90]) {
        const r = solve([x], [v], [[2]], [100], [c]),
          p = r.impulses[0],
          v1 = v - 2 * p;
        const oldE = 0.25 * v * v + 50 * Math.max(0, x) ** 2;
        const newE = 0.25 * v1 * v1 + 50 * Math.max(0, x + v1 / 120) ** 2;
        assert.ok(p >= 0);
        close(oldE - newE, r.dampingWorkJ + r.numericalLossJ, 1e-10);
        assert.ok(r.dampingWorkJ >= 0);
        assert.ok(r.numericalLossJ >= -1e-11);
      }
});
test('invalid and asymmetric mobility reject before returning impulses', () => {
  assert.throws(() =>
    solve(
      [0, 0],
      [0, 0],
      [
        [1, 2],
        [0, 1],
      ],
    ),
  );
  assert.throws(() => solve([0], [0], [[-1]]));
  assert.throws(() => solve([NaN], [0], [[1]]));
});
