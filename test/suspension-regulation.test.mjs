import test from 'node:test';
import assert from 'node:assert/strict';
import { automatic, tracking } from './contracts/suspension.mjs';

test('travel regulation tracks three targets with a rubber arm and rejects disabled control', async () => {
  // 5 mm is 5% of tire radius and 7% of the useful 70 mm adjustment span.
  // The .26–.33 m interval leaves at least 16 mm inside the measured manual reach.
  for (const rows of await automatic('rubber')) tracking(rows);
  const disabled = await automatic('rubber', true);
  assert.throws(() => tracking(disabled[0]), /tracking error/);
  const wrong = structuredClone(disabled[0]);
  wrong[0].length = NaN;
  assert.throws(() => tracking(wrong));
});
