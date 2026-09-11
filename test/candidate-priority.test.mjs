import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/candidate-priority.mjs', import.meta.url));
const priorityFiles = ['scripts/verify-recording-browser.mjs', 'src/application/workshop-app.mjs'];
for (const [tier, codes] of [
  ['local', [0, 1]],
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
      const base = tier === 'local' ? 'HEAD~1' : 'HEAD';
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
        ...(tier === 'local' ? ['--base', captured.base] : []),
        '--priority-files',
        ...priorityFiles,
      ]);
      assert.ok(processes.every((row) => row.cwd === captured.destination));
      assert.deepEqual(report.verification.priority, {
        base: tier === 'local' ? captured.base : 'HEAD',
        priorityFiles,
        priorityProvenance: 'explicit integration paths',
      });
      assert.deepEqual(
        calls.filter((row) => row.kind === 'identity').map((row) => row.path),
        [captured.destination, captured.origin],
      );
      assert.equal(report.status, code === 1 ? 'failed' : code === 2 ? 'blocked' : 'passed');
      assert.equal(
        report.qualification.status,
        tier === 'local' ? 'NOT_EVALUATED' : code ? 'BLOCKED' : 'PASS',
      );
    });
