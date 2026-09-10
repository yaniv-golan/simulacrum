import test from 'node:test';
import { automatic, tracking } from './contracts/suspension.mjs';

test('travel regulation tracks three targets with an authored aluminium arm', async () => {
  for (const rows of await automatic('aluminium')) tracking(rows);
});
