import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRejection, recovered } from './contracts/suspension.mjs';

test('automatic suspension rejects reversed sensing and disconnected regulation during load changes', async () => {
  for (const variant of ['reversed', 'disconnected']) {
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
