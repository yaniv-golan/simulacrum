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
  // No tier accepts a hand-supplied file list: a diagnosed retry's byte delta reaches selection
  // through the attempt ledger only, so nothing typed on a command line can narrow coverage.
  for (const tier of ['local', 'merge', 'final'])
    assert.throws(
      () =>
        parseCompletionArgs(tier, [
          ...(tier === 'merge' ? ['--base', 'HEAD'] : []),
          '--changed-files',
          'README.md',
        ]),
      /Usage/,
      `${tier} refuses --changed-files`,
    );
});

test('phase reporting publishes start and finish with elapsed time even on failure', async () => {
  let now = 0;
  const snapshots = [];
  const rows = await runVerificationPhases(
    [
      [
        'ci',
        async () => {
          now = 12;
          return { ok: true };
        },
      ],
      [
        'browser',
        async () => {
          now = 32;
          throw Error('deliberate failure');
        },
      ],
      ['gate', async () => assert.fail('must not run')],
    ],
    { now: () => now, onProgress: (r) => snapshots.push(structuredClone(r)) },
  );
  assert.equal(snapshots.length, 4);
  assert.equal(snapshots[0][0].status, 'running');
  assert.equal(snapshots[1][0].elapsedMs, 12);
  assert.equal(rows[1].elapsedMs, 20);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows.length, 2);
});

test('merge tier requires explicit base and paired integration provenance', async () => {
  const { parseCompletionArgs } = await import('../scripts/verification-tiers.mjs');
  assert.equal(parseCompletionArgs('merge', ['--base', 'HEAD~1']).base, 'HEAD~1');
  assert.throws(() => parseCompletionArgs('merge', []), /Usage/);
  assert.throws(
    () => parseCompletionArgs('merge', ['--base', 'HEAD', '--incoming', 'HEAD']),
    /Usage/,
  );
  const args = parseCompletionArgs('merge', [
    '--base',
    'abc',
    '--incoming',
    'def',
    '--destination',
    'ghi',
  ]);
  assert.equal(args.incoming, 'def');
  assert.equal(args.destination, 'ghi');
});
