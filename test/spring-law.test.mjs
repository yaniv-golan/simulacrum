import test from 'node:test';
import assert from 'node:assert/strict';
import { springImpulse, coupledSpringImpulses } from '../src/simulation/physics/law/spring.mjs';
test('spring matches independent semi-implicit solution and signed ledger', () => {
  const dt = 1 / 120,
    k = 100,
    c = 2,
    w = 1,
    x = 0.05,
    v = 0.3;
  const result = springImpulse({
    extension: x,
    speed: v,
    stiffness: k,
    damping: c,
    inverseMass: w,
    dt,
  });
  const next = (v - dt * k * x * w) / (1 + dt * c * w);
  assert.ok(Math.abs(result.impulse - (next - v) / w) < 1e-12);
  assert.ok(Math.abs(result.dampingWorkJ - c * dt * next * next) < 1e-15);
  const delta = (0.5 * (next * next - v * v)) / w + 0.5 * k * ((x + dt * next) ** 2 - x * x);
  assert.ok(Math.abs(delta + result.dampingWorkJ - result.numericalDeltaJ) < 1e-12);
  assert.notEqual(result.impulse, dt * k * x); // wrong restoring sign
  assert.notEqual(result.impulse, -dt * (k * x + c * v)); // explicit is not this law
});
test('spring damping is relative and locked mobility is bounded', () => {
  for (const speed of [-2, 0, 2]) {
    const r = springImpulse({
      extension: 0,
      speed,
      stiffness: 0,
      damping: 20,
      inverseMass: 2,
      dt: 1 / 120,
    });
    assert.ok(r.impulse * speed <= 0);
    assert.ok(r.dampingWorkJ >= 0);
  }
  assert.equal(
    springImpulse({
      extension: 1,
      speed: 0,
      stiffness: 100,
      damping: 0,
      inverseMass: 0,
      dt: 1 / 120,
    }).impulse,
    0,
  );
  assert.throws(() =>
    springImpulse({
      extension: NaN,
      speed: 0,
      stiffness: 1,
      damping: 0,
      inverseMass: 1,
      dt: 1 / 120,
    }),
  );
});
test('coupled spring solve admits slightly asymmetric PSD mobility and rejects indefinite W', () => {
  const input = {
    extensions: [0.01, -0.02],
    speeds: [0.3, -0.1],
    stiffnesses: [0, 0],
    dampings: [2, 5],
    mobility: [
      [1, -0.2],
      [-0.2, 0.8],
    ],
    dt: 1 / 120,
  };
  const p = coupledSpringImpulses(input);
  assert.equal(p.impulses.length, 2);
  assert.ok(p.impulses.every(Number.isFinite));
  assert.ok(p.dampingWorkJ >= 0);
  const tilted = coupledSpringImpulses({
    ...input,
    mobility: [
      [1, -0.2],
      [-0.2 + 1e-16, 0.8],
    ],
  });
  assert.ok(p.impulses.every((x, i) => Math.abs(x - tilted.impulses[i]) < 1e-12));
  assert.throws(
    () =>
      coupledSpringImpulses({
        ...input,
        mobility: [
          [1, 2],
          [0, 1],
        ],
      }),
    /asymmetric spring mobility/,
  );
  assert.throws(
    () =>
      coupledSpringImpulses({
        ...input,
        mobility: [
          [1, 2],
          [2, 1],
        ],
      }),
    RangeError,
  );
});
