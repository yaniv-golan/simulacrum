import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiming } from '../scripts/verification-timing.mjs';
test('nested timing retains overlap and failed intervals without masking failures', async () => {
  let clock = 0;
  const reports = [];
  const t = createTiming({ now: () => clock, publish: () => reports.push(t.snapshot()) });
  await assert.rejects(
    t.measure('outer', async () => {
      clock = 3;
      await t.measure('inner', async () => {
        clock = 8;
      });
      clock = 10;
      throw Error('wrong');
    }),
    /wrong/,
  );
  assert.deepEqual(
    t.snapshot().map((r) => [r.name, r.startMs, r.elapsedMs, r.status]),
    [
      ['outer', 0, 10, 'failed'],
      ['inner', 3, 5, 'passed'],
    ],
  );
  assert.equal(reports[0][0].status, 'running');
});
test('reporting failure cannot prevent cleanup and still rejects missing evidence', async () => {
  const reportFailure = Error('timing artifact unavailable');
  let closed = false;
  const t = createTiming({
    publish() {
      throw reportFailure;
    },
  });
  await assert.rejects(
    t.measure('cleanup', async () => {
      closed = true;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [reportFailure, reportFailure]);
      return true;
    },
  );
  assert.equal(closed, true);
  assert.equal(t.snapshot()[0].status, 'passed');
});
test('operation error remains primary when timing publication also fails', async () => {
  const primary = Error('actual navigation failure');
  const secondary = Error('timing write failure');
  let publications = 0;
  const t = createTiming({
    publish() {
      if (++publications === 2) throw secondary;
    },
  });
  await assert.rejects(
    t.measure('navigation', () => {
      throw primary;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary, secondary]);
      assert.match(error.message, /actual navigation failure/);
      return true;
    },
  );
  assert.equal(t.snapshot()[0].status, 'failed');
});
