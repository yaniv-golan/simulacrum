import test from 'node:test';
import assert from 'node:assert/strict';
import { coupledGearImpulses } from '../src/simulation/physics/law/gear.mjs';

test('backward Euler mesh matches independent scalar solution and dissipates energy', () => {
  const p = coupledGearImpulses({
    extensions: [0.002],
    speeds: [3],
    stiffnesses: [20000],
    dampings: [20],
    mobility: [[100]],
    dt: 1 / 120,
  });
  const expected =
    (-(1 / 120) * (20000 * 0.002 + (20000 / 120 + 20) * 3)) /
    (1 + (1 / 120) * (20000 / 120 + 20) * 100);
  assert.ok(Math.abs(p.impulses[0] - expected) < 1e-12);
  const kineticDelta = 3 * p.impulses[0] + 50 * p.impulses[0] ** 2;
  const potentialDelta = 10000 * (p.extensions[0] ** 2 - 0.002 ** 2);
  assert.ok(Math.abs(kineticDelta + potentialDelta + p.dampingWorkJ + p.numericalLossJ) < 1e-12);
  assert.ok(p.dampingWorkJ > 0 && p.numericalLossJ > 0);
});
test('coupled mesh solve preserves permutation and accounts energy including cross mobility', () => {
  const input = {
    extensions: [0.003, -0.001],
    speeds: [2, -4],
    stiffnesses: [20000, 10000],
    dampings: [20, 5],
    mobility: [
      [100, -30],
      [-30, 60],
    ],
    dt: 1 / 120,
  };
  const p = coupledGearImpulses(input),
    q = coupledGearImpulses({
      ...input,
      extensions: [...input.extensions].reverse(),
      speeds: [...input.speeds].reverse(),
      stiffnesses: [...input.stiffnesses].reverse(),
      dampings: [...input.dampings].reverse(),
      mobility: [
        [60, -30],
        [-30, 100],
      ],
    });
  assert.ok(Math.abs(p.impulses[0] - q.impulses[1]) < 1e-12);
  const kinetic = input.speeds.reduce(
    (s, v, i) =>
      s +
      v * p.impulses[i] +
      0.5 * p.impulses[i] * input.mobility[i].reduce((z, w, j) => z + w * p.impulses[j], 0),
    0,
  );
  const elastic = input.extensions.reduce(
    (s, x, i) => s + 0.5 * input.stiffnesses[i] * (p.extensions[i] ** 2 - x * x),
    0,
  );
  assert.ok(Math.abs(kinetic + elastic + p.dampingWorkJ + p.numericalLossJ) < 1e-12);
});
test('mesh law rejects malformed, asymmetric, indefinite and nonfinite inputs', () => {
  const input = {
    extensions: [0],
    speeds: [1],
    stiffnesses: [20000],
    dampings: [20],
    mobility: [[1]],
    dt: 1 / 120,
  };
  for (const change of [
    { extensions: null },
    { mobility: [[-1]] },
    { stiffnesses: [-1] },
    { dt: 0 },
    { speeds: [Infinity] },
    { mobility: [[NaN]] },
  ])
    assert.throws(() => coupledGearImpulses({ ...input, ...change }), RangeError);
  assert.throws(
    () =>
      coupledGearImpulses({
        extensions: [0, 0],
        speeds: [1, 1],
        stiffnesses: [1, 1],
        dampings: [0, 0],
        mobility: [
          [1, 2],
          [2, 1],
        ],
        dt: 0.1,
      }),
    RangeError,
  );
});
