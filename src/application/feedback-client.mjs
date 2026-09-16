import { openFeedbackStore } from './feedback-store.mjs';
import { feedbackLimits } from './feedback-protocol.mjs';
import { createDialogClose, createDialogHeader } from '../presentation/dialog-close.mjs';

const messageFor = (code) =>
  code === 400
    ? 'This feedback was rejected by validation. Keep or download its local copy and ask Yaniv for help.'
    : code === 401 || code === 403
      ? 'Open your invitation again in another tab, then return here and retry.'
      : code === 404 || code === 410
        ? 'This service or recording is unavailable. Keep your saved feedback or download it.'
        : code === 409
          ? 'This submission could not be reconciled. Keep its saved copy and ask Yaniv for help.'
          : code === 413
            ? 'This feedback is too large or storage is full. Keep its saved copy and ask Yaniv for help.'
            : code === 415
              ? 'This feedback format is not supported by the server. Keep its saved copy.'
              : 'Saved on this device—waiting to send. We will retry automatically.';
const blockedCodes = [400, 401, 403, 404, 409, 410, 413, 415];
const storageFull = (error) =>
  error?.code === 'FEEDBACK_STORAGE_FULL' || error?.name === 'QuotaExceededError';
/** A full local store names the outs the player actually has right now; nothing is promised. */
export function storageFullMessage(draft, items) {
  const outs = [];
  if (draft?.image || draft?.context)
    outs.push('untick the workshop image or project details below');
  if (items.some((item) => item.outcome === 'received'))
    outs.push('delete a received local copy from your feedback history');
  if (!outs.length) outs.push('shorten the report or remove its voice comment');
  const ways = outs.length > 1 ? `${outs[0]}, or ${outs.slice(1).join(', or ')}` : outs[0];
  const sentence = `${ways[0].toUpperCase()}${ways.slice(1)}, then send again.`;
  return `This browser's feedback storage is full, so the report could not be prepared. ${sentence}`;
}
const token = (draft) => ({ id: draft.id, revision: draft.revision });
// Default captures are attached on every fresh draft; only text or voice makes it the player's
// own report, so attachments alone never count as content to keep, discard or finish.
const hasAuthoredContent = (draft) =>
  !!(draft?.text?.trim() || draft?.voice || draft?.voiceRecording);
const hasContent = hasAuthoredContent;

