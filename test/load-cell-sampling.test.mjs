import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSensor } from '../src/simulation/sensors.mjs';
const sensor = { node: 0, body: 0, kind: 'loadCell', joint: 1, support: 0, sign: -1 };
const context = {
  tick: 3,
  dt: 1 / 120,
  powered: true,
  bodies: [{ rotation: [0, 0, 0, 1] }],
  reaction: (i) => {
    assert.equal(i, 1);
    return { tick: 3, status: 'ok', impulse: [0.1, -0.2, 0] };
  },
};
test('load cell samples its completed B reaction in local axis with unsigned resultant', () => {
  const r = sampleSensor(sensor, context);
  assert.equal(r.tick, 3);
  assert.equal(r.channels.axialForce.value, -12);
  assert.ok(Math.abs(r.channels.load.value - Math.hypot(12, 24)) < 1e-12);
  const rotated = sampleSensor(sensor, {
    ...context,
    bodies: [{ rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
  });
  assert.ok(Math.abs(rotated.channels.axialForce.value - 24) < 1e-12);
});
test('load cell invalid readings never become numeric zero or stale force', () => {
  for (const [change, status] of [
    [{ powered: false }, 'no-power'],
    [{ reaction: () => ({ tick: 2, status: 'ok', impulse: [0, 0, 0] }) }, 'unavailable'],
    [{ reaction: () => ({ tick: 3, status: 'unavailable' }) }, 'unavailable'],
    [{ reaction: () => ({ tick: 3, status: 'ok', impulse: [NaN, 0, 0] }) }, 'unavailable'],
    [{ tick: 0, reaction: () => ({ tick: 0, status: 'initializing' }) }, 'initializing'],
  ]) {
    const r = sampleSensor(sensor, { ...context, ...change });
    assert.deepEqual(Object.values(r.channels), [{ status }, { status }]);
  }
  for (const change of [{ joint: -1 }, { support: -1 }])
    assert.deepEqual(Object.values(sampleSensor({ ...sensor, ...change }, context).channels), [
      { status: 'disconnected' },
      { status: 'disconnected' },
    ]);
  const zero = sampleSensor(sensor, {
    ...context,
    reaction: () => ({ tick: 3, status: 'ok', impulse: [0, 0, 0] }),
  });
  assert.deepEqual(zero.channels.load, { status: 'ok', value: 0 });
});
