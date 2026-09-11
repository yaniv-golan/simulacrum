import { packCapturePacket, unpackCapturePacket } from '../src/application/capture-packet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CaptureStore } from '../scripts/playtest/cloud-store.mjs';
import { ReleaseCoordinator } from '../scripts/playtest/release-control.mjs';

function state() {
  const db = new DatabaseSync(':memory:');
  return {
    storage: {
      sql: {
        exec(query, ...args) {
          const statement = db.prepare(query);
          return { toArray: () => statement.all(...args) };
        },
      },
      transactionSync(fn) {
        db.exec('BEGIN');
        try {
          const r = fn();
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
      async setAlarm() {},
      async getAlarm() {
        return null;
      },
    },
    db,
  };
}
function bucket() {
  const values = new Map();
  return {
    values,
    async put(key, body, options = {}) {
      if (options.onlyIf && values.has(key)) return null;
      const bytes = new Uint8Array(body);
      values.set(key, { bytes, customMetadata: options.customMetadata || {} });
      return this.get(key);
    },
    async get(key) {
      const v = values.get(key);
      return (
        v && {
          size: v.bytes.length,
          customMetadata: v.customMetadata,
          arrayBuffer: async () => v.bytes.slice().buffer,
        }
      );
    },
  };
}
const req = (path, body = {}, method = 'POST') =>
  new Request('https://capture.invalid' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-invitation-generation': '1' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
async function start(store, id = 'start') {
  const r = await store.fetch(
    req('/api/playtest/v2/session', { requestId: id, metadata: { build: 'test' } }),
  );
  assert.equal(r.status, 201);
  return r.json();
}
test('cloud receipt retries, pending conflicts, deletion fencing and capacity recovery', async () => {
  const st = state(),
    r2 = bucket(),
    env = { RECORDINGS: r2, INVITATION_GENERATION: '1' };
  const store = new CaptureStore(st, env);
  const { sessionId } = await start(store);
  const retry = await store.fetch(
    req('/api/playtest/v2/session', { requestId: 'start', metadata: { build: 'test' } }),
  );
  assert.equal((await retry.json()).sessionId, sessionId);
  assert.equal(
    (
      await store.fetch(
        req('/api/playtest/v2/session', { requestId: 'start', metadata: { build: 'changed' } }),
      )
    ).status,
    409,
  );
  const path = `/api/playtest/v2/${sessionId}/event`;
  const first = await store.fetch(req(path, { id: 'one', text: 'hello' }));
  assert.equal(first.status, 201);
  const receipt = await first.json();
  assert.equal(receipt.protocolVersion, 2);
  assert.equal(receipt.logicalKey, 'event:one');
  assert.deepEqual(
    await (await store.fetch(req(path, { id: 'one', text: 'hello' }))).json(),
    receipt,
  );
  assert.equal((await store.fetch(req(path, { id: 'one', text: 'changed' }))).status, 409);
  assert.equal(
    (await store.fetch(req(`/api/playtest/${sessionId}/event`, { id: 'legacy' }))).status,
    404,
  );
  assert.equal((await store.fetch(req(`/admin/playtest/${sessionId}/delete`))).status, 202);
  await store.alarm();
  assert.equal((await store.fetch(req(path, { id: 'two' }))).status, 410);
  for (const v of r2.values.values()) {
    assert.equal(v.bytes.length, 0);
    assert.equal(v.customMetadata.deleted, '1');
  }
  st.db.close();
});
test('late conditional payload cannot resurrect a deleted session', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const { sessionId } = await start(store);
  let entered, release;
  const reached = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  const put = r2.put.bind(r2);
  r2.put = async (...args) => {
    if (args[2]?.onlyIf) {
      entered();
      await gate;
    }
    return put(...args);
  };
  const uploading = store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'late' }));
  await reached;
  await store.fetch(req(`/admin/playtest/${sessionId}/delete`));
  await store.alarm();
  release();
  assert.equal((await uploading).status, 410);
  for (const v of r2.values.values()) assert.equal(v.bytes.length, 0);
  st.db.close();
});
test('publisher admission is atomic, owner checked and has no clock takeover', async () => {
  const st = state(),
    owner = new ReleaseCoordinator(st, {});
  const a = { attempt: 'a', token: 'a'.repeat(64), artifact: '1'.repeat(64), predecessor: 'p' };
  assert.equal((await owner.fetch(req('/acquire', a))).status, 201);
  assert.equal(
    (await owner.fetch(req('/acquire', { ...a, attempt: 'b', token: 'b'.repeat(64) }))).status,
    409,
  );
  assert.equal((await owner.fetch(req('/release', { ...a, token: 'wrong' }))).status, 403);
  assert.equal((await owner.fetch(req('/acquire', a))).status, 200);
  assert.equal((await owner.fetch(req('/release', a))).status, 200);
  assert.equal((await owner.fetch(req('/acquire', { ...a, attempt: 'b' }))).status, 201);
  st.db.close();
});

