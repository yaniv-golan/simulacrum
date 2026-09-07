import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedPowerStep } from '../src/simulation/physics/law/motor.mjs';
const dt = 1 / 120;
const cell = (voltage, limit = 2) => ({ voltage, resistance: 1, limit, energy: 100 });
const motor = (cell, duty = 1) => ({
  cell,
  duty,
  speed: 0,
  inertia: 0.1,
  active: true,
  k: 0.1,
  resistance: 2,
  limit: 100,
});
test('independent island merge equals connected solve and independent network results', () => {
  const cells = [cell(12), cell(8), cell(19), cell(7)],
    motors = [motor(2, 0.4), motor(0, -0.7), motor(1), motor(2), motor(0)],
    coupling = [{ source: 0, target: 3, response: 3 }];
  motors[3].limit = 50;
  motors[4].limit = 40;
  const r = sharedPowerStep(cells, motors, coupling, dt);
  assert.ok(r);
  const connected = sharedPowerStep(
    cells,
    motors,
    [...coupling, { source: 0, target: 1, response: 0 }, { source: 1, target: 2, response: 0 }],
    dt,
  );
  assert.deepEqual(
    r,
    connected,
    'zero coupling connects solver topology without altering physical equations',
  );
  for (let c = 0; c < cells.length; c++) {
    const indices = motors.map((m, i) => (m.cell === c ? i : -1)).filter((i) => i >= 0),
      edges = coupling
        .filter((e) => indices.includes(e.source))
        .map((e) => ({
          ...e,
          source: indices.indexOf(e.source),
          target: indices.indexOf(e.target),
        }));
    const separate = sharedPowerStep(
      [cells[c]],
      indices.map((i) => ({ ...motors[i], cell: 0 })),
      edges,
      dt,
    );
    assert.equal(r.totals[c], separate.totals[0]);
    assert.equal(r.voltages[c], separate.voltages[0]);
    for (const [local, original] of indices.entries()) {
      assert.equal(r.currents[original], separate.currents[local]);
      assert.equal(r.speeds[original], separate.speeds[local]);
    }
  }
  const wrong = { ...r, currents: [...r.currents].reverse() };
  assert.notDeepEqual(wrong, connected, 'wrong local-to-original merge must not pass');
});
test('inactive and unpowered motors retain their coupled speed receipts across islands', () => {
  const cells = [cell(12), cell(8)],
    motors = [motor(0), { ...motor(-1), active: false }, { ...motor(0), active: false }, motor(1)],
    coupling = [
      { source: 0, target: 1, response: 4 },
      { source: 0, target: 2, response: -3 },
    ];
  const r = sharedPowerStep(cells, motors, coupling, dt);
  const connected = sharedPowerStep(
    cells,
    motors,
    [...coupling, { source: 2, target: 3, response: 0 }],
    dt,
  );
  assert.deepEqual(r, connected);
  assert.equal(r.currents[1], 0);
  assert.equal(r.currents[2], 0);
  assert.ok(r.speeds[1] > 0);
  assert.ok(r.speeds[2] < 0);
});
