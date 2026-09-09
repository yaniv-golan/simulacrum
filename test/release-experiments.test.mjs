import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectExperiments,
  experimentReceipt,
  experimentIdentity,
  verifyExperimentResults,
  validateProfile,
} from '../scripts/playtest/experiments.mjs';
const now = 1000000;
const profile = {
  schema: 1,
  recordingMode: 'video',
  captureSchema: 1,
  enduranceSeconds: 360,
  capacitySeconds: 120,
  maxAgeMs: 86400000,
  calibration: {
    browserVersion: 'test-browser',
    evidence: 'a'.repeat(64),
    workload: {
      maxEventBytes: 1000,
      maxMediaBytesPerSecond: 100000,
      maxEventsPerSecond: 10,
      maxChunkBytes: 10485760,
    },
  },
};
const context = {
  artifact: 'a'.repeat(64),
  environment: 'staging',
  inputs: { endurance: 'b'.repeat(64), capacity: 'c'.repeat(64) },
  configuration: 'd'.repeat(64),
};
const input = (extra = {}) => ({ ...context, profile, now, ...extra });
test('experiment policy requires measured calibration but explicit exception works without baseline', () => {
  assert.throws(() => selectExperiments(input({ profile: null })), /calibrat/i);
  const plan = selectExperiments(
    input({
      profile: null,
      mode: 'bypass-expensive',
      reason: 'UI review before capacity qualification',
    }),
  );
  assert.deepEqual(plan.run, []);
  assert.equal(plan.smokeSeconds, 60);
  assert.equal(plan.results.endurance.status, 'NOT_RUN');
  assert.throws(
    () => selectExperiments(input({ mode: 'bypass-expensive', reason: ' ' })),
    /reason/,
  );
  assert.throws(() => selectExperiments(input({ mode: 'oops' })), /mode/);
});
test('separate evidence inputs select only invalidated family; full never reuses', () => {
  const selected = selectExperiments(input());
  assert.deepEqual(selected.run, ['endurance', 'capacity']);
  const evidence = ['endurance', 'capacity'].map((f) =>
    experimentReceipt(f, input(), { proof: 'measured' }, now - 10),
  );
  assert.deepEqual(selectExperiments(input({ evidence })).run, []);
  assert.deepEqual(
    selectExperiments(input({ evidence, inputs: { ...context.inputs, endurance: 'e'.repeat(64) } }))
      .run,
    ['endurance'],
  );
  assert.deepEqual(selectExperiments(input({ evidence, mode: 'full' })).run, [
    'endurance',
    'capacity',
  ]);
  for (const mutate of [
    (r) => (r.expires = now),
    (r) => (r.measuredAt = now + 1),
    (r) => (r.status = 'NOT_RUN'),
    (r) => (r.configuration = 'e'.repeat(64)),
    (r) => (r.environment = 'production'),
    (r) => (r.profile = 'f'.repeat(64)),
  ]) {
    const wrong = structuredClone(evidence);
    mutate(wrong[0]);
    assert.ok(selectExperiments(input({ evidence: wrong })).run.includes('endurance'));
  }
});
test('known failures require acknowledgement and cannot be hidden behind older passes', () => {
  const good = experimentReceipt('endurance', input(), {}, now - 20);
  const bad = { ...good, status: 'FAIL', id: 'failure-1', measuredAt: now - 10 };
  assert.ok(selectExperiments(input({ evidence: [good, bad] })).run.includes('endurance'));
  assert.deepEqual(selectExperiments(input({ evidence: [bad], mode: 'full' })).run, [
    'endurance',
    'capacity',
  ]);
  assert.throws(
    () =>
      selectExperiments(
        input({ evidence: [bad], mode: 'bypass-expensive', reason: 'investigation' }),
      ),
    /acknowledge/,
  );
  const p = selectExperiments(
    input({
      evidence: [bad],
      mode: 'bypass-expensive',
      reason: 'investigation',
      acknowledgeFailures: ['failure-1'],
    }),
  );
  assert.equal(p.results.endurance.status, 'NOT_RUN');
  assert.equal(p.exception.acknowledgeFailures[0], 'failure-1');
});
test('production staging evidence never converts skipped experiments into qualification', () => {
  const plan = selectExperiments(input({ mode: 'bypass-expensive', reason: 'preview' }));
  assert.throws(() => verifyExperimentResults(plan.results), /qualification/);
  const good = Object.fromEntries(
    ['endurance', 'capacity'].map((f) => [
      f,
      { status: 'PASS', receipt: experimentReceipt(f, input(), {}, now) },
    ]),
  );
  assert.doesNotThrow(() => verifyExperimentResults(good, now));
  assert.throws(
    () => verifyExperimentResults({ ...good, capacity: { status: 'PASS' } }),
    /receipt/,
  );
});
test('profile and experiment identity reject guessed defaults and bind workload/configuration', () => {
  assert.throws(() => validateProfile({ ...profile, calibration: null }), /calibrat/i);
  assert.throws(() => validateProfile({ ...profile, enduranceSeconds: 60 }), /duration/);
  assert.throws(() => validateProfile({ ...profile, maxAgeMs: Infinity }), /age/);
  assert.notEqual(
    experimentIdentity('capacity', input()),
    experimentIdentity('capacity', input({ configuration: 'e'.repeat(64) })),
  );
});