/** M3b requested feedback UI. Recording is a separate consent and lifetime. */
export async function mountFeedbackClient({
  trigger,
  gate,
  snapshot,
  screenshot,
  reference = () => undefined,
  onChange = () => {},
  stopTabRecording = async () => {},
  openStore = openFeedbackStore,
}) {
  let store,
    storageError = '';
  try {
    store = await openStore({ durable: !!navigator.locks?.request });
  } catch (error) {
    storageError = error.message;
    store = await openStore({ durable: false });
  }
  const cancelled = new Set();
  const attachmentEpoch = { image: 0, context: 0 };
  // The player's latest choice per attachment while its save is pending. render() shows it
  // instead of the committed draft, so a slower save for the other box cannot undo a click.
  const attachmentIntent = { image: null, context: null };
  // Capture problems are shown per kind so a later success for the other kind cannot hide them.
  const attachmentNotes = { image: '', context: '' };
  let draft = null,
    items = [],
    config = null,
    disposed = false,
    opening = false,
    editing = false,
    busy = false;
  let lockRelease = null,
    gateHeld = false,
    mode = 'compose',
    error = '',
    saveError = '',
    dirty = false,
    inputEpoch = 0;
  let writes = Promise.resolve(),
    saveTimer,
    uploadTimer,
    uploadController,
    voice = null,
    voiceStream = null;
  let voicePending = false;
  let voiceRequest = 0,
    voiceTimer,
    voiceTicker,
    voiceStarted = 0,
    voiceStoppedAt = null,
    voiceDone = null,
    voiceResolve = null,
    voiceError = '';
  const submittedPreviews = new Map(),
    historyRows = new Map();
  let historyKey = null,
    receiptKey = null;
  function clearSubmittedPreviews() {
    for (const [audio, url] of submittedPreviews) {
      audio.pause();
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
    }
    submittedPreviews.clear();
    historyRows.clear();
    q('[data-submitted-media]').replaceChildren();
    q('.playtest-comments').replaceChildren();
    historyKey = null;
    receiptKey = null;
  }
  function captureLabel(container, label, capturedAt) {
    const p = document.createElement('p'),
      time = document.createElement('time');
    time.dateTime = capturedAt;
    time.textContent = new Date(capturedAt).toLocaleString();
    p.append(`${label} captured `, time);
    container.append(p);
  }
  function submittedMedia(container, envelope) {
    if (envelope?.voice) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.setAttribute('aria-label', 'Play submitted voice comment');
      const bytes = Uint8Array.from(atob(envelope.voice.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: envelope.voice.mime }));
      audio.src = url;
      submittedPreviews.set(audio, url);
      container.append(audio);
    }
    if (envelope?.image) {
      const image = document.createElement('img');
      image.alt = 'Submitted workshop image';
      image.src = envelope.image.dataUrl;
      container.append(image);
      captureLabel(
        container,
        envelope.image.scope === 'tab' ? 'Tab image' : 'Workshop canvas image',
        envelope.image.capturedAt,
      );
    }
    if (envelope?.context) {
      const details = document.createElement('details'),
        summary = document.createElement('summary'),
        pre = document.createElement('pre');
      summary.textContent = 'Inspect submitted context';
      pre.textContent = JSON.stringify(envelope.context.value, null, 2);
      details.append(summary, pre);
      container.append(details);
      captureLabel(container, 'Project and workshop snapshot', envelope.context.capturedAt);
    }
  }
  let previewKey = null;
  let previewURL = null,
    liveText = '',
    finishing = false,
    refreshing = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'playtest-dialog feedback-dialog';
  dialog.innerHTML =
    '<h2 id="feedback-title" tabindex="-1">What would you like Yaniv to know?</h2><div class="feedback-scroll"><p class="feedback-intro">Something worked, surprised you, or got in your way.</p><p class="feedback-disclosure">Your message goes to Yaniv for review, with a picture of your workshop and a copy of your project (including programs) unless you untick them below.</p><p data-mode-note role="status"></p><div data-composer><label for="feedback-text">Your feedback</label><textarea id="feedback-text" aria-label="Your feedback" rows="4" placeholder="A sentence is enough."></textarea><p data-count class="feedback-muted"></p><p data-save role="status" class="feedback-muted"></p><div class="feedback-voice"><button data-voice class="feedback-secondary">Record voice comment</button><span data-voice-time></span><audio data-playback controls hidden aria-label="Preview voice comment"></audio><button data-remove-voice class="feedback-secondary" hidden>Remove voice comment</button><p data-voice-status role="status"></p></div><details data-attachments><summary data-attachments-summary>Workshop details</summary><p>A picture of your workshop and a snapshot of your project and workshop state are attached unless you untick them. The snapshot may include programs. Removing these attachments does not remove an existing recording.</p><label><input type="checkbox" data-image> Include workshop image</label><div data-image-preview hidden><img alt="Selected workshop image"><p></p></div><label><input type="checkbox" data-context> Include project and workshop state (programs included)</label><details data-context-preview hidden><summary>Inspect attached context</summary><p data-context-time></p><pre></pre></details><button data-remove-links class="feedback-secondary" hidden>Remove recording links</button><p data-attachment-status role="status"></p></details></div><section data-received hidden><span class="feedback-check" aria-hidden="true">✓</span><h3>Thanks for helping improve the workshop.</h3><p data-receipt-state role="status"></p><p data-submitted-text></p><div data-submitted-media></div><button data-correct class="feedback-secondary" hidden>Create corrected draft</button></section><section data-history tabindex="-1" aria-labelledby="feedback-title" hidden><h3>Your feedback history</h3><p>Submissions saved in this browser. Removing a local copy does not recall feedback already sent.</p><ol class="playtest-comments" aria-label="Your comments"></ol></section><p data-error role="status"></p></div><footer class="feedback-actions"><button data-send>Send feedback</button><button data-back hidden>Back to building</button><button data-keep class="feedback-secondary" hidden>Keep draft</button><button data-discard class="feedback-secondary" hidden>Discard draft</button><button data-another class="feedback-secondary" hidden>Add another</button><button data-history-toggle class="feedback-secondary">Your feedback history</button><button data-retry-config class="feedback-secondary" hidden>Check connection</button><button data-copy class="feedback-secondary" hidden>Download draft</button><button data-stop-recording class="feedback-secondary" hidden>Stop tab recording and open feedback</button></footer>';
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  // The × routes through the same guarded close as Escape; it never bypasses draft saving.
  dialog.prepend(
    createDialogHeader(
      dialog.querySelector('#feedback-title'),
      createDialogClose('Close feedback', () => void close()),
    ),
  );
  document.body.append(dialog);
  const privacyNotice = document.createElement('dialog');
  privacyNotice.className = 'playtest-dialog';
  privacyNotice.setAttribute('aria-label', 'Feedback privacy');
  privacyNotice.innerHTML =
    '<h2>Pause tab recording to give feedback</h2><p role="status"></p><button data-stop>Stop tab recording and open feedback</button>';
  // Closing only dismisses the notice; stopping tab recording stays an explicit action.
  privacyNotice.prepend(
    createDialogHeader(
      privacyNotice.querySelector('h2'),
      createDialogClose('Close feedback notice', () => privacyNotice.close()),
    ),
  );
  document.body.append(privacyNotice);
  privacyNotice.querySelector('[data-stop]').onclick = async () => {
    await stopTabRecording();
    privacyNotice.close();
    await open();
  };
  const q = (selector) => dialog.querySelector(selector),
    text = q('textarea');
  const supported = () =>
    config?.feedback?.enabled === true && config.feedback.protocolVersion === 1;
  const editable = () => editing && !busy && mode === 'compose';
  const itemState = (item) =>
    item.outcome === 'received'
      ? 'Sent to Yaniv for review.'
      : item.outcome === 'discarded'
        ? 'Local copy discarded. Already sent feedback may remain on the server.'
        : item.outcome === 'blocked'
          ? messageFor(item.code ?? item.error)
          : store.mode === 'durable'
            ? messageFor(item.code ?? item.error)
            : 'Sending is not confirmed. Keep this tab open to retry the same message.';
  function revokePreview() {
    q('[data-playback]').pause();
    q('[data-playback]').removeAttribute('src');
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null;
    previewKey = null;
  }
  function render() {
    if (disposed) return;
    const composing = mode === 'compose',
      received = mode === 'receipt',
      history = mode === 'history';
    q('#feedback-title').textContent = composing
      ? 'What would you like Yaniv to know?'
      : history
        ? 'Your feedback history'
        : items.at(-1)?.outcome === 'received'
          ? 'Thanks for helping improve the workshop.'
          : 'Your feedback';
    q('[data-received] h3').hidden = received && items.at(-1)?.outcome === 'received';
    q('[data-history] h3').hidden = history;
    q('[data-composer]').hidden = !composing;
    q('[data-received]').hidden = !received;
    q('[data-history]').hidden = !history;
    q('.feedback-intro').hidden = !composing;
    q('[data-error]').textContent =
      error ||
      (supported()
        ? ''
        : 'Feedback is unavailable right now. You can keep your draft and check the connection.');
    q('[data-mode-note]').textContent =
      !editing && composing
        ? 'Feedback is open in another workshop tab. Close it there, then reopen here.'
        : store.mode === 'memory'
          ? 'Text-only mode: this browser cannot save feedback reliably. Keep this tab open until sending is confirmed.'
          : '';
    q('[data-save]').textContent = saveError
      ? `Not saved on this device. ${saveError}`
      : dirty
        ? 'Saving draft…'
        : store.mode === 'durable' && draft
          ? 'Draft saved on this device.'
          : '';
    const count = [...liveText].length;
    q('[data-count]').textContent =
      count > feedbackLimits.textCharacters - 1000
        ? `${count.toLocaleString()} / ${feedbackLimits.textCharacters.toLocaleString()} characters`
        : '';
    text.disabled = !editable();
    q('[data-send]').hidden = !composing;
    q('[data-send]').disabled =
      !editable() ||
      !supported() ||
      !!voice ||
      !!draft?.voiceRecording ||
      attachmentPending() ||
      (!liveText.trim() && !draft?.voice) ||
      count > feedbackLimits.textCharacters;
    q('[data-back]').hidden = finishing || composing;
    q('[data-history-toggle]').disabled = busy;
    q('[data-another]').disabled = busy || !editing;
    q('[data-discard]').disabled = busy;
    q('[data-keep]').hidden = !finishing;
    q('[data-discard]').hidden = !(composing && hasContent(draft)) && !finishing;
    q('[data-another]').hidden = composing;
    q('[data-another]').textContent = history && (draft || dirty) ? 'Back to draft' : 'Add another';
    q('[data-history-toggle]').hidden = history;
    q('[data-copy]').hidden = !saveError && store.mode !== 'memory';
    q('[data-retry-config]').hidden = supported();
    q('[data-voice]').disabled = !editable() || store.mode !== 'durable';
    q('[data-voice]').textContent = voice
      ? 'Stop voice recording'
      : draft?.voice
        ? 'Record again'
        : 'Record voice comment';
    q('[data-remove-voice]').hidden = !draft?.voice && !draft?.voiceRecording;
    q('[data-remove-voice]').disabled = !!voice || busy;
    q('[data-voice-status]').textContent =
      voiceError ||
      (draft?.voiceRecording && !voice
        ? 'This voice recording was interrupted. Remove it to continue.'
        : '');
    const key = composing && (dialog.open || opening) ? draft?.voice?.base64 : undefined;
    if (!key && previewURL) revokePreview();
    if (key && key !== previewKey) {
      revokePreview();
      const bytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      previewURL = URL.createObjectURL(new Blob([bytes], { type: draft.voice.mime }));
      previewKey = key;
      q('[data-playback]').src = previewURL;
    }
    q('[data-playback]').hidden = !key;
    q('[data-attachments]').hidden = store.mode !== 'durable';
    q('.feedback-disclosure').textContent =
      store.mode === 'durable'
        ? 'Your message goes to Yaniv for review, with a picture of your workshop and a copy of your project (including programs) unless you untick them below.'
        : 'Your message goes to Yaniv for review. Only your message is included.';
    const attached = ['image', 'context'].filter(
      (kind) => attachmentIntent[kind] ?? !!draft?.[kind],
    );
    q('[data-attachments-summary]').textContent =
      'Workshop details: ' +
      (attached.length === 2
        ? 'image and project attached'
        : attached[0] === 'image'
          ? 'image attached'
          : attached[0] === 'context'
            ? 'project attached'
            : 'nothing attached');
    q('[data-attachment-status]').textContent = [attachmentNotes.image, attachmentNotes.context]
      .filter(Boolean)
      .join(' ');
    for (const kind of ['image', 'context']) {
      q(`[data-${kind}]`).checked = attachmentIntent[kind] ?? !!draft?.[kind];
      q(`[data-${kind}]`).disabled = !editable();
      q(`[data-${kind}-preview]`).hidden = !draft?.[kind];
    }
    if (draft?.image) {
      q('[data-image-preview] img').src = draft.image.dataUrl;
      q('[data-image-preview] p').textContent =
        `${draft.image.scope === 'tab' ? 'Tab' : 'Workshop canvas'} image captured ${new Date(draft.image.capturedAt).toLocaleTimeString()}.`;
    }
    if (draft?.context) {
      q('[data-context-preview] pre').textContent = JSON.stringify(draft.context.value, null, 2);
      q('[data-context-time]').textContent =
        `Project and workshop snapshot captured ${new Date(draft.context.capturedAt).toLocaleString()}.`;
    }
    q('[data-remove-links]').hidden = ![draft, draft?.image, draft?.context].some(
      (part) => part?.reference,
    );
    q('[data-remove-links]').disabled = !editable();
    onChange({
      dirty: dirty || !!saveError,
      pending: items.filter((item) => item.outcome === 'pending').length,
      blocked: items.filter((item) => item.outcome === 'blocked').length,
    });
  }
  function enqueue(fn) {
    const next = writes.catch(() => {}).then(fn);
    writes = next;
    return next.catch((e) => {
      saveError = e.message;
      render();
      throw e;
    });
  }
  async function persistText() {
    clearTimeout(saveTimer);
    const value = liveText,
      epoch = inputEpoch;
    if (!draft || !editing) return;
    await enqueue(async () => {
      draft = await store.saveDraft({ ...draft, text: value });
      if (inputEpoch === epoch) dirty = false;
      saveError = '';
    });
    render();
  }
  text.oninput = () => {
    liveText = text.value;
    dirty = true;
    inputEpoch++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistText().catch(() => {}), 250);
    render();
  };
  async function acquireEditor() {
    if (store.mode === 'memory') {
      editing = true;
      return true;
    }
    return new Promise((resolve, reject) => {
      navigator.locks
        .request('simulacrum-feedback-draft-v1', { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          editing = true;
          await new Promise((release) => {
            lockRelease = release;
            resolve(true);
          });
          editing = false;
        })
        .catch(reject);
    });
  }
  async function refreshItems() {
    items = await store.items();
    return items;
  }
  function showHistory() {
    if (!dialog.open && !opening) return;
    const list = q('.playtest-comments');
    const visible = [...items].reverse().filter((row) => row.outcome !== 'discarded');
    const key = JSON.stringify(visible.map((item) => item.id));
    if (historyKey === key) {
      for (const item of visible) {
        const entry = historyRows.get(item.id);
        if (!entry) continue;
        const focused = document.activeElement;
        Object.assign(entry.item, item);
        const message = itemState(item);
        if (entry.state.textContent !== message) entry.state.textContent = message;
        entry.retry.hidden = item.outcome === 'received';
        entry.correct.hidden = item.outcome !== 'blocked';
        entry.discard.textContent =
          item.outcome === 'received' ? 'Delete received local copy' : 'Discard local copy';
        if ([entry.retry, entry.correct].some((button) => button.hidden && button === focused))
          entry.state.focus({ preventScroll: true });
      }
      return;
    }
    const restoreHistoryFocus = list.contains(document.activeElement);
    clearSubmittedPreviews();
    historyKey = key;
    for (const item of visible) {
      const row = document.createElement('li');
      row.className = 'playtest-comment';
      const content = document.createElement('p');
      content.textContent = item.envelope?.text || 'Voice comment';
      const state = document.createElement('p');
      state.textContent = itemState(item);
      state.setAttribute('role', 'status');
      state.tabIndex = -1;
      row.append(content, state);
      submittedMedia(row, item.envelope);
      if (['pending', 'blocked', 'received'].includes(item.outcome)) {
        const retry = document.createElement('button');
        retry.className = 'feedback-secondary';
        retry.textContent = 'Retry';
        retry.onclick = () => void retryItem(item.id);
        const download = document.createElement('button');
        download.className = 'feedback-secondary';
        download.textContent = 'Download saved feedback';
        download.onclick = () =>
          downloadJSON(
            { envelope: item.envelope, receipt: item.receipt, bodyText: item.bodyText },
            'saved-feedback.json',
          );
        const discard = document.createElement('button');
        discard.className = 'feedback-secondary';
        discard.textContent =
          item.outcome === 'received' ? 'Delete received local copy' : 'Discard local copy';
        discard.onclick = async () => {
          if (busy) return;
          if (
            !window.confirm(
              item.outcome === 'received'
                ? 'Delete this received feedback from this browser? The server copy remains with Yaniv; this does not recall or delete it.'
                : 'Discard this local pending copy? An in-flight or received submission may remain on the server.',
            )
          )
            return;
          busy = true;
          render();
          try {
            cancelled.add(item.id);
            await store.discard(item.id);
            await refreshItems();
            error = '';
            showHistory();
          } catch (e) {
            error = `Could not remove the local copy: ${e.message}`;
          } finally {
            busy = false;
            render();
          }
        };
        const correct = document.createElement('button');
        correct.className = 'feedback-secondary';
        correct.textContent = 'Create corrected draft';
        correct.onclick = () => void correctDraft(item.id);
        correct.hidden = item.outcome !== 'blocked';
        retry.hidden = item.outcome === 'received';
        row.append(correct, retry);
        historyRows.set(item.id, { item, state, retry, correct, discard });
        row.append(download, discard);
      }
      list.append(row);
    }
    if (restoreHistoryFocus) q('[data-history]').focus();
  }
  function receipt() {
    if (!dialog.open && !opening) return;
    const item = items.at(-1);
    if (receiptKey !== item?.id) {
      clearSubmittedPreviews();
      receiptKey = item?.id;
      submittedMedia(q('[data-submitted-media]'), item?.envelope);
    }
    q('[data-correct]').hidden = item?.outcome !== 'blocked';
    q('[data-correct]').onclick = () => void correctDraft(item.id);
    q('[data-receipt-state]').textContent = item ? itemState(item) : '';
    q('[data-submitted-text]').textContent =
      item?.envelope?.text || (item?.envelope?.voice ? 'Voice comment' : '');
    q('.feedback-check').hidden = item?.outcome !== 'received';
    q('[data-received] h3').textContent =
      item?.outcome === 'received'
        ? 'Thanks for helping improve the workshop.'
        : store.mode === 'durable'
          ? 'Your feedback is saved on this device'
          : 'Sending is not confirmed';
  }
  async function open({ finish = false, history = false } = {}) {
    if (disposed || opening || dialog.open) return;
    opening = true;
    error = '';
    finishing = finish;
    try {
      // Draft ownership is nonblocking. A busy editor needs only a content-free notice,
      // never the video gate held by that editor's protected composer.
      const acquired = await acquireEditor();
      if (disposed) throw Error('Feedback closed');
      if (!acquired) {
        privacyNotice.querySelector('h2').textContent = 'Feedback is open in another tab';
        privacyNotice.querySelector('[role=status]').textContent =
          'Feedback is open in another workshop tab. Close it there, then try again.';
        privacyNotice.querySelector('[data-stop]').hidden = true;
        if (!privacyNotice.open) privacyNotice.showModal();
        return;
      }
      await gate.enter();
      gateHeld = true;
      if (disposed) throw Error('Feedback closed');
      if (acquired) {
        draft = await store.draft();
        if (draft && defaultsOnly(draft) && !history) {
          // A draft the player never wrote (left by reload or dispose) must not carry old captures.
          await store.discardDraft(token(draft));
          draft = null;
        }
        if (draft) {
          attachmentNotes.image = attachmentNotes.context = '';
          q('[data-attachments]').open = !!(draft.image || draft.context);
        }
        if (!draft && !history) {
          try {
            draft = await newDraft();
          } catch (e) {
            error = `A new draft could not be saved: ${e.message}. Review your saved feedback below; deleting a received local copy can free space.`;
            history = true;
          }
        }
        liveText = draft?.text || '';
        text.value = liveText;
      } else {
        draft = null;
        liveText = '';
        text.value = '';
      }
      await refreshItems();
      mode = history ? 'history' : 'compose';
      if (history) showHistory();
      render();
      dialog.showModal();
      if (acquired && !history) text.focus();
    } catch (e) {
      error = `Feedback is not open yet: ${e.message}`;
      trigger.title = error;
      onChange(error);
      privacyNotice.querySelector('h2').textContent = 'Pause tab recording to give feedback';
      privacyNotice.querySelector('[data-stop]').hidden = false;
      privacyNotice.querySelector('[role=status]').textContent =
        error + ' Close or reload older workshop tabs if recording continues there.';
      if (!privacyNotice.open && !disposed) privacyNotice.showModal();
      if (gateHeld) {
        gate.leave();
        gateHeld = false;
      }
      lockRelease?.();
      lockRelease = null;
      editing = false;
    } finally {
      opening = false;
    }
  }
  async function stopVoice() {
    voiceRequest++;
    clearTimeout(voiceTimer);
    clearInterval(voiceTicker);
    const current = voice;
    if (!current) return;
    if (current.state !== 'inactive') {
      voiceStoppedAt ??= performance.now();
      current.stop();
    }
    voiceStream?.getTracks().forEach((track) => track.stop());
    await voiceDone;
  }
  async function close() {
    if (opening || (busy && !voicePending)) return;
    q('[data-playback]').pause();
    await stopVoice();
    try {
      await persistText();
    } catch {}
    if (dirty || saveError) {
      error = 'Your latest draft could not be saved. Download it or keep this window open.';
      render();
      return;
    }
    if (defaultsOnly(draft)) {
      // Never send days-old captures: a draft the player never wrote is dropped on close.
      const stale = draft;
      draft = null;
      const discard = writes.catch(() => {}).then(() => store.discardDraft(token(stale)));
      writes = discard.catch(() => {});
      await discard.catch(() => {});
    }
    revokePreview();
    clearSubmittedPreviews();
    dialog.close();
    finishing = false;
    lockRelease?.();
    lockRelease = null;
    editing = false;
    if (gateHeld) {
      gate.leave();
      gateHeld = false;
    }
    trigger.focus();
    render();
  }
  async function discardDraft() {
    if (!draft) return;
    if (
      !window.confirm(
        'Discard this unsent draft? This removes its local text and starts a new draft with a fresh workshop image and project.',
      )
    )
      return;
    await stopVoice();
    clearTimeout(saveTimer);
    await enqueue(async () => {
      await store.discardDraft(token(draft));
      draft = finishing ? null : await newDraft();
    });
    liveText = '';
    text.value = '';
    dirty = false;
    saveError = '';
    voiceError = '';
    saveError = '';
    revokePreview();
    q('[data-playback]').hidden = true;
    if (finishing) await close();
    else render();
  }
  const attachmentPending = () =>
    attachmentIntent.image !== null || attachmentIntent.context !== null;
  async function send() {
    if (!editable() || !supported() || voice || attachmentPending()) return;
    busy = true;
    error = '';
    render();
    let textSaved = false;
    try {
      await persistText();
      textSaved = true;
      await enqueue(async () => {
        await store.freeze(token(draft));
        draft = null;
      });
      liveText = '';
      text.value = '';
      dirty = false;
      saveError = '';
      mode = 'receipt';
      finishing = false;
      revokePreview();
      await refreshItems();
      receipt();
      render();
      q('#feedback-title').focus();
      void pump();
    } catch (e) {
      // The draft survives a failed freeze, so a full store must not also read as "not saved";
      // a full store that refused the last text save is still unsaved and keeps saying so.
      if (storageFull(e)) {
        if (textSaved) saveError = '';
        error = storageFullMessage(draft, items);
      } else error = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  async function pump() {
    if (disposed || refreshing || !supported()) return;
    refreshing = true;
    try {
      for (const candidate of await store.items()) {
        const item = (await store.items()).find((row) => row.id === candidate.id);
        if (!item || cancelled.has(item.id)) continue;
        if (disposed || item.outcome !== 'pending' || (item.retryAt || 0) > Date.now()) continue;
        try {
          uploadController = new AbortController();
          const deadline = setTimeout(() => uploadController?.abort(), 15000);
          let response;
          try {
            response = await fetch('/api/playtest/feedback/v1/submission', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: item.bodyText,
              signal: uploadController.signal,
            });
            if (!response.ok)
              throw Object.assign(Error(messageFor(response.status)), { status: response.status });
            await store.acknowledge(item.id, await response.json());
          } finally {
            clearTimeout(deadline);
            uploadController = null;
          }
        } catch (e) {
          const code = e.status || 0;
          await store.failure(item.id, {
            code,
            permanent: blockedCodes.includes(code),
            retryAt: Date.now() + Math.min(60000, 2000 * 2 ** Math.min(item.attempts || 0, 5)),
          });
        }
      }
      await refreshItems();
      if (mode === 'receipt') receipt();
      if (mode === 'history') showHistory();
      render();
    } catch (e) {
      error = `Cannot read saved feedback: ${e.message}`;
      render();
    } finally {
      refreshing = false;
    }
  }
  async function correctDraft(id) {
    if (busy || !editing) return;
    busy = true;
    render();
    try {
      await persistText();
      draft = await store.correctDraft(id);
      liveText = draft.text;
      text.value = liveText;
      dirty = false;
      saveError = '';
      error = '';
      revokePreview();
      clearSubmittedPreviews();
      mode = 'compose';
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
    if (mode === 'compose') text.focus();
  }
  async function retryItem(id) {
    await store.retry(id);
    await pump();
  }
  /** Capture one attachment now; throws with a player-readable reason when it cannot. */
  function capture(kind) {
    const attachmentReference = reference(),
      capturedAt = new Date().toISOString();
    if (kind === 'image') {
      const shot = screenshot?.();
      if (!shot) throw Error('Workshop image unavailable. You can send your message without it.');
      if (new TextEncoder().encode(shot).length > feedbackLimits.imageBytes)
        throw Error('Workshop image is too large. You can send without it.');
      return {
        dataUrl: shot,
        scope: 'canvas',
        capturedAt,
        ...(attachmentReference ? { reference: attachmentReference } : {}),
      };
    }
    const json = JSON.stringify(snapshot());
    if (new TextEncoder().encode(json).length > feedbackLimits.contextBytes)
      throw Error('Workshop context is too large. You can send without it.');
    return {
      value: JSON.parse(json),
      capturedAt,
      ...(attachmentReference ? { reference: attachmentReference } : {}),
    };
  }
  /**
   * A fresh draft starts with the workshop image and project attached (durable stores only:
   * text-only browsers hide the attachment controls, so a default there could not be unticked).
   * Each capture is taken now, so a report always carries what the player saw when opening it.
   */
  async function newDraft() {
    const initial = {};
    attachmentNotes.image = attachmentNotes.context = '';
    if (store.mode === 'durable')
      for (const kind of ['image', 'context'])
        try {
          initial[kind] = capture(kind);
        } catch (e) {
          attachmentNotes[kind] = e.message;
        }
    let created;
    try {
      created = await store.createDraft(initial);
    } catch (e) {
      // The store validates captures too (image type, sizes); keep the draft, show the reason.
      if (!Object.keys(initial).length) throw e;
      created = await store.createDraft({});
      for (const kind of Object.keys(initial)) attachmentNotes[kind] = e.message;
    }
    q('[data-attachments]').open = store.mode === 'durable';
    return created;
  }
  const defaultsOnly = (value) => !!value && !hasAuthoredContent(value);
  async function attach(kind, checked) {
    if (!editable()) return;
    const expectedId = draft?.id,
      epoch = ++attachmentEpoch[kind];
    attachmentIntent[kind] = checked;
    render();
    try {
      await persistText();
      if (draft?.id !== expectedId || attachmentEpoch[kind] !== epoch || !editing || !dialog.open)
        return;
      const value = checked ? capture(kind) : undefined;
      await enqueue(async () => {
        if (draft?.id !== expectedId || attachmentEpoch[kind] !== epoch || !editing || !dialog.open)
          return;
        const next = { ...draft };
        if (checked) next[kind] = value;
        else delete next[kind];
        draft = await store.saveDraft(next);
      });
      attachmentNotes[kind] = '';
    } catch (e) {
      attachmentNotes[kind] = e.message;
    } finally {
      if (attachmentEpoch[kind] === epoch) attachmentIntent[kind] = null;
    }
    render();
  }
  async function recordVoice() {
    if (voice) {
      await stopVoice();
      return;
    }
    if (!editable() || store.mode !== 'durable') return;
    if (draft?.voice && !window.confirm('Replace this unsent voice comment with a new recording?'))
      return;
    const request = ++voiceRequest;
    voicePending = true;
    voiceError = '';
    busy = true;
    render();
    let stream;
    try {
      await persistText();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== voiceRequest || disposed || !dialog.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime)
        throw Error('Voice recording is unavailable in this browser. You can write instead.');
      await enqueue(async () => {
        draft = await store.beginVoice(token(draft), mime);
      });
      if (request !== voiceRequest || disposed || !dialog.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      voicePending = false;
      voiceStream = stream;
      voice = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      const recorder = voice;
      voiceDone = new Promise((resolve) => {
        voiceResolve = resolve;
      });
      voiceStarted = performance.now();
      voiceStoppedAt = null;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        void enqueue(async () => {
          draft = await store.appendVoiceChunk(token(draft), event.data);
        })
          .then(() => {
            if (draft?.voiceRecording?.overflow) void stopVoice();
          })
          .catch((e) => {
            voiceError = `Voice could not be saved: ${e.message}`;
            void stopVoice();
          });
      };
      recorder.onerror = () => {
        voiceError = 'Voice recording failed. Remove the clip or record again.';
        void stopVoice();
      };
      recorder.onstop = () => {
        voiceStream?.getTracks().forEach((t) => t.stop());
        const stoppedAt = voiceStoppedAt ?? performance.now();
        void enqueue(async () => {
          if (!voiceError)
            draft = await store.finalizeVoice(
              token(draft),
              feedbackVoiceDuration(voiceStarted, stoppedAt),
            );
        })
          .then(() => {
            revokePreview();
            if (draft?.voice) {
              const bytes = Uint8Array.from(atob(draft.voice.base64), (c) => c.charCodeAt(0));
              previewURL = URL.createObjectURL(new Blob([bytes], { type: draft.voice.mime }));
              q('[data-playback]').src = previewURL;
              q('[data-playback]').hidden = false;
            }
          })
          .catch((e) => {
            voiceError = `Voice could not be finalized: ${e.message}. Remove it to send your text.`;
          })
          .finally(() => {
            voice = null;
            voiceStream = null;
            clearTimeout(voiceTimer);
            clearInterval(voiceTicker);
            voiceResolve?.();
            voiceResolve = null;
            render();
          });
      };
      recorder.start(250);
      // Request stop early; delayed callbacks beyond the hard limit are rejected, never relabeled.
      voiceTimer = setTimeout(() => void stopVoice(), feedbackLimits.voiceDurationMs - 1000);
      voiceTicker = setInterval(() => {
        q('[data-voice-time]').textContent =
          `${Math.floor((performance.now() - voiceStarted) / 1000)} / 60 seconds`;
      }, 250);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      voiceError = `Microphone unavailable: ${e.message}. You can write instead.`;
      voice = null;
      voiceResolve?.();
    } finally {
      busy = false;
      voicePending = false;
      render();
    }
  }
  function downloadJSON(value, name) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  q('[data-send]').onclick = () => void send();
  q('[data-back]').onclick = q('[data-keep]').onclick = () => void close();
  q('[data-discard]').onclick = () => void discardDraft();
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const stops = [
      ...dialog.querySelectorAll(
        'button, input, textarea, select, summary, audio[controls], a[href], [tabindex]',
      ),
    ].filter((node) => node.tabIndex >= 0 && !node.disabled && node.checkVisibility());
    const first = stops[0],
      last = stops.at(-1);
    if (!first) {
      event.preventDefault();
      q('#feedback-title').focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === q('#feedback-title') ||
        document.activeElement === q('[data-history]'))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void close();
  });
  q('[data-another]').onclick = async () => {
    if (busy || !editing) return;
    busy = true;
    render();
    try {
      if (!draft) {
        draft = await newDraft();
        liveText = draft.text || '';
      }
      text.value = liveText;
      clearSubmittedPreviews();
      mode = 'compose';
      error = '';
    } catch (e) {
      error = `A new draft could not be saved: ${e.message}. Delete a received local copy to free space.`;
    } finally {
      busy = false;
      render();
    }
    if (mode === 'compose') text.focus();
  };
  q('[data-history-toggle]').onclick = async () => {
    if (busy) return;
    q('[data-playback]').pause();
    await stopVoice();
    // Recovery must remain reachable when saving the live draft is exactly what failed.
    await persistText().catch(() => {});
    await refreshItems();
    revokePreview();
    mode = 'history';
    showHistory();
    render();
    q('[data-history]').focus();
  };
  q('[data-remove-links]').onclick = async () => {
    if (!editable()) return;
    busy = true;
    render();
    try {
      await persistText();
      await enqueue(async () => {
        const changed = structuredClone(draft);
        for (const part of [changed, changed.image, changed.context])
          if (part) delete part.reference;
        draft = await store.saveDraft(changed);
      });
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  };
  q('[data-image]').onchange = (event) => void attach('image', event.target.checked);
  q('[data-context]').onchange = (event) => void attach('context', event.target.checked);
  q('[data-voice]').onclick = () => void recordVoice();
  q('[data-remove-voice]').onclick = async () => {
    await enqueue(async () => {
      draft = await store.cancelVoice(token(draft));
    });
    voiceError = '';
    saveError = '';
    revokePreview();
    q('[data-playback]').hidden = true;
    render();
  };
  q('[data-copy]').onclick = () =>
    downloadJSON({ ...draft, text: liveText }, 'feedback-draft.json');
  q('[data-retry-config]').onclick = async () => {
    try {
      const response = await fetch('/api/playtest/config', { signal: AbortSignal.timeout(10000) });
      config = response.ok ? await response.json() : null;
    } catch {
      config = null;
    }
    render();
    void pump();
  };
  trigger.onclick = () => void open();
  const beforeUnload = (event) => {
    if (
      dirty ||
      saveError ||
      voice ||
      (store.mode === 'memory' && items.some((item) => item.outcome === 'pending'))
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  const wake = () => void pump();
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  uploadTimer = setInterval(pump, 3000);
  if (storageError) saveError = storageError;
  render();
  return {
    configure(value) {
      config = value;
      render();
      void pump();
    },
    open,
    stopVoice,
    async finish() {
      voiceRequest++;
      voiceStream?.getTracks().forEach((t) => t.stop());
      await stopVoice();
      await persistText().catch(() => {});
      await writes.catch(() => {});
      const saved = await store.draft().catch(() => draft);
      if (hasContent(saved) || dirty || saveError) {
        if (dialog.open) {
          finishing = true;
          clearSubmittedPreviews();
          mode = 'compose';
          render();
          if (!text.disabled) text.focus();
          else q('#feedback-title').focus();
        } else await open({ finish: true });
        return true;
      }
      return false;
    },
    async hasDraft() {
      return hasContent(await store.draft());
    },
    status: () => ({
      dirty: dirty || !!saveError,
      pending: items.filter((item) => item.outcome === 'pending' || item.outcome === 'blocked')
        .length,
    }),
    dispose() {
      const save = persistText().catch(() => {});
      revokePreview();
      clearSubmittedPreviews();
      dialog.remove();
      privacyNotice.remove();
      disposed = true;
      voiceRequest++;
      clearTimeout(saveTimer);
      clearInterval(uploadTimer);
      clearInterval(voiceTicker);
      clearTimeout(voiceTimer);
      uploadController?.abort();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      voiceStream?.getTracks().forEach((t) => t.stop());
      void stopVoice()
        .then(() => save)
        .then(() => writes.catch(() => {}))
        .finally(() => {
          lockRelease?.();
          lockRelease = null;
          revokePreview();
          clearSubmittedPreviews();
          dialog.remove();
          if (gateHeld) gate.leave();
          gateHeld = false;
          revokePreview();
          store.close();
        });
    },
  };
}
export const feedbackFailureMessage = messageFor;
export function feedbackVoiceDuration(start, stop) {
  const elapsed = stop - start;
  if (!Number.isFinite(start) || !Number.isFinite(stop) || elapsed <= 0)
    throw Error('Invalid voice duration');
  if (elapsed > feedbackLimits.voiceDurationMs)
    throw Error('Voice clip exceeds the 60 second limit. Remove it or record again.');
  return elapsed;
}
