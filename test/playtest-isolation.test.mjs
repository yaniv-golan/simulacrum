import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCredentialIsolation } from '../scripts/playtest/credential-isolation.mjs';
test('isolation probes require disposable authorization and catch storage or Worker write authority', async () => {
  const config = {
    accountId: 'current',
    otherAccountId: 'other',
    workerName: 'workshop',
    bucketName: 'recordings',
    isolationTargets: {
      authorization: 'disposable-probes-only',
      currentWorker: 'simulacrum-isolation-current',
      otherWorker: 'simulacrum-isolation-other',
      currentBucket: 'simulacrum-isolation-current',
      otherBucket: 'simulacrum-isolation-other',
    },
  };
  const run = (allowed, createdStatus = 200) =>
    verifyCredentialIsolation(
      config,
      async (path, options = {}) =>
        new Response('', {
          status:
            path.startsWith('accounts/other') &&
            !(['PUT', 'DELETE'].includes(options.method) && path.includes(allowed))
              ? 403
              : options.method === 'PUT' && path.endsWith('/secrets')
                ? createdStatus
                : 200,
        }),
    );
  assert.equal((await run('never')).otherStorageWriteDenied, true);
  assert.equal((await run('never', 201)).currentWorkerWrite, true);
  await assert.rejects(run('never', 202), /Worker write/);
  await assert.rejects(run('/cors'), /isolation/);
  await assert.rejects(run('/secrets'), /Worker write/);
  await assert.rejects(
    verifyCredentialIsolation(
      { ...config, isolationTargets: { ...config.isolationTargets, otherBucket: 'recordings' } },
      () => {
        throw Error('Must not contact provider');
      },
    ),
    /Disposable/,
  );
});
