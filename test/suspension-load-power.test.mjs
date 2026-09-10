import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRejection, recovered } from './contracts/suspension.mjs';

test('automatic suspension rejects depleted and current-limited power during load changes', async () => {
  for (const variant of ['depleted', 'saturated']) {
    await assert.rejects(
      async () => {
        const rows = await loadRejection(variant);
        rows.forEach(recovered);
      },
      /load recovery|sustained support|carries load|no travel stop/,
      `${variant} must fail physical tracking`,
    );
  }
});
