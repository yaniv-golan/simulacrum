import test from 'node:test';
import assert from 'node:assert/strict';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const dt = 1 / 120;
const config = (wired = true) => ({
  cells: [{ node: 0, voltage: 12, capacityJ: 100, initialJ: 100, resistance: 2, currentLimit: 1 }],
  motors: [],
  receivers: [],
  controllers: [],
  sensors: [{ node: 1, body: 1, axis: [1, 0, 0], supply: { resistance: 100, minVoltage: 1 } }],
  wires: wired ? [[0, 1]] : [],
  signalWires: [],
});
test('sensor current causes source droop, heat and charge loss without a motor', () => {
  const network = createPowerNetwork(config());
  network.step(dt, []);
  const s = network.completeStep(dt, []),
    i = 12 / 102;
  assert.ok(Math.abs(s.sensors[0].current - i) < 1e-10);
  assert.equal(s.sensors[0].powered, true);
  assert.ok(Math.abs(100 - s.cells[0].energyJ - 12 * i * dt) < 1e-10);
  assert.ok(Math.abs(100 - s.cells[0].energyJ - s.cells[0].heatJ - s.sensors[0].heatJ) < 1e-10);
  const copy = network.snapshot();
  network.step(dt, []);
  const expected = network.completeStep(dt, []);
  network.restore(copy);
  network.step(dt, []);
  assert.deepEqual(network.completeStep(dt, []), expected);
});
test('a signal connection cannot power a sensor and depleted supply invalidates it', () => {
  const c = config(false);
  c.controllers = [{ node: 2, duty: 0 }];
  c.signalWires = [[1, 2]];
  const network = createPowerNetwork(c);
  network.step(dt, []);
  const s = network.completeStep(dt, []);
  assert.equal(s.sensors[0].powered, false);
  assert.equal(s.cells[0].energyJ, 100);
  const exhausted = config();
  exhausted.cells[0].initialJ = 0;
  const empty = createPowerNetwork(exhausted);
  empty.step(dt, []);
  assert.equal(empty.completeStep(dt, []).sensors[0].powered, false);
});

test('sensor brownout conserves the last fraction of charge under a current cap', () => {
  for (const energy of [0.001, 1e-12, 1e-100, Number.MIN_VALUE]) {
    const c = config();
    c.cells[0].initialJ = energy;
    const n = createPowerNetwork(c);
    assert.doesNotThrow(() => n.step(dt, []));
    const f = n.completeStep(dt, []);
    assert.ok(f.cells[0].energyJ >= 0 && f.cells[0].energyJ <= energy);
    assert.equal(f.sensors[0].powered, false);
    assert.ok(
      Math.abs(energy - f.cells[0].energyJ - f.cells[0].heatJ - f.sensors[0].heatJ) <=
        Math.max(1e-14, energy * 1e-10),
    );
  }
});

test('sensor networks have an explicit admitted component bound', () => {
  const c = config(false);
  c.sensors = Array.from({ length: 64 }, (_, i) => ({ ...c.sensors[0], node: i + 1, body: i + 1 }));
  assert.doesNotThrow(() => createPowerNetwork(c));
  c.sensors.push({ ...c.sensors[0], node: 65, body: 65 });
  assert.throws(() => createPowerNetwork(c), /INVALID_POWER_CONFIGURATION/);
});
test('controller count has a measured admission bound independent of sensor count', () => {
  const c = config(false);
  c.controllers = Array.from({ length: 9 }, (_, i) => ({ node: i + 2, duty: 0 }));
  assert.throws(() => createPowerNetwork(c), /INVALID_POWER_CONFIGURATION/);
  c.controllers.pop();
  assert.doesNotThrow(() => createPowerNetwork(c));
});
