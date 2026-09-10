import test from 'node:test';
import assert from 'node:assert/strict';
import { createPowerNetwork } from '../src/simulation/power.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createManualActiveSuspensionBench } from '../src/model/fixtures/articulated-suspension.mjs';
const dt = 1 / 120;
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
// Independent two-DOF regularized mechanics: inverse mass diag(1,2),
// J=(1,-1), C=1/2. Passive projection of (+/-.3,-/+ .1) gives
// v=(+/-13/70,+/-9/70). A=J M^-1 J^T+C=7/2. A motor impulse
// (p,0) produces reaction(-2p/7,2p/7) and delta v=(5p/7,4p/7).
function analyticalReceipt(sign) {
  const network = createPowerNetwork(config());
  const before = [(sign * 13) / 70, (sign * 9) / 70];
  const torque = network.step(
    dt,
    [{ node: 1, speed: before[0] }],
    [],
    [{ node: 1, inertia: 7 / 5 }],
  ).torques[0].value;
  const impulse = torque * dt,
    reaction = [(-2 * impulse) / 7, (2 * impulse) / 7];
  const after = [before[0] + (5 * impulse) / 7, before[1] + (4 * impulse) / 7];
  const kinetic = (v) => (v[0] ** 2 + v[1] ** 2 / 2) / 2;
  return {
    network,
    sample: {
      node: 1,
      speedBefore: before[0],
      speedAfter: after[0],
      workJ: (impulse * (before[0] + after[0])) / 2,
      constraintWorkJ: reaction.reduce((s, r, i) => s + (r * (before[i] + after[i])) / 2, 0),
      kineticBeforeJ: kinetic(before),
      kineticAfterJ: kinetic(after),
      kineticDeltaJ: kinetic(after) - kinetic(before),
    },
  };
}
test('independent regularized reaction work has either sign and never becomes driver heat', () => {
  for (const sign of [1, -1]) {
    const { network, sample } = analyticalReceipt(sign);
    assert.equal(Math.sign(sample.constraintWorkJ), -sign);
    assert.ok(Math.abs(sample.kineticDeltaJ - sample.workJ - sample.constraintWorkJ) < 1e-17);
    const state = network.completeStep(dt, [sample]);
    assert.equal(state.motors[0].mechanicalEnergy, sample.workJ);
    assert.equal(state.motors[0].shaftWorkJ, sample.workJ);
    const ordinary = analyticalReceipt(sign);
    ordinary.sample.constraintWorkJ = 0;
    ordinary.sample.kineticDeltaJ = ordinary.sample.workJ;
    ordinary.sample.kineticAfterJ = ordinary.sample.kineticBeforeJ + ordinary.sample.workJ;
    const control = ordinary.network.completeStep(dt, [ordinary.sample]);
    assert.deepEqual(state.cells, control.cells);
    assert.equal(state.motors[0].driverHeatJ, control.motors[0].driverHeatJ);
    for (const wrong of ['omit', 'reverse']) {
      const mutant = analyticalReceipt(sign);
      if (wrong === 'omit') delete mutant.sample.constraintWorkJ;
      else mutant.sample.constraintWorkJ *= -1;
      assert.throws(() => mutant.network.completeStep(dt, [mutant.sample]), /ENERGY_INVARIANT/);
    }
  }
});
test('reaction accounting cannot conceal an unfunded motor kick or malformed numeric receipt', () => {
  const { network, sample } = analyticalReceipt(1);
  sample.speedAfter = 1000;
  // Recover the allocated impulse from the independent response, not telemetry
  // (the power state has not committed until completeStep).
  const fresh = analyticalReceipt(1),
    p = ((fresh.sample.speedAfter - fresh.sample.speedBefore) * 7) / 5;
  sample.workJ = (p * (sample.speedBefore + sample.speedAfter)) / 2;
  sample.constraintWorkJ = -sample.workJ;
  sample.kineticDeltaJ = 0;
  sample.kineticAfterJ = sample.kineticBeforeJ;
  assert.throws(() => network.completeStep(dt, [sample]), /ENERGY_INVARIANT/);
  for (const value of [null, NaN, Infinity, '0']) {
    const { network, sample } = analyticalReceipt(1);
    sample.constraintWorkJ = value;
    assert.throws(() => network.completeStep(dt, [sample]), /INVALID_MOTOR_SAMPLE/);
  }
});
test('ordinary loaded articulated hinge accounts signed reaction work through session and checkpoint', async () => {
  const blueprint = createManualActiveSuspensionBench();
  blueprint.parts.find((p) => p.id === 'arm').authoredMaterial.body = 'aluminium';
  const configuration = compileAssembly(blueprint).configuration;
  const session = await createSession(configuration);
  let observed = false;
  try {
    for (let tick = 0; tick < 240; tick++) {
      session.step();
      const f = session.observe().frames[0];
      assert.equal(f.status, 'ready');
      assert.ok(Number.isFinite(f.energy.constraintWorkJ));
      if (Math.abs(f.energy.constraintWorkJ) > 1e-8) observed = true;
      const ledgerTolerance =
        64 * Number.EPSILON * Math.max(1, ...Object.values(f.energy).map(Math.abs));
      assert.ok(
        Math.abs(f.energy.balanceResidualJ) < ledgerTolerance,
        'signed session ledger closes at arithmetic roundoff',
      );
    }
    assert.ok(observed, 'loaded mechanism exercises non-negligible reaction work');
    const checkpoint = session.checkpoint();
    session.step(12);
    const expected = session.observe().frames[0];
    session.restore(checkpoint);
    session.step(12);
    assert.deepEqual(session.observe().frames[0].energy, expected.energy);
    const before = session.checkpoint(),
      bad = structuredClone(before);
    bad.energy.constraintWorkJ = NaN;
    assert.throws(() => session.restore(bad));
    assert.deepEqual(session.checkpoint(), before);
  } finally {
    session.dispose();
  }
});
