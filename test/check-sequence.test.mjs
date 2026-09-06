import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckSequence } from '../scripts/check-sequence.mjs';
test('a failed check does not hide later failures or positive controls', async () => {
  const seen = [],
    failure = Error('first check failed');
  const result = await runCheckSequence(
    [{ id: 'bad' }, { id: 'good' }, { id: 'also-bad' }],
    async ({ id }) => {
      seen.push(id);
      if (id !== 'good') throw failure;
      return 42;
    },
  );
  assert.deepEqual(seen, ['bad', 'good', 'also-bad']);
  assert.deepEqual(
    result.map((r) => r.ok),
    [false, true, false],
  );
  assert.equal(result[0].error, failure);
  assert.equal(result[1].value, 42);
});
test('source integrity failure aborts remaining checks even after a check fails', async () => {
  const seen = [];
  await assert.rejects(
    runCheckSequence(
      [{ id: 'first' }, { id: 'must-not-run' }],
      async ({ id }) => {
        seen.push(id);
        throw Error('check failure');
      },
      () => {
        throw Error('source changed');
      },
    ),
    /source changed/,
  );
  assert.deepEqual(seen, ['first']);
});
