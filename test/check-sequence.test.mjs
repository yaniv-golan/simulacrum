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

test('bounded browser workers overlap only admitted checks and drain before exclusive work', async () => {
  let active = 0,
    peak = 0;
  const seen = [];
  const checks = [
    { id: 'a', execution: 'parallel' },
    { id: 'b', execution: 'parallel' },
    { id: 'exclusive', execution: 'exclusive' },
    { id: 'c', execution: 'parallel' },
    { id: 'unknown' },
  ];
  const rows = await runCheckSequence(
    checks,
    async (c) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(c.id);
      if (c.execution !== 'parallel') assert.equal(active, 1);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      if (c.id === 'b') throw Error('wrong trace');
    },
    () => {},
    { workers: 2 },
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(
    rows.map((x) => x.id),
    checks.map((x) => x.id),
  );
  assert.deepEqual(
    rows.map((x) => x.ok),
    [true, false, true, true, true],
  );
  await assert.rejects(
    runCheckSequence(
      [],
      () => {},
      () => {},
      { workers: 3 },
    ),
    /workers/,
  );
});

test('identity failure drains already-running checks and never launches the next batch', async () => {
  const done = [];
  await assert.rejects(
    runCheckSequence(
      [
        { id: 'a', execution: 'parallel' },
        { id: 'b', execution: 'parallel' },
        { id: 'c', execution: 'parallel' },
      ],
      async (c) => {
        await new Promise((r) => setTimeout(r, c.id === 'a' ? 2 : 15));
        done.push(c.id);
      },
      () => {
        throw Error('identity changed');
      },
      { workers: 2 },
    ),
    /identity changed/,
  );
  assert.deepEqual(done.sort(), ['a', 'b']);
});

test('a free worker starts the next admitted check before its slow peer completes', async () => {
  let release;
  const slow = new Promise((r) => {
    release = r;
  });
  let third = false;
  const running = runCheckSequence(
    ['a', 'b', 'c'].map((id) => ({ id, execution: 'parallel' })),
    async ({ id }) => {
      if (id === 'a') await slow;
      if (id === 'c') third = true;
    },
    () => {},
    { workers: 2 },
  );
  await new Promise(setImmediate);
  const progressed = third;
  release();
  await running;
  assert.equal(progressed, true);
});
