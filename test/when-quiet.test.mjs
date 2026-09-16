import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWhenQuietArgs,
  pollUntilQuiet,
  sampleKind,
  MAX_TRANSITIONS,
} from '../scripts/when-quiet.mjs';

test('--when-quiet is parsed beside the tier arguments and validated', () => {
  const parsed = parseWhenQuietArgs(['merge', '--base', 'abc', '--when-quiet', '60000']);
  assert.deepEqual(parsed, { rest: ['merge', '--base', 'abc'], whenQuiet: 60000 });
  assert.deepEqual(parseWhenQuietArgs(['local']), { rest: ['local'], whenQuiet: null });
  assert.deepEqual(
    parseWhenQuietArgs(['resume', 'r.json', '--when-quiet', '1000']).whenQuiet,
    1000,
  );
  for (const bad of [
    ['local', '--when-quiet'],
    ['local', '--when-quiet', '0'],
    ['local', '--when-quiet', 'soon'],
    ['local', '--when-quiet', '-5'],
    ['local', '--when-quiet', '5', '--when-quiet', '5'],
  ])
    assert.throws(() => parseWhenQuietArgs(bad), /--when-quiet/);
  // Syntax only: the parser passes a citation through untouched; verify-candidate refuses the
  // flag beside `--satisfied-by` in its own argument order (the E2E control covers it).
  assert.deepEqual(
    parseWhenQuietArgs(['merge', '--base', 'a', '--satisfied-by', '/r', '--when-quiet', '5']),
    { rest: ['merge', '--base', 'a', '--satisfied-by', '/r'], whenQuiet: 5 },
  );
});

// A scripted host: each call to admit() and windowState() returns the next scripted value.
function scripted(admissions, windows, { step = 5000, jumps = {} } = {}) {
  let clock = 1_000_000,
    calls = 0;
  const admitCalls = [];
  return {
    now: () => clock,
    sleep: async () => {
      clock += step + (jumps[calls] ?? 0);
      calls++;
    },
    admit: async (options) => {
      admitCalls.push(options);
      const next = admissions.shift();
      return typeof next === 'function' ? next() : next;
    },
    windowState: () => windows.shift() ?? { state: 'free' },
    admitCalls,
  };
}
const refused = (reason) => ({ ok: false, notEvaluated: true, reason, admission: { load1: 9 } });
const admitted = { ok: true, admission: { load1: 2 } };

test('the poller admits on the first sample the launch admission would admit, with a free window', async () => {
  const host = scripted(
    [refused('host load 9 above bound 7'), refused('host load 8 above bound 7'), admitted],
    [],
    {},
  );
  const result = await pollUntilQuiet({ maxWaitMs: 60000, reach: 'timing', ...host });
  assert.equal(result.admitted, true);
  assert.equal(result.waitedMs, 10000);
  assert.equal(result.samples.count, 3);
  assert.equal(result.samples.first.reason, 'host load 9 above bound 7');
  assert.equal(result.samples.last.admitted, true);
  // Transitions only: the two refusals differ only in the load they measured (one class), then
  // the admission.
  assert.deepEqual(
    result.samples.transitions.map((s) => s.admitted),
    [false, true],
  );
  assert.deepEqual(
    result.samples.transitions.map((s) => s.kind),
    ['refused: host load # above bound #', 'admitted'],
  );
  assert.equal(result.windowOwner, null);
  // Parity: the same launch admission, with no in-admission wait and the caller's reach.
  assert.ok(host.admitCalls.every((c) => c.reach === 'timing' && c.waitMs === 0));
});

