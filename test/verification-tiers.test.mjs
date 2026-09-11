import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerificationPhases, localOutcome } from '../scripts/verification-tiers.mjs';
test('failed preflight stops expensive phases and cannot claim local completion', async () => {
  const seen = [];
  const rows = await runVerificationPhases([
    [
      'ci',
      async () => {
        seen.push('ci');
        throw Error('stale docs');
      },
    ],
    ['browser', async () => seen.push('browser')],
  ]);
  assert.deepEqual(seen, ['ci']);
  assert.equal(localOutcome(rows, []).exitCode, 1);
  assert.equal(
    localOutcome(
      [
        { id: 'ci', ok: true },
        { id: 'browser', ok: true },
      ],
      [],
    ).qualification.status,
    'NOT_EVALUATED',
  );
  assert.equal(localOutcome([{ id: 'ci', ok: true }], []).exitCode, 1);
  assert.equal(
    localOutcome(
      [
        { id: 'ci', ok: true },
        { id: 'browser', ok: true },
      ],
      [{ ok: false }],
    ).exitCode,
    1,
  );
  assert.equal(
    localOutcome(
      [
        { id: 'ci', ok: true },
        { id: 'browser', ok: true },
      ],
      [],
    ).exitCode,
    0,
  );
});

test('completion priority arguments preserve tier and normalized provenance', async () => {
  const { parseCompletionArgs } = await import('../scripts/verification-tiers.mjs');
  assert.deepEqual(
    parseCompletionArgs('local', [
      '--base',
      'HEAD~1',
      '--priority-files',
      'scripts/verify-browser.mjs',
    ]),
    {
      base: 'HEAD~1',
      priorityFiles: ['scripts/verify-browser.mjs'],
      priorityProvenance: 'explicit integration paths',
    },
  );
  assert.throws(() => parseCompletionArgs('final', ['--base', 'HEAD']), /Usage/);
  assert.throws(
    () => parseCompletionArgs('local', ['--priority-files', '../escape']),
    /inside project/,
  );
  assert.throws(() => parseCompletionArgs('final', ['--priority-files']), /Usage/);
});
