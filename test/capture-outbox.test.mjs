import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openCaptureOutbox, validReceipt } from '../src/application/capture-outbox.mjs';
test('v2 durable receipt survives another tab closing and wrong identity preserves payload', async () => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const a = await openCaptureOutbox(),
    b = await openCaptureOutbox();
  try {
    const id = await a.enqueue({
      url: `/api/playtest/v2/${'a'.repeat(32)}/event`,
      body: new Blob(['{"id":"one"}']),
      type: 'application/json',
      group: 'g',
    });
    const row = (await b.items())[0],
      ack = {
        protocolVersion: 2,
        sessionId: row.sessionId,
        logicalKey: row.logicalKey,
        uploadHash: row.uploadHash,
        sequence: 1,
        receivedAt: new Date().toISOString(),
      };
    assert.equal(validReceipt(row, { ...ack, sessionId: 'b'.repeat(32) }), false);
    await assert.rejects(b.acknowledge(row, { ...ack, uploadHash: 'wrong' }));
    assert.ok((await a.items())[0].body);
    await b.acknowledge(row, ack);
    b.close();
    assert.equal((await a.items())[0].id, id);
    assert.equal((await a.items())[0].outcome, 'received');
    assert.equal((await a.items())[0].body, null);
    await a.acknowledge(row, ack);
    await assert.rejects(a.acknowledge(row, { ...ack, sequence: 2 }));
  } finally {
    a.close();
    b.close();
    globalThis.indexedDB = original;
  }
});

test('explicit local deletion is not a receipt and prevents another tab recreating its uploads', async () => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const a = await openCaptureOutbox(),
    b = await openCaptureOutbox();
  try {
    const value = {
      url: `/api/playtest/v2/${'b'.repeat(32)}/event`,
      body: new Blob(['{"id":"one"}']),
      type: 'application/json',
    };
    await a.enqueue(value);
    const row = (await a.items())[0];
    await b.deleteSession(row.sessionId);
    assert.equal((await a.items()).length, 0);
    assert.equal((await a.starts())[0].outcome, 'discarded');
    await assert.rejects(a.enqueue(value), /deleted/);
    await assert.rejects(
      a.acknowledge(row, {
        protocolVersion: 2,
        sessionId: row.sessionId,
        logicalKey: row.logicalKey,
        uploadHash: row.uploadHash,
        sequence: 1,
        receivedAt: new Date().toISOString(),
      }),
      /unavailable/,
    );
  } finally {
    a.close();
    b.close();
    globalThis.indexedDB = original;
  }
});

test('frozen legacy database access cannot discover or remove v2 payloads', async () => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const legacy = await new Promise((resolve, reject) => {
    const r = indexedDB.open('simulacrum-playtest-outbox', 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const v2 = await openCaptureOutbox();
  try {
    await v2.enqueue({
      url: `/api/playtest/v2/${'c'.repeat(32)}/event`,
      body: new Blob(['{"id":"private-v2"}']),
      type: 'application/json',
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = legacy.transaction('items', 'readonly'),
        r = tx.objectStore('items').getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
    });
    assert.equal(rows.length, 0);
    await new Promise((resolve, reject) => {
      const tx = legacy.transaction('items', 'readwrite');
      tx.objectStore('items').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    assert.equal((await v2.items()).length, 1);
  } finally {
    legacy.close();
    v2.close();
    globalThis.indexedDB = original;
  }
});

test('terminal errors isolate the whole session and Retry-After is a minimum', async (t) => {
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  t.after(() => (globalThis.indexedDB = original));
  const box = await openCaptureOutbox();
  const sid = 'c'.repeat(32),
    other = 'd'.repeat(32);
  const make = (s, id) =>
    box.enqueue({
      url: `/api/playtest/v2/${s}/event`,
      body: new Blob([JSON.stringify({ id })]),
      type: 'application/json',
    });
  await make(sid, 'bad');
  await make(sid, 'later');
  await make(other, 'healthy');
  const bad = (await box.items()).find((r) => r.sessionId === sid);
  await box.failure(bad, 410);
  assert.equal((await box.next()).sessionId, other);
  await box.retry(sid);
  const oldRandom = Math.random;
  Math.random = () => 0;
  const now = Date.now();
  try {
    await box.failure(bad, 429, 60000);
  } finally {
    Math.random = oldRandom;
  }
  assert.ok((await box.items()).find((r) => r.id === bad.id).nextAttempt >= now + 60000);
  await box.deleteSession(sid);
  await box.deleteSession(other);
  box.close();
});
