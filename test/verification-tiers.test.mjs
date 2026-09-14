import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runVerificationPhases,
  localOutcome,
  launchAdmission,
  LAUNCH_ADMISSION_ID,
} from '../scripts/verification-tiers.mjs';
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

test('a phase that refused rows before running them records their ids on its row', async () => {
  const { runVerificationPhases } = await import('../scripts/verification-tiers.mjs');
  const refused = Object.assign(Error('Browser checks failed: perf, audio'), {
    notEvaluated: ['perf', 'audio'],
    failedChecks: [],
  });
  const rows = await runVerificationPhases(
    [
      ['ci', async () => ({ ok: true })],
      [
        'browser',
        async () => {
          throw refused;
        },
      ],
    ],
    { onProgress: () => {} },
  );
  const browser = rows.find((r) => r.id === 'browser');
  assert.equal(browser.status, 'failed');
  assert.deepEqual(browser.notEvaluated, ['perf', 'audio']);
  assert.equal(rows.find((r) => r.id === 'ci').notEvaluated, undefined);
  // A plain failure carries no list.
  const plain = await runVerificationPhases(
    [
      [
        'browser',
        async () => {
          throw Error('boom');
        },
      ],
    ],
    { onProgress: () => {} },
  );
  assert.equal(plain[0].notEvaluated, undefined);
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

test('launch admission runs before the CI phase, waits out a launch burst, and refuses as not evaluated', async () => {
  // The same rule as the timing phase, one short bound, sampler injected — never the live host.
  let admitted = false;
  const admit = async (options) => {
    assert.equal(options.waitMs, 60000);
    assert.equal(options.trendMs, 20000);
    assert.equal(typeof options.pressure, 'function');
    return admitted
      ? { admitted: true, load1: 2.1, waitedMs: 15000, samples: [9, 4, 2.1] }
      : {
          admitted: false,
          load1: 8.2,
          waitedMs: 60000,
          reason:
            'host pressure: GoogleUpdater 65 %, Microsoft AutoUpdate 41 % (foreign ≥ 40 %) after 60000 ms',
        };
  };
  const host = {
    cores: 14,
    load1: () => 8.2,
    pressure: async () => ({ method: 'cpus+ps', idlePercent: 70, foreign: [] }),
  };
  const refused = await launchAdmission({ admit, host });
  assert.deepEqual(
    { ok: refused.ok, notEvaluated: refused.notEvaluated, reason: refused.reason },
    {
      ok: false,
      notEvaluated: true,
      reason:
        'host pressure: GoogleUpdater 65 %, Microsoft AutoUpdate 41 % (foreign ≥ 40 %) after 60000 ms',
    },
  );
  // As the first phase: a refusal stops the tier before CI ran — a failed attempt whose only
  // row is the admission, and no completion claim.
  let ciRan = 0;
  const results = await runVerificationPhases([
    [LAUNCH_ADMISSION_ID, () => launchAdmission({ admit, host })],
    ['ci', async () => ++ciRan],
  ]);
  assert.equal(ciRan, 0);
  assert.deepEqual(
    results.map((row) => [row.id, row.status]),
    [[LAUNCH_ADMISSION_ID, 'failed']],
  );
  assert.equal(results[0].result.notEvaluated, true);
  assert.equal(localOutcome(results, []).automation.status, 'FAIL');
  // Admitted after a wait: the phase passes with the samples recorded and CI runs.
  admitted = true;
  const passed = await runVerificationPhases([
    [LAUNCH_ADMISSION_ID, () => launchAdmission({ admit, host })],
    ['ci', async () => ++ciRan],
  ]);
  assert.equal(ciRan, 1);
  assert.equal(passed[0].status, 'passed');
  assert.deepEqual(passed[0].result.admission.samples, [9, 4, 2.1]);
});
