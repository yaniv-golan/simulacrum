import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runVerificationPhases,
  localOutcome,
  launchAdmission,
  selectionReach,
  assertSelectionReach,
  LAUNCH_ADMISSION_ID,
  launchWaitMs,
  LAUNCH_WAIT_VARIABLE,
  FINAL_PHASES,
} from '../scripts/verification-tiers.mjs';

// A release prepare waits five minutes for a quiet host where a routine tier waits one; only
// the wait lengthens, the budget is recorded on the row, and a malformed budget fails the
// attempt by name rather than defaulting or reading as host pressure. The refusal is printed
// where the operator looks, offenders included.
test('launch admission takes its wait budget from the environment within bounds, records it and prints a refusal', async () => {
  assert.equal(launchWaitMs({}), 60000);
  assert.equal(launchWaitMs({ [LAUNCH_WAIT_VARIABLE]: '' }), 60000);
  assert.equal(launchWaitMs({ [LAUNCH_WAIT_VARIABLE]: '300000' }), 300000);
  for (const raw of ['59999', '600001', 'abc', '3e5', '-60000', '60000.5'])
    assert.throws(
      () => launchWaitMs({ [LAUNCH_WAIT_VARIABLE]: raw }),
      new RegExp(
        `${LAUNCH_WAIT_VARIABLE} must be an integer between 60000 and 600000 milliseconds, got "${raw}"`,
      ),
    );
  const seen = [];
  const admit = async (options) => {
    seen.push(options.waitMs);
    return {
      admitted: false,
      load1: 3,
      waitedMs: options.waitMs,
      samples: [3],
      pressure: {
        foreign: [
          { comm: 'WindowServer', pcpu: 48, pid: 400 },
          { comm: 'Google Chrome Helper', pcpu: 35, pid: 9 },
        ],
      },
      reason: 'host pressure: WindowServer 48 % (foreign ≥ 40 %) after 300000 ms',
    };
  };
  const host = {
    cores: 14,
    load1: () => 3,
    pressure: async () => ({ method: 'cpus+ps', foreign: [] }),
  };
  const refused = await launchAdmission({ reach: 'timing', admit, host, waitMs: 300000 });
  assert.deepEqual(seen, [300000]);
  assert.equal(refused.policy.budgetMs, 300000);
  const printed = [];
  const rows = await runVerificationPhases(
    [
      [
        LAUNCH_ADMISSION_ID,
        () => launchAdmission({ reach: 'timing', admit, host, waitMs: 300000 }),
      ],
      ['ci', async () => 'never'],
    ],
    { log: (line) => printed.push(line) },
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(printed, [
    'launch admission refused after 300 s: host pressure: WindowServer 48 % (foreign ≥ 40 %) after 300000 ms; busiest foreign processes: WindowServer 48 %, Google Chrome Helper 35 %',
  ]);
  // The default budget is read from the environment when the phase runs: a malformed value is
  // the phase's error, not a refusal, so a retry never reads it as pressure.
  const previous = process.env[LAUNCH_WAIT_VARIABLE];
  process.env[LAUNCH_WAIT_VARIABLE] = 'abc';
  try {
    let ciRan = 0;
    const failed = await runVerificationPhases(
      [
        [LAUNCH_ADMISSION_ID, () => launchAdmission({ reach: 'structural', admit, host })],
        ['ci', async () => ++ciRan],
      ],
      { log: () => {} },
    );
    assert.equal(ciRan, 0);
    assert.equal(failed[0].status, 'failed');
    assert.equal(failed[0].notEvaluated, undefined);
    assert.match(failed[0].error, new RegExp(`${LAUNCH_WAIT_VARIABLE} must be an integer`));
  } finally {
    if (previous === undefined) delete process.env[LAUNCH_WAIT_VARIABLE];
    else process.env[LAUNCH_WAIT_VARIABLE] = previous;
  }
  // The qualification phase list is one shared value, admission first.
  assert.deepEqual([...FINAL_PHASES], [LAUNCH_ADMISSION_ID, 'ci', 'browser', 'gate']);
  assert.ok(Object.isFrozen(FINAL_PHASES));
});
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
  const refused = await launchAdmission({ reach: 'timing', admit, host });
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
    [LAUNCH_ADMISSION_ID, () => launchAdmission({ reach: 'timing', admit, host })],
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
    [LAUNCH_ADMISSION_ID, () => launchAdmission({ reach: 'timing', admit, host })],
    ['ci', async () => ++ciRan],
  ]);
  assert.equal(ciRan, 1);
  assert.equal(passed[0].status, 'passed');
  assert.deepEqual(passed[0].result.admission.samples, [9, 4, 2.1]);
});