test('synthetic capacity is reclaimed across 21 runs without deleting human evidence', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const human = await start(store, 'human');
  const humanSnapshot = await (
    await store.fetch(
      new Request(`https://capture.invalid/admin/playtest/${human.sessionId}/snapshot`),
    )
  ).json();
  assert.equal(humanSnapshot.session.syntheticRun, null);
  for (let i = 0; i < 21; i++) {
    const response = await store.fetch(
      req('/admin/playtest/synthetic', { slots: 1, bytes: 65536 }),
    );
    assert.equal(response.status, 201);
    const run = await response.json();
    const request = req('/api/playtest/v2/session', {
      requestId: `synthetic-${i}`,
      metadata: { build: 'synthetic' },
    });
    request.headers.set('x-synthetic-run', run.id);
    const created = await store.fetch(request);
    assert.equal(created.status, 201);
    const { sessionId } = await created.json();
    const snapshot = await (
      await store.fetch(new Request(`https://capture.invalid/admin/playtest/${sessionId}/snapshot`))
    ).json();
    assert.equal(snapshot.session.syntheticRun, run.id);
    await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'one' }));
    const deletion = await store.fetch(
      new Request(`https://capture.invalid/admin/playtest/synthetic/${run.id}`, {
        method: 'DELETE',
      }),
    );
    assert.equal(deletion.status, 202);
    await store.alarm();
    assert.equal(store.usage().sessions, 1);
  }
  assert.equal(
    (await store.fetch(req(`/api/playtest/v2/${human.sessionId}/event`, { id: 'still-here' })))
      .status,
    201,
  );
  st.db.close();
});

test('cloud exact P plus pointer quota, expired writes and exhausted cleanup retries fail closed', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const { sessionId } = await start(store);
  const body = { id: 'edge' },
    bytes = Buffer.byteLength(JSON.stringify(body));
  store.run('UPDATE sessions SET bytes=? WHERE id=?', 1024 ** 3 - bytes - 4096, sessionId);
  assert.equal((await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, body))).status, 201);
  assert.equal(store.live(sessionId).bytes, 1024 ** 3);
  assert.equal(
    (await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'over' }))).status,
    413,
  );
  store.run('UPDATE sessions SET expires=0 WHERE id=?', sessionId);
  assert.equal((await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, body))).status, 410);
  const put = r2.put.bind(r2);
  r2.put = async () => {
    throw Error('outage');
  };
  for (let i = 0; i < 8; i++) {
    await store.alarm();
    store.run('UPDATE sessions SET nextAttempt=0 WHERE id=?', sessionId);
  }
  assert.equal(store.usage().sessions, 1);
  assert.ok(store.one('SELECT failures FROM sessions').failures >= 8);
  r2.put = put;
  await store.fetch(req('/admin/playtest/reconcile'));
  await store.alarm();
  assert.equal(store.usage().sessions, 0);
  assert.equal(store.usage().bytes, 0);
  st.db.close();
});

test('synthetic admission reserves lifetime metadata before publication', async () => {
  const st = state();
  const store = new CaptureStore(st, { INVITATION_GENERATION: '1' });
  store.run('UPDATE ledger SET lifetime=?', 8 * 1024 ** 3);
  assert.equal(
    (
      await store.fetch(
        req('/admin/playtest/synthetic', { slots: 2, bytes: 32000000, metadataBytes: 8192 }),
      )
    ).status,
    413,
  );
  st.db.close();
});

