import test from 'node:test';
import assert from 'node:assert/strict';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const dt = 1 / 120;
const config = () => ({
  cells: [
    { node: 0, voltage: 24, capacityJ: 100, initialJ: 100, resistance: 0.1, currentLimit: 20 },
  ],
  motors: [],
  sensors: [],
  controllers: [],
  receivers: [],
  wires: [[0, 1]],
  signalWires: [],
  lamps: [{ node: 1, brightness: 1, color: 0xffffff, beamSpread: 0.52 }],
});
const step = (n, commands = []) => {
  n.step(dt, [], commands);
  return n.completeStep(dt, []);
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test('lamp default output is funded and its energy is counted once', () => {
  const c = config(),
    n = createPowerNetwork(c),
    s = step(n),
    l = s.lamps[0],
    i = 24 / 57.7;
  near(l.current, i);
  near(l.deliveredW, i * i * 57.6);
  near(l.luminousFluxLm, l.deliveredW * 100);
  assert.equal(l.command, 1);
  assert.equal(l.requestedW, 10);
  assert.ok(l.luminousFluxLm > 990);
  near(100 - s.cells[0].energyJ, s.cells[0].heatJ + l.deliveredEnergyJ);
});
test('brightness, high voltage, weak power, no power and depletion have bounded output', () => {
  for (const brightness of [0, 0.25, 1])
    for (const voltage of [0.1, 12, 24, 240]) {
      const c = config();
      Object.assign(c.lamps[0], { brightness });
      c.cells[0].voltage = voltage;
      const l = step(createPowerNetwork(c)).lamps[0];
      assert.equal(l.requestedW, 10 * brightness);
      assert.ok(l.deliveredW >= 0 && l.deliveredW <= l.requestedW + 1e-10);
      near(l.luminousFluxLm, l.deliveredW * 100);
      if (brightness > 0) assert.ok(l.deliveredW > 0);
    }
  for (const reason of ['NO_POWER', 'DEPLETED']) {
    const c = config();
    if (reason === 'NO_POWER') c.wires = [];
    else c.cells[0].initialJ = 0;
    const l = step(createPowerNetwork(c)).lamps[0];
    assert.equal(l.reasonCode, reason);
    assert.equal(l.deliveredW, 0);
  }
  const c = config();
  c.cells[0].currentLimit = 0.01;
  const l = step(createPowerNetwork(c)).lamps[0];
  assert.equal(l.reasonCode, 'LIMITED');
  assert.ok(l.deliveredW > 0 && l.deliveredW < 1);
});
test('receiver explicitly replaces default including zero negative disabled and fresh commands', () => {
  const c = config();
  c.receivers = [{ node: 2, duty: 0 }];
  c.signalWires = [[2, 1]];
  const n = createPowerNetwork(c);
  assert.equal(step(n).lamps[0].deliveredW, 0);
  assert.ok(step(n, [{ node: 2, duty: 0.5 }]).lamps[0].deliveredW > 0);
  assert.equal(step(n, [{ node: 2, duty: -1 }]).lamps[0].requestedW, 0);
  assert.equal(step(n, [{ node: 2, duty: 1, enabled: false }]).lamps[0].deliveredW, 0);
  assert.ok(step(n, [{ node: 2, duty: 1 }]).lamps[0].deliveredW > 0);
  c.signalWires = [];
  assert.ok(step(createPowerNetwork(c)).lamps[0].deliveredW > 0);
  c.controllers = [{ node: 3, duty: 1 }];
  c.signalWires = [[3, 1]];
  assert.throws(() => createPowerNetwork(c), /UNSUPPORTED_SIGNAL_TOPOLOGY/);
});
test('lamp and sensor compete on limited supply without double counting delivered energy', () => {
  const c = config();
  c.cells[0].currentLimit = 0.1;
  const single = step(createPowerNetwork(c));
  c.sensors = [{ node: 2, body: 2, axis: [1, 0, 0], supply: { resistance: 57.6, minVoltage: 1 } }];
  c.wires.push([0, 2]);
  const s = step(createPowerNetwork(c));
  assert.ok(s.lamps[0].deliveredW < single.lamps[0].deliveredW);
  near(
    100 - s.cells[0].energyJ,
    s.cells[0].heatJ + s.sensors[0].heatJ + s.lamps[0].deliveredEnergyJ,
  );
});
test('lamp checkpoint rejects corrupt output atomically and resumes exactly', () => {
  const n = createPowerNetwork(config());
  step(n);
  const cp = n.snapshot();
  const next = step(n);
  n.restore(cp);
  assert.deepEqual(step(n), next);
  for (const edit of [
    (l) => l.luminousFluxLm++,
    (l) => (l.deliveredW = -1),
    (l) => (l.command = 2),
    (l) => (l.deliveredEnergyJ = -1),
    (l) => (l.requestedW = 99),
    (l) => (l.extra = 1),
    (l) => (l.deliveredEnergyJ = 1e300),
    (l) => (l.voltage = 1e300),
    (l) => (l.reasonCode = 'DEPLETED'),
  ]) {
    const bad = structuredClone(cp);
    edit(bad.lamps[0]);
    const before = n.snapshot();
    assert.throws(() => n.restore(bad), /INVALID_POWER_CHECKPOINT/);
    assert.deepEqual(n.snapshot(), before);
  }
});
test('lamp configurations have strict bounds and an eight lamp limit', () => {
  const c = config();
  c.lamps = Array.from({ length: 8 }, (_, i) => ({ ...c.lamps[0], node: i + 1 }));
  assert.doesNotThrow(() => createPowerNetwork(c));
  c.lamps.push({ ...c.lamps[0], node: 9 });
  assert.throws(() => createPowerNetwork(c));
  for (const [key, value] of [
    ['brightness', -1],
    ['brightness', 1.1],
    ['color', 1.5],
    ['color', -1],
    ['beamSpread', 0],
    ['beamSpread', 2],
  ]) {
    const x = config();
    x.lamps[0][key] = value;
    assert.throws(() => createPowerNetwork(x));
  }
});
test('one motor and lamp share current and reconcile the complete electrical ledger', () => {
  const run = (withLamp) => {
    const c = config();
    c.cells[0].currentLimit = 0.2;
    c.motors = [
      {
        node: 2,
        body: 2,
        rotor: 3,
        joint: 0,
        axis: [1, 0, 0],
        torqueConstant: 0.1,
        resistance: 2,
        currentLimit: 1,
        defaultDuty: 1,
      },
    ];
    c.wires.push([0, 2]);
    if (!withLamp) delete c.lamps;
    const n = createPowerNetwork(c),
      a = n.step(dt, [{ node: 2, speed: 0 }], [], [{ node: 2, inertia: 0.1 }]);
    const torque = a.torques[0].value,
      speed = (torque * dt) / 0.1,
      work = (torque * speed * dt) / 2;
    return n.completeStep(dt, [
      {
        node: 2,
        speedBefore: 0,
        speedAfter: speed,
        workJ: work,
        kineticDeltaJ: work,
        kineticBeforeJ: 0,
        kineticAfterJ: work,
      },
    ]);
  };
  const alone = run(false),
    s = run(true),
    m = s.motors[0];
  assert.ok(m.current < alone.motors[0].current);
  assert.ok(s.lamps[0].deliveredW > 0);
  near(
    100 - s.cells[0].energyJ,
    s.cells[0].heatJ +
      m.heatJ +
      m.driverHeatJ +
      m.mechanicalEnergy +
      m.energyResidualJ +
      s.lamps[0].deliveredEnergyJ,
  );
});
test('low brightness on maximum capacity preserves bounded float64 ledger rounding', () => {
  const c = config();
  c.cells[0].capacityJ = c.cells[0].initialJ = 1e9;
  c.lamps[0].brightness = 0.01;
  const n = createPowerNetwork(c);
  for (let i = 0; i < 120; i++) step(n);
  const cp = n.snapshot();
  assert.ok(cp.lamps[0].deliveredEnergyJ > 0.09);
  assert.doesNotThrow(() => n.restore(cp));
});
test('lamp shares release coil energy through ready restore and opening', () => {
  const c = config();
  c.couplers = [{ node: 2, joint: 0, resistance: 24, minVoltage: 12, energyJ: 1 }];
  c.receivers = [{ node: 3, duty: 1 }];
  c.signalWires = [[3, 2]];
  c.wires.push([0, 2]);
  const n = createPowerNetwork(c);
  let s;
  for (let i = 0; i < 20; i++) {
    s = step(n);
    n.restore(JSON.parse(JSON.stringify(n.snapshot())));
    near(
      100 - s.cells[0].energyJ,
      s.cells[0].heatJ + s.couplers[0].heatJ + s.lamps[0].deliveredEnergyJ,
    );
    assert.ok(s.lamps[0].deliveredW > 0);
    if (s.couplers[0].ready) break;
  }
  assert.equal(s.couplers[0].ready, true);
  assert.ok(s.couplers[0].current > 0);
  const cp = n.snapshot();
  const open = () => {
    n.step(dt, [], [], [], [], [{ joint: 0, reasonCode: 'OK' }]);
    return n.completeStep(dt, []);
  };
  const opened = open();
  n.restore(cp);
  assert.deepEqual(open(), opened);
  assert.equal(opened.couplers[0].current, 0);
  assert.equal(opened.couplers[0].progressJ, 0);
  assert.equal(opened.couplers[0].heatJ, s.couplers[0].heatJ);
  assert.ok(opened.lamps[0].deliveredW > s.lamps[0].deliveredW);
});
test('lamp bus restore uses the actual speed-limited linear actuator PWM', () => {
  const c = config();
  c.motors = [
    {
      node: 2,
      body: 2,
      rotor: 3,
      joint: 0,
      axis: [1, 0, 0],
      torqueConstant: 1,
      resistance: 2,
      currentLimit: 1,
      defaultDuty: 1,
      coordinate: 'linear',
      maxSpeed: 0.5,
    },
  ];
  c.wires.push([0, 2]);
  const n = createPowerNetwork(c);
  const a = n.step(dt, [{ node: 2, speed: 0 }], [], [{ node: 2, inertia: 0.1 }]);
  const force = a.torques[0].value,
    speed = (force * dt) / 0.1,
    work = (force * speed * dt) / 2;
  n.completeStep(dt, [
    {
      node: 2,
      speedBefore: 0,
      speedAfter: speed,
      workJ: work,
      kineticDeltaJ: work,
      kineticBeforeJ: 0,
      kineticAfterJ: work,
    },
  ]);
  const cp = n.snapshot();
  assert.doesNotThrow(() => n.restore(cp));
});
