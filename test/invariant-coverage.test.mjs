import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvariantCoverage, explainInvariant } from '../scripts/invariant-coverage.mjs';
const fixture = () => ({
  milestone: 'M3b',
  milestones: ['M0', 'M3b', 'M5'],
  rules: [{ id: 'runtime' }],
  bars: { L0: { dueAt: 'M5', human: false } },
  checks: [{ id: 'unit', ruleId: 'runtime' }],
  exitObligations: {},
  browserChecks: [],
  invariants: [
    {
      id: 'atomic',
      ruleId: 'runtime',
      dueAt: 'M3b',
      guarantee: 'Rejected edits preserve state',
      owners: [{ path: 'src/owner.mjs', anchor: 'commit' }],
      checks: ['unit'],
      controls: {
        positive: [{ path: 'test/owner.test.mjs', anchor: 'accepted edit' }],
        negative: [{ path: 'test/owner.test.mjs', anchor: 'rejected edit' }],
      },
      qualificationBars: ['L0'],
    },
  ],
});
const files = {
  'src/owner.mjs': 'function commit() {}',
  'test/owner.test.mjs': 'accepted edit\nrejected edit',
};
const read = (path) => {
  if (!(path in files)) throw Error('missing');
  return files[path];
};
test('coverage validates real pointers and distinguishes checks from deferred qualification', () => {
  const m = fixture();
  assert.doesNotThrow(() => validateInvariantCoverage(m, { read }));
  const e = explainInvariant(m, 'atomic');
  assert.equal(e.enforcement, 'REGISTERED_CHECKS_NOT_EXECUTION_EVIDENCE');
  assert.equal(e.qualification[0].status, 'DEFERRED');
  assert.equal(e.mechanisms[0].id, 'unit');
  assert.throws(() => explainInvariant(m, 'missing'), /unknown invariant/);
});
test('dangling owner, missing negative control and unknown check cannot masquerade as coverage', () => {
  const edits = [
    (m) => (m.invariants[0].owners[0].path = 'src/missing.mjs'),
    (m) => (m.invariants[0].owners[0].anchor = 'absent'),
    (m) => (m.invariants[0].controls.negative = []),
    (m) => (m.invariants[0].checks = ['invented']),
    (m) => (m.invariants[0].ruleId = 'invented'),
    (m) => (m.invariants[0].qualificationBars = ['invented']),
    (m) => m.invariants.push(structuredClone(m.invariants[0])),
    (m) => (m.invariants[0].owners = []),
    (m) => delete m.invariants,
  ];
  for (const edit of edits) {
    const m = fixture();
    edit(m);
    assert.throws(() => validateInvariantCoverage(m, { read }));
  }
});

test('current guarantee cannot cite only a future check as its owner', () => {
  const m = fixture();
  m.checks[0].dueAt = 'M5';
  assert.throws(() => validateInvariantCoverage(m, { read }), /future check/);
});

test('runtime service invariants may name script owners but not private or escaping paths', () => {
  const m = fixture();
  m.invariants[0].owners[0].path = 'scripts/playtest/worker.mjs';
  const serviceRead = (path) =>
    path === 'scripts/playtest/worker.mjs' ? 'function commit() {}' : read(path);
  assert.doesNotThrow(() => validateInvariantCoverage(m, { read: serviceRead }));
  for (const path of ['scripts/../private.mjs', 'docs/internal/worker.mjs']) {
    m.invariants[0].owners[0].path = path;
    assert.throws(
      () => validateInvariantCoverage(m, { read: () => 'commit accepted edit rejected edit' }),
      /invalid pointer/,
    );
  }
});
