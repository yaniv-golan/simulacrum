import test from 'node:test';
import assert from 'node:assert/strict';
import { readBounded, admission } from '../scripts/playtest/protocol.mjs';
test('reader enforces actual bytes and cancels a stalled stream before another admission', async () => {
  let cancelled = false;
  await assert.rejects(
    readBounded(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      20,
      { idleMs: 5, totalMs: 30 },
    ),
    (e) => e.status === 408,
  );
  assert.equal(cancelled, true);
  await assert.rejects(readBounded(new Blob(['too large']).stream(), 2), (e) => e.status === 413);
  assert.equal(new TextDecoder().decode(await readBounded(new Blob(['ok']).stream(), 2)), 'ok');
  const gate = admission(2, 20),
    a = gate.acquire(10),
    b = gate.acquire(10);
  assert.throws(
    () => gate.acquire(1),
    (e) => e.status === 429,
  );
  a();
  a();
  assert.deepEqual(gate.status(), { count: 1, bytes: 10 });
  b();
  assert.deepEqual(gate.status(), { count: 0, bytes: 0 });
});
