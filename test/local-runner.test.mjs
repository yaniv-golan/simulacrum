import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const run = (scenario) => {
  const p = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/local-runner.mjs', import.meta.url)), scenario],
    { encoding: 'utf8' },
  );
  assert.equal(p.status, 0, p.stderr + p.stdout);
  const line = (prefix) => p.stdout.split('\n').find((x) => x.startsWith(prefix));
  return {
    report: JSON.parse(line('REPORT ').slice(7)),
    suite: line('SUITE ') ? JSON.parse(line('SUITE ').slice(6)) : null,
  };
};

test('the local tier applies its own policy to the base diff; a retry only widens it or skips covered checks its delta does not reach', () => {
  // No retry: the fresh policy over the working-tree change (src/foo.mjs) selects foo and bar.
  const plain = run('plain');
  assert.equal(plain.report.retry, null);
  assert.deepEqual(
    plain.report.selection.checks.map((c) => c.id),
    ['foo', 'bar'],
  );
  assert.equal(plain.report.selection.skippedByDelta, undefined);
  assert.deepEqual(plain.suite, ['foo', 'bar']);

  // A docs-only byte delta against a parent that covered bar: foo still runs (the fresh policy
  // selected it and nothing covers it); bar is skipped by reasoning and named.
  const delta = run('retry-delta');
  assert.deepEqual(delta.report.retry, {
    changedFiles: ['docs/x.md'],
    required: [],
    covered: ['bar'],
  });
  assert.deepEqual(
    delta.report.selection.checks.map((c) => c.id),
    ['foo'],
  );
  assert.deepEqual(delta.report.selection.skippedByDelta, ['bar']);
  assert.deepEqual(delta.report.selection.fresh, {
    scope: 'local-contract',
    fallback: null,
    checks: ['foo', 'bar'],
  });
  assert.deepEqual(delta.suite, ['foo']);

  // Blocker from review: the same delta against a parent with no browser coverage runs the
  // full fresh selection and skips nothing.
  const uncovered = run('retry-uncovered');
  assert.deepEqual(
    uncovered.report.selection.checks.map((c) => c.id),
    ['foo', 'bar'],
  );
  assert.deepEqual(uncovered.report.selection.skippedByDelta, []);
  assert.deepEqual(uncovered.suite, ['foo', 'bar']);

  // Same bytes: no delta, the required check is added from the registry.
  const required = run('retry-required');
  assert.deepEqual(
    required.report.selection.checks.map((c) => c.id),
    ['foo', 'bar', 'baz'],
  );
  assert.deepEqual(required.report.selection.required, ['baz']);
  assert.deepEqual(required.suite, ['foo', 'bar', 'baz']);
});
