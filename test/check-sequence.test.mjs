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
      { workers: 5 },
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

test('packing preserves coverage, priority prefix and exclusive order with bounded new groups', async () => {
  const { packParallelChecks } = await import('../scripts/check-sequence.mjs');
  const checks = Array.from({ length: 8 }, (_, i) => [
    { id: `e${i}` },
    { id: `p${i}`, execution: 'parallel' },
  ]).flat();
  const packed = packParallelChecks(checks, { workers: 2, priorityCount: 2 });
  assert.deepEqual(packed.slice(0, 2), checks.slice(0, 2));
  assert.deepEqual([...packed].map((c) => c.id).sort(), checks.map((c) => c.id).sort());
  assert.equal(new Set(packed).size, checks.length);
  assert.deepEqual(
    packed.filter((c) => c.execution !== 'parallel'),
    checks.filter((c) => c.execution !== 'parallel'),
  );
  assert.deepEqual(packParallelChecks(checks, { workers: 1, priorityCount: 2 }), checks);
  let consecutive = 0;
  for (const c of packed.slice(2)) {
    consecutive = c.execution === 'parallel' ? consecutive + 1 : 0;
    assert.ok(consecutive <= 4);
  }
  assert.deepEqual(
    packed.slice(2, 7).map((c) => c.id),
    ['p1', 'p2', 'p3', 'p4', 'e1'],
  );
  assert.throws(() => packParallelChecks(checks, { workers: 5 }), /workers/);
  assert.throws(() => packParallelChecks(checks, { priorityCount: checks.length + 1 }), /priority/);
});

test('packed isolated checks reduce fake wall time while exclusive work remains alone', async () => {
  const { packParallelChecks } = await import('../scripts/check-sequence.mjs');
  const checks = Array.from({ length: 4 }, (_, i) => [
    { id: `e${i}` },
    { id: `p${i}`, execution: 'parallel' },
  ]).flat();
  async function measure(order) {
    let clock = 0,
      done = false,
      failure;
    const pending = [];
    const running = runCheckSequence(
      order,
      (c) =>
        new Promise((resolve) => {
          if (c.execution !== 'parallel') assert.equal(pending.length, 0);
          else assert.ok(!pending.some((p) => p.check.execution !== 'parallel'));
          pending.push({ at: clock + 10, resolve, check: c });
        }),
      () => {},
      { workers: 2 },
    ).then(
      () => {
        done = true;
      },
      (e) => {
        failure = e;
        done = true;
      },
    );
    while (!done) {
      await new Promise(setImmediate);
      if (!pending.length) continue;
      clock = Math.min(...pending.map((p) => p.at));
      for (const p of pending.filter((p) => p.at === clock)) {
        pending.splice(pending.indexOf(p), 1);
        p.resolve();
      }
    }
    await running;
    if (failure) throw failure;
    return clock;
  }
  assert.equal(await measure(checks), 80);
  assert.equal(await measure(packParallelChecks(checks, { workers: 2 })), 60);
});

test('packing never splits an existing long parallel batch', async () => {
  const { packParallelChecks } = await import('../scripts/check-sequence.mjs');
  const checks = [100, 1, 1, 1, 1, 1, 1, 100].map((duration, i) => ({
    id: `p${i}`,
    execution: 'parallel',
    duration,
  }));
  checks.push({ id: 'exclusive', duration: 1 });
  const packed = packParallelChecks(checks, { workers: 2 });
  function fakeDuration(order) {
    let wall = 0,
      batch = [];
    function drain() {
      let lanes = [0, 0];
      for (const c of batch) {
        const lane = lanes[0] <= lanes[1] ? 0 : 1;
        lanes[lane] += c.duration;
      }
      wall += Math.max(...lanes);
      batch = [];
    }
    for (const c of order) {
      if (c.execution === 'parallel') batch.push(c);
      else {
        drain();
        wall += c.duration;
      }
    }
    drain();
    return wall;
  }
  assert.equal(fakeDuration(checks), 107);
  assert.equal(fakeDuration(packed), 107);
  assert.deepEqual(packed, checks);
});

test('probe fail-fast drains started peers and reports every unstarted obligation', async () => {
  const seen = [];
  const rows = await runCheckSequence(
    ['bad', 'peer', 'later', 'exclusive'].map((id) => ({
      id,
      execution: id === 'exclusive' ? 'exclusive' : 'parallel',
    })),
    async ({ id }) => {
      seen.push(id);
      if (id === 'bad') throw Error('wrong trace');
      await new Promise(setImmediate);
    },
    () => {},
    { workers: 2, failFast: true },
  );
  assert.deepEqual(seen, ['bad', 'peer']);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[1].ok, true);
  assert.deepEqual(
    rows.slice(2).map((row) => row.status),
    ['not evaluated', 'not evaluated'],
  );
});

test('duration hints balance each parallel run without crossing priority or exclusive barriers', async () => {
  const { balanceParallelChecks } = await import('../scripts/check-sequence.mjs');
  const checks = ['priority', 'short', 'long', 'exclusive', 'tail'].map((id) => ({
    id,
    execution: id === 'exclusive' ? 'exclusive' : 'parallel',
  }));
  assert.deepEqual(
    balanceParallelChecks(checks, { short: 1, long: 100, priority: 0, tail: 200 }, 1).map(
      (c) => c.id,
    ),
    ['priority', 'long', 'short', 'exclusive', 'tail'],
  );
  assert.deepEqual(balanceParallelChecks(checks, {}), checks);
});

test('four workers drain before exclusive work', async () => {
  let active = 0,
    peak = 0;
  await runCheckSequence(
    [
      ...Array.from({ length: 5 }, (_, i) => ({ id: String(i), execution: 'parallel' })),
      { id: 'barrier' },
    ],
    async (c) => {
      active++;
      peak = Math.max(peak, active);
      if (c.id === 'barrier') assert.equal(active, 1);
      await new Promise(setImmediate);
      active--;
    },
    () => {},
    { workers: 4 },
  );
  assert.equal(peak, 4);
});
