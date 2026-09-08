import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerificationPhases, localOutcome } from '../scripts/verification-tiers.mjs';
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