test('publisher rejects stale predecessor and supports owner-checked recovery', async () => {
  const st = state(),
    c = new ReleaseCoordinator(st);
  const a = {
    attempt: 'first',
    token: 'a'.repeat(32),
    artifact: 'a'.repeat(64),
    predecessor: 'initial',
  };
  const call = (path, input) =>
    c.fetch(
      new Request('https://control.invalid' + path, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  assert.equal((await call('/acquire', a)).status, 201);
  await call('/phase', { ...a, phase: 'complete', version: 'local-new' });
  await call('/release', a);
  const b = { ...a, attempt: 'queued', token: 'b'.repeat(32) };
  assert.equal((await call('/acquire', b)).status, 409);
  b.predecessor = 'local-new';
  assert.equal((await call('/acquire', b)).status, 201);
  assert.equal(
    (
      await call('/recover', {
        ...b,
        token: 'wrong'.repeat(10),
        artifact: 'c'.repeat(64),
        predecessor: 'observed',
      })
    ).status,
    403,
  );
  assert.equal(
    (await call('/recover', { ...b, artifact: 'c'.repeat(64), predecessor: 'observed' })).status,
    200,
  );
  assert.equal((await (await call('/check', b)).json()).artifact, 'c'.repeat(64));
  st.db.close();
});

test('storage deadlines retain a finite operation budget until the provider settles', async () => {
  const st = state(),
    store = new CaptureStore(st, {}),
    waits = [Promise.withResolvers(), Promise.withResolvers()];
  const pending = waits.map((w) => store.io(() => w.promise, Date.now() + 2));
  const outcomes = await Promise.allSettled(pending);
  assert.ok(outcomes.every((r) => r.status === 'rejected' && r.reason.status === 503));
  let called = false;
  await assert.rejects(
    store.io(() => {
      called = true;
    }),
    /saturated/,
  );
  assert.equal(called, false);
  assert.equal(store.inflight, 2);
  waits.forEach((w) => w.resolve());
  await new Promise((r) => setImmediate(r));
  assert.equal(store.circuit, false);
  assert.equal(await store.io(() => 42), 42);
  st.db.close();
});

test('receipt recovery survives R2 and SQL acknowledgment faults without double charging', async () => {
  for (const point of ['reserved', 'r2-written', 'sql-committed']) {
    const st = state(),
      r2 = bucket(),
      env = { RECORDINGS: r2, INVITATION_GENERATION: '1' };
    let store = new CaptureStore(st, env);
    const { sessionId } = await start(store, point);
    const path = `/api/playtest/v2/${sessionId}/event`,
      body = { id: 'fault', kind: 'synthetic' };
    const get = r2.get.bind(r2),
      put = r2.put.bind(r2),
      transaction = store.transaction.bind(store);
    let fail = true;
    if (point === 'reserved')
      r2.put = async (...args) => {
        if (fail) {
          fail = false;
          throw Error('lost before write');
        }
        return put(...args);
      };
    if (point === 'r2-written')
      r2.put = async (...args) => {
        const result = await put(...args);
        if (fail) {
          fail = false;
          throw Error('lost write acknowledgment');
        }
        return result;
      };
    if (point === 'sql-committed')
      store.transaction = (fn) => {
        const result = transaction(fn);
        if (result.receipt && fail) {
          fail = false;
          throw Error('lost SQL acknowledgment');
        }
        return result;
      };
    assert.equal((await store.fetch(req(path, body))).status, 500);
    const usage = store.usage(),
      lifetime = store.one('SELECT lifetime FROM ledger').lifetime;
    store = new CaptureStore(st, env);
    const response = await store.fetch(req(path, body));
    assert.ok(response.ok);
    const receipt = await response.json();
    assert.equal(receipt.sequence, 1);
    assert.deepEqual(store.usage(), usage);
    assert.equal(store.one('SELECT lifetime FROM ledger').lifetime, lifetime);
    assert.deepEqual(await (await store.fetch(req(path, body))).json(), receipt);
    assert.equal(r2.values.size, 1);
    st.db.close();
  }
});

test('independent Cron repairs missing alarms and recovers deletion after repeated outages', async () => {
  const worker = (await import('../scripts/playtest/worker.mjs')).default;
  const st = state(),
    r2 = bucket(),
    env = { RECORDINGS: r2, INVITATION_GENERATION: '1' };
  let alarm = null;
  st.storage.getAlarm = async () => alarm;
  st.storage.setAlarm = async (value) => {
    alarm = value;
  };
  let store = new CaptureStore(st, env);
  const { sessionId } = await start(store);
  await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'erase' }));
  await store.fetch(req(`/admin/playtest/${sessionId}/delete`));
  const put = r2.put.bind(r2);
  r2.put = async (...args) => {
    await put(...args);
    throw Error('marker acknowledgment lost');
  };
  for (let i = 0; i < 8; i++) {
    await store.alarm();
    store.run('UPDATE sessions SET nextAttempt=0');
  }
  assert.equal(store.usage().sessions, 1);
  alarm = null;
  r2.put = put;
  store = new CaptureStore(st, env);
  await worker.scheduled(
    {},
    {
      CAPTURE: {
        idFromName: (name) => {
          assert.equal(name, 'capture-v2');
          return name;
        },
        get: () => ({ fetch: (request) => store.fetch(request) }),
      },
    },
  );
  assert.ok(alarm > Date.now());
  await store.alarm();
  assert.equal(store.usage().sessions, 0);
  assert.equal(
    (await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'erase' }))).status,
    410,
  );
  for (const value of r2.values.values()) assert.equal(value.bytes.length, 0);
  st.db.close();
});

