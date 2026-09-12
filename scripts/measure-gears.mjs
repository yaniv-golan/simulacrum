import { summarizeTickAttribution } from './tick-attribution.mjs';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { gearCapacityFixture } from '../test/fixtures/gear-capacity.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const latest = (s) => s.observe().frames[0];
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
    },
    status: 'failed',
  };
  try {
    report.endurance = await measureGearEndurance();
    report.performance = await measureGearPerformance();
    const failures = report.performance.flatMap((row) => {
      const label = `trial${row.trial}/${row.bodies}bodies/${row.meshes}meshes`;
      return [
        ['tickP95Ms', (1000 / 120) * 0.4],
        ['actuatorP95Ms', 2],
        ['integrationP95Ms', 2],
      ]
        .filter(([key, limit]) => !Number.isFinite(row[key]) || row[key] > limit)
        .map(([key, limit]) => `${label} ${key} ${row[key]} exceeds ${limit}`);
    });
    assert.equal(failures.length, 0, failures.join('; '));
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
