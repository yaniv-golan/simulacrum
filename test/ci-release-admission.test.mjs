import test from 'node:test';
import assert from 'node:assert/strict';
import { latestReleaseRun, assertExperimentAdmission } from '../scripts/playtest/ci-release.mjs';
test('latest release ignores PR and schedule while considering manual and push releases', () => {
  const run = (event, id) => ({
    event,
    id,
    run_number: id,
    head_branch: 'v2',
    conclusion: 'success',
    path: '.github/workflows/ci.yml',
    head_repository: { full_name: 'owner/repo' },
  });
  const paths = [];
  const query = (path) => {
    paths.push(path);
    return {
      workflow_runs: [
        run(
          path.includes('event=push') ? 'push' : 'workflow_dispatch',
          path.includes('event=push') ? 4 : 6,
        ),
        run('schedule', 20),
        run('pull_request', 21),
      ],
    };
  };
  assert.equal(latestReleaseRun(query, 'owner/repo', 'v2').id, 6);
  assert.equal(paths.length, 2);
  assert.equal(
    latestReleaseRun(() => ({ workflow_runs: [run('schedule', 25)] }), 'owner/repo', 'v2'),
    undefined,
  );
  assert.throws(() => latestReleaseRun(() => ({}), 'owner/repo', 'v2'), /Invalid/);
});
test('admission validates calibrated modes and exact staging smoke even for production bypass', () => {
  const staged = { schema: 2, artifact: 'a', smoke: { status: 'PASS' } };
  assert.doesNotThrow(() =>
    assertExperimentAdmission(
      { mode: 'bypass-expensive' },
      { production: true, staged, artifact: 'a' },
    ),
  );
  for (const mode of ['auto', 'full', 'typo'])
    assert.throws(
      () => assertExperimentAdmission({ mode }, { production: false }),
      /calibration|Unknown/,
    );
  for (const bad of [
    undefined,
    { ...staged, schema: 1 },
    { ...staged, artifact: 'b' },
    { ...staged, smoke: { status: 'FAIL' } },
  ])
    assert.throws(
      () =>
        assertExperimentAdmission(
          { mode: 'bypass-expensive' },
          { production: true, staged: bad, artifact: 'a' },
        ),
      /Exact staging/,
    );
});

test('valid measured profile admits auto and full before publisher acquisition', () => {
  const profile = {
    schema: 1,
    recordingMode: 'video',
    captureSchema: 1,
    enduranceSeconds: 360,
    capacitySeconds: 120,
    maxAgeMs: 86400000,
    calibration: {
      evidence: 'a'.repeat(64),
      browserVersion: 'Chromium fixture',
      workload: {
        maxEventBytes: 1000,
        maxMediaBytesPerSecond: 1,
        maxEventsPerSecond: 1,
        maxChunkBytes: 1,
      },
    },
  };
  for (const mode of ['auto', 'full'])
    assert.doesNotThrow(() => assertExperimentAdmission({ mode, profile }));
  assert.throws(
    () => assertExperimentAdmission({ mode: 'full', profile: { ...profile, enduranceSeconds: 1 } }),
    /duration/,
  );
});
