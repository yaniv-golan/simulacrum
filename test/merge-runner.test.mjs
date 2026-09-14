import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const scenario of [
  'pass',
  'ci-fail',
  'browser-fail',
  'retry-required',
  'retry-delta',
  'reach-drift',
])
  test(`merge runner source binding and qualification boundary: ${scenario}`, () => {
    const p = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/merge-runner.mjs', import.meta.url)), scenario],
      { encoding: 'utf8' },
    );
    assert.equal(
      p.status,
      ['pass', 'retry-required', 'retry-delta'].includes(scenario) ? 0 : 1,
      p.stderr + p.stdout,
    );
    const report = JSON.parse(
      p.stdout
        .split('\n')
        .find((x) => x.startsWith('REPORT '))
        .slice(7),
    );
    assert.equal(report.outcome.qualification.status, 'NOT_EVALUATED');
    assert.equal(report.outcome.humanAcceptance.status, 'NOT_EVALUATED');
    if (scenario === 'ci-fail')
      assert.equal(
        report.results.some((r) => r.id === 'browser'),
        false,
      );
    // A diagnosed retry's required checks widen the merge selection from the registry and are
    // reported as selected for that reason; nothing else about the selection changes. Without a
    // retry the selection is exactly what mergeSelection returned.
    if (scenario === 'ci-fail') {
      assert.equal(report.selection, undefined, 'failed prerequisites stop before selection');
      return;
    }
    // The launch admission is admitted under the reach the tier will have: a selection with
    // no timing row applies load and idle only (no foreign bound), a required timing row the
    // full policy. The selection phase refuses a selection whose reach moved after launch.
    const launch = report.results.find((r) => r.id === 'launch-admission');
    const timing = scenario === 'retry-required';
    assert.equal(report.reach, timing ? 'timing' : 'structural');
    assert.deepEqual(launch.result.policy, {
      reach: timing ? 'timing' : 'structural',
      mode: 'observe',
      bounds: { idle: 80, foreign: timing ? 40 : null },
    });
    assert.equal(launch.result.admission.policy.foreignBound, timing ? 40 : null);
    assert.equal(launch.result.admission.policy.idleBound, 80);
    if (scenario === 'reach-drift') {
      const selection = report.results.find((r) => r.id === 'selection');
      assert.equal(selection.status, 'failed');
      assert.match(
        selection.error,
        /selection reach changed after launch admission: admitted as structural, selection reaches timing/,
      );
      assert.equal(
        report.results.some((r) => r.id === 'browser'),
        false,
      );
      return;
    }
    assert.equal(report.selection.reach, timing ? 'timing' : 'structural');
    const ids = report.selection.checks.map((c) => c.id);
    if (scenario === 'retry-delta') {
      // The integration scope stays the real one; the delta yields a second, narrower scope.
      assert.deepEqual(report.integration.files, ['README.md', 'src/foo.mjs']);
      assert.deepEqual(report.retryIntegration.files, ['docs/x.md']);
      assert.equal(report.retryIntegration.filesProvenance, 'candidate delta');
      // Fresh policy foo+bar+smoke; the docs delta reaches only smoke; bar is covered by the
      // parent and the delta does not reach it, so it is the one omission by reasoning.
      assert.deepEqual(ids, ['smoke', 'foo']);
      assert.deepEqual(report.selection.skippedByDelta, ['bar']);
      assert.deepEqual(report.selection.covered, ['bar']);
      assert.equal(report.selection.scope, 'local-contract', 'the fresh scope is reported');
      assert.deepEqual(report.selection.delta.checks, ['smoke']);
      assert.deepEqual(
        report.selection.selected.map((c) => [c.id, c.reason]),
        [
          ['smoke', 'registered merge smoke'],
          ['foo', 'existing audited affected selection'],
        ],
      );
      assert.deepEqual(
        report.selection.omitted.map((c) => [c.id, c.reason]),
        [
          ['bar', 'covered by a parent attempt receipt the byte delta does not reach'],
          ['mirror', 'outside audited selection and registered merge smoke'],
        ],
      );
      return;
    }
    if (scenario === 'retry-required') {
      assert.deepEqual(ids, ['smoke', 'foo', 'bar', 'mirror']);
      assert.deepEqual(report.selection.required, ['mirror']);
      assert.ok(
        report.selection.selected.some(
          (c) => c.id === 'mirror' && /required re-execution/.test(c.reason),
        ),
      );
      assert.equal(
        report.selection.omitted.some((c) => c.id === 'mirror'),
        false,
      );
      assert.deepEqual(report.retry, { changedFiles: null, required: ['mirror'], covered: [] });
    } else {
      assert.deepEqual(ids, ['smoke', 'foo', 'bar']);
      assert.equal(report.selection.required, undefined);
      assert.equal(report.retry, null);
    }
  });
