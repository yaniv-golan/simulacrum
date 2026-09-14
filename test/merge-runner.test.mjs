import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const scenario of ['pass', 'ci-fail', 'browser-fail', 'retry-required'])
  test(`merge runner source binding and qualification boundary: ${scenario}`, () => {
    const p = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/merge-runner.mjs', import.meta.url)), scenario],
      { encoding: 'utf8' },
    );
    assert.equal(
      p.status,
      ['pass', 'retry-required'].includes(scenario) ? 0 : 1,
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
    const ids = report.selection.checks.map((c) => c.id);
    if (scenario === 'retry-required') {
      assert.deepEqual(ids, ['smoke', 'mirror']);
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
      assert.deepEqual(report.retry, { changedFiles: null, required: ['mirror'] });
    } else {
      assert.deepEqual(ids, ['smoke']);
      assert.equal(report.selection.required, undefined);
      assert.equal(report.retry, null);
    }
  });
