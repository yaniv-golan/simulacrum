import test from 'node:test';
import assert from 'node:assert/strict';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const config = (voltage = 24, wired = true) => ({
  cells: [{ node: 0, voltage, capacityJ: 100, initialJ: 100, resistance: 0.1, currentLimit: 20 }],
  motors: [],
  receivers: [{ node: 1, duty: 0 }],
  controllers: [],
  sensors: [],
  wires: wired ? [[0, 2]] : [],
  signalWires: [[1, 2]],
  couplers: [{ node: 2, joint: 0, resistance: 24, minVoltage: 12, energyJ: 1 }],
});
const step = (p, duty = 1, results = []) => {
  p.step(1 / 120, [], [{ node: 1, duty }], [], [], results);
  return p.completeStep(1 / 120, []);
};
test('funded held release accumulates coil work, schedules once and accounts every joule', () => {
  const p = createPowerNetwork(config());
  let s;
  for (let i = 0; i < 20; i++) {
    s = step(p);
    if (s.couplers[0].ready) break;
  }
  assert.equal(s.couplers[0].ready, true);
  assert.equal(s.couplers[0].opened, false);
  assert.ok(Math.abs(100 - s.cells[0].energyJ - s.cells[0].heatJ - s.couplers[0].heatJ) < 1e-10);
  const paid = s.cells[0].energyJ;
  s = step(p, 0, [{ joint: 0, reasonCode: 'OK' }]);
  assert.equal(s.couplers[0].opened, true);
  for (let i = 0; i < 10; i++) s = step(p);
  assert.equal(s.cells[0].energyJ, paid);
});
test('unwired and undervoltage controls never release; interrupted progress resets without refund', () => {
  for (const c of [config(24, false), config(1)]) {
    const p = createPowerNetwork(c);
    let s;
    for (let i = 0; i < 30; i++) s = step(p);
    assert.equal(s.couplers[0].ready, false);
    assert.equal(s.couplers[0].progressJ, 0);
  }
  const p = createPowerNetwork(config());
  const first = step(p);
  assert.ok(first.couplers[0].progressJ > 0);
  const interrupted = step(p, 0);
  assert.equal(interrupted.couplers[0].progressJ, 0);
  assert.equal(interrupted.cells[0].energyJ, first.cells[0].energyJ);
  assert.equal(interrupted.couplers[0].heatJ, first.couplers[0].heatJ);
  const cp = p.snapshot();
  step(p);
  p.restore(cp);
  assert.deepEqual(p.snapshot(), cp);
});
test('blocked release retains latch with an explicit reason and invalid state rejects atomically', () => {
  const p = createPowerNetwork(config());
  let s;
  do {
    s = step(p);
  } while (!s.couplers[0].ready);
  s = step(p, 1, [{ joint: 0, reasonCode: 'RELEASE_SUPPORT_BLOCKED' }]);
  assert.equal(s.couplers[0].opened, false);
  assert.equal(s.couplers[0].reasonCode, 'RELEASE_SUPPORT_BLOCKED');
  const cp = p.snapshot();
  const bad = structuredClone(cp);
  bad.couplers[0].opened = true;
  assert.throws(() => p.restore(bad));
  assert.deepEqual(p.snapshot(), cp);
});
test('unattached latch rejects invented ready progress atomically', () => {
  const c = config();
  c.couplers[0].joint = -1;
  const p = createPowerNetwork(c),
    before = p.snapshot(),
    bad = structuredClone(before);
  Object.assign(bad.couplers[0], { ready: true, progressJ: 1, reasonCode: 'READY' });
  assert.throws(() => p.restore(bad));
  assert.deepEqual(p.snapshot(), before);
});
test('checkpoint reason cannot claim an open or ready latch while constraint remains closed', () => {
  const p = createPowerNetwork(config()),
    before = p.snapshot();
  for (const reasonCode of ['OPEN', 'READY', 'RELEASE_SUPPORT_BLOCKED', 'NO_LATCH', 'ACTUATING']) {
    const bad = structuredClone(before);
    bad.couplers[0].reasonCode = reasonCode;
    assert.throws(() => p.restore(bad));
    assert.deepEqual(p.snapshot(), before);
  }
});
