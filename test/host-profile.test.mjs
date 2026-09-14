import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  readHostProfile,
  profileDeadline,
  browserBudget,
  partitionHostedChecks,
  rotateSchedule,
  assertNoHostProfile,
  ciBudget,
  hostedReportFields,
  hostProfileStateLine,
} from '../scripts/host-profile.mjs';
import { validateManifest } from '../scripts/validate-manifest.mjs';
const manifest = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
const profile = () => structuredClone(manifest.hostProfiles['github-ubuntu-2cpu']);
test('the hosted profile is read only from the registered manifest entry named by the environment', () => {
  assert.equal(readHostProfile(manifest, {}), null);
  assert.throws(() => readHostProfile(manifest, { SIMULACRUM_HOST_PROFILE: 'laptop' }), /unknown host profile/);
  const p = readHostProfile(manifest, { SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' });
  assert.equal(p.id, 'github-ubuntu-2cpu');
  assert.equal(p.measurement, true);
  assert.deepEqual(p.notEvaluated, ['performance']);
});
test('profile deadlines never shorten a caller deadline and leave local runs untouched', () => {
  assert.equal(profileDeadline(null, 'moduleTimeoutMs', 5000), 5000);
  const p = { id: 'x', moduleTimeoutMs: 30000, unitTimeoutMs: 120000 };
  assert.equal(profileDeadline(p, 'moduleTimeoutMs', 5000), 30000);
  assert.equal(profileDeadline(p, 'moduleTimeoutMs', 45000), 45000);
  assert.equal(profileDeadline(p, 'unitTimeoutMs', 30000), 120000);
  assert.throws(() => profileDeadline(p, 'nodeTimeoutMs', 1), /unknown deadline site/);
});
test('browser budgets come from a registered per-check value, or the measurement rule, never a silent factor', () => {
  const check = { id: 'c', timeoutMs: 45000, tier: 'browser' };
  assert.deepEqual(browserBudget(null, check), { timeoutMs: 45000 });
  const measuring = { id: 'm', measurement: true, browserTimeoutMs: { default: { cap: 600000, factor: 5 } } };
  assert.deepEqual(browserBudget(measuring, check), {
    timeoutMs: 225000,
    registeredTimeoutMs: 45000,
    hostProfile: 'm',
    measurement: true,
  });
  assert.equal(browserBudget(measuring, { ...check, timeoutMs: 180000 }).timeoutMs, 600000);
  assert.equal(browserBudget(measuring, { ...check, hostedTimeoutMs: 70000 }).timeoutMs, 70000);
  const registered = { id: 'r', measurement: false };
  assert.equal(browserBudget(registered, { ...check, hostedTimeoutMs: 70000 }).timeoutMs, 70000);
  assert.throws(() => browserBudget(registered, check), /no hostedTimeoutMs registered for c/);
});
test('hosted runs report excluded tiers as NOT_EVALUATED with a registered reason and rotate the order per run', () => {
  const checks = [
    { id: 'a', tier: 'browser' },
    { id: 'p', tier: 'performance' },
    { id: 'b', tier: 'browser' },
  ];
  assert.deepEqual(partitionHostedChecks(checks, null), { run: checks, notEvaluated: [] });
  const p = { id: 'github-ubuntu-2cpu', notEvaluated: ['performance'] };
  const parts = partitionHostedChecks(checks, p);
  assert.deepEqual(parts.run.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(parts.notEvaluated, [
    { id: 'p', status: 'NOT_EVALUATED', reason: 'hosted profile github-ubuntu-2cpu: performance tier is not evaluated on this platform' },
  ]);
  assert.deepEqual(rotateSchedule(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(rotateSchedule(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
  assert.deepEqual(rotateSchedule([], 7), []);
});
test('completion tiers refuse a hosted profile and hosted reports carry their label', () => {
  assert.doesNotThrow(() => assertNoHostProfile({}));
  assert.throws(() => assertNoHostProfile({ SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' }), /completion tiers never run under a hosted profile/);
  assert.deepEqual(hostedReportFields(null), {});
  assert.deepEqual(hostedReportFields({ id: 'x', measurement: true }), { hostProfile: 'x', measurement: true });
  assert.deepEqual(ciBudget(null), { limitMs: 180000, deadlineMs: 180000 });
  assert.deepEqual(ciBudget({ id: 'x', ciBudgetMs: 900000 }), { limitMs: 180000, hostedLimitMs: 900000, deadlineMs: 900000 });
  for (const tier of ['local']) {
    const child = spawnSync(process.execPath, [`scripts/verify-${tier}.mjs`], {
      encoding: 'utf8',
      env: { ...process.env, SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' },
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr + child.stdout, /completion tiers never run under a hosted profile/);
  }
});
test('host profiles are registered facts: closed keys, bounded measurement, and per-check budgets once measured', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.match(hostProfileStateLine(manifest), /^hosted profile github-ubuntu-2cpu: measurement mode \(\d\/3 runs recorded\)$/);
  const withProfile = (mutate) => {
    const m = structuredClone(manifest);
    mutate(m.hostProfiles['github-ubuntu-2cpu'], m);
    return m;
  };
  assert.throws(() => validateManifest(withProfile((p) => (p.extra = 1))), /host profile/);
  assert.throws(() => validateManifest(withProfile((p) => (p.measurementRuns = [1, 2, 3, 4]))), /at most three measurement runs/);
  assert.throws(() => validateManifest(withProfile((p) => (p.notEvaluated = ['unknown-tier']))), /unknown tier/);
  assert.throws(() => validateManifest(withProfile((p) => (p.moduleTimeoutMs = 1000))), /shorter than the local deadline/);
  assert.throws(() => validateManifest(withProfile((p) => (p.measurement = false))), /hostedTimeoutMs/);
  assert.throws(
    () => validateManifest(withProfile((p, m) => (m.browserChecks[0].hostedTimeoutMs = m.browserChecks[0].timeoutMs - 1))),
    /hostedTimeoutMs/,
  );
  const registered = withProfile((p, m) => {
    p.measurement = false;
    delete p.browserTimeoutMs;
    for (const c of m.browserChecks) c.hostedTimeoutMs = c.timeoutMs * 3;
  });
  assert.doesNotThrow(() => validateManifest(registered));
  assert.match(hostProfileStateLine(registered), /registered per-check budgets/);
});
