import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openFeedbackStore, FEEDBACK_DB } from '../src/application/feedback-store.mjs';
const ack = (row) => ({
  protocolVersion: 1,
  submissionId: row.id,
  uploadHash: row.uploadHash,
  receivedAt: new Date().toISOString(),
  status: 'received',
});
test('draft revisions fence stale tabs, discard and freeze retain exact durable submission', async () => {
  const indexedDB = new IDBFactory(),
    a = await openFeedbackStore({ indexedDB }),
    b = await openFeedbackStore({ indexedDB });
  let draft = await a.createDraft({ text: 'first' });
  const old = draft;
  draft = await a.saveDraft({ ...draft, text: 'second' });
  await assert.rejects(b.saveDraft({ ...old, text: 'stale' }), /revision/i);
  assert.equal((await b.draft()).text, 'second');
  const row = await a.freeze(draft);
  assert.equal(await b.draft(), null);
  assert.equal((await b.items())[0].bodyText, row.bodyText);
  await assert.rejects(b.saveDraft({ ...draft, text: 'late' }), /revision/i);
  await assert.rejects(
    a.acknowledge(row.id, { ...ack(row), uploadHash: 'a'.repeat(64) }),
    /receipt/i,
  );
  await b.acknowledge(row.id, ack(row));
  const receipt = (await a.items())[0].receipt;
  await a.acknowledge(row.id, receipt);
  assert.equal((await a.items()).length, 1);
  await a.discard(row.id);
  await b.acknowledge(row.id, receipt);
  assert.equal((await a.items())[0].outcome, 'discarded');
  assert.equal((await a.items())[0].bodyText, null);
  a.close();
  b.close();
});
test('voice chunks are local bounded and revision fenced; discard cannot resurrect', async () => {
  const store = await openFeedbackStore({ indexedDB: new IDBFactory() });
  let d = await store.createDraft({ text: 'keep' });
  d = await store.startVoice(d, 'audio/webm');
  d = await store.appendVoice(d, new Blob(['abc']));
  assert.equal((await store.draft()).voiceRecording.bytes, 3);
  await assert.rejects(store.freeze(d), /voice/i);
  d = await store.finalizeVoice(d, 100);
  assert.equal(d.voice.base64, 'YWJj');
  assert.equal(d.voiceRecording, undefined);
  await store.discardDraft(d);
  await assert.rejects(store.saveDraft(d), /revision/i);
  assert.equal(await store.draft(), null);
  store.close();
});
test('memory fallback is explicit text only and write failures do not clear drafts', async () => {
  const store = await openFeedbackStore({ durable: false });
  assert.equal(store.mode, 'memory');
  const d = await store.createDraft({ text: 'keep' });
  await assert.rejects(store.saveDraft({ ...d, image: {} }), /text.only/i);
  assert.equal((await store.draft()).text, 'keep');
  const row = await store.freeze(d);
  assert.equal(row.envelope.text, 'keep');
  const broken = {
    open() {
      throw Error('storage denied');
    },
  };
  await assert.rejects(openFeedbackStore({ indexedDB: broken }), /storage denied/);
});
test('queued caller mutation cannot rewrite a draft and semantically equal receipt retries are idempotent', async () => {
  const store = await openFeedbackStore({ indexedDB: new IDBFactory() });
  const d = await store.createDraft(),
    edit = { ...d, text: 'chosen' };
  const saving = store.saveDraft(edit);
  edit.text = 'later caller mutation';
  const saved = await saving;
  assert.equal(saved.text, 'chosen');
  const row = await store.freeze(saved),
    receipt = ack(row);
  await store.acknowledge(row.id, receipt);
  const reordered = Object.fromEntries(Object.entries(receipt).reverse());
  await store.acknowledge(row.id, reordered);
  assert.equal((await store.items())[0].outcome, 'received');
  store.close();
});
test('storage exhaustion leaves draft editable and oversized audio remains bounded and unsendable', async () => {
  // 300 bytes hold the draft but not its frozen row; a frozen row no longer carries a second
  // copy of the envelope, so the 400-byte budget this test once used now fits it.
  const store = await openFeedbackStore({ indexedDB: new IDBFactory(), storageBytes: 300 });
  let draft = await store.createDraft({ text: 'kept' });
  await assert.rejects(store.saveDraft({ ...draft, text: 'x'.repeat(700) }), /storage limit/);
  assert.equal((await store.draft()).text, 'kept');
  await assert.rejects(store.freeze(draft), /storage limit/);
  assert.equal((await store.draft()).id, draft.id);
  assert.equal((await store.items()).length, 0);
  store.close();
  const audio = await openFeedbackStore({ indexedDB: new IDBFactory() });
  draft = await audio.createDraft({ text: 'keep' });
  draft = await audio.beginVoice(draft, 'audio/webm');
  draft = await audio.appendVoiceChunk(draft, new Blob([new Uint8Array(2 * 1024 ** 2 + 1)]));
  assert.equal(draft.voiceRecording.bytes, 0);
  assert.equal(draft.voiceRecording.overflow, true);
  await assert.rejects(audio.finalizeVoice(draft, 100), /limit/);
  draft = await audio.cancelVoice(draft);
  assert.equal((await audio.freeze(draft)).envelope.text, 'keep');
  audio.close();
});

