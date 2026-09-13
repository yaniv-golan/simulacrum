import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { immutableCopy } from '../src/model/observation.mjs';
import { motorStep } from '../src/simulation/physics/law/motor.mjs';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const dt = 1 / 120,
  close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const config = () => ({
  cells: [
    { node: 0, voltage: 24, capacityJ: 100, initialJ: 100, resistance: 0.1, currentLimit: 20 },
  ],
  motors: [
    {
      node: 1,
      body: 1,
      rotor: 2,
      joint: 0,
      defaultDuty: 1,
      axis: [1, 0, 0],
      torqueConstant: 0.1,
      resistance: 1,
      currentLimit: 10,
    },
  ],
  wires: [[0, 1]],
  signalWires: [[3, 1]],
  receivers: [{ node: 3, duty: 1 }],
  controllers: [],
  sensors: [],
});
const receipt = (before, after, torque) => ({
  node: 1,
  speedBefore: before,
  speedAfter: after,
  workJ: (torque * (before + after) * dt) / 2,
  kineticDeltaJ: (torque * (before + after) * dt) / 2,
  kineticBeforeJ: Math.max(0, (-torque * (before + after) * dt) / 2),
  kineticAfterJ: Math.max(0, (torque * (before + after) * dt) / 2),
});
function execute(network, { speed = 0, inertia = 0.01, commands = [] } = {}) {
  const allocation = network.step(dt, [{ node: 1, speed }], commands, [{ node: 1, inertia }]);
  const after = speed + (allocation.torques[0].value * dt) / inertia;
  return {
    torques: allocation.torques,
    telemetry: network.completeStep(dt, [receipt(speed, after, allocation.torques[0].value)]),
  };
}
test('endpoint bound funds constant current throughout isolated acceleration', () => {
  for (const speed of [0, 2, -2])
    for (const voltage of [12, -12])
      for (const limit of [0.1, 20]) {
        const r = motorStep(voltage, speed, 0.2, 1, limit, 0.3, dt);
        close(r.electricalEnergy, r.heatEnergy + r.mechanicalEnergy);
        close(r.mechanicalEnergy, 0.5 * 0.3 * (r.nextSpeed ** 2 - speed ** 2));
        assert.ok((voltage - 0.2 * r.nextSpeed - r.current) * r.current >= -1e-12);
        assert.ok(r.heatEnergy >= r.current ** 2 * dt - 1e-12);
        assert.ok(Math.abs(r.current) <= limit);
      }
  const off = motorStep(0, 3, 0.2, 1, 20, 0.3, dt);
  assert.equal(off.current, 0);
  assert.equal(off.nextSpeed, 3);
});
test('network requires physical power; receiver overrides forgiving motor default', () => {
  const network = createPowerNetwork(config()),
    r = execute(network);
  assert.ok(r.torques[0].value > 0);
  assert.ok(network.read().cells[0].energyJ < 100);
  const disconnected = config();
  disconnected.wires = [];
  const off = execute(createPowerNetwork(disconnected));
  assert.equal(off.torques[0].value, 0);
  assert.equal(off.telemetry.motors[0].reasonCode, 'NO_POWER');
  const unsignalled = config();
  unsignalled.signalWires = [];
  assert.ok(execute(createPowerNetwork(unsignalled)).torques[0].value > 0);
  assert.equal(
    execute(createPowerNetwork(config()), { commands: [{ node: 3, duty: 0 }] }).torques[0].value,
    0,
  );
});
test('energy depletion cannot overdraw and only completed state checkpoints', () => {
  const cfg = config();
  cfg.cells[0].initialJ = 0.00001;
  const network = createPowerNetwork(cfg),
    snapshot = network.snapshot();
  const allocation = network.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]);
  assert.deepEqual(network.read(), snapshot);
  assert.throws(() => network.snapshot(), /POWER_STEP_PENDING/);
  assert.throws(
    () => network.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]),
    /POWER_STEP_PENDING/,
  );
  const state = network.completeStep(dt, [
    receipt(0, (allocation.torques[0].value * dt) / 0.01, allocation.torques[0].value),
  ]);
  assert.ok(state.cells[0].energyJ >= 0);
  close(snapshot.cells[0].energyJ - state.cells[0].energyJ, state.motors[0].electricalEnergy);
  network.restore(snapshot);
  assert.deepEqual(network.snapshot(), snapshot);
  assert.throws(() => network.step(dt, [{ node: 1, speed: 0 }], [{ node: 99, duty: 1 }]));
});
test('unsupported multi-source power and malformed numeric config are explicit', () => {
  const multiple = config();
  multiple.cells.push({ ...multiple.cells[0], node: 4 });
  multiple.wires.push([4, 1]);
  assert.throws(() => createPowerNetwork(multiple), /UNSUPPORTED_POWER_TOPOLOGY/);
  const invalid = config();
  invalid.cells[0].initialJ = 101;
  assert.throws(() => createPowerNetwork(invalid));
  const bad = config();
  bad.motors[0].resistance = -1;
  assert.throws(() => createPowerNetwork(bad));
});
test('measured kick work determines driver loss and conserves the electrical allocation', () => {
  const network = createPowerNetwork(config());
  const allocation = network.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]);
  const measuredAfter = 0.006,
    telemetry = network.completeStep(dt, [receipt(0, measuredAfter, allocation.torques[0].value)]),
    m = telemetry.motors[0];
  close(telemetry.cells[0].heatJ, m.current ** 2 * 0.1 * dt);
  close(m.heatJ, m.current ** 2 * dt);
  close(m.mechanicalEnergy, (allocation.torques[0].value * measuredAfter * dt) / 2);
  close(
    m.electricalEnergy,
    telemetry.cells[0].heatJ + m.heatJ + m.driverHeatJ + m.mechanicalEnergy + m.energyResidualJ,
  );
  assert.ok(m.driverHeatJ > 0);
  close(m.shaftWorkJ, m.mechanicalEnergy);
});
test('unfunded actual work fails atomically rather than becoming negative driver heat', () => {
  const network = createPowerNetwork(config()),
    before = network.snapshot();
  const allocation = network.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]);
  assert.throws(
    () => network.completeStep(dt, [receipt(0, 10000, allocation.torques[0].value)]),
    /ENERGY_INVARIANT/,
  );
  assert.deepEqual(network.read(), before);
  assert.throws(() => network.snapshot(), /POWER_STEP_PENDING/);
  network.restore(before);
  assert.deepEqual(network.snapshot(), before);
});
test('positive average driver heat cannot hide negative endpoint voltage headroom', () => {
  const network = createPowerNetwork(config()),
    before = network.snapshot();
  const allocation = network.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]);
  // 10 A, 24 V, Rtotal1.1: final back-EMF at150rad/s requires26V.
  // Average work is only0.625J, leaving positive average driverheat0.4583J.
  assert.throws(
    () => network.completeStep(dt, [receipt(0, 150, allocation.torques[0].value)]),
    /ENERGY_INVARIANT/,
  );
  assert.deepEqual(network.read(), before);
});
test('missing, duplicate, misbound or forged work receipts fail without publishing', () => {
  for (const mutate of [
    (r) => [],
    (r) => [r, r],
    (r) => [{ ...r, node: 99 }],
    (r) => [{ ...r, kineticDeltaJ: r.workJ + 1 }],
    (r) => [{ ...r, speedBefore: 2 }],
    (r) => [{ ...r, workJ: r.workJ + 1 }],
  ]) {
    const n = createPowerNetwork(config()),
      before = n.read(),
      a = n.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]),
      r = receipt(0, (a.torques[0].value * dt) / 0.01, a.torques[0].value);
    assert.throws(() => n.completeStep(dt, mutate(r)));
    assert.deepEqual(n.read(), before);
  }
});
test('large kinetic energy cannot conceal a forged motor work identity', () => {
  const n = createPowerNetwork(config()),
    a = n.step(dt, [{ node: 1, speed: 0 }], [], [{ node: 1, inertia: 0.01 }]),
    r = receipt(0, (a.torques[0].value * dt) / 0.01, a.torques[0].value);
  assert.throws(
    () =>
      n.completeStep(dt, [
        { ...r, workJ: 0, kineticDeltaJ: 0, kineticBeforeJ: 10000, kineticAfterJ: 10000 },
      ]),
    /ENERGY_INVARIANT/,
  );
});
test('multiple sensors share a motor supply, brown out under its load and recover with conserved energy', () => {
  const cfg = config();
  cfg.cells[0].currentLimit = 0.1;
  cfg.sensors = [4, 5].map((node) => ({
    node,
    body: node,
    axis: [1, 0, 0],
    supply: { resistance: 100, minVoltage: 1 },
  }));
  cfg.wires.push([0, 4], [0, 5]);
  const network = createPowerNetwork(cfg);
  const loaded = execute(network).telemetry;
  assert.ok(loaded.sensors.every((s) => !s.powered && s.current > 0));
  const recovered = execute(network, { commands: [{ node: 3, duty: 0 }] }).telemetry;
  assert.ok(recovered.sensors.every((s) => s.powered));
  close(recovered.sensors[0].current, recovered.sensors[1].current);
  const spent = 100 - recovered.cells[0].energyJ;
  const heat =
    recovered.cells[0].heatJ +
    recovered.sensors.reduce((sum, s) => sum + s.heatJ, 0) +
    recovered.motors.reduce((sum, m) => sum + m.heatJ + m.driverHeatJ + m.energyResidualJ, 0);
  close(spent, heat + recovered.motors.reduce((sum, m) => sum + m.shaftWorkJ, 0));
});

