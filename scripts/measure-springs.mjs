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
  connectedBodies: Object.freeze([22, 34]), // Four-wheel cart size and retained 32-fixed-link counterexample.
  warmupTicks: 240,
  sampleTicks: 480,
  warmupFrames: 60,
  sampleFrames: 90,
  tickP95Ms: (1000 / 120) * 0.4,
  constraintP95Ms: 2,
  loadedImpulseMinNs: 9.81 / 120 / 2, // Half the known 1 kg weight impulse; springs press down too.
  integrationP95Ms: 1, // Leaves 1/3 ms of the 3 1/3 ms tick allocation for other phases.
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
export function springSimulationProfiles() {
  return [
    { dense: false, connectedBodies: 0 },
    { dense: true, connectedBodies: 0 },
    ...SPRING_PERFORMANCE.connectedBodies.map((connectedBodies) => ({
      dense: false,
      connectedBodies,
    })),
  ];
}
export function evaluateSpringSimulation(cases) {
  assert.equal(
    cases.length,
    SPRING_PERFORMANCE.repetitions * 3 * springSimulationProfiles().length,
    'three complete sparse/dense/connected simulation trials required',
  );
  const results = [];
  for (let trial = 0; trial < 3; trial++)
    for (const count of [0, 1, 8])
      for (const { dense, connectedBodies } of springSimulationProfiles()) {
        const matches = cases.filter(
          (c) =>
            c.trial === trial &&
            c.count === count &&
            c.dense === dense &&
            (c.connectedBodies ?? 0) === connectedBodies,
        );
        assert.equal(matches.length, 1, 'unique simulation trial required');
        const c = matches[0],
          label = `simulation trial ${trial} count ${count} ${connectedBodies ? `connected-${connectedBodies}` : dense ? 'dense' : 'sparse'}`;
        if (connectedBodies)
          assert.deepEqual(
            c.fixture,
            connectedSpringFixture(count, connectedBodies),
            'connected workload geometry and topology must be retained',
          );
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
        let integrationP95Ms = null;
        if ((dense && count > 0) || connectedBodies) {
          integrationP95Ms = under(
            c.phases['integration-contacts'],
            SPRING_PERFORMANCE.integrationP95Ms,
            `${label} integration and contacts`,
            SPRING_PERFORMANCE.sampleTicks,
          );
        }
        if (dense && count > 0) {
          assert.equal(
            c.contacts.length,
            SPRING_PERFORMANCE.sampleTicks,
            'complete loaded-contact samples required',
          );
          assert.ok(
            c.contacts.every(
              (s) =>
                s.available &&
                s.supportImpulses.length === count &&
                s.supportImpulses.every(
                  (j) => Number.isFinite(j) && j >= SPRING_PERFORMANCE.loadedImpulseMinNs,
                ),
            ),
            'dense fixture must actually measure loaded contacts',
          );
        }
        if (count === 0 && !connectedBodies)
          under(
            c.timesMs,
            1000 / 120 / 8,
            `${label} environment control`,
            SPRING_PERFORMANCE.sampleTicks,
          );
        results.push({
          trial,
          count,
          dense,
          connectedBodies,
          tickP95Ms,
          constraintP95Ms,
          integrationP95Ms,
        });
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
  // Retain the shared spring constraint body and add a real supporting floor.
  // Dense trials now exercise contact collection alongside all eight spring rows.
  if (dense && count > 0)
    bodies.push({ ...body((count - 1) / 2, 0.24, true), halfExtents: [count, 0.1, 1] });
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
export function connectedSpringFixture(count, totalBodies) {
  if (![0, 1, 8].includes(count) || !Number.isInteger(totalBodies) || totalBodies < count + 1)
    throw Error('invalid benchmark dimensions');
  const body = (position) => ({
    shape: 'box',
    position,
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 1,
    halfExtents: [0.01, 0.01, 0.01],
    fixed: false,
    friction: 0,
    restitution: 0,
  });
  const bodies = [body([0, 0, 0])],
    joints = [];
  for (let i = 0; i < count; i++) {
    const x = i * 0.04;
    bodies.push(body([x, 0.31, 0]));
    joints.push({
      kind: 'spring',
      a: 0,
      b: bodies.length - 1,
      anchorA: [x, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [0.08, 0.4],
      restLength: 0.3,
      stiffness: 20,
      damping: 2,
    });
  }
  let previous = 0,
    link = 0;
  while (bodies.length < totalBodies) {
    link++;
    bodies.push(body([-link * 0.04, 0, 0]));
    joints.push({
      kind: 'fixed',
      a: previous,
      b: bodies.length - 1,
      anchorA: [-0.02, 0, 0],
      anchorB: [0.02, 0, 0],
      rotationA: [0, 0, 0, 1],
      rotationB: [0, 0, 0, 1],
    });
    previous = bodies.length - 1;
  }
  return {
    gravity: [0, 0, 0],
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

export function springSupportImpulses(sample, fixture) {
  const floor = fixture.bodies.length - 1;
  return fixture.joints.map((j) =>
    sample.rows.reduce((sum, r) => {
      if (r.a === j.b && r.b === floor) return sum - (r.normalImpulse?.[1] ?? 0);
      if (r.b === j.b && r.a === floor) return sum + (r.normalImpulse?.[1] ?? 0);
      return sum;
    }, 0),
  );
}
export async function measureSpringSimulation() {
  const cases = [];
  for (let trial = 0; trial < 3; trial++)
    for (const count of trial % 2 ? [8, 1, 0] : [0, 1, 8])
      for (const { dense, connectedBodies } of springSimulationProfiles()) {
        const fixture = connectedBodies
            ? connectedSpringFixture(count, connectedBodies)
            : springSimulationFixture(count, dense),
          session = await createSession(fixture);
        try {
          session.step(SPRING_PERFORMANCE.warmupTicks);
          const timesMs = [],
            contacts = [],
            phases = {};
          for (let i = 0; i < SPRING_PERFORMANCE.sampleTicks; i++) {
            const start = performance.now();
            session.step(1);
            timesMs.push(performance.now() - start);
            const f = session.observe().frames[0];
            assert.equal(f.status, 'ready');
            contacts.push({
              available: f.contacts.available,
              supportImpulses: dense && count > 0 ? springSupportImpulses(f.contacts, fixture) : [],
            });
            for (const [p, ms] of Object.entries(f.phaseTimings)) (phases[p] ??= []).push(ms);
          }
          cases.push({
            trial,
            count,
            dense,
            connectedBodies,
            fixture,
            warmupTicks: SPRING_PERFORMANCE.warmupTicks,
            timesMs,
            phases,
            contacts,
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
