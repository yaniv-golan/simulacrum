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

test('receipts record their origin attempt, carry it through resumed saves and expire by chain depth', async () => {
  const { createVerificationRun } = await import('../scripts/verification-run.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'resume-origin-'));
  try {
    const identity = { source: 'fixed' },
      key = Buffer.alloc(32, 5),
      id = 'browser:mirror';
    const first = createLeafLedger({
      directory: join(dir, 'a'),
      key,
      identity,
      eligible: [],
      saveEligible: null,
      origin: { attempt: 'attempt-a', report: '/a/report.json' },
    });
    // Every passing leaf is saved when saving is unrestricted, even outside the resume list.
    await createVerificationRun({ readIdentity: () => identity, writeLedger: first }).check(
      id,
      { script: 'x' },
      () => ({ code: 0, output: 'first' }),
    );
    const loaded = createLeafLedger({
      directory: join(dir, 'a'),
      key,
      identity,
      eligible: [id],
    }).load(id, { script: 'x' });
    assert.deepEqual(loaded.origin, { attempt: 'attempt-a', report: '/a/report.json', depth: 0 });
    // A plain resume ledger still ignores the browser leaf.
    assert.equal(
      createLeafLedger({ directory: join(dir, 'a'), key, identity, eligible: ['unit:x'] }).load(
        id,
        {
          script: 'x',
        },
      ),
      null,
    );
    // Resumed saves keep the original origin and count depth.
    const second = createLeafLedger({
      directory: join(dir, 'b'),
      key,
      identity,
      eligible: [id],
      saveEligible: null,
      origin: { attempt: 'attempt-b', report: '/b/report.json' },
    });
    const run = createVerificationRun({
      readIdentity: () => identity,
      resumeLedger: createLeafLedger({ directory: join(dir, 'a'), key, identity, eligible: [id] }),
      writeLedger: second,
    });
    assert.equal(
      (await run.check(id, { script: 'x' }, () => assert.fail('reexecuted'))).output,
      'first',
    );
    assert.deepEqual(run.receipts()[0].origin, {
      attempt: 'attempt-a',
      report: '/a/report.json',
      depth: 1,
    });
    const chained = createLeafLedger({
      directory: join(dir, 'b'),
      key,
      identity,
      eligible: [id],
    }).load(id, {
      script: 'x',
    });
    assert.equal(chained.origin.attempt, 'attempt-a');
    assert.equal(chained.origin.depth, 1);
    // Beyond the chain depth limit the receipt is not offered.
    const { CHAIN_DEPTH_LIMIT } = await import('../scripts/candidate-after.mjs');
    const stale = createLeafLedger({
      directory: join(dir, 'c'),
      key,
      identity,
      eligible: [id],
      saveEligible: null,
      origin: { attempt: 'attempt-c', report: '/c/report.json' },
    });
    stale.save(id, { script: 'x' }, { code: 0, output: 'old' }, 1, {
      attempt: 'attempt-0',
      report: '/0/report.json',
      depth: CHAIN_DEPTH_LIMIT,
    });
    assert.equal(
      createLeafLedger({ directory: join(dir, 'c'), key, identity, eligible: [id] }).load(id, {
        script: 'x',
      }),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unrestricted save policy is a predicate: non-process, aggregate and timing-sensitive leaves are never saved', async () => {
  const { createVerificationRun } = await import('../scripts/verification-run.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'resume-policy-'));
  try {
    const identity = { source: 'fixed' },
      key = Buffer.alloc(32, 6);
    const ledger = createLeafLedger({
      directory: dir,
      key,
      identity,
      eligible: [],
      saveEligible: (id) => id.startsWith('unit:') || id === 'browser:mirror',
      origin: { attempt: 'a', report: '/a' },
    });
    const run = createVerificationRun({ readIdentity: () => identity, writeLedger: ledger });
    await run.check('ci:budget', {}, () => ({ elapsedMs: 1 }));
    await run.check('check:layers', {}, () => undefined);
    await run.check('browser:perf', {}, () => ({ code: 0 }));
    await run.check('browser:mirror', {}, () => ({ code: 0 }));
    await run.check('unit:test/a.test.mjs', {}, () => ({ code: 0 }));
    assert.ok(
      run.receipts().every((r) => r.ok === true),
      'no leaf failed because of the save policy',
    );
    const reader = (id) =>
      createLeafLedger({ directory: dir, key, identity, eligible: [id] }).load(id, {});
    assert.equal(reader('ci:budget'), null);
    assert.equal(reader('check:layers'), null);
    assert.equal(reader('browser:perf'), null);
    assert.equal(reader('browser:mirror')?.origin.attempt, 'a');
    assert.equal(reader('unit:test/a.test.mjs')?.origin.attempt, 'a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
