import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeafLedger } from '../scripts/verification-resume.mjs';
test('signed leaf results retain payload and reject tampering, drift and unregistered checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resume-test-'));
  try {
    const options = {
      directory: dir,
      key: Buffer.alloc(32, 7),
      identity: { source: 'same' },
      eligible: ['unit:test/pure.test.mjs'],
    };
    const a = createLeafLedger(options);
    a.save('unit:test/pure.test.mjs', { args: ['--test'] }, { code: 0, stdout: 'proof' }, 12);
    const b = createLeafLedger(options);
    assert.equal(b.load('unit:test/pure.test.mjs', { args: ['--test'] }).value.stdout, 'proof');
    assert.equal(b.load('unit:test/pure.test.mjs', { args: ['different'] }), null);
    assert.equal(
      createLeafLedger({ ...options, identity: { source: 'changed' } }).load(
        'unit:test/pure.test.mjs',
        { args: ['--test'] },
      ),
      null,
    );
    assert.equal(b.load('ci:budget', {}), null);
    const p = a.path('unit:test/pure.test.mjs');
    const x = JSON.parse(readFileSync(p));
    x.payload.value.stdout = 'forged';
    writeFileSync(p, JSON.stringify(x));
    assert.throws(() => b.load('unit:test/pure.test.mjs', { args: ['--test'] }), /integrity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run reconstructs a signed result without reexecuting the leaf and preserves failures', async () => {
  const { createVerificationRun } = await import('../scripts/verification-run.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'resume-run-'));
  try {
    const identity = { source: 'fixed' },
      key = Buffer.alloc(32, 4),
      eligible = ['unit:test/pure.test.mjs'];
    const ledger = createLeafLedger({ directory: dir, key, identity, eligible });
    let calls = 0;
    const first = createVerificationRun({ readIdentity: () => identity, writeLedger: ledger });
    await first.check(eligible[0], {}, () => {
      calls++;
      return { code: 0, stdout: 'retained' };
    });
    const second = createVerificationRun({ readIdentity: () => identity, resumeLedger: ledger });
    assert.equal(
      (await second.check(eligible[0], {}, () => assert.fail('reexecuted'))).stdout,
      'retained',
    );
    assert.equal(second.receipts()[0].resumed, true);
    await assert.rejects(
      second.check('failed', {}, () => {
        throw Error('original failure');
      }),
      /original failure/,
    );
    assert.equal(second.receipts().find((r) => r.id === 'failed').ok, false);
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
