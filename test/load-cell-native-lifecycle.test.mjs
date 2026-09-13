import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('reused native joint slots cannot leak the prior generation load-cell reaction', () => {
  const report = JSON.parse(
    execFileSync(
      process.execPath,
      [
        new URL('../vendor/rapier-contact/test-joint-reaction-lifecycle.mjs', import.meta.url)
          .pathname,
      ],
      { encoding: 'utf8', timeout: 15000 },
    ),
  );
  assert.deepEqual(report, {
    cycles: 4,
    reusedSlots: 4,
    oldGenerationRejected: true,
    staleReceiptControlsRejected: true,
  });
});
