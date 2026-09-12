import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSession } from '../src/simulation/session.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createGearLift } from '../src/model/fixtures/gear-lift.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';

// Independent rigid-body energy from completed poses/velocities and admitted
// canonical SI masses/inertias, not the session's balanceResidualJ.
function physicalEnergy(frame, configuration) {
  return (
    frame.physics.reduce((sum, b, i) => {
      const d = configuration.bodies[i];
      if (d.fixed) return sum;
      const [x, y, z] = d.halfExtents,
        m = d.mass,
        q = b.rotation,
        w = rotateVector([-q[0], -q[1], -q[2], q[3]], b.angularVelocity),
        inertia =
          d.shape === 'cylinder'
            ? [
                (m * y * y) / 2,
                (m * (3 * y * y + 4 * x * x)) / 12,
                (m * (3 * y * y + 4 * x * x)) / 12,
              ]
            : [(m * (y * y + z * z)) / 3, (m * (x * x + z * z)) / 3, (m * (x * x + y * y)) / 3];
      return (
        sum +
        0.5 * m * b.velocity.reduce((s, v) => s + v * v, 0) +
        0.5 * w.reduce((s, v, k) => s + inertia[k] * v * v, 0) -
        m * b.position.reduce((s, v, k) => s + v * configuration.gravity[k], 0)
      );
    }, 0) +
    frame.gears.reduce(
      (sum, g) => sum + 0.5 * configuration.joints[g.index].stiffness * g.strain * g.strain,
      0,
    )
  );
}

test('editable loaded reduction lifts, reverse gearing cannot, and the corrected mesh runs ten seconds', async (t) => {
  const measurements = [];
  for (const { reduction, currentLimit } of [
    { reduction: true, currentLimit: 0.45 },
    { reduction: false, currentLimit: 0.45 },
    { reduction: true, currentLimit: 0.1 },
  ]) {
    const bp = createGearLift({ reduction });
    bp.parts.find((p) => p.id === 'motor').parameters.currentLimit = currentLimit;
    const compiled = compileAssembly(bp),
      session = await createSession(compiled.configuration),
      load = compiled.mapping.findIndex((p) => p.part === 'load');
    try {
      const initial = session.observe().frames[0].physics[load].position[1];
      let maximum = initial,
        stepError = 0,
        strain = 0,
        cumulative = 0,
        positiveCorrection = false,
        negativeCorrection = false;
      for (let i = 0; i < 1200; i++) {
        session.step(1);
        const f = session.observe().frames[0],
          g = f.gears[0];
        maximum = Math.max(maximum, f.physics[load].position[1]);
        stepError = Math.max(stepError, Math.abs(g.splitStepM));
        strain = Math.max(strain, Math.abs(g.strain));
        cumulative = Math.max(cumulative, Math.abs(g.splitDriftM));
        assert.equal(g.strain, g.completedSlipM);
        assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-10);
        positiveCorrection ||= f.energy.gearSplitElasticDeltaJ > 1e-8;
        negativeCorrection ||= f.energy.gearSplitElasticDeltaJ < -1e-8;
      }
      if (reduction && currentLimit === 0.45) assert.ok(maximum - initial > 0.04);
      else assert.ok(maximum - initial < 0.002);
      assert.ok(stepError < 0.0001 && strain < 0.0005);
      assert.ok(cumulative > 0.001, 'cumulative split discrepancy must remain visible');
      assert.ok(
        positiveCorrection && negativeCorrection,
        'signed numerical corrections are not classified as heat',
      );
      measurements.push({
        reduction,
        currentLimit,
        rise: maximum - initial,
        maximumStrainM: strain,
        maximumStepMismatchM: stepError,
        cumulativeSplitM: cumulative,
      });
    } finally {
      session.dispose();
    }
  }
  t.diagnostic(JSON.stringify(measurements));
});

test('unpowered loaded mesh bounds independently reconstructed energy with gravity and contact', async (t) => {
  const evidence = [];
  for (const fixed of [false, true]) {
    const bp = createGearLift();
    bp.connections = bp.connections.filter((c) => c.kind !== 'power');
    const { configuration } = compileAssembly(bp);
    if (fixed) configuration.bodies[0].fixed = true;
    const session = await createSession(configuration);
    try {
      const initial = physicalEnergy(session.observe().frames[0], configuration);
      let maximum = initial,
        final = initial;
      for (let i = 0; i < 1200; i++) {
        session.step(1);
        const f = session.observe().frames[0];
        assert.equal(f.gears[0].strain, f.gears[0].completedSlipM);
        final = physicalEnergy(f, configuration);
        maximum = Math.max(maximum, final);
        assert.equal(f.energy.actuatorWorkJ, 0);
      }
      // A finite 1 mJ numerical envelope, not a strict passivity theorem. At .06 m
      // leverage the load's characteristic gravitational energy is about .296 J.
      assert.ok(maximum - initial < 0.001);
      assert.ok(final <= initial + 0.001);
      evidence.push({
        fixed,
        maximumEnergyGainJ: maximum - initial,
        finalEnergyChangeJ: final - initial,
      });
    } finally {
      session.dispose();
    }
  }
  t.diagnostic(JSON.stringify(evidence));
});

test('gear session checkpoint resumes complete deterministic projection and rejects corrupt signed ledger', async () => {
  const session = await createSession(compileAssembly(createGearLift()).configuration);
  try {
    session.step(120);
    const cp = session.checkpoint();
    session.step(60);
    const expected = deterministicProjection(session.observe().frames[0]);
    session.restore(cp);
    session.step(60);
    assert.deepEqual(deterministicProjection(session.observe().frames[0]), expected);
    const saved = session.checkpoint(),
      bad = structuredClone(saved);
    bad.energy.gearSplitElasticDeltaJ = NaN;
    assert.throws(() => session.restore(bad));
    assert.deepEqual(session.checkpoint(), saved);
  } finally {
    session.dispose();
  }
});

test('geared loaded projections agree across four processes and both production clock drivers', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) =>
    JSON.parse(
      execFileSync(process.execPath, ['test/fixtures/gear-run.mjs', driver], { encoding: 'utf8' }),
    ),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const run of runs) assert.deepEqual(run.hashes, runs[0].hashes);
  const wrong = structuredClone(runs[0].hashes);
  wrong[12] = 'wrong';
  assert.notDeepEqual(wrong, runs[0].hashes);
});

test('replacing a geared machine removes obsolete mesh telemetry and restores it on reverse replacement', async () => {
  const bp = createGearLift(),
    withGear = compileAssembly(bp).configuration;
  bp.connections = bp.connections.filter((c) => c.kind !== 'gear');
  const withoutGear = compileAssembly(bp).configuration;
  const session = await createSession(withGear);
  try {
    session.step(10);
    await session.replaceConfiguration(withoutGear, {});
    assert.equal('gears' in session.observe().frames[0], false);
    await session.replaceConfiguration(withGear, {});
    assert.equal(session.observe().frames[0].gears[0].strain, 0);
  } finally {
    session.dispose();
  }
});
