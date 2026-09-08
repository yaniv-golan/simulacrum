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
      r2.get = async (...args) => {
        if (fail) {
          fail = false;
          throw Error('lost read');
        }
        return get(...args);
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