test('the poller expires with the last refusal, never admits while the window is owned, and fails fast on an abandoned owner', async () => {
  const expired = await pollUntilQuiet({
    maxWaitMs: 12000,
    reach: 'structural',
    ...scripted([refused('r1'), refused('r2'), refused('r3'), refused('r4')], []),
  });
  assert.equal(expired.admitted, false);
  // Samples at 0, 5, 10 and 15 s: the last one, taken past the budget, is the recorded reason.
  assert.equal(expired.reason, 'r4');
  assert.ok(expired.waitedMs >= 12000);
  assert.equal(expired.samples.count, 4);
  // Repeated identical refusals collapse into one transition.
  const same = await pollUntilQuiet({
    maxWaitMs: 12000,
    reach: 'structural',
    ...scripted([refused('same'), refused('same'), refused('same'), refused('same')], []),
  });
  assert.equal(same.samples.transitions.length, 1);
  assert.equal(same.samples.count, 4);
  // An owned window holds the poll even when the host is quiet; the owner is recorded.
  const owner = { pid: 4242, cwd: '/w', intent: { tier: 'merge', head: 'x', destination: 'main' } };
  const held = await pollUntilQuiet({
    maxWaitMs: 12000,
    reach: 'structural',
    ...scripted(
      [admitted, admitted, admitted, admitted],
      [{ state: 'owned', owner }, { state: 'owned', owner }, { state: 'free' }],
    ),
  });
  assert.equal(held.admitted, true);
  assert.equal(held.waitedMs, 10000);
  assert.deepEqual(held.windowOwners, [{ atMs: 0, pid: 4242, cwd: '/w', intent: owner.intent }]);
  // A dead-pid owner file needs explicit recovery: the poll fails fast rather than capturing
  // into a tier that will refuse.
  await assert.rejects(
    () =>
      pollUntilQuiet({
        maxWaitMs: 12000,
        reach: 'structural',
        ...scripted([admitted], [{ state: 'abandoned', owner: { pid: 1, token: 't' } }]),
      }),
    /abandoned verification window needs explicit recovery/,
  );
});

test('a clock jump is recorded as a host-slept sample and not counted as waiting', async () => {
  const host = scripted([refused('r'), refused('r'), admitted], [], { jumps: { 1: 3_600_000 } });
  const result = await pollUntilQuiet({
    maxWaitMs: 20000,
    reach: 'timing',
    sleepGapMs: 60000,
    ...host,
  });
  assert.equal(result.admitted, true);
  // Two 5 s intervals counted; the hour-long gap is named, not waited.
  assert.equal(result.waitedMs, 10000);
  assert.equal(result.samples.transitions.filter((s) => s.hostSlept).length, 1);
  assert.equal(result.hostSleptMs, 3_600_000);
});

test('transitions are keyed on the sample class, never on the live numbers, and are capped', async () => {
  // Every refused sample of an 8 h wait carries fresh numbers; keyed on text the record would
  // hold every one of them.
  const loads = [5.23, 6.1, 7.9, 5.01].map((load) =>
    refused(
      `host load ${load} above bound 7 after 0 ms; host pressure: WindowServer ${load * 7} % (foreign ≥ 40 %)`,
    ),
  );
  const owner = { pid: 77, cwd: '/w', intent: { tier: 'local' } };
  const varied = await pollUntilQuiet({
    maxWaitMs: 40000,
    reach: 'timing',
    ...scripted(
      [...loads, admitted],
      [{}, {}, {}, {}, { state: 'owned', owner }, { state: 'free' }],
    ),
  });
  assert.equal(varied.admitted, true);
  assert.equal(varied.samples.count, 6);
  assert.deepEqual(
    varied.samples.transitions.map((s) => s.kind),
    [
      'refused: host load # above bound # after # ms; host pressure: WindowServer # % (foreign ≥ # %)',
      'window-owned',
      'admitted',
    ],
  );
  assert.equal(varied.samples.transitionsDropped, 0);
  assert.equal(sampleKind({ admitted: false, hostSlept: true, windowOwner: null }), 'host-slept');
  // A genuinely changing class (a different loud process each sample) is still bounded.
  const churn = Array.from({ length: MAX_TRANSITIONS + 6 }, (_, i) =>
    refused(i % 2 ? 'host pressure: WindowServer' : 'host pressure: mdworker'),
  );
  const capped = await pollUntilQuiet({
    maxWaitMs: (MAX_TRANSITIONS + 10) * 5000,
    reach: 'timing',
    ...scripted([...churn, admitted], []),
  });
  assert.equal(capped.admitted, true);
  assert.equal(capped.samples.count, MAX_TRANSITIONS + 7);
  assert.equal(capped.samples.transitions.length, MAX_TRANSITIONS);
  assert.equal(capped.samples.transitionsDropped, 7);
  assert.equal(capped.samples.last.admitted, true);
});

test('the default sleep follows intervalMs', async () => {
  // A 1 ms interval with the default sleep: the poll neither waits the 5 s default nor spins.
  const startedAt = Date.now();
  const admissions = [refused('r'), admitted];
  const result = await pollUntilQuiet({
    maxWaitMs: 10000,
    reach: 'structural',
    intervalMs: 1,
    admit: async () => admissions.shift(),
    windowState: () => ({ state: 'free' }),
  });
  assert.equal(result.admitted, true);
  assert.equal(result.samples.count, 2);
  assert.ok(Date.now() - startedAt < 2000, 'slept the interval, not the default 5 s');
});
