import test from 'node:test';
import assert from 'node:assert/strict';
import { ropeVectorImpulses } from '../src/simulation/physics/law/rope.mjs';
const solve = (vector) =>
  ropeVectorImpulses({
    vectors: [vector],
    extensions: [0],
    restLengths: [1],
    stiffnesses: [100],
    dampings: [10],
    mobility: [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ],
    dt: 1 / 120,
  });
test('nonlinear slack and transverse extension match independent radial solution', () => {
  assert.deepEqual(solve([0.5, 0.2, 0]).impulses, [[0, 0, 0]]);
  const v = [1, 0.2, 0],
    l = Math.hypot(...v),
    a = 100 / 120 + 10,
    expected = (l - 1) / (1 / a + (5 / 8 / 120) * 2),
    actual = solve(v).impulses[0];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(actual[k] - (expected * v[k]) / l) < 1e-10);
  assert.ok(actual[1] > 0, 'transverse reaction cannot be omitted');
});
