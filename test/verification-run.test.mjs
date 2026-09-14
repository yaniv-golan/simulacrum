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
  assert.equal(
    run
      .receipts()
      .find((r) => r.id === 'positive')
      .processDiagnostics.events.at(-1).type,
    'settlement',
  );
});
test('identity binds the declared relevant environment only; the whole environment is forensic', async () => {
  const { verificationIdentity, environmentForensics, RELEVANT_ENVIRONMENT } = await import(
    '../scripts/verification-run.mjs'
  );
  const saved = Object.fromEntries(
    ['SIM_VERIFIER_TEST_CONFIGURATION', 'FEEDBACK_SOURCE', 'PLAYWRIGHT_TEST_FLAG'].map((k) => [
      k,
      process.env[k],
    ]),
  );
  const restore = () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  };
  try {
    delete process.env.FEEDBACK_SOURCE;
    delete process.env.PLAYWRIGHT_TEST_FLAG;
    process.env.SIM_VERIFIER_TEST_CONFIGURATION = 'first-private-value';
    const first = verificationIdentity(),
      forensicFirst = environmentForensics();
    process.env.SIM_VERIFIER_TEST_CONFIGURATION = 'second-private-value';
    const second = verificationIdentity();
    // An undeclared variable (terminal, cwd, private configuration) must not change identity.
    assert.equal(first.environmentDigest, second.environmentDigest);
    assert.notEqual(environmentForensics().environmentDigest, forensicFirst.environmentDigest);
    assert.equal(JSON.stringify(second).includes('second-private-value'), false);
    assert.ok(RELEVANT_ENVIRONMENT.names.includes('FEEDBACK_SOURCE'));
    assert.ok(RELEVANT_ENVIRONMENT.names.includes('NODE_OPTIONS'));
    assert.ok(RELEVANT_ENVIRONMENT.prefixes.includes('PLAYWRIGHT_'));
    assert.ok(RELEVANT_ENVIRONMENT.prefixes.includes('PLAYTEST_'));
    // The tier defaults NODE_ENV to production; an unset NODE_ENV must digest the same way.
    const { relevantEnvironmentDigest } = await import('../scripts/verification-environment.mjs');
    assert.equal(
      relevantEnvironmentDigest({}),
      relevantEnvironmentDigest({ NODE_ENV: 'production' }),
    );
    process.env.FEEDBACK_SOURCE = 'override';
    assert.notEqual(verificationIdentity().environmentDigest, second.environmentDigest);
    delete process.env.FEEDBACK_SOURCE;
    process.env.PLAYWRIGHT_TEST_FLAG = '1';
    assert.notEqual(verificationIdentity().environmentDigest, second.environmentDigest);
  } finally {
    restore();
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

test('expired unit admission stops before identity work and reports every unexecuted file', async () => {
  const { createVerificationContext } = await import('../scripts/verification-run.mjs');
  let reads = 0;
  const run = createVerificationContext({ readIdentity: () => ({ source: ++reads && 'a' }) });
  const before = reads;
  const files = ['missing-c.test.mjs', 'missing-a.test.mjs', 'missing-b.test.mjs'];
  await assert.rejects(
    run.withDeadline(-1, () => run.unit(files)),
    (error) => {
      assert.deepEqual(error.unexecuted, [...files].sort());
      return true;
    },
  );
  assert.equal(reads, before, 'expired queue must not repeatedly hash identity');
  assert.equal(run.receipts().length, 0, 'unexecuted tests are not failed executions');
  assert.equal((await run.node('after-budget', ['-e', 'console.log(7)'], 3000)).stdout.trim(), '7');
});

test('receipt elapsed includes admission identity work and preserves process failure details', async () => {
  let reads = 0;
  const run = createVerificationRun({
    readIdentity: () => {
      if (++reads === 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      return { source: 'a' };
    },
  });
  await assert.rejects(
    run.check('failure', {}, () => {
      throw Object.assign(Error('cleanup failed'), {
        code: 'EPERM',
        signal: 'SIGTERM',
        failureKind: 'watchdog',
        elapsedMs: 12,
        processDiagnostics: { events: [{ type: 'signal', errno: 'EPERM' }] },
      });
    }),
    /cleanup failed/,
  );
  const receipt = run.receipts()[0];
  assert.ok(receipt.elapsedMs >= 30, `identity time omitted: ${receipt.elapsedMs}`);
  assert.equal(receipt.code, 'EPERM');
  assert.equal(receipt.signal, 'SIGTERM');
  assert.equal(receipt.failureKind, 'watchdog');
  assert.equal(receipt.processElapsedMs, 12);
  assert.equal(receipt.processDiagnostics.events[0].errno, 'EPERM');
});

test('a watchdog shortened by the shared budget reports budget exhaustion, not a hung test', async () => {
  const { createVerificationContext } = await import('../scripts/verification-run.mjs');
  const run = createVerificationContext({ readIdentity: () => ({ source: 'a' }) });
  await assert.rejects(
    run.withDeadline(80, () => run.node('budget-child', ['-e', 'while(true){}'], 30000)),
    (error) => {
      assert.equal(error.code, 'ITERATION_BUDGET_EXHAUSTED');
      assert.equal(error.failureKind, 'iteration-budget');
      assert.match(error.message, /iteration-budget/);
      return true;
    },
  );
  await assert.rejects(run.node('hung-child', ['-e', 'while(true){}'], 80), (error) => {
    assert.notEqual(error.code, 'ITERATION_BUDGET_EXHAUSTED');
    return true;
  });
});
