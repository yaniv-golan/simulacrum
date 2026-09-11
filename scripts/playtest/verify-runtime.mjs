import { build } from 'esbuild';
// Local workerd proof; never contacts a Cloudflare account.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve, join as pathJoin } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const persistence = await mkdtemp(pathJoin(tmpdir(), 'capture-restart-'));
const options = convertV4MiniflareOptions({
  resourcePersistencePath: persistence,
  workers: [
    {
      name: 'capture',
      modules: true,
      script: (
        await build({
          entryPoints: [resolve('scripts/playtest/worker.mjs')],
          bundle: true,
          write: false,
          format: 'esm',
          platform: 'browser',
        })
      ).outputFiles[0].text,
      compatibilityDate: '2026-09-07',
      bindings: {
        ALLOWED_ORIGIN: 'https://capture.invalid',
        INVITATION_GENERATION: '1',
        INVITATION_TOKEN: 'i'.repeat(32),
        COOKIE_SECRET: 'c'.repeat(32),
        ADMIN_TOKEN: 'a'.repeat(32),
      },
      durableObjects: { CAPTURE: { className: 'CaptureStore', useSQLite: true } },
      r2Buckets: ['RECORDINGS'],
    },
  ],
});
let mf = new Miniflare(options);
try {
  const config = await mf.dispatchFetch('https://capture.invalid/api/playtest/config');
  assert.deepEqual(await config.json(), { enabled: false });
  const join = await mf.dispatchFetch('https://capture.invalid/join?token=' + 'i'.repeat(32), {
    redirect: 'manual',
  });
  assert.equal(join.status, 303);
  const cookie = join.headers.get('set-cookie').split(';')[0];
  const post = (path, body) =>
    mf.dispatchFetch('https://capture.invalid' + path, {
      method: 'POST',
      headers: { cookie, origin: 'https://capture.invalid', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const start = await post('/api/playtest/v2/session', {
    requestId: 'runtime',
    metadata: { build: 'runtime-test' },
  });
  assert.equal(start.status, 201, await start.clone().text());
  const { sessionId } = await start.json();
  const upload = await post(`/api/playtest/v2/${sessionId}/event`, {
    id: 'event',
    kind: 'feedback-text',
    data: { text: 'synthetic' },
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const receipt = await upload.json();
  assert.equal(receipt.protocolVersion, 2);
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal(
    (
      await (
        await post('/api/playtest/v2/session', {
          requestId: 'runtime',
          metadata: { build: 'runtime-test' },
        })
      ).json()
    ).sessionId,
    sessionId,
  );
  assert.deepEqual(
    await (
      await post(`/api/playtest/v2/${sessionId}/event`, {
        id: 'event',
        kind: 'feedback-text',
        data: { text: 'synthetic' },
      })
    ).json(),
    receipt,
  );
  const forbidden = await mf.dispatchFetch(
    `https://capture.invalid/admin/playtest/${sessionId}/snapshot`,
    { headers: { cookie } },
  );
  assert.equal(forbidden.status, 403);
  const snapshot = await mf.dispatchFetch(
    `https://capture.invalid/admin/playtest/${sessionId}/snapshot`,
    { headers: { authorization: 'Bearer ' + 'a'.repeat(32) } },
  );
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).uploads.length, 1);
  // Exercise near the complete shared wire budget inside real workerd, not only the SQL fake.
  const burst = await Promise.all(
    Array.from({ length: 32 }, (_, i) => {
      const body = JSON.stringify({ id: `bounded-${i}`, data: { text: 'x'.repeat(600000) } });
      return mf.dispatchFetch(`https://capture.invalid/api/playtest/v2/${sessionId}/event`, {
        method: 'POST',
        headers: {
          cookie,
          origin: 'https://capture.invalid',
          'content-type': 'application/json',
          'content-length': String(new TextEncoder().encode(body).length),
        },
        body,
      });
    }),
  );
  for (const response of burst) assert.equal(response.status, 201, await response.clone().text());
  const mediaBurst = await Promise.all(
    Array.from({ length: 32 }, (_, i) =>
      mf.dispatchFetch(
        `https://capture.invalid/api/playtest/v2/${sessionId}/media?kind=voice&clip=bounded&seq=${i}`,
        {
          method: 'POST',
          headers: {
            cookie,
            origin: 'https://capture.invalid',
            'content-type': 'audio/webm',
            'content-length': '600000',
          },
          body: new Uint8Array(600000),
        },
      ),
    ),
  );
  for (const response of mediaBurst)
    assert.equal(response.status, 201, await response.clone().text());
  const maximum = new Uint8Array(10 * 1024 ** 2);
  const uploads = await Promise.all(
    [0, 1].map((seq) =>
      mf.dispatchFetch(
        `https://capture.invalid/api/playtest/v2/${sessionId}/media?kind=voice&clip=max&seq=${seq}`,
        {
          method: 'POST',
          headers: { cookie, origin: 'https://capture.invalid', 'content-type': 'audio/webm' },
          body: maximum,
        },
      ),
    ),
  );
  for (const response of uploads) assert.equal(response.status, 201, await response.clone().text());
  console.log(
    'workerd: persisted restart,32 concurrent events and media near20 MiB, concurrent 10 MiB uploads, invitation, SQLite/R2 create, exact retry and private export passed',
  );
} finally {
  await mf.dispose();
  await rm(persistence, { recursive: true, force: true });
}