test('completed power reads are admitted immutable snapshots detached from later work', () => {
  const network = createPowerNetwork(config());
  const initial = network.read();
  assert.ok(Object.isFrozen(initial));
  assert.equal(immutableCopy(initial), initial);
  assert.ok(Object.isFrozen(initial.motors[0]));
  assert.throws(() => {
    initial.cells[0].energyJ = 0;
  }, TypeError);
  execute(network);
  assert.equal(initial.cells[0].energyJ, 100);
  assert.ok(network.read().cells[0].energyJ < 100);
  const snapshot = network.snapshot();
  snapshot.cells[0].energyJ = 0;
  assert.ok(network.read().cells[0].energyJ > 0);
});

test('late receipt failure preserves completed and pending state for an unrestored retry', () => {
  for (const reason of ['INVALID_MOTOR_SAMPLE', 'ENERGY_INVARIANT']) {
    const cfg = config();
    cfg.motors.push({ ...cfg.motors[0], node: 4, body: 4, rotor: 5, joint: 1 });
    cfg.wires.push([0, 4]);
    const control = createPowerNetwork(cfg),
      retry = createPowerNetwork(cfg);
    const before = JSON.stringify(retry.read());
    const allocate = (n) =>
      n.step(
        dt,
        cfg.motors.map(({ node }) => ({ node, speed: 0 })),
        [],
        cfg.motors.map(({ node }) => ({ node, inertia: 0.01 })),
      );
    const expected = allocate(control),
      allocation = allocate(retry);
    assert.deepEqual(allocation, expected);
    const good = cfg.motors.map(({ node }, i) => ({
      ...receipt(0, (allocation.torques[i].value * dt) / 0.01, allocation.torques[i].value),
      node,
    }));
    assert.ok(good[0].workJ > 0);
    const bad = structuredClone(good);
    if (reason === 'INVALID_MOTOR_SAMPLE') bad[1].speedAfter = NaN;
    else bad[1].workJ += 1;
    assert.throws(() => retry.completeStep(dt, bad), new RegExp(reason));
    assert.equal(JSON.stringify(retry.read()), before);
    assert.throws(() => retry.snapshot(), /POWER_STEP_PENDING/);
    assert.equal(
      JSON.stringify(retry.completeStep(dt, good)),
      JSON.stringify(control.completeStep(dt, good)),
    );
    assert.equal(JSON.stringify(retry.read()), JSON.stringify(control.read()));
  }
});