test('launch admission applies the foreign-process bound only to a tier that will reach a timing phase', async () => {
  // The real admission over an injected sampler: a window server drawing at 52 % of one core
  // beside 86 % idle. A structural tier is admitted on load and idle (the rows it saw stay in
  // the record); a timing tier is refused by name. Neither reach relaxes idle or load.
  const { admitQuietHost } = await import('../scripts/check-sequence.mjs');
  const drawing = {
    method: 'cpus+ps',
    idlePercent: 86,
    foreign: [{ comm: 'WindowServer', pcpu: 52 }],
  };
  const run = (reach, sample = drawing, load = 3) =>
    launchAdmission({
      reach,
      admit: (options) =>
        admitQuietHost({
          ...options,
          bound: 7,
          pollMs: 5000,
          sleep: async () => {},
          now: (() => {
            let t = 0;
            return () => (t += 5000);
          })(),
        }),
      host: { cores: 14, load1: () => load, pressure: async () => sample },
      policy: { mode: 'enforce', idleBound: 80, foreignBound: 40 },
    });
  const structural = await run('structural');
  assert.equal(structural.ok, true);
  assert.deepEqual(structural.policy, {
    reach: 'structural',
    mode: 'enforce',
    bounds: { idle: 80, foreign: null },
    budgetMs: 60000,
  });
  assert.deepEqual(structural.admission.pressure.foreign, [{ comm: 'WindowServer', pcpu: 52 }]);
  assert.equal(JSON.parse(JSON.stringify(structural)).policy.bounds.foreign, null);
  const timing = await run('timing');
  assert.equal(timing.ok, false);
  assert.equal(timing.notEvaluated, true);
  assert.match(timing.reason, /host pressure: WindowServer 52 % \(foreign ≥ 40 %\)/);
  assert.deepEqual(timing.policy, {
    reach: 'timing',
    mode: 'enforce',
    bounds: { idle: 80, foreign: 40 },
    budgetMs: 60000,
  });
  // Controls: the structural policy still refuses a dim host and a loaded one.
  const dim = await run('structural', { ...drawing, idlePercent: 61 });
  assert.equal(dim.ok, false);
  assert.match(dim.reason, /idle 61 % \(< 80 %\)/);
  assert.doesNotMatch(dim.reason, /WindowServer/, 'no foreign bound at all, not a lenient one');
  const loaded = await run('structural', { method: 'cpus+ps', idlePercent: 90, foreign: [] }, 10);
  assert.equal(loaded.ok, false);
  assert.match(loaded.reason, /host load 10 above bound 7/);
  // No silent default: a tier must say what it reaches.
  await assert.rejects(() => launchAdmission({ admit: async () => ({ admitted: true }) }), {
    message: /launch admission needs the tier's reach \(timing\|structural\), got undefined/,
  });
  await assert.rejects(() => run('all'), { message: /got all/ });
});

test('a selection reaches a timing phase when any selected row is a timing budget; the selection phase refuses a reach that moved after launch', () => {
  assert.equal(selectionReach({ checks: [{ id: 'a' }, { id: 'b' }] }), 'structural');
  assert.equal(selectionReach({ checks: [] }), 'structural');
  assert.equal(selectionReach(undefined), 'structural');
  assert.equal(
    selectionReach({ checks: [{ id: 'a' }, { id: 'measure-gears', timingSensitive: true }] }),
    'timing',
  );
  const timed = { checks: [{ id: 'q', timingSensitive: true }] };
  assert.equal(assertSelectionReach(timed, 'timing'), 'timing');
  assert.throws(() => assertSelectionReach(timed, 'structural'), {
    message:
      'selection reach changed after launch admission: admitted as structural, selection reaches timing',
  });
  assert.throws(() => assertSelectionReach({ checks: [] }, 'timing'), {
    message: /admitted as timing, selection reaches structural/,
  });
});