test('promotion binds capture settings and rechecks receipt expiry at completion', async () => {
  const { stagingResults, behaviorConfiguration } = await import(
    '../scripts/playtest/experiments.mjs'
  );
  const worker = {
    name: 'staging',
    account_id: 'a',
    vars: { ALLOWED_ORIGIN: 'https://staging', MAX_BYTES: '100' },
    limits: { cpu_ms: 10 },
  };
  const report = {
    schema: 2,
    environment: 'staging',
    artifact: context.artifact,
    smoke: { status: 'PASS' },
    behaviorConfiguration: behaviorConfiguration(worker),
    experiments: Object.fromEntries(
      ['endurance', 'capacity'].map((f) => [
        f,
        { status: 'PASS', receipt: experimentReceipt(f, input(), {}, now) },
      ]),
    ),
  };
  assert.equal(
    stagingResults(
      report,
      context.artifact,
      { ...worker, name: 'production', account_id: 'b' },
      profile,
      now,
    ).capacity.status,
    'REUSED',
  );
  assert.throws(
    () =>
      stagingResults(report, context.artifact, { ...worker, limits: { cpu_ms: 5 } }, profile, now),
    /incompatible/,
  );
  assert.throws(
    () => stagingResults(report, context.artifact, worker, profile, now + profile.maxAgeMs),
    /expired/,
  );
});

test('promotion rejects receipts from a superseded calibration profile', async () => {
  const { stagingResults, behaviorConfiguration } = await import(
    '../scripts/playtest/experiments.mjs'
  );
  const worker = { limits: { cpu_ms: 10 } };
  const report = {
    schema: 2,
    environment: 'staging',
    artifact: context.artifact,
    smoke: { status: 'PASS' },
    behaviorConfiguration: behaviorConfiguration(worker),
    experiments: Object.fromEntries(
      ['endurance', 'capacity'].map((f) => [
        f,
        { status: 'PASS', receipt: experimentReceipt(f, input(), {}, now) },
      ]),
    ),
  };
  assert.throws(
    () =>
      stagingResults(report, context.artifact, worker, { ...profile, maxAgeMs: 1000 }, now + 2000),
    /profile|expired/i,
  );
});
test('experiment evidence deduplicates compact durable failures without erasing contradictions', async () => {
  const { normalizeExperimentEvidence } = await import('../scripts/playtest/experiments.mjs');
  const failure = {
    id: 'failure-1',
    family: 'endurance',
    status: 'FAIL',
    identity: 'a'.repeat(64),
    artifact: 'b'.repeat(64),
    measuredAt: 1,
    reason: 'backlog',
  };
  const rich = { ...failure, attempt: 'local', measurement: { samples: [1, 2] } };
  assert.deepEqual(normalizeExperimentEvidence([failure, rich, failure]), [rich]);
  assert.throws(
    () => normalizeExperimentEvidence([failure, { ...failure, status: 'PASS' }]),
    /conflicting/i,
  );
  assert.throws(
    () => normalizeExperimentEvidence([failure, { ...failure, reason: 'other' }]),
    /conflicting/i,
  );
  for (const bad of [
    { ...failure, id: '../escape' },
    { ...failure, measuredAt: NaN },
    { ...failure, family: 'unknown' },
    {},
  ])
    assert.throws(() => normalizeExperimentEvidence([bad]), /invalid/i);
  assert.throws(() => normalizeExperimentEvidence({}), /array/i);
});

test('qualification profile rejects unbound legacy media evidence and admits data bounds', () => {
  const p = {
    schema: 1,
    recordingMode: 'data',
    captureSchema: 1,
    enduranceSeconds: 360,
    capacitySeconds: 120,
    maxAgeMs: 1000,
    calibration: {
      evidence: 'a'.repeat(64),
      browserVersion: 'test',
      workload: {
        maxMediaBytesPerSecond: 0,
        maxChunkBytes: 0,
        maxEventsPerSecond: 10,
        maxEventBytes: 1000,
      },
    },
  };
  assert.doesNotThrow(() => validateProfile(p));
  assert.throws(() => validateProfile({ ...p, recordingMode: undefined }), /mode|schema/i);
  assert.throws(() => validateProfile({ ...p, captureSchema: 2 }), /mode|schema/i);
  assert.throws(() => validateProfile({ ...p, recordingMode: 'video' }), /bounds/i);
});