test('session late power failure preserves the completed projection and failure bundle', () => {
  const run = (mode) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [new URL('./fixtures/power-late-failure.mjs', import.meta.url).pathname, mode],
        { encoding: 'utf8' },
      ),
    );
  const positive = run('success');
  assert.equal(positive.failureBundle, null);
  const failed = run('failure');
  assert.equal(failed.failureBundle.failedTick, 1);
  assert.equal(failed.failureBundle.reasonCode, 'ENERGY_INVARIANT');
  assert.deepEqual(failed.power, failed.failureBundle.completed.power);
  assert.ok(failed.power.motors.every((m) => m.heatJ === 0));
});

test('completion rechecks an untrusted position receipt before committing its angle', () => {
  const cfg = config();
  cfg.motors[0].positionControl = {
    lowerLimit: -1,
    upperLimit: 1,
    proportionalGain: 1,
    dampingGain: 0,
    integralGain: 0,
  };
  const network = createPowerNetwork(cfg),
    before = network.read();
  const allocation = network.step(
    dt,
    [{ node: 1, speed: 0, angle: 0 }],
    [],
    [{ node: 1, inertia: 0.01 }],
  );
  const good = {
    ...receipt(0, (allocation.torques[0].value * dt) / 0.01, allocation.torques[0].value),
    angle: 0,
  };
  let reads = 0;
  const changing = {
    ...good,
    get angle() {
      return ++reads <= 2 ? 0 : NaN;
    },
  };
  assert.throws(() => network.completeStep(dt, [changing]), /INVALID_POWER_CHECKPOINT/);
  assert.deepEqual(network.read(), before);
  const completed = network.completeStep(dt, [good]);
  assert.equal(completed.motors[0].position.angle, 0);
});
