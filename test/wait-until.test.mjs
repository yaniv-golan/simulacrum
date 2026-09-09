import test from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil } from '../scripts/wait-until.mjs';
test('observable waits tolerate delayed completion and fail with a named deadline', async () => {
  let ready = false;
  setTimeout(() => (ready = true), 30);
  await waitUntil(() => ready, 'delayed transaction', { timeoutMs: 500 });
  await assert.rejects(
    waitUntil(() => false, 'storage close', { timeoutMs: 10 }),
    /storage close.*10/,
  );
  await assert.rejects(
    waitUntil(() => {
      throw Error('broken observation');
    }, 'observation'),
    /broken observation/,
  );
});
