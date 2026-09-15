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
  assert.throws(
    () => readHostProfile(manifest, { SIMULACRUM_HOST_PROFILE: 'laptop' }),
    /unknown host profile/,
  );
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
  const measuring = {
    id: 'm',
    measurement: true,
    browserTimeoutMs: { default: { cap: 600000, factor: 5 } },
  };
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
  assert.deepEqual(
    parts.run.map((c) => c.id),
    ['a', 'b'],
  );
  assert.deepEqual(parts.notEvaluated, [
    {
      id: 'p',
      status: 'NOT_EVALUATED',
      reason:
        'hosted profile github-ubuntu-2cpu: performance tier is not evaluated on this platform',
    },
  ]);
  // Timing-sensitive checks need the quiet-host admission that only a tier context provides;
  // the hosted route has none, so they are not evaluated there whatever their tier.
  const timed = partitionHostedChecks(
    [
      { id: 't', tier: 'browser', timingSensitive: true },
      { id: 'u', tier: 'browser' },
    ],
    p,
  );
  assert.deepEqual(
    timed.run.map((c) => c.id),
    ['u'],
  );
  assert.deepEqual(timed.notEvaluated, [
    {
      id: 't',
      status: 'NOT_EVALUATED',
      reason:
        'hosted profile github-ubuntu-2cpu: timing-sensitive check has no quiet-host admission on this platform',
    },
  ]);
  const real = partitionHostedChecks(
    manifest.browserChecks,
    readHostProfile(manifest, { SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' }),
  );
  assert.ok(real.run.every((c) => c.timingSensitive !== true && c.tier !== 'performance'));
  assert.equal(
    real.notEvaluated.length,
    manifest.browserChecks.filter((c) => c.timingSensitive === true || c.tier === 'performance')
      .length,
  );
  assert.deepEqual(rotateSchedule(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(rotateSchedule(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
  assert.deepEqual(rotateSchedule([], 7), []);
});
test('completion tiers refuse a hosted profile and hosted reports carry their label', () => {
  assert.doesNotThrow(() => assertNoHostProfile({}));
  assert.throws(
    () => assertNoHostProfile({ SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' }),
    /completion tiers never run under a hosted profile/,
  );
  assert.deepEqual(hostedReportFields(null), {});
  assert.deepEqual(hostedReportFields({ id: 'x', measurement: true }), {
    hostProfile: 'x',
    measurement: true,
  });
  assert.deepEqual(ciBudget(null), { limitMs: 180000, deadlineMs: 180000 });
  assert.deepEqual(ciBudget({ id: 'x', ciBudgetMs: 900000 }), {
    limitMs: 180000,
    hostedLimitMs: 900000,
    deadlineMs: 900000,
  });
  // verify-candidate refuses before writing any report; the tier scripts refuse in
  // parseCompletionArgs (covered by assertNoHostProfile above without touching artifacts).
  const child = spawnSync(process.execPath, ['scripts/verify-candidate.mjs', 'local'], {
    encoding: 'utf8',
    env: { ...process.env, SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu' },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr + child.stdout, /completion tiers never run under a hosted profile/);
});
test('host profiles are registered facts: closed keys, bounded measurement, and per-check budgets once measured', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.match(
    hostProfileStateLine(manifest),
    /^hosted profile github-ubuntu-2cpu: measurement mode \(\d\/3 runs recorded\)$/,
  );
  const withProfile = (mutate) => {
    const m = structuredClone(manifest);
    mutate(m.hostProfiles['github-ubuntu-2cpu'], m);
    return m;
  };
  assert.throws(() => validateManifest(withProfile((p) => (p.extra = 1))), /host profile/);
  assert.throws(
    () => validateManifest(withProfile((p) => (p.measurementRuns = ['1', '2', '3', '4']))),
    /at most three measurement runs/,
  );
  assert.throws(
    () => validateManifest(withProfile((p) => (p.notEvaluated = ['unknown-tier']))),
    /unknown tier/,
  );
  assert.throws(
    () => validateManifest(withProfile((p) => (p.moduleTimeoutMs = 1000))),
    /shorter than the local deadline/,
  );
  assert.throws(
    () => validateManifest(withProfile((p) => (p.measurement = false))),
    /no provisional browser rule/,
  );
  assert.throws(
    () =>
      validateManifest(
        withProfile((p) => {
          p.measurement = false;
          delete p.browserTimeoutMs;
        }),
      ),
    /hostedTimeoutMs/,
  );
  assert.throws(
    () =>
      validateManifest(
        withProfile(
          (p, m) => (m.browserChecks[0].hostedTimeoutMs = m.browserChecks[0].timeoutMs - 1),
        ),
      ),
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
test('persisted suite rows keep NOT_EVALUATED entries and children never inherit the profile', async () => {
  const { finalSuiteRuns, childEnvironment } = await import('../scripts/host-profile.mjs');
  const executed = [
    { id: 'a', status: 'passed', ok: true },
    { id: 'b', status: 'failed', ok: false },
  ];
  const notEvaluated = [
    {
      id: 'p',
      status: 'NOT_EVALUATED',
      reason: 'hosted profile x: performance tier is not evaluated on this platform',
    },
  ];
  assert.deepEqual(
    finalSuiteRuns([{ id: 'b' }, { id: 'a' }], executed, notEvaluated).map((r) => r.id),
    ['b', 'a', 'p'],
  );
  assert.deepEqual(
    finalSuiteRuns([{ id: 'a' }], executed, []).map((r) => r.id),
    ['a'],
  );
  const env = childEnvironment({
    PATH: '/bin',
    SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu',
    SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS: '300000',
    OTHER: '1',
  });
  assert.deepEqual(env, { PATH: '/bin', OTHER: '1' });
  assert.equal(Object.hasOwn(env, 'SIMULACRUM_HOST_PROFILE'), false);
});
test('an empty hosted run set reports only NOT_EVALUATED rows instead of crashing the packer', async () => {
  const { measurementRotation } = await import('../scripts/host-profile.mjs');
  // The rotation note is schedule metadata, never a priority reason that inflates the prefix.
  const rotated = measurementRotation(
    [{ id: 'a' }, { id: 'b' }],
    { id: 'x', measurement: true },
    { GITHUB_RUN_NUMBER: '1' },
  );
  assert.deepEqual(
    rotated.checks.map((c) => c.id),
    ['b', 'a'],
  );
  assert.equal(rotated.note, 'measurement rotation seed 1');
  const empty = measurementRotation([], { id: 'x', measurement: true }, { GITHUB_RUN_NUMBER: '5' });
  assert.deepEqual(empty.checks, []);
  const local = measurementRotation([{ id: 'a' }], null, {});
  assert.deepEqual(local, { checks: [{ id: 'a' }], note: null });
});
test('registered profiles clamp browser workers and require recorded measurement run ids to be strings', () => {
  const withProfile = (mutate) => {
    const m = structuredClone(manifest);
    mutate(m.hostProfiles['github-ubuntu-2cpu'], m);
    return m;
  };
  assert.throws(
    () => validateManifest(withProfile((p) => (p.browserWorkers = 4))),
    /browserWorkers must be 1 or 2/,
  );
  assert.throws(
    () => validateManifest(withProfile((p) => (p.measurementRuns = [1]))),
    /measurementRuns entries must be run identifiers/,
  );
  assert.doesNotThrow(() =>
    validateManifest(withProfile((p) => (p.measurementRuns = ['34799855458']))),
  );
});
test('wait scale and live slice are registered host facts that reach checks as numbers, never locally', async () => {
  const { checkWaitEnvironment, WAIT_SCALE_VARIABLE, LIVE_SLICE_VARIABLE } = await import(
    '../scripts/host-profile.mjs'
  );
  const withProfile = (mutate) => {
    const m = structuredClone(manifest);
    mutate(m.hostProfiles['github-ubuntu-2cpu'], m);
    return m;
  };
  // Registered on the manifest profile, validated as finite facts.
  assert.equal(typeof profile().waitScale, 'number');
  assert.equal(typeof profile().liveSliceMs, 'number');
  assert.throws(() => validateManifest(withProfile((p) => delete p.waitScale)), /waitScale/);
  assert.throws(() => validateManifest(withProfile((p) => (p.waitScale = 0.5))), /waitScale/);
  assert.throws(() => validateManifest(withProfile((p) => (p.liveSliceMs = 500))), /liveSliceMs/);
  // The child of a hosted run gets the numbers and never the profile id; a local child gets
  // neither, even when the parent shell exported one.
  const parent = {
    PATH: '/bin',
    SIMULACRUM_HOST_PROFILE: 'github-ubuntu-2cpu',
    [WAIT_SCALE_VARIABLE]: '99',
    [LIVE_SLICE_VARIABLE]: '1',
  };
  const hosted = checkWaitEnvironment(parent, profile());
  assert.equal(hosted[WAIT_SCALE_VARIABLE], String(profile().waitScale));
  assert.equal(hosted[LIVE_SLICE_VARIABLE], String(profile().liveSliceMs));
  assert.equal(Object.hasOwn(hosted, 'SIMULACRUM_HOST_PROFILE'), false);
  assert.equal(hosted.PATH, '/bin');
  const local = checkWaitEnvironment(parent, null);
  assert.deepEqual(local, { PATH: '/bin' });
  // Completion tiers refuse an exported scale exactly as they refuse a profile.
  assert.throws(
    () => assertNoHostProfile({ [WAIT_SCALE_VARIABLE]: '10' }),
    /completion tiers never run under a hosted/,
  );
});