test('verification holds full capacity across preliminary drain and load admission', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const full = { slots: 20, bytes: 20 * 1024 ** 3, metadataBytes: 1024 ** 3 };
  const abandoned = await (
    await store.fetch(req('/admin/playtest/synthetic', { slots: 1, bytes: 65536 }))
  ).json();
  assert.equal((await store.fetch(req('/admin/playtest/synthetic', full))).status, 413);
  await store.fetch(req('/admin/playtest/synthetic/' + abandoned.id, {}, 'DELETE'));
  const run = await (await store.fetch(req('/admin/playtest/synthetic', full))).json();
  const create = (id) => {
    const r = req('/api/playtest/v2/session', { requestId: id, metadata: {} });
    r.headers.set('x-synthetic-run', run.id);
    return store.fetch(r);
  };
  const preliminary = await (await create('preliminary')).json();
  await store.fetch(req(`/api/playtest/v2/${preliminary.sessionId}/event`, { id: 'one' }));
  await store.fetch(req(`/admin/playtest/synthetic/${run.id}/drain`));
  await store.alarm();
  const held = store.one('SELECT * FROM synthetic WHERE id=?', run.id);
  assert.equal(held.slots, 20);
  assert.equal(held.bytes, 20 * 1024 ** 3);
  assert.equal(held.metadata, 1024 ** 3 - 8192);
  assert.equal(
    (await store.fetch(req('/api/playtest/v2/session', { requestId: 'competing', metadata: {} })))
      .status,
    413,
  );
  for (let i = 0; i < 20; i++) assert.equal((await create('load' + i)).status, 201);
  await store.fetch(req('/admin/playtest/synthetic/' + run.id, {}, 'DELETE'));
  await store.alarm();
  assert.equal(store.usage().sessions, 0);
  st.db.close();
});

