import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRING_PERFORMANCE as policy,
  evaluateSpringSimulation,
  evaluateSpringBrowser,
  springSupportImpulses,
  springSimulationFixture,
  springSimulationProfiles,
  connectedSpringFixture,
} from '../scripts/measure-springs.mjs';
const samples = (value, n) => Array(n).fill(value);
function simulation() {
  return Array.from({ length: 3 }, (_, trial) =>
    [0, 1, 8].flatMap((count) =>
      springSimulationProfiles().map(({ dense, connectedBodies }) => ({
        trial,
        count,
        dense,
        connectedBodies,
        ...(connectedBodies ? { fixture: connectedSpringFixture(count, connectedBodies) } : {}),
        warmupTicks: policy.warmupTicks,
        timesMs: samples(count ? policy.tickP95Ms : 0.1, policy.sampleTicks),
        phases: {
          'actuators-constraints': samples(policy.constraintP95Ms, policy.sampleTicks),
          'integration-contacts': samples(policy.integrationP95Ms, policy.sampleTicks),
        },
        contacts: Array.from({ length: policy.sampleTicks }, () => ({
          available: true,
          supportImpulses: Array(count).fill(policy.loadedImpulseMinNs),
        })),
      })),
    ),
  ).flat();
}
function browser() {
  return {
    trials: Array.from({ length: 3 }, (_, trial) =>
      [0, 1, 8].map((count) => ({
        trial,
        count,
        warmupFrames: policy.warmupFrames,
        visible: true,
        renderCostsMs: samples(policy.renderP95Ms, policy.sampleFrames),
        cadenceMs: samples(policy.cadenceP95Ms, policy.sampleFrames),
        elapsedMs: policy.cadenceP95Ms * policy.sampleFrames,
        startTick: 0,
        endTick: policy.cadenceP95Ms * policy.sampleFrames * 0.12,
      })),
    ).flat(),
    idle: Array.from({ length: 2 }, () => ({
      visible: true,
      cadenceMs: samples(policy.idleP95Ms, policy.sampleFrames),
    })),
  };
}
test('spring performance accepts complete trials at independently allocated budget boundaries', () => {
  assert.equal(evaluateSpringSimulation(simulation()).length, 36);
  const { trials, idle } = browser();
  assert.equal(evaluateSpringBrowser(trials, idle).length, 9);
});
test('spring performance rejects simulation, renderer, cadence and real-time regressions independently', () => {
  for (const field of ['tick', 'constraints']) {
    const cases = simulation(),
      c = cases.find((c) => c.count === 8);
    if (field === 'tick') c.timesMs.fill(policy.tickP95Ms * 1.01);
    else c.phases['actuators-constraints'].fill(policy.constraintP95Ms * 1.01);
    assert.throws(() => evaluateSpringSimulation(cases), /exceeds/);
  }
  for (const field of ['render', 'cadence', 'throughput', 'stall']) {
    const { trials, idle } = browser(),
      c = trials.find((c) => c.count === 8);
    if (field === 'render') c.renderCostsMs.fill(policy.renderP95Ms * 1.01);
    if (field === 'cadence') c.cadenceMs.fill(policy.cadenceP95Ms * 1.01);
    if (field === 'throughput') c.endTick *= 0.9;
    if (field === 'stall') c.cadenceMs[0] = policy.stallMs + 1;
    assert.throws(() => evaluateSpringBrowser(trials, idle), /exceeds|ratio|stall/);
  }
});
test('spring performance cannot pass missing trials, warmup, hidden pages or unhealthy controls', () => {
  const cases = simulation();
  cases.pop();
  assert.throws(() => evaluateSpringSimulation(cases), /complete/);
  for (const field of ['missing', 'duplicate', 'warmup', 'hidden', 'idle', 'rendered']) {
    const { trials, idle } = browser();
    if (field === 'missing') trials.pop();
    if (field === 'duplicate') trials[0] = structuredClone(trials[1]);
    if (field === 'warmup') trials[0].warmupFrames = 0;
    if (field === 'hidden') trials[0].visible = false;
    if (field === 'idle') idle[0].cadenceMs.fill(policy.idleP95Ms + 1);
    if (field === 'rendered') trials[0].renderCostsMs = [];
    assert.throws(() => evaluateSpringBrowser(trials, idle));
  }
});

test('spring contact performance rejects missing load and integration cost regressions', () => {
  const fixture = springSimulationFixture(8, true);
  const rows = fixture.joints.map((j) => ({ a: j.b, b: 9, normalImpulse: [0, -0.1, 0] }));
  assert.deepEqual(springSupportImpulses({ rows }, fixture), Array(8).fill(0.1));
  rows[7] = { a: 0, b: 9, normalImpulse: [0, -0.1, 0] };
  assert.equal(springSupportImpulses({ rows }, fixture)[7], 0, 'unrelated pair is not support');
  rows[7] = { a: 8, b: 9, normalImpulse: [0, 0.1, 0] };
  assert.equal(
    springSupportImpulses({ rows }, fixture)[7],
    -0.1,
    'downward impulse keeps its sign',
  );
  for (const field of [
    'cost',
    'missing',
    'unavailable',
    'unloaded',
    'one-missing',
    'wrong-direction',
  ]) {
    const cases = simulation(),
      c = cases.find((c) => c.count === 8 && c.dense);
    if (field === 'cost') c.phases['integration-contacts'].fill(policy.integrationP95Ms * 1.01);
    if (field === 'missing') c.contacts.pop();
    if (field === 'unavailable') c.contacts[0].available = false;
    if (field === 'unloaded')
      c.contacts.forEach((s) => {
        s.supportImpulses.fill(0);
      });
    if (field === 'one-missing') c.contacts[0].supportImpulses[7] = 0;
    if (field === 'wrong-direction') c.contacts[0].supportImpulses[7] *= -1;
    assert.throws(() => evaluateSpringSimulation(cases));
  }
});

test('connected spring performance rejects missing bodies and slow connected integration', () => {
  for (const fault of ['bodies', 'integration', 'tick']) {
    const cases = simulation(),
      c = cases.find((c) => c.connectedBodies === 34 && c.count === 1);
    if (fault === 'bodies') c.fixture.bodies.pop();
    if (fault === 'integration')
      c.phases['integration-contacts'].fill(policy.integrationP95Ms * 1.01);
    if (fault === 'tick') c.timesMs.fill(policy.tickP95Ms * 1.01);
    assert.throws(
      () => evaluateSpringSimulation(cases),
      fault === 'bodies' ? /workload/ : /exceeds/,
    );
  }
});
