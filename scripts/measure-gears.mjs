import { summarizeTickAttribution } from './tick-attribution.mjs';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { gearCapacityFixture } from '../test/fixtures/gear-capacity.mjs';
import {
  GEAR_BOUND_CORNERS,
  cornerLabel,
  gearBoundsFixture,
  measureCoast,
  measureTransmission,
  meshFrequency,
  meshLedger,
  spinUpToPitchLineSpeed,
} from '../test/fixtures/gear-bounds.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch, loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const latest = (s) => s.observe().frames[0];
// Two fifths of a 1/120 s tick, the same share the capacity rows are held to, in microseconds.
const TICK_BUDGET_US = (1000 / 120) * 0.4 * 1000;
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
function ratioError(f) {
  const input = f.physics[1].angularVelocity[0];
  assert.ok(Math.abs(input) > 0.2, 'healthy driven input is required');
  return Math.max(
    ...f.physics
      .slice(1, 10)
      .map((b, i) => Math.abs(b.angularVelocity[0] / input - (i % 2 ? -0.5 : 1))),
  );
}

export async function measureGearEndurance() {
  const metrics = [];
  for (const bodies of [12, 34]) {
    const config = gearCapacityFixture({ bodies }),
      session = await createSession(config);
    try {
      assert.equal(config.joints.filter((j) => j.kind === 'gear').length, 8);
      let strain = 0,
        stepMismatch = 0,
        drift = 0,
        error = 0;
      for (let i = 0; i < 7200; i++) {
        session.step(1);
        const f = latest(session);
        assert.equal(f.status, 'ready');
        assert.equal(f.gears.length, 8);
        for (const g of f.gears) {
          assert.ok(Object.values(g).every(Number.isFinite));
          strain = Math.max(strain, Math.abs(g.strain));
          stepMismatch = Math.max(stepMismatch, Math.abs(g.splitStepM));
          drift = Math.max(drift, Math.abs(g.splitDriftM));
        }
        assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-8);
        if (i > 480) error = Math.max(error, ratioError(f));
      }
      assert.ok(strain < 0.001, 'elastic displacement stays below one millimetre');
      assert.ok(stepMismatch < 0.0002, 'native split step stays below .2mm');
      assert.ok(error < 0.03, 'all output ratios remain within three percent');
      const cp = session.checkpoint();
      session.step(12);
      const expected = deterministicProjection(latest(session));
      session.restore(cp);
      session.step(12);
      assert.deepEqual(deterministicProjection(latest(session)), expected);
      metrics.push({
        bodies,
        meshes: 8,
        simulatedSeconds: 60,
        maximumStrainM: strain,
        maximumStepMismatchM: stepMismatch,
        maximumCumulativeDriftM: drift,
        maximumRatioError: error,
      });
    } finally {
      session.dispose();
    }
  }
  return metrics;
}

/** What one constant mesh stiffness costs at the edges of the authored bounds.
 *
 * The capacity apparatus above measures many meshes at one tooth size. This measures one mesh
 * at every tooth size the catalog admits, because with `stiffness` fixed the mode the tick has
 * to resolve is set by the authored pair: the pitch-point mobility spans more than an order of
 * magnitude from the heaviest pair to the lightest, and so does `omega dt`. Each corner is held
 * at the same transmitted force and the same pitch-line speed, so input work is identical by
 * construction and the recorded figures compare the mesh rather than the duty.
 *
 * The balanced operating point drives the relative slip to zero, which suppresses both
 * dissipative terms structurally however fast the mesh is, so the delivered-work figure speaks
 * only for steady transmission. The engine's own per-tick energy ledger is therefore recorded
 * per phase as well, and the step-torque spin-up that rings the mesh is where the solver's
 * dissipation is attributed.
 */
