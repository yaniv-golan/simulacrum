import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLeafLedger } from '../scripts/verification-resume.mjs';
import { createVerificationRun } from '../scripts/verification-run.mjs';
import { reusableLeaf } from '../scripts/candidate-after.mjs';

const id = 'unit:test/pure.test.mjs';
const configuration = { args: ['--test', 'test/pure.test.mjs'], timeoutMs: 30000 };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'resume-controls-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const identity = { source: 'fixed', environmentDigest: 'same-environment' };
  const ledger = (name, overrides = {}) =>
    createLeafLedger({
      directory: join(directory, name),
      key: Buffer.alloc(32, 9),
      identity,
      eligible: [id],
      ...overrides,
    });
  return { directory, identity, ledger };
}

test('repeated resume preserves the original execution duration and embedded evidence', async (t) => {
  const { identity, ledger } = fixture(t);
  for (const duration of [0, 12345]) {
    const original = ledger(`original-${duration}`);
    const value = { code: 0, stdout: 'original proof', stderr: '' };
    original.save(id, configuration, value, duration);
    let previous = original;
    for (let attempt = 0; attempt < 3; attempt++) {
      const output = ledger(`attempt-${duration}-${attempt}`);
      const run = createVerificationRun({
        readIdentity: () => identity,
        resumeLedger: previous,
        writeLedger: output,
      });
      assert.deepEqual(
        await run.check(id, configuration, () => assert.fail('must reuse eligible leaf')),
        value,
      );
      assert.equal(run.receipts()[0].originalElapsedMs, duration);
      assert.equal(output.load(id, configuration).elapsedMs, duration);
      assert.deepEqual(output.load(id, configuration).value, value);
      previous = output;
    }
  }
});

test('missing and identity-invalidated receipts execute fresh leaves', async (t) => {
  const { identity, ledger } = fixture(t);
  const original = ledger('original');
  let calls = 0;
  const execute = () => ({ code: 0, stdout: `fresh-${++calls}` });
  const missing = createVerificationRun({ readIdentity: () => identity, resumeLedger: original });
  assert.equal((await missing.check(id, configuration, execute)).stdout, 'fresh-1');
  original.save(id, configuration, { code: 0, stdout: 'old' }, 100);
  for (const changed of [
    { ...identity, source: 'changed' },
    { ...identity, environmentDigest: 'changed' },
  ]) {
    const invalidated = ledger('original', { identity: changed });
    const run = createVerificationRun({ readIdentity: () => changed, resumeLedger: invalidated });
    assert.match((await run.check(id, configuration, execute)).stdout, /^fresh-/);
    assert.equal(run.receipts()[0].resumed, undefined);
  }
  const alteredArguments = createVerificationRun({
    readIdentity: () => identity,
    resumeLedger: original,
  });
  assert.match(
    (await alteredArguments.check(id, { ...configuration, timeoutMs: 25000 }, execute)).stdout,
    /^fresh-/,
  );
  assert.equal(calls, 4);
});

test('failed leaves and source drift never publish a successful receipt', async (t) => {
  const { identity, ledger } = fixture(t);
  const output = ledger('output');
  const failure = createVerificationRun({ readIdentity: () => identity, writeLedger: output });
  await assert.rejects(
    failure.check(id, configuration, () => {
      throw Error('actual child failure');
    }),
    /actual child failure/,
  );
  assert.equal(output.load(id, configuration), null);
  assert.equal(failure.receipts()[0].ok, false);
  assert.throws(
    () => output.save(id, configuration, { code: 1, stdout: 'failed' }, 1),
    /successful/,
  );
  assert.equal(output.load(id, configuration), null);
  let current = identity;
  const drift = createVerificationRun({ readIdentity: () => current, writeLedger: output });
  await assert.rejects(
    drift.check(id, configuration, () => {
      current = { ...identity, source: 'modified-during-check' };
      return { code: 0 };
    }),
    /identity changed/,
  );
  assert.equal(output.load(id, configuration), null);
});

test('malformed, tampered, oversized and nonregular receipts fail closed without execution', async (t) => {
  const { directory, identity, ledger } = fixture(t);
  for (const corruption of ['malformed', 'tampered', 'oversized', 'symlink']) {
    const input = ledger(corruption);
    input.save(id, configuration, { code: 0, stdout: 'proof' }, 10);
    const path = input.path(id);
    if (corruption === 'malformed') writeFileSync(path, '{');
    if (corruption === 'tampered') {
      const row = JSON.parse(readFileSync(path));
      row.payload.value.stdout = 'forged';
      writeFileSync(path, JSON.stringify(row));
    }
    if (corruption === 'oversized') writeFileSync(path, 'x'.repeat(5 * 1024 * 1024 + 1));
    if (corruption === 'symlink') {
      const target = join(directory, 'valid-but-linked.json');
      writeFileSync(target, readFileSync(path));
      rmSync(path);
      symlinkSync(target, path);
    }
    let calls = 0;
    const run = createVerificationRun({ readIdentity: () => identity, resumeLedger: input });
    await assert.rejects(
      run.check(id, configuration, () => {
        calls++;
        return { code: 0 };
      }),
    );
    assert.equal(calls, 0, corruption);
    assert.equal(run.receipts()[0].ok, false);
  }
});

test('plain resume never reads aggregate, timing-sensitive or unaudited leaves, whatever the production save policy stored', async (t) => {
  const { identity, ledger } = fixture(t);
  // The production save policy: unit leaves and browser checks that are neither
  // timing-sensitive nor merge smoke are stored for a diagnosed retry; nothing else is.
  const manifest = {
    browserChecks: [
      { id: 'performance', timingSensitive: true },
      { id: 'mirror' },
      { id: 'smoke', mergeSmoke: true },
    ],
  };
  const output = ledger('output', { saveEligible: (leaf) => reusableLeaf(leaf, manifest) });
  const stored = (leaf) => ledger('output', { eligible: [leaf] }).load(leaf, {}) !== null;
  for (const other of [
    'ci:budget',
    'browser:performance',
    'browser:smoke',
    'browser:mirror',
    'unit:test/unaudited.test.mjs',
  ]) {
    let calls = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = createVerificationRun({
        readIdentity: () => identity,
        resumeLedger: output,
        writeLedger: output,
      });
      await run.check(other, {}, () => {
        calls++;
        return { code: 0 };
      });
      // The audited resume list gates every load: an unaudited leaf executes on each attempt.
      assert.equal(run.receipts()[0].resumed, undefined, other);
    }
    assert.equal(calls, 2, other);
    assert.equal(output.load(other, {}), null, `${other} is not resumable by plain resume`);
  }
  // What the policy stores is readable only by a ledger that names the leaf explicitly — the
  // reuse list a diagnosed retry is given; aggregates, timing-sensitive and smoke rows are absent.
  assert.equal(stored('unit:test/unaudited.test.mjs'), true);
  assert.equal(stored('browser:mirror'), true);
  for (const never of ['ci:budget', 'browser:performance', 'browser:smoke'])
    assert.equal(stored(never), false, never);
});