test('coordinator persists bounded failures across owners and clears only explicit same-family IDs', async (t) => {
  const st = state();
  t.after(() => st.db.close());
  const c = new ReleaseCoordinator(st);
  const a = {
    attempt: 'publisher-a',
    token: 'a'.repeat(64),
    artifact: '1'.repeat(64),
    predecessor: 'p',
  };
  const failure = {
    id: 'failure-a',
    family: 'endurance',
    status: 'FAIL',
    identity: '2'.repeat(64),
    artifact: a.artifact,
    measuredAt: Date.now() - 1000,
    reason: 'backlog grew',
  };
  assert.equal((await c.fetch(req('/acquire', a))).status, 201);
  assert.equal((await c.fetch(req('/experiment-failed', { ...a, failure }))).status, 201);
  assert.equal((await c.fetch(req('/experiment-failed', { ...a, failure }))).status, 200);
  assert.equal(
    (await c.fetch(req('/experiment-failed', { ...a, failure: { ...failure, reason: 'rewrite' } })))
      .status,
    409,
  );
  const list = async () => (await (await c.fetch(req('/experiment-failures'))).json()).failures;
  assert.deepEqual(await list(), [failure]);
  await c.fetch(req('/release', a));
  const b = { ...a, attempt: 'publisher-b', token: 'b'.repeat(64), artifact: '3'.repeat(64) };
  await c.fetch(req('/acquire', b));
  const pass = {
    ...b,
    family: 'endurance',
    receiptId: '4'.repeat(64),
    identity: '5'.repeat(64),
    measuredAt: Date.now(),
    artifact: b.artifact,
    failureIds: [failure.id],
  };
  assert.equal((await c.fetch(req('/experiment-passed', { ...pass, token: a.token }))).status, 403);
  assert.equal(
    (await c.fetch(req('/experiment-passed', { ...pass, family: 'capacity' }))).status,
    409,
  );
  assert.equal(
    (await c.fetch(req('/experiment-passed', { ...pass, artifact: a.artifact }))).status,
    409,
  );
  assert.deepEqual(await list(), [failure]);
  assert.equal((await c.fetch(req('/experiment-passed', pass))).status, 200);
  assert.deepEqual(await list(), []);
  assert.equal((await c.fetch(req('/experiment-passed', pass))).status, 200);
  for (const invalid of [
    { status: 'PASS' },
    { identity: 'bad' },
    { artifact: a.artifact },
    { measuredAt: Infinity },
    { reason: '' },
    { extra: 'unbounded' },
  ])
    assert.equal(
      (
        await c.fetch(
          req('/experiment-failed', {
            ...b,
            failure: { ...failure, artifact: b.artifact, ...invalid },
          }),
        )
      ).status,
      400,
    );
  const failures = Array.from({ length: 65 }, (_, i) => ({
    ...failure,
    id: `failure-${i}`,
    artifact: b.artifact,
  }));
  const responses = await Promise.all(
    failures.map((f) => c.fetch(req('/experiment-failed', { ...b, failure: f }))),
  );
  assert.equal(responses.filter((r) => r.status === 201).length, 64);
  assert.equal(responses.filter((r) => r.status === 409).length, 1);
  assert.equal((await list()).length, 64);
  assert.equal(
    (await c.fetch(req('/experiment-passed', { ...pass, failureIds: failures.map((f) => f.id) })))
      .status,
    400,
  );
  assert.equal((await list()).length, 64);
});

test('data sessions reject screen uploads and disabled video cannot be admitted', async () => {
  const st = state(),
    store = new CaptureStore(st, { RECORDINGS: bucket(), INVITATION_GENERATION: '1' });
  const denied = await store.fetch(
    req('/api/playtest/v2/session', {
      requestId: 'video',
      metadata: { recordingMode: 'video', captureSchema: 1 },
    }),
  );
  assert.equal(denied.status, 403);
  const { sessionId } = await start(store, 'data');
  const screen = () =>
    new Request(
      `https://capture.invalid/api/playtest/v2/${sessionId}/media?kind=screen&clip=tab&seq=0`,
      {
        method: 'POST',
        headers: { 'content-type': 'video/webm', 'x-invitation-generation': '1' },
        body: 'video',
      },
    );
  assert.equal((await store.fetch(screen())).status, 403);
  const enabled = new CaptureStore(st, {
    RECORDINGS: bucket(),
    INVITATION_GENERATION: '1',
    CAPTURE_OPTIONAL_VIDEO: 'true',
  });
  assert.equal((await enabled.fetch(screen())).status, 403);
  const v = await (
    await enabled.fetch(
      req('/api/playtest/v2/session', {
        requestId: 'allowed',
        metadata: { recordingMode: 'video', captureSchema: 1 },
      }),
    )
  ).json();
  const voice = new Request(
    `https://capture.invalid/api/playtest/v2/${v.sessionId}/media?kind=screen&clip=tab&seq=0`,
    {
      method: 'POST',
      headers: { 'content-type': 'video/webm', 'x-invitation-generation': '1' },
      body: 'video',
    },
  );
  assert.equal((await enabled.fetch(voice)).status, 201);
  const disabledAgain = new CaptureStore(st, { RECORDINGS: bucket(), INVITATION_GENERATION: '1' });
  assert.equal(
    (
      await disabledAgain.fetch(
        req('/api/playtest/v2/session', {
          requestId: 'allowed',
          metadata: { recordingMode: 'video', captureSchema: 1 },
        }),
      )
    ).status,
    200,
  );
});