export async function measureGearBounds() {
  const force = 2,
    pitchLineSpeed = 1,
    loadedTicks = 1200,
    coastTicks = 1200,
    metrics = [];
  for (const corner of GEAR_BOUND_CORNERS) {
    const fixture = gearBoundsFixture(corner),
      frequency = meshFrequency(fixture),
      world = await createPhysicsWorld(fixture.config);
    try {
      const transient = meshLedger(),
        steady = meshLedger(),
        idle = meshLedger(),
        spinUp = spinUpToPitchLineSpeed(world, fixture, force, pitchLineSpeed, transient),
        loaded = measureTransmission(world, fixture, {
          force,
          ticks: loadedTicks,
          ledger: steady,
        }),
        coast = measureCoast(world, coastTicks, idle);
      assert.ok(
        loaded.maximumStrainM < 0.001,
        `${cornerLabel(corner)} elastic displacement stays below one millimetre`,
      );
      assert.ok(
        loaded.maximumRatioError < 0.03,
        `${cornerLabel(corner)} ratio stays within three percent`,
      );
      assert.ok(
        Math.abs(loaded.lostWorkFraction) < 0.01,
        `${cornerLabel(corner)} delivers the input work to the output at the balanced point`,
      );
      assert.ok(coast.growth <= 0, `${cornerLabel(corner)} never gains mechanical energy`);
      for (const [phase, ledger] of [
        ['spin-up', transient],
        ['loaded', steady],
        ['coast', idle],
      ]) {
        assert.ok(
          ledger.totals.ticks > 0 &&
            ledger.totals.maximumResidualJ < 1e-9 &&
            ledger.totals.maximumIslandResidualJ < 1e-9,
          `${cornerLabel(corner)} ${phase} closes the mesh and island energy ledgers`,
        );
        assert.ok(
          ledger.totals.dampingWorkJ >= 0 && ledger.totals.numericalLossJ >= 0,
          `${cornerLabel(corner)} ${phase} damper and solver only remove energy`,
        );
      }
      metrics.push({
        label: cornerLabel(corner),
        ...corner,
        reference: corner.reference === true,
        massAKg: fixture.massA,
        massBKg: fixture.massB,
        centreDistanceM: fixture.centreDistance,
        pitchPointMobility: frequency.mobility,
        meshOmegaRadPerS: frequency.omega,
        meshOmegaDt: frequency.omegaDt,
        meshDampingRatio: frequency.dampingRatio,
        // Backward Euler represents a mode of frequency omega as atan(omega dt)/dt, which can
        // never reach a quarter turn of phase per tick. That saturation is why a corner well
        // past omega dt = 1 dissipates its mesh oscillation instead of diverging, and it is the
        // honest statement of what the small end loses: resolved compliance, not work.
        representedPhasePerTick: Math.atan(frequency.omegaDt),
        spinUpTicks: spinUp.ticks,
        loadedTicks,
        coastTicks,
        transmittedForceN: force,
        pitchLineSpeedMPerS: pitchLineSpeed,
        inputWorkJ: loaded.inputWorkJ,
        outputWorkJ: loaded.outputWorkJ,
        // Steady-state only: the balanced point suppresses slip, so read this beside the ledger.
        steadyLostWorkFraction: loaded.lostWorkFraction,
        // The transient the step torque excited, and what the mesh dissipated while it rang.
        spinUpDriveWorkJ: spinUp.driveWorkJ,
        spinUpNumericalLossJ: transient.totals.numericalLossJ,
        spinUpDampingWorkJ: transient.totals.dampingWorkJ,
        spinUpLossFraction: transient.dissipatedJ / spinUp.driveWorkJ,
        loadedNumericalLossJ: steady.totals.numericalLossJ,
        loadedDampingWorkJ: steady.totals.dampingWorkJ,
        coastNumericalLossJ: idle.totals.numericalLossJ,
        coastDampingWorkJ: idle.totals.dampingWorkJ,
        maximumMeshLedgerResidualJ: Math.max(
          transient.totals.maximumResidualJ,
          steady.totals.maximumResidualJ,
          idle.totals.maximumResidualJ,
        ),
        maximumIslandLedgerResidualJ: Math.max(
          transient.totals.maximumIslandResidualJ,
          steady.totals.maximumIslandResidualJ,
          idle.totals.maximumIslandResidualJ,
        ),
        maximumRatioError: loaded.maximumRatioError,
        maximumStrainM: loaded.maximumStrainM,
        maximumCumulativeDriftM: loaded.maximumDriftM,
        coastRetainedFraction: coast.retained,
        coastEnergyGrowthFraction: coast.growth,
        costPerTickUs: loaded.costPerTickUs,
      });
    } finally {
      world.dispose();
    }
  }
  return metrics;
}

