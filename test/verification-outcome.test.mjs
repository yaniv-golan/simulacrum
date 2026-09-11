import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationOutcome } from '../scripts/verification-outcome.mjs';
const result = (
  bars = [
    { id: 'F1', human: true, state: 'RED', assessment: 'pending', why: 'no recorded assessment' },
  ],
) => [
  { id: 'ci', ok: true },
  { id: 'browser', ok: true },
  {
    id: 'gate',
    ok: bars.every((b) => b.state === 'GREEN'),
    result: { failed: 0, unmet: 0, dueBarCount: bars.length, bars },
  },
];
test('automation success remains separate from missing, failed and invalid human evidence', () => {
  for (const assessment of ['pending', 'failed', 'invalid']) {
    const rows = result();
    rows[2].result.bars[0].assessment = assessment;
    const out = verificationOutcome(rows, [{ id: 'test', ok: true }]);
    assert.equal(out.automation.status, 'PASS');
    assert.equal(out.humanAcceptance.status, assessment.toUpperCase());
    assert.equal(out.qualification.status, 'BLOCKED');
    assert.equal(out.exitCode, 2);
  }
});
test('engineering failures and incomplete gate data cannot masquerade as a human-only blocker', () => {
  for (const mutate of [
    (r) => (r[0].ok = false),
    (r) => (r[2].result.unmet = 1),
    (r) => (r[2].result.failed = 1),
    (r) => delete r[2].result.bars,
    (r) => {
      r[2].ok = true;
      r[2].result.bars[0].state = 'GREEN';
      delete r[2].result.bars[0].assessment;
    },
    (r) => r[2].result.bars.push({ id: 'D1', human: false, state: 'RED' }),
  ]) {
    const r = result();
    mutate(r);
    assert.notEqual(verificationOutcome(r, []).automation.status, 'PASS');
    assert.equal(verificationOutcome(r, []).exitCode, 1);
  }
  assert.equal(verificationOutcome(result(), [{ id: 'failed', ok: false }]).exitCode, 1);
  assert.equal(verificationOutcome([], []).exitCode, 1);
});
test('only complete automation and accepted human evidence qualify', () => {
  const out = verificationOutcome(
    result([{ id: 'F1', human: true, state: 'GREEN', assessment: 'passed' }]),
    [{ id: 'test', ok: true }],
  );
  assert.equal(out.humanAcceptance.status, 'PASS');
  assert.equal(out.qualification.status, 'PASS');
  assert.equal(out.exitCode, 0);
});

test('absent gate is not evaluated rather than an invented structural failure', () => {
  const out = verificationOutcome(
    [
      { id: 'ci', ok: true },
      { id: 'browser', ok: false },
    ],
    [],
  );
  assert.equal(out.exitCode, 1);
  assert.ok(!out.automation.failures.includes('structural checks'));
  assert.ok(!out.automation.failures.includes('milestone obligations'));
  assert.equal(out.phases.find((row) => row.id === 'gate').status, 'NOT_EVALUATED');
  assert.match(out.phases.find((row) => row.id === 'gate').reason, /browser/);
  for (const value of [undefined, -1, NaN, '0']) {
    const rows = result([]);
    rows[2].result.failed = value;
    assert.equal(verificationOutcome(rows, []).exitCode, 1);
  }
});
