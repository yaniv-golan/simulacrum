import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openFeedbackStore } from '../src/application/feedback-store.mjs';
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
  const store = await openFeedbackStore({ indexedDB: new IDBFactory(), storageBytes: 400 });
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