export async function measureGearPerformance() {
  const metrics = [];
  for (let trial = 0; trial < 3; trial++)
    for (const bodies of [12, 34])
      for (const meshes of [0, 1, 8]) {
        const session = await createSession(gearCapacityFixture({ bodies, meshes }));
        try {
          session.step(240);
          const ticks = [],
            actuators = [],
            integration = [],
            phaseSamples = {},
            tickTimingSamples = {};
          for (let i = 0; i < 480; i++) {
            const start = performance.now();
            session.step(1);
            const tickMs = performance.now() - start;
            const f = latest(session),
              phases = f.phaseTimings;
            assert.equal(f.physics.length, bodies);
            assert.equal(f.gears?.length ?? 0, meshes);
            ticks.push(tickMs);
            actuators.push(phases['actuators-constraints']);
            integration.push(phases['integration-contacts']);
            for (const [key, value] of Object.entries(phases))
              (phaseSamples[key] ??= []).push(value);
            for (const [key, value] of Object.entries(f.tickTiming))
              (tickTimingSamples[key] ??= []).push(value);
          }
          const f = latest(session);
          if (meshes === 8) assert.ok(ratioError(f) < 0.03);
          if (meshes === 0)
            assert.ok(
              Math.abs(f.physics[2].angularVelocity[0]) < 1e-8,
              'unmeshed second rotor stays undriven',
            );
          const result = {
            trial,
            bodies,
            meshes,
            tickP95Ms: p95(ticks),
            actuatorP95Ms: p95(actuators),
            integrationP95Ms: p95(integration),
            sampleTicks: 480,
            warmupTicks: 240,
            timesMs: ticks,
            phases: phaseSamples,
            tickTimings: tickTimingSamples,
            attribution: summarizeTickAttribution(tickTimingSamples),
            phaseP95Ms: Object.fromEntries(
              Object.entries(phaseSamples).map(([key, values]) => [key, p95(values)]),
            ),
            tickTimingP95Ms: Object.fromEntries(
              Object.entries(tickTimingSamples).map(([key, values]) => [key, p95(values)]),
            ),
          };

          metrics.push(result);
        } finally {
          session.dispose();
        }
      }
  return metrics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    source: sourceIdentity(),
    environment: {
      node: process.version,
      cpu: cpus()[0].model,
      platform: platform(),
      arch: arch(),
      // Timing figures are read against the host they were taken on, so the load carried while
      // they were taken is part of the measurement rather than a note beside it.
      loadAverage: loadavg(),
    },
    status: 'failed',
  };
  try {
    report.endurance = await measureGearEndurance();
    report.bounds = await measureGearBounds();
    report.performance = await measureGearPerformance();
    const failures = report.performance.flatMap((row) => {
      const label = `trial${row.trial}/${row.bodies}bodies/${row.meshes}meshes`;
      return [
        ['tickP95Ms', TICK_BUDGET_US / 1000],
        ['actuatorP95Ms', 2],
        ['integrationP95Ms', 2],
      ]
        .filter(([key, limit]) => !Number.isFinite(row[key]) || row[key] > limit)
        .map(([key, limit]) => `${label} ${key} ${row[key]} exceeds ${limit}`);
    });
    // A bound corner is a three-body world, so it has to fit the same fraction of a tick the
    // capacity rows are held to; the figure is recorded either way, but it is also enforced.
    failures.push(
      ...report.bounds
        .filter((row) => !Number.isFinite(row.costPerTickUs) || row.costPerTickUs > TICK_BUDGET_US)
        .map((row) => `${row.label} costPerTickUs ${row.costPerTickUs} exceeds ${TICK_BUDGET_US}`),
    );
    assert.equal(failures.length, 0, failures.join('; '));
    report.environment.loadAverageAfter = loadavg();
    report.status = 'passed';
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
  }
  const output = process.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT ?? 'artifacts/gears';
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'capacity.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      ...report,
      performance: report.performance?.map(({ timesMs, phases, tickTimings, ...row }) => row),
    }),
  );
}
