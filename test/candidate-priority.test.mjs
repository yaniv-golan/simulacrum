import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/candidate-priority.mjs', import.meta.url));
const priorityFiles = ['scripts/verify-recording-browser.mjs', 'src/application/workshop-app.mjs'];
for (const [tier, codes] of [
  ['local', [0, 1]],
  ['merge', [0, 1]],
  ['final', [0, 1, 2]],
])
  for (const code of codes)
    test(`candidate ${tier} forwards captured priority and preserves exit ${code}`, () => {
      const child = spawnSync(process.execPath, [fixture, tier, String(code)], {
        encoding: 'utf8',
      });
      assert.equal(child.status, code, child.stderr || child.stdout);
      const output = child.stdout.split('\n').find((line) => line.startsWith('TRANSPORT '));
      assert.ok(output, child.stdout + child.stderr);
      const { calls, captured, report } = JSON.parse(output.slice(10));
      const base = tier !== 'final' ? 'HEAD~1' : 'HEAD';
      assert.deepEqual(calls.find((row) => row.kind === 'capture').options, { base });
      assert.deepEqual(report.priority, {
        base,
        priorityFiles,
        priorityProvenance: 'explicit integration paths',
      });
      const processes = calls.filter((row) => row.kind === 'process');
      assert.equal(processes.length, 2);
      assert.deepEqual(processes[0].args, ['ci', '--prefer-offline']);
      assert.deepEqual(processes[1].args, [
        'scripts/verification-window.mjs',
        `scripts/verify-${tier}.mjs`,
        ...(tier !== 'final' ? ['--base', captured.base] : []),
        '--priority-files',
        ...priorityFiles,
      ]);
      assert.ok(processes.every((row) => row.cwd === captured.destination));
      assert.deepEqual(report.verification.priority, {
        base: tier !== 'final' ? captured.base : 'HEAD',
        priorityFiles,
        priorityProvenance: 'explicit integration paths',
      });
      assert.deepEqual(
        calls.filter((row) => row.kind === 'identity').map((row) => row.path),
        [captured.destination, captured.origin],
      );
      assert.equal(report.status, code === 1 ? 'failed' : 'passed');
      // The candidate keeps the host awake itself (through the replaceable preflight helper,
      // which the fixture records) and names the launch priority it saw.
      assert.deepEqual(report.sleepAssertion, {
        method: 'fixture',
        pid: report.sleepAssertion.pid,
      });
      assert.equal(report.launchNiceness, 0);
      assert.equal(
        report.qualification.status,
        tier !== 'final' ? 'NOT_EVALUATED' : code ? 'BLOCKED' : 'PASS',
      );
      // The tier's window owner declares the candidate's purpose and origin worktree.
      assert.deepEqual(processes[1].intent, {
        script: `verify-${tier}.mjs`,
        tier,
        origin: captured.origin,
        head: 'fixture-branch',
        base: captured.base,
      });
      assert.equal(report.destinationStillMatches, 'NOT_EVALUATED');
      assert.equal(
        calls.some((row) => row.kind === 'drift'),
        false,
      );
    });

test('candidate merge branch pair names its destination, publishes it and routes drift', () => {
  const child = spawnSync(process.execPath, [fixture, 'merge', '0', 'pair'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const output = child.stdout.split('\n').find((line) => line.startsWith('TRANSPORT '));
  assert.ok(output, child.stdout + child.stderr);
  const { calls, captured, report } = JSON.parse(output.slice(10));
  assert.deepEqual(report.priority, {
    base: 'HEAD~1',
    incoming: 'resolved-feature',
    destination: 'resolved-target',
    destinationName: 'target',
    priorityFiles,
    priorityProvenance: 'explicit integration paths',
  });
  const tierProcess = calls.filter((row) => row.kind === 'process')[1];
  assert.deepEqual(tierProcess.args.slice(0, 8), [
    'scripts/verification-window.mjs',
    'scripts/verify-merge.mjs',
    '--base',
    captured.base,
    '--incoming',
    'resolved-feature',
    '--destination',
    'resolved-target',
  ]);
  assert.deepEqual(tierProcess.intent, {
    script: 'verify-merge.mjs',
    tier: 'merge',
    origin: captured.origin,
    head: 'fixture-branch',
    base: captured.base,
    incoming: 'resolved-feature',
    destination: 'resolved-target',
    destinationName: 'target',
  });
  assert.deepEqual(
    calls.filter((row) => row.kind === 'drift'),
    [
      {
        kind: 'drift',
        root: captured.origin,
        refs: { destination: 'resolved-target', destinationName: 'target' },
      },
    ],
  );
  assert.equal(report.destinationStillMatches, 'fixture-drift');
});

test('candidate merge --stack derives its destination, incoming and base, records the chain and prints the landing order', () => {
  const child = spawnSync(process.execPath, [fixture, 'merge', '0', 'stack'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const output = child.stdout.split('\n').find((line) => line.startsWith('TRANSPORT '));
  assert.ok(output, child.stdout + child.stderr);
  const { calls, captured, report, stdout } = JSON.parse(output.slice(10));
  // The derived values go through the same scope resolution as typed ones.
  assert.deepEqual(report.priority, {
    base: 'HEAD~1',
    incoming: 'resolved-feature',
    destination: 'resolved-target',
    destinationName: 'target',
    stack: 'target',
    chain: {
      stack: 'target',
      destination: 'sha-target',
      incoming: 'feature',
      base: 'HEAD~1',
      head: 'sha-head',
    },
    landingOrder: ['target @ sha-tar', 'this candidate @ sha-hea'],
    priorityFiles,
    priorityProvenance: 'explicit integration paths',
  });
  const tierProcess = calls.filter((row) => row.kind === 'process')[1];
  assert.deepEqual(tierProcess.args.slice(0, 8), [
    'scripts/verification-window.mjs',
    'scripts/verify-merge.mjs',
    '--base',
    captured.base,
    '--incoming',
    'resolved-feature',
    '--destination',
    'resolved-target',
  ]);
  // Contenders see the stack in the window intent; the landing order is printed at launch
  // and again with the passing result.
  assert.equal(tierProcess.intent.stack, 'target');
  assert.equal(tierProcess.intent.destinationName, 'target');
  assert.deepEqual(
    stdout.filter((line) => line.startsWith('landing order')),
    [
      'landing order: target @ sha-tar, then this candidate @ sha-hea',
      'landing order: target @ sha-tar, then this candidate @ sha-hea',
    ],
  );
  assert.equal(report.destinationStillMatches, 'fixture-drift');
});