test('corrected draft preserves blocked bytes and never replaces another contribution', async () => {
  const store = await openFeedbackStore({ indexedDB: new IDBFactory() });
  const source = await store.createDraft({
    text: 'Original',
    reference: { sessionId: 'a'.repeat(32), timeMs: 10 },
  });
  const item = await store.freeze(source);
  await store.failure(item.id, { permanent: true, code: 400 });
  await store.createDraft();
  const corrected = await store.correctDraft(item.id);
  assert.notEqual(corrected.id, item.id);
  assert.equal(corrected.text, source.text);
  assert.deepEqual(corrected.reference, source.reference);
  assert.equal((await store.items())[0].bodyText, item.bodyText);
  await assert.rejects(store.correctDraft(item.id), /unsent draft/i);
  assert.deepEqual(await store.draft(), corrected);
  await store.discardDraft(corrected);
  await store.acknowledge(item.id, ack(item));
  await assert.rejects(store.correctDraft(item.id), /blocked/i);
  store.close();
});
const rawState = (indexedDB) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(FEEDBACK_DB, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        request = db.transaction('state').objectStore('state').get('current');
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    };
  });
test('frozen items persist their bytes once and read the envelope back from them', async () => {
  const indexedDB = new IDBFactory(),
    store = await openFeedbackStore({ indexedDB });
  const context = { value: { a: 1 }, capturedAt: new Date().toISOString() };
  const draft = await store.createDraft({ text: 'once', context });
  const row = await store.freeze(draft);
  assert.deepEqual(row.envelope, JSON.parse(row.bodyText), 'freeze returns the derived envelope');
  const persisted = (await rawState(indexedDB)).items[0];
  assert.equal('envelope' in persisted, false, 'only the hashed bytes are stored');
  assert.equal(persisted.bodyText, row.bodyText);
  const [item] = await store.items();
  assert.deepEqual(item.envelope, JSON.parse(row.bodyText));
  assert.equal(item.envelope.context.value.a, 1);
  const parses = [];
  const parse = JSON.parse;
  JSON.parse = (...args) => {
    parses.push(args[0]);
    return parse(...args);
  };
  try {
    await store.items();
    await store.items();
  } finally {
    JSON.parse = parse;
  }
  assert.equal(parses.length, 0, 'a store parses each item once, not per read');
  await store.discard(row.id);
  assert.equal((await store.items())[0].envelope, null, 'discarded rows read exactly null');
  store.close();
});
test('legacy rows read their bytes as truth and drop the second copy on write', async () => {
  const indexedDB = new IDBFactory(),
    store = await openFeedbackStore({ indexedDB });
  const draft = await store.createDraft({ text: 'truth' });
  const row = await store.freeze(draft);
  store.close();
  await new Promise((resolve, reject) => {
    const open = indexedDB.open(FEEDBACK_DB, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('state', 'readwrite'),
        state = tx.objectStore('state');
      const read = state.get('current');
      read.onsuccess = () => {
        const current = read.result;
        current.items[0].envelope = { ...JSON.parse(row.bodyText), text: 'stale copy' };
        current.items.push({
          ...current.items[0],
          id: 'corrupt',
          uploadHash: 'c'.repeat(64),
          bodyText: '{not json',
        });
        state.put(current, 'current');
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const reopened = await openFeedbackStore({ indexedDB });
  const items = await reopened.items();
  assert.equal(items[0].envelope.text, 'truth', 'the stored copy is ignored');
  assert.equal(items[1].envelope, null, 'unreadable bytes read null without failing the list');
  await reopened.retry(row.id);
  const persisted = await rawState(indexedDB);
  assert.equal('envelope' in persisted.items[0], false, 'the next write drops the legacy copy');
  reopened.close();
});
test('one stored copy leaves room the doubled copy did not', async () => {
  const context = { value: { pad: 'x'.repeat(40 * 1024) }, capturedAt: new Date().toISOString() };
  const probe = await openFeedbackStore({ indexedDB: new IDBFactory() });
  const sample = await probe.createDraft({ text: 'sized', context });
  const size = new TextEncoder().encode(JSON.stringify({ draft: sample, items: [] })).length;
  probe.close();
  // Budget: the draft and one frozen copy fit; a second copy of the context would not.
  const store = await openFeedbackStore({
    indexedDB: new IDBFactory(),
    storageBytes: size + 2048,
  });
  const draft = await store.createDraft({ text: 'sized', context });
  const row = await store.freeze(draft);
  assert.equal(row.envelope.context.value.pad.length, 40 * 1024);
  assert.equal((await store.items()).length, 1);
  store.close();
});
test('the browser’s own quota error reaches the caller by name', async () => {
  const indexedDB = new IDBFactory(),
    store = await openFeedbackStore({ indexedDB });
  const draft = await store.createDraft({ text: 'quota' });
  // A put that fails on quota fires the request's error event before the abort sets the
  // transaction's error; the store must keep that DOMException, not its generic failure.
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    return this.transaction._execRequestAsync({
      operation: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      source: this,
    });
  };
  try {
    await assert.rejects(store.freeze(draft), (error) => error.name === 'QuotaExceededError');
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal((await store.draft()).id, draft.id, 'the draft survives the refused write');
  store.close();
});
