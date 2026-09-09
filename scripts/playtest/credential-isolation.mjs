// Only explicitly provisioned disposable probes may receive these capability tests.
export async function verifyCredentialIsolation(config, request) {
  const targets = config.isolationTargets;
  if (targets?.authorization !== 'disposable-probes-only')
    throw Error('Authorized isolation probe inventory required');
  for (const key of ['currentWorker', 'otherWorker', 'currentBucket', 'otherBucket'])
    if (!/^simulacrum-isolation-[a-z0-9-]{1,40}$/.test(targets[key] || ''))
      throw Error('Disposable isolation target required');
  if (targets.currentWorker === config.workerName || targets.currentBucket === config.bucketName)
    throw Error('Live capture resources cannot be isolation probes');
  const current = `accounts/${config.accountId}`,
    other = `accounts/${config.otherAccountId}`;
  const expect = async (path, options, status) => {
    const response = await request(path, options);
    await response.arrayBuffer();
    if (response.status !== status)
      throw Error(`Credential isolation probe failed (${response.status})`);
  };
  await expect(`${current}/workers/scripts/${targets.currentWorker}/settings`, {}, 200);
  await expect(`${current}/r2/buckets/${targets.currentBucket}`, {}, 200);
  await expect(`${other}/workers/scripts/${targets.otherWorker}/settings`, {}, 403);
  await expect(`${other}/r2/buckets/${targets.otherBucket}`, {}, 403);
  const secret = `ISOLATION_${crypto.randomUUID().replaceAll('-', '')}`;
  const value = { name: secret, text: crypto.randomUUID(), type: 'secret_text' };
  const writeSecret = async (account, worker) => {
    const path = `${account}/workers/scripts/${worker}/secrets`;
    const response = await request(path, {
      method: 'PUT',
      body: JSON.stringify(value),
      headers: { 'content-type': 'application/json' },
    });
    await response.arrayBuffer();
    if (response.ok) await expect(path + '/' + secret, { method: 'DELETE' }, 200);
    return response.status;
  };
  if (![200, 201].includes(await writeSecret(current, targets.currentWorker)))
    throw Error('Permitted current-account Worker write failed');
  if ((await writeSecret(other, targets.otherWorker)) !== 403)
    throw Error('Cross-account Worker write was not denied');
  // The reviewed other-account bucket is an empty disposable probe. Writing its
  // empty CORS policy cannot alter the workshop bucket even with a mis-scoped token.
  await expect(
    `${other}/r2/buckets/${targets.otherBucket}/cors`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: [] }),
    },
    403,
  );
  return {
    currentWorkerRead: true,
    currentWorkerWrite: true,
    currentStorageRead: true,
    otherWorkerReadDenied: true,
    otherWorkerWriteDenied: true,
    otherStorageReadDenied: true,
    otherStorageWriteDenied: true,
  };
}