test('compressed receipts attest opaque bytes and review rejects invalid expansion', async (t) => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const { sessionId } = await start(store);
  const post = (p, b) => store.fetch(req(p, b));
  const packet = packCapturePacket({
    id: 'compressed-1',
    kind: 'capture-batch',
    data: {
      schema: 1,
      events: [{ id: 'event-1', kind: 'sample', data: { text: 'observation '.repeat(1000) } }],
    },
  });
  assert.throws(() =>
    unpackCapturePacket({ ...packet, data: { ...packet.data, uncompressedBytes: 1 } }),
  );
  const path = `/api/playtest/v2/${sessionId}/event`;
  assert.equal(packet.data.encoding, 'gzip-base64');
  for (const data of [
    { ...packet.data, uncompressedBytes: 2 * 1024 ** 2 + 1 },
    { ...packet.data, encoding: 'zip' },
    { ...packet.data, payload: '*===' },
  ])
    assert.equal((await post(path, { ...packet, id: 'bad-envelope', data })).status, 400);
  const first = await post(path, packet);
  assert.equal(first.status, 201);
  const receipt = await first.json();
  assert.deepEqual(await (await post(path, packet)).json(), receipt);
  assert.equal(
    (await post(path, { ...packet, id: 'invalid', data: { ...packet.data, uncompressedBytes: 1 } }))
      .status,
    201,
  );
});

test('small uploads fill the bounded32 request allowance without serial storage stalls', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const { sessionId } = await start(store),
    gate = Promise.withResolvers(),
    put = r2.put.bind(r2);
  let entered = 0;
  r2.put = async (...args) => {
    entered++;
    await gate.promise;
    return put(...args);
  };
  const calls = Array.from({ length: 32 }, (_, i) => {
    const body = JSON.stringify({ id: 'parallel-' + i, data: 'x'.repeat(10000) });
    return store.fetch(
      new Request(`https://capture.invalid/api/playtest/v2/${sessionId}/event`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          'x-invitation-generation': '1',
        },
        body,
      }),
    );
  });
  let reached;
  try {
    for (let i = 0; i < 100 && entered < 32; i++) await new Promise((r) => setTimeout(r, 2));
    reached = entered;
    assert.equal(
      (await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'overflow' }))).status,
      429,
    );
  } finally {
    gate.resolve();
  }
  const results = await Promise.all(calls);
  assert.equal(reached, 32);
  assert(results.every((r) => r.status === 201));
  assert.deepEqual(store.readers.status(), { count: 0, bytes: 0 });
  st.db.close();
});

test('declared body size is enforced before storage or accounting can be bypassed', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' }),
    { sessionId } = await start(store);
  const body = JSON.stringify({ id: 'size', data: 'content' });
  for (const size of ['1', String(body.length + 1), 'nope', String(2 * 1024 ** 2 + 1)]) {
    const r = await store.fetch(
      new Request(`https://capture.invalid/api/playtest/v2/${sessionId}/event`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': size,
          'x-invitation-generation': '1',
        },
        body,
      }),
    );
    assert([400, 413].includes(r.status), `${size}: ${r.status}`);
  }
  assert.equal(r2.values.size, 0);
  assert.deepEqual(store.readers.status(), { count: 0, bytes: 0 });
  st.db.close();
});

test('upload byte reservation survives response timeout until R2 settles', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' }),
    { sessionId } = await start(store),
    wait = Promise.withResolvers();
  r2.put = () => wait.promise;
  const io = store.io.bind(store);
  store.io = (fn, deadline, hold) => io(fn, Date.now() + 5, hold);
  const result = await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'held' }));
  try {
    assert.equal(result.status, 503);
    assert.equal(store.readers.status().count, 1);
    assert(store.readers.status().bytes > 0);
  } finally {
    wait.resolve();
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(store.readers.status(), { count: 0, bytes: 0 });
  st.db.close();
});

