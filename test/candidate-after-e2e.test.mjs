import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/candidate-after.mjs', import.meta.url));
function run(...args) {
  const child = spawnSync(process.execPath, [fixture, ...args], { encoding: 'utf8' });
  const line = child.stdout.split('\n').find((l) => l.startsWith('TRANSPORT '));
  assert.ok(line, child.stdout + child.stderr);
  return { status: child.status, ...JSON.parse(line.slice(10)), stderr: child.stderr };
}
const receipt = (report, id) => report.verification.checks.find((r) => r.id === id);

test('a diagnosed retry reuses the failed attempt on identical bytes, re-executes the failure and its controls, and never reports plain green', (t) => {
  const first = run('first', 'new', '', 'x=fail');
  t.after(() => {
    rmSync(first.root, { recursive: true, force: true });
    if (first.report?.directory) rmSync(first.report.directory, { recursive: true, force: true });
  });
  assert.equal(first.status, 1);
  assert.equal(first.report.status, 'failed');
  assert.equal(receipt(first.report, 'browser:x').ok, false);
  assert.equal(receipt(first.report, 'unit:test/a.test.mjs').ok, true);
  const parent = first.report.attemptReport;

  // A cause that names a passing leaf is refused before anything runs, and the report says so.
  const bad = run('after', first.root, parent, 'x=pass', '--cause=browser:perf=not the failure');
  assert.equal(bad.status, 1);
  assert.equal(bad.report.status, 'failed');
  assert.match(bad.report.error, /browser:x|browser:perf/);
  assert.equal(bad.calls.some((c) => c.kind === 'process'), false, 'no process ran');

  // Same bytes: the passing unit leaf is reused with its origin; the failure, its control and
  // every timing-sensitive or structural leaf execute; the status is distinct from plain passed.
  const retry = run('after', first.root, parent, 'x=pass', '--cause=browser:x=late pause landed after the load fell');
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.report.status, 'passed after failure');
  assert.equal(retry.report.directory, first.report.directory, 'same candidate directory');
  assert.equal(retry.report.after.mode, 'same-bytes');
  assert.deepEqual(retry.report.after.sameBytes, {
    sameSource: true,
    sameDependencies: true,
    sameIdentity: true,
  });
  const reused = receipt(retry.report, 'unit:test/a.test.mjs');
  assert.equal(reused.resumed, true);
  assert.deepEqual(reused.origin, {
    attempt: first.report.attempt,
    report: first.report.attemptReport,
    depth: 1,
  });
  assert.deepEqual(retry.report.after.reused, [{ id: 'unit:test/a.test.mjs', origin: reused.origin }]);
  const executed = retry.report.verification.executed;
  for (const id of ['browser:x', 'unit:test/geometry.test.mjs', 'browser:perf', 'build:browser', 'check:layers', 'ci:budget'])
    assert.ok(executed.includes(id), `${id} executed`);
  assert.equal(executed.includes('unit:test/a.test.mjs'), false);
  assert.ok(retry.report.after.reexecuted.includes('browser:x'));
  assert.ok(retry.report.after.reexecuted.includes('unit:test/geometry.test.mjs'));
  assert.ok(retry.report.after.controls.includes('unit:test/geometry.test.mjs'));
  assert.ok(retry.report.after.alwaysFresh.includes('browser:perf'));
  assert.equal(retry.report.after.causes['browser:x'], 'late pause landed after the load fell');
  assert.deepEqual(retry.report.after.chain, [first.report.attempt]);
  assert.equal(receipt(retry.report, 'ci:budget').ok, true, 'a non-process leaf still completes');

  // A retry whose child never observed the failed leaf executing cannot pass after failure.
  const omitted = run('after', first.root, parent, 'x=pass', 'omit=browser:x', '--cause=browser:x=late pause');
  assert.equal(omitted.status, 1);
  assert.equal(omitted.report.status, 'failed');
  assert.match(omitted.report.error, /browser:x/);

  // Different bytes: fresh capture, the byte delta reaches the tier, no receipt loads, and a
  // child that executed everything without reuse is plain passed with the after block present.
  const delta = run('after', first.root, parent, 'x=pass', 'touch=src.mjs', '--cause=browser:x=late pause');
  t.after(() => {
    if (delta.report?.directory) rmSync(delta.report.directory, { recursive: true, force: true });
  });
  assert.equal(delta.status, 0, delta.stderr);
  assert.equal(delta.report.after.mode, 'delta');
  assert.notEqual(delta.report.directory, first.report.directory);
  assert.deepEqual(delta.report.after.delta, ['src.mjs']);
  assert.deepEqual(delta.report.verification.changedFiles, ['src.mjs']);
  assert.equal(delta.report.verification.checks.some((r) => r.resumed), false);
  assert.deepEqual(delta.report.after.reused, []);
  assert.equal(delta.report.status, 'passed');
});
