import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRING_PERFORMANCE as policy,
  evaluateSpringSimulation,
  evaluateSpringBrowser,
} from '../scripts/measure-springs.mjs';
const samples = (value, n) => Array(n).fill(value);
function simulation() {
  return Array.from({ length: 3 }, (_, trial) =>
    [0, 1, 8].flatMap((count) =>
      [false, true].map((dense) => ({
        trial,
        count,
        dense,
        warmupTicks: policy.warmupTicks,
        timesMs: samples(count ? policy.tickP95Ms : 0.1, policy.sampleTicks),
        phases: { 'actuators-constraints': samples(policy.constraintP95Ms, policy.sampleTicks) },
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
  assert.equal(evaluateSpringSimulation(simulation()).length, 18);
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