test('small media shares bounded request and byte admission with events', async () => {
  for (const declared of [true, false]) {
    const st = state(),
      r2 = bucket(),
      store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' }),
      { sessionId } = await start(store),
      gate = Promise.withResolvers(),
      put = r2.put.bind(r2);
    let entered = 0;
    r2.put = async (...args) => {
      entered++;
      await gate.promise;
      return put(...args);
    };
    const media = (i) =>
      new Request(
        `https://capture.invalid/api/playtest/v2/${sessionId}/media?kind=voice&clip=voice&seq=${i}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'audio/webm',
            'x-invitation-generation': '1',
            ...(declared ? { 'content-length': '4' } : {}),
          },
          body: new Uint8Array(4),
        },
      );
    const count = declared ? 32 : 2;
    const active = Array.from({ length: count }, (_, i) => store.fetch(media(i)));
    let snapshot, third, extra;
    try {
      for (let i = 0; i < 100 && entered < count; i++) await new Promise((r) => setTimeout(r, 2));
      snapshot = store.readers.status();
      third = await store.fetch(media(count));
      extra = store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: 'mixed-overflow' }));
    } finally {
      gate.resolve();
    }
    assert((await Promise.all(active)).every((r) => r.status === 201));
    assert.equal(third.status, 429);
    assert.equal((await extra).status, 429);
    assert.equal(snapshot.bytes, declared ? 128 : 20 * 1024 ** 2);
    assert.deepEqual(store.readers.status(), { count: 0, bytes: 0 });
    st.db.close();
  }
});

test('busy uploads preserve a bounded independent control storage lane', async () => {
  const st = state(),
    store = new CaptureStore(st, {}),
    gate = Promise.withResolvers(),
    hold = { pending: 0, release() {} };
  const uploads = [
    store.io(() => gate.promise, Date.now() + 1000, hold),
    store.io(() => gate.promise, Date.now() + 1000, hold),
  ];
  try {
    assert.equal(await store.io(() => 42), 42);
    const controls = [store.io(() => gate.promise), store.io(() => gate.promise)];
    await assert.rejects(
      store.io(() => 43),
      /saturated/,
    );
    gate.resolve();
    await Promise.all(controls);
  } finally {
    gate.resolve();
    await Promise.all(uploads);
    st.db.close();
  }
});

test('cleanup settles eight marker writes, preserves partial success and retains failed capacity', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const { sessionId } = await start(store);
  for (let i = 0; i < 9; i++)
    assert.equal(
      (await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: `cleanup-${i}` })))
        .status,
      201,
    );
  const charged = store.usage().bytes,
    put = r2.put.bind(r2),
    gates = [];
  store.run("UPDATE sessions SET state='deleting' WHERE id=?", sessionId);
  r2.put = async (key, bytes, options) => {
    assert.equal(bytes.length, 0);
    assert.deepEqual(options, { customMetadata: { deleted: '1' } });
    const gate = Promise.withResolvers();
    gates.push(gate);
    await gate.promise;
    return put(key, bytes, options);
  };
  const cleaning = store.alarm();
  try {
    for (let i = 0; i < 100 && gates.length < 8; i++) await new Promise((r) => setTimeout(r, 1));
    assert.equal(gates.length, 8);
    assert.equal(await store.io(() => 42), 42);
    assert.equal(await store.io(() => 43, Date.now() + 1000, { pending: 0, release() {} }), 43);
    await assert.rejects(store.fence('f'.repeat(32)), /saturated/);
    gates[1].resolve();
    await new Promise((r) => setImmediate(r));
    assert.equal(store.one("SELECT COUNT(*) AS n FROM uploads WHERE state='fenced'").n, 1);
    gates[0].reject(Error('synthetic marker failure'));
    for (const gate of gates.slice(2)) gate.resolve();
    await cleaning;
    assert.equal(gates.length, 8, 'no next batch after failure');
    assert.equal(store.one("SELECT COUNT(*) AS n FROM uploads WHERE state='fenced'").n, 7);
    assert.equal(store.usage().bytes, charged);
    assert.equal(store.one('SELECT state FROM sessions WHERE id=?', sessionId).state, 'deleting');
    r2.put = put;
    store.run('UPDATE sessions SET nextAttempt=0 WHERE id=?', sessionId);
    await store.alarm();
    await store.alarm();
    assert.equal(store.usage().bytes, 0);
    assert.equal(store.one('SELECT state FROM sessions WHERE id=?', sessionId).state, 'deleted');
  } finally {
    r2.put = put;
    for (const gate of gates) gate.resolve();
    await cleaning;
    st.db.close();
  }
});

test('cleanup timeout retains its operation slot until the marker settles', async () => {
  const st = state(),
    gate = Promise.withResolvers(),
    store = new CaptureStore(st, { RECORDINGS: { put: () => gate.promise } });
  try {
    await assert.rejects(store.fence('a'.repeat(32), Date.now() + 5), /deadline/);
    assert.equal(store.cleanupInflight, 1);
    assert.equal(store.inflight, 1);
    assert.equal(store.circuit, true);
    gate.resolve();
    await new Promise((r) => setImmediate(r));
    assert.equal(store.cleanupInflight, 0);
    assert.equal(store.inflight, 0);
    assert.equal(store.circuit, false);
  } finally {
    gate.resolve();
    st.db.close();
  }
});

test('cleanup batches respect the one hundred key allowance', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  try {
    const { sessionId } = await start(store);
    for (let i = 0; i < 101; i++)
      assert.equal(
        (await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: `budget-${i}` })))
          .status,
        201,
      );
    store.run("UPDATE sessions SET state='deleting' WHERE id=?", sessionId);
    await store.alarm();
    assert.equal(store.one("SELECT COUNT(*) AS n FROM uploads WHERE state='fenced'").n, 100);
    assert.equal(store.one('SELECT state FROM sessions WHERE id=?', sessionId).state, 'deleting');
    await store.alarm();
    assert.equal(store.usage().bytes, 0);
  } finally {
    st.db.close();
  }
});

test('cleanup starts no next batch after its ten second start budget', async () => {
  const st = state(),
    r2 = bucket(),
    store = new CaptureStore(st, { RECORDINGS: r2, INVITATION_GENERATION: '1' });
  const originalNow = Date.now,
    put = r2.put.bind(r2);
  try {
    const { sessionId } = await start(store);
    for (let i = 0; i < 16; i++)
      await store.fetch(req(`/api/playtest/v2/${sessionId}/event`, { id: `clock-${i}` }));
    store.run("UPDATE sessions SET state='deleting' WHERE id=?", sessionId);
    let clock = originalNow(),
      markers = 0;
    Date.now = () => clock;
    r2.put = (...args) => {
      if (++markers === 1) clock += 11000;
      return put(...args);
    };
    await store.alarm();
    assert.equal(markers, 8);
    assert.equal(store.one('SELECT state FROM sessions WHERE id=?', sessionId).state, 'deleting');
    Date.now = originalNow;
    r2.put = put;
    await store.alarm();
    assert.equal(store.usage().bytes, 0);
  } finally {
    Date.now = originalNow;
    r2.put = put;
    st.db.close();
  }
});

test('reconciliation rearms overdue alarms without postponing imminent scheduled work', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const st = state(),
    store = new CaptureStore(st, {});
  let current,
    scheduled = [];
  st.storage.getAlarm = async () => current;
  st.storage.setAlarm = async (value) => {
    scheduled.push(value);
    current = value;
  };
  try {
    for (const overdue of [1, 99999, 100000]) {
      current = overdue;
      scheduled = [];
      await store.reconcile();
      assert.deepEqual(scheduled, [100000], 'explicitly rearm overdue work immediately');
    }
    current = 100500;
    scheduled = [];
    await store.reconcile();
    assert.deepEqual(scheduled, [], 'preserve an earlier imminent alarm');
    for (const missingOrLate of [null, 200000]) {
      current = missingOrLate;
      scheduled = [];
      await store.reconcile();
      assert.deepEqual(scheduled, [101000]);
    }
  } finally {
    st.db.close();
    t.mock.timers.reset();
  }
});
