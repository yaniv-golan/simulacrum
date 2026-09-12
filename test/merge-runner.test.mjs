import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const scenario of ['pass', 'ci-fail', 'browser-fail'])
  test(`merge runner source binding and qualification boundary: ${scenario}`, () => {
    const p = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/merge-runner.mjs', import.meta.url)), scenario],
      { encoding: 'utf8' },
    );
    assert.equal(p.status, scenario === 'pass' ? 0 : 1, p.stderr + p.stdout);
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
  });
