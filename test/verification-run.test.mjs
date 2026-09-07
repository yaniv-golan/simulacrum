import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationRun } from '../scripts/verification-run.mjs';
test('one invocation deduplicates simultaneous checks and preserves failed obligations', async () => {
  let calls = 0;
  const run = createVerificationRun({
    readIdentity: () => ({ source: 'a', build: 'b', runtime: '24', environment: 'ui' }),
  });
  const execute = async () => {
    calls++;
    return 7;
  };
  assert.deepEqual(
    await Promise.all([
      run.check('unit:a', { file: 'a' }, execute),
      run.check('unit:a', { file: 'a' }, execute),
    ]),
    [7, 7],
  );
  assert.equal(calls, 1);
  const fail = () => {
    calls++;
    throw Error('wrong trace');
  };
  await assert.rejects(run.check('bad', {}, fail), /wrong trace/);
  await assert.rejects(run.check('bad', {}, execute), /wrong trace/);
  assert.equal(calls, 2);
  assert.equal(run.receipts().find((x) => x.id === 'bad').ok, false);
});
test('receipt identity or configuration changes refuse reuse; independent invocations execute again', async () => {
  let identity = { source: 'a', build: 'b', runtime: '24', environment: 'ui' },
    calls = 0;
  const run = createVerificationRun({ readIdentity: () => identity }),
    execute = () => ++calls;
  await run.check('x', { profile: 'ui' }, execute);
  await assert.rejects(run.check('x', { profile: 'focus' }, execute), /configuration/);
  identity = { ...identity, source: 'changed' };
  await assert.rejects(run.check('x', { profile: 'ui' }, execute), /identity/);
  const second = createVerificationRun({ readIdentity: () => identity });
  await second.check('x', { profile: 'ui' }, execute);
  assert.equal(calls, 2);
});
test('aggregate deadline bounds a blocking child while independent later work remains usable', async () => {
  const { createVerificationContext } = await import('../scripts/verification-run.mjs');
  const run = createVerificationContext({ readIdentity: () => ({ source: 'a' }) });
  await assert.rejects(
    run.withDeadline(50, () => run.node('blocking', ['-e', 'while(true){}'], 10000)),
    /timed out/,
  );
  assert.equal((await run.node('positive', ['-e', 'console.log(42)'], 3000)).stdout.trim(), '42');
});
test('inherited verifier environment is identity-bound without recording secret values', async () => {
  const { verificationIdentity } = await import('../scripts/verification-run.mjs');
  const prior = process.env.SIM_VERIFIER_TEST_CONFIGURATION;
  try {
    process.env.SIM_VERIFIER_TEST_CONFIGURATION = 'first-private-value';
    const first = verificationIdentity();
    process.env.SIM_VERIFIER_TEST_CONFIGURATION = 'second-private-value';
    const second = verificationIdentity();
    assert.notEqual(first.environmentDigest, second.environmentDigest);
    assert.equal(JSON.stringify(second).includes('second-private-value'), false);
  } finally {
    if (prior === undefined) delete process.env.SIM_VERIFIER_TEST_CONFIGURATION;
    else process.env.SIM_VERIFIER_TEST_CONFIGURATION = prior;
  }
});
test('Vite receives an initialized environment before final verification identity is sealed', async () => {
  const { resolveConfig } = await import('vite');
  const { createVerificationContext } = await import('../scripts/verification-run.mjs');
  const prior = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    const context = createVerificationContext();
    await assert.doesNotReject(
      context.check('vite:config', { mode: 'production' }, () =>
        resolveConfig({ logLevel: 'silent' }, 'build', 'production'),
      ),
    );
    assert.equal(process.env.NODE_ENV, 'production');
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});
