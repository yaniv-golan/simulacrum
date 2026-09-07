import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedPowerStep } from '../src/simulation/physics/law/motor.mjs';
test('positive tiny shared charge allocates proportionally instead of stagnating at zero', () => {
  for (const energy of [1e-12, 1e-15, 1e-30]) {
    const cells = [{ voltage: 12, resistance: 1, limit: 2, energy }],
      motors = [0, 1].map(() => ({
        cell: 0,
        duty: 1,
        speed: 0,
        inertia: 0.1,
        active: true,
        k: 0.1,
        resistance: 2,
        limit: 100,
      }));
    const r = sharedPowerStep(cells, motors, [], 1 / 120);
    assert.ok(r);
    assert.ok(r.totals[0] > 0);
    const spent = (12 * r.totals[0]) / 120;
    assert.ok(spent <= energy);
    assert.ok(spent > energy * (1 - 1e-9));
    assert.equal(r.currents[0], r.currents[1]);
  }
});
