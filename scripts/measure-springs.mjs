import { createSession } from '../src/simulation/session.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch, release } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
// Resource allocations: 40% of a 120 Hz tick; 6 ms renderer CPU in a 30 Hz frame.
// Cadence gets 20% scheduling margin. These are fixed budgets, not fitted baselines.
export const SPRING_PERFORMANCE = Object.freeze({
  repetitions: 3,
  warmupTicks: 240,
  sampleTicks: 480,
  warmupFrames: 60,
  sampleFrames: 90,
  tickP95Ms: (1000 / 120) * 0.4,
  constraintP95Ms: 2,
  renderP95Ms: 6,
  cadenceP95Ms: 40,
  stallMs: 500,
  realTimeRatioMin: 0.95,
  idleP95Ms: 20,
});
export const springBenchmarkEnvironment = () => ({
  runtime: process.version,
  cpu: cpus()[0].model,
  platform: platform(),
  arch: arch(),
  osRelease: release(),
});
export function springQuantile(values, p = 0.95) {
  assert.ok(
    values.length && values.every((x) => Number.isFinite(x) && x >= 0),
    'finite nonnegative performance samples required',
  );
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
}
function under(values, limit, label, count) {
  assert.equal(values.length, count, `${label}: incomplete samples`);
  const p95 = springQuantile(values);
  assert.ok(p95 <= limit, `${label}: p95 ${p95.toFixed(3)} ms exceeds ${limit.toFixed(3)} ms`);
  return p95;
}
export function evaluateSpringSimulation(cases) {
  assert.equal(cases.length, 18, 'three complete sparse/dense simulation trials required');
  const results = [];
  for (let trial = 0; trial < 3; trial++)
    for (const count of [0, 1, 8])
      for (const dense of [false, true]) {
        const matches = cases.filter(
          (c) => c.trial === trial && c.count === count && c.dense === dense,
        );
        assert.equal(matches.length, 1, 'unique simulation trial required');
        const c = matches[0],
          label = `simulation trial ${trial} count ${count} ${dense ? 'dense' : 'sparse'}`;
        assert.equal(c.warmupTicks, SPRING_PERFORMANCE.warmupTicks);
        const tickP95Ms = under(
          c.timesMs,
          SPRING_PERFORMANCE.tickP95Ms,
          label,
          SPRING_PERFORMANCE.sampleTicks,
        );
        const constraintP95Ms = under(
          c.phases['actuators-constraints'],
          SPRING_PERFORMANCE.constraintP95Ms,
          `${label} constraints`,
          SPRING_PERFORMANCE.sampleTicks,
        );
        if (count === 0)
          under(
            c.timesMs,
            1000 / 120 / 8,
            `${label} environment control`,
            SPRING_PERFORMANCE.sampleTicks,
          );
        results.push({ trial, count, dense, tickP95Ms, constraintP95Ms });
      }
  return results;
}
export function evaluateSpringBrowser(trials, idle) {
  assert.equal(idle.length, 2, 'before/after idle controls required');
  for (const c of idle) {
    assert.equal(c.visible, true, 'background benchmark is not accepted');
    under(
      c.cadenceMs,
      SPRING_PERFORMANCE.idleP95Ms,
      'idle environment control',
      SPRING_PERFORMANCE.sampleFrames,
    );
  }
  assert.equal(trials.length, 9, 'three complete browser trials required');
  const results = [];
  for (let trial = 0; trial < 3; trial++)
    for (const count of [0, 1, 8]) {
      const matches = trials.filter((c) => c.trial === trial && c.count === count);
      assert.equal(matches.length, 1, 'unique browser trial required');
      const c = matches[0],
        label = `browser trial ${trial} count ${count}`;
      assert.equal(c.warmupFrames, SPRING_PERFORMANCE.warmupFrames);
      assert.equal(c.visible, true, `${label}: background benchmark`);
      assert.ok(
        c.renderCostsMs.length >= SPRING_PERFORMANCE.sampleFrames - 2,
        `${label}: missing rendered frames`,
      );
      const renderP95Ms = springQuantile(c.renderCostsMs);
      assert.ok(
        renderP95Ms <= SPRING_PERFORMANCE.renderP95Ms,
        `${label}: renderer CPU p95 ${renderP95Ms.toFixed(3)} ms exceeds ${SPRING_PERFORMANCE.renderP95Ms} ms`,
      );
      const cadenceP95Ms = under(
        c.cadenceMs,
        SPRING_PERFORMANCE.cadenceP95Ms,
        `${label} cadence`,
        SPRING_PERFORMANCE.sampleFrames,
      );
      assert.ok(Math.max(...c.cadenceMs) <= SPRING_PERFORMANCE.stallMs, `${label}: cadence stall`);
      const ratio = (c.endTick - c.startTick) / 120 / (c.elapsedMs / 1000);
      assert.ok(
        Number.isFinite(ratio) && ratio >= SPRING_PERFORMANCE.realTimeRatioMin && ratio <= 1.05,
        `${label}: simulation/wall ratio ${ratio}`,
      );
      results.push({ trial, count, renderP95Ms, cadenceP95Ms, realTimeRatio: ratio });
    }
  return results;
}
const body = (x, y, fixed = false) => ({
  shape: 'box',
  position: [x, y, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass: 1,
  halfExtents: [0.01, 0.01, 0.01],
  fixed,
  friction: 0,
  restitution: 0,
});
export function springSimulationFixture(count, dense) {
  const bodies = [],
    joints = [];
  if (dense) bodies.push(body(0, 0, true));
  for (let i = 0; i < count; i++) {
    const a = dense ? 0 : bodies.push(body(i, 0, true)) - 1,
      b = bodies.push(body(i, 0.35)) - 1;
    joints.push({
      kind: 'spring',
      a,
      b,
      anchorA: dense ? [i, 0, 0] : [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [0.08, 0.4],
      restLength: 0.3,
      stiffness: 20,
      damping: 2,
    });
  }
  return {
    gravity: [0, -9.81, 0],
    bodies,
    joints,
    power: {
      cells: [],
      motors: [],
      wires: [],
      signalWires: [],
      receivers: [],
      controllers: [],
      sensors: [],
    },
  };
}
export async function measureSpringSimulation() {
  const cases = [];
  for (let trial = 0; trial < 3; trial++)
    for (const count of trial % 2 ? [8, 1, 0] : [0, 1, 8])
      for (const dense of [false, true]) {
        const fixture = springSimulationFixture(count, dense),
          session = await createSession(fixture);
        try {
          session.step(SPRING_PERFORMANCE.warmupTicks);
          const timesMs = [],
            phases = {};
          for (let i = 0; i < SPRING_PERFORMANCE.sampleTicks; i++) {
            const start = performance.now();
            session.step(1);
            timesMs.push(performance.now() - start);
            const f = session.observe().frames[0];
            assert.equal(f.status, 'ready');
            for (const [p, ms] of Object.entries(f.phaseTimings)) (phases[p] ??= []).push(ms);
          }
          cases.push({
            trial,
            count,
            dense,
            fixture,
            warmupTicks: SPRING_PERFORMANCE.warmupTicks,
            timesMs,
            phases,
          });
        } finally {
          session.dispose();
        }
      }
  return cases;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    source: sourceIdentity(),
    environment: springBenchmarkEnvironment(),
    policy: SPRING_PERFORMANCE,
    status: 'failed',
  };
  try {
    report.cases = await measureSpringSimulation();
    report.acceptance = evaluateSpringSimulation(report.cases);
    report.status = 'passed';
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
  }
  mkdirSync('artifacts/springs', { recursive: true });
  writeFileSync('artifacts/springs/performance.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: report.status,
      acceptance: report.acceptance,
      failure: report.failure,
    }),
  );
}
