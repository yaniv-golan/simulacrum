import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRejection, recovered } from './contracts/suspension.mjs';

test('automatic suspension rejects an applied and removed laboratory load within two seconds for a three-second hold', async (t) => {
  for (const rows of await loadRejection()) {
    recovered(rows);
    t.diagnostic(
      `Automatic maximum error ${Math.max(...rows.map((r) => Math.abs(r.length - 0.3)))} m`,
    );
  }
  const manual = await loadRejection('manual-held');
  const held = manual[0][0].control.duty;
  for (const rows of manual) {
    recovered(rows);
    for (const row of rows) {
      assert.equal(row.control.mode, 'manual');
      assert.equal(row.control.duty, held);
    }
    t.diagnostic(
      `Held manual output ${held}: maximum error ${Math.max(...rows.map((r) => Math.abs(r.length - 0.3)))} m`,
    );
  }
  // The ordinary inner servo can also hold this modest load at fixed target.
});
