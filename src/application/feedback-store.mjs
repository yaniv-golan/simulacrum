import {
  feedbackLimits,
  validateFeedbackEnvelope,
  validateFeedbackVoice,
  encodeFeedbackEnvelope,
  validateFeedbackReceipt,
} from './feedback-protocol.mjs';
/** M3b local feedback ownership. This database never touches capture outboxes. */
export const FEEDBACK_DB = 'simulacrum-feedback-v1';
const clone = (value) => structuredClone(value);
const conflict = () =>
  Object.assign(Error('Feedback draft revision conflict'), { code: 'FEEDBACK_REVISION_CONFLICT' });
const draftFields = ['text', 'voice', 'image', 'context', 'reference'];
const textOnly = (draft) => {
  if (draft.voice || draft.voiceRecording || draft.image || draft.context)
    throw Error('Non-durable feedback is text only');
};
function envelopeOf(draft) {
  const envelope = {
    protocolVersion: 1,
    id: draft.id,
    createdAt: draft.createdAt,
    text: draft.text,
  };
  for (const field of draftFields.slice(1))
    if (draft[field] !== undefined) envelope[field] = clone(draft[field]);
  return envelope;
}
function validateDraft(draft, mode) {
  if (mode === 'memory') textOnly(draft);
  // Empty drafts are legal; submission admission still requires text or finalized voice.
  const envelope = envelopeOf(draft);
  if (
    typeof envelope.text !== 'string' ||
    [...envelope.text].length > feedbackLimits.textCharacters
  )
    throw Error('Invalid feedback draft text');
  validateFeedbackEnvelope({ ...envelope, text: envelope.text.trim() ? envelope.text : 'draft' });
  if (draft.voiceRecording) {
    const recording = draft.voiceRecording;
    if (
      !Array.isArray(recording.chunks) ||
      recording.chunks.some((chunk) => !(chunk instanceof Blob)) ||
      recording.bytes !== recording.chunks.reduce((sum, chunk) => sum + chunk.size, 0) ||
      recording.bytes > feedbackLimits.voiceBytes
    )
      throw Error('Invalid local voice chunks');
  }
}
export async function openFeedbackStore({
  indexedDB = globalThis.indexedDB,
  durable = true,
  name = FEEDBACK_DB,
  storageBytes = 32 * 1024 ** 2,
} = {}) {
  const mode = durable ? 'durable' : 'memory';
  let db,
    memory = { draft: null, items: [] },
    closed = false;
  if (durable) {
    if (!indexedDB) throw Error('Feedback storage unavailable');
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('Feedback storage unavailable'));
      request.onblocked = () => reject(Error('Feedback storage upgrade blocked'));
    });
  }
  function bounded(state) {
    const bytes =
      new TextEncoder().encode(JSON.stringify(state)).length +
      (state.draft?.voiceRecording?.bytes || 0);
    if (bytes > storageBytes)
      throw Object.assign(Error('Local feedback storage limit reached'), {
        code: 'FEEDBACK_STORAGE_FULL',
      });
  }
  function transaction(fn, write = true) {
    if (closed) return Promise.reject(Error('Feedback store closed'));
    if (!db) {
      try {
        const state = clone(memory),
          result = fn(state);
        if (write) {
          bounded(state);
          memory = state;
        }
        return Promise.resolve(clone(result));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly'),
        store = tx.objectStore('state'),
        request = store.get('current');
      let result, failure;
      request.onsuccess = () => {
        try {
          const state = request.result || { draft: null, items: [] };
          result = fn(state);
          if (write) {
            bounded(state);
            store.put(state, 'current');
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(clone(result));
      tx.onabort = tx.onerror = () =>
        reject(failure || tx.error || Error('Feedback storage transaction failed'));
    });
  }
  function current(state, token) {
    if (!token || state.draft?.id !== token.id || state.draft.revision !== token.revision)
      throw conflict();
    return state.draft;
  }
  function change(token, fn) {
    token = clone(token);
    return transaction((state) => {
      const draft = current(state, token);
      fn(draft);
      draft.revision++;
      validateDraft(draft, mode);
      return draft;
    });
  }
  const api = {
    mode,
    close() {
      closed = true;
      db?.close();
    },
    draft: () => transaction((state) => state.draft, false),
    items: () => transaction((state) => state.items, false),
    createDraft(initial = {}) {
      initial = clone(initial);
      return transaction((state) => {
        if (state.draft)
          throw Object.assign(Error('A feedback draft already exists'), {
            code: 'FEEDBACK_DRAFT_EXISTS',
          });
        const draft = {
          id: crypto.randomUUID(),
          revision: 0,
          createdAt: new Date().toISOString(),
          text: '',
        };
        for (const field of draftFields)
          if (initial[field] !== undefined) draft[field] = clone(initial[field]);
        validateDraft(draft, mode);
        state.draft = draft;
        return draft;
      });
    },
    correctDraft(id) {
      return transaction((state) => {
        const item = state.items.find((row) => row.id === id);
        if (item?.outcome !== 'blocked') throw Error('Only blocked feedback can be corrected');
        // Default image/context captures alone are not an unsent report; only text or voice is.
        if (
          state.draft &&
          (state.draft.text?.trim() || state.draft.voice || state.draft.voiceRecording)
        )
          throw Error(
            'You already have an unsent draft. Send or discard it before creating a correction.',
          );
        const draft = {
          id: crypto.randomUUID(),
          revision: 0,
          createdAt: new Date().toISOString(),
          text: '',
        };
        for (const field of draftFields)
          if (item.envelope[field] !== undefined) draft[field] = clone(item.envelope[field]);
        validateDraft(draft, mode);
        state.draft = draft;
        return draft;
      });
    },
    saveDraft(value) {
      value = clone(value);
      return change(value, (draft) => {
        for (const field of draftFields) {
          if (value[field] === undefined) delete draft[field];
          else draft[field] = clone(value[field]);
        }
        // Recorder-owned chunks are never replaced by a text/attachment save.
      });
    },
    discardDraft(token) {
      token = clone(token);
      return transaction((state) => {
        current(state, token);
        state.draft = null;
        return true;
      });
    },
    async freeze(token) {
      token = clone(token);
      const snapshot = await transaction((state) => {
        const prior = state.items.find((item) => item.id === token.id);
        if (prior && prior.sourceRevision === token.revision && prior.outcome !== 'discarded')
          return { prior };
        return { draft: current(state, token) };
      }, false);
      if (snapshot.prior) return snapshot.prior;
      if (snapshot.draft.voiceRecording)
        throw Error('Finalize or remove the unfinished voice clip before sending');
      const envelope = envelopeOf(snapshot.draft),
        encoded = await encodeFeedbackEnvelope(envelope);
      return transaction((state) => {
        const prior = state.items.find((item) => item.id === token.id);
        if (prior && prior.sourceRevision === token.revision && prior.outcome !== 'discarded')
          return prior;
        current(state, token);
        const item = {
          id: envelope.id,
          envelope,
          ...encoded,
          sourceRevision: token.revision,
          outcome: 'pending',
          attempts: 0,
          retryAt: 0,
        };
        state.items.push(item);
        state.draft = null;
        return item;
      });
    },
    acknowledge(id, receipt) {
      receipt = clone(receipt);
      return transaction((state) => {
        const row = state.items.find((item) => item.id === id);
        if (!row || !validateFeedbackReceipt(receipt, row))
          throw Error('Feedback receipt mismatch');
        if (row.outcome === 'discarded') return false;
        if (
          row.receipt &&
          Object.keys(row.receipt).some((key) => row.receipt[key] !== receipt[key])
        )
          throw Error('Conflicting feedback receipt');
        row.receipt = clone(receipt);
        row.outcome = 'received';
        row.retryAt = 0;
        delete row.error;
        return row;
      });
    },
    failure(id, { code, retryAt = 0, permanent = false } = {}) {
      return transaction((state) => {
        const row = state.items.find((item) => item.id === id);
        if (!row || ['received', 'discarded'].includes(row.outcome)) return false;
        if (!Number.isFinite(retryAt) || retryAt < 0) throw Error('Invalid feedback retry time');
        row.attempts++;
        row.error = code ?? 'network';
        row.retryAt = retryAt;
        row.outcome = permanent ? 'blocked' : 'pending';
        return row;
      });
    },
    retry(id) {
      return transaction((state) => {
        const row = state.items.find((item) => item.id === id);
        if (!row || ['received', 'discarded'].includes(row.outcome)) return false;
        row.outcome = 'pending';
        row.retryAt = 0;
        delete row.error;
        return row;
      });
    },
    discard(id) {
      return transaction((state) => {
        const row = state.items.find((item) => item.id === id);
        if (!row) return false;
        row.outcome = 'discarded';
        row.bodyText = null;
        row.envelope = null;
        row.retryAt = 0;
        delete row.receipt;
        delete row.error;
        return true;
      });
    },
    beginVoice(token, mime) {
      return change(token, (draft) => {
        validateFeedbackVoice({ mime, base64: 'AAAA', durationMs: 1 });
        delete draft.voice;
        draft.voiceRecording = { mime, chunks: [], bytes: 0 };
      });
    },
    appendVoiceChunk(token, chunk) {
      return change(token, (draft) => {
        if (!draft.voiceRecording || !(chunk instanceof Blob))
          throw Error('Voice recording unavailable');
        const recording = draft.voiceRecording;
        if (recording.overflow || recording.bytes + chunk.size > feedbackLimits.voiceBytes) {
          recording.overflow = true;
          return;
        }
        recording.chunks.push(chunk);
        recording.bytes += chunk.size;
      });
    },
    async finalizeVoice(token, durationMs) {
      token = clone(token);
      const draft = await transaction((state) => current(state, token), false),
        recording = draft.voiceRecording;
      if (!recording || recording.overflow) throw Error('Voice clip unavailable or exceeds limit');
      const bytes = new Uint8Array(await new Blob(recording.chunks).arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const voice = { mime: recording.mime, base64: btoa(binary), durationMs };
      validateFeedbackVoice(voice);
      return change(token, (currentDraft) => {
        currentDraft.voice = voice;
        delete currentDraft.voiceRecording;
      });
    },
    cancelVoice(token) {
      return change(token, (draft) => {
        delete draft.voice;
        delete draft.voiceRecording;
      });
    },
  };
  api.startVoice = api.beginVoice;
  api.appendVoice = api.appendVoiceChunk;
  return api;
}
