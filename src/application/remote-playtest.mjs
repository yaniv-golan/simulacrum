function uploadFailureMessage(code) {
  return code === 401 || code === 403
    ? 'Open your invitation again in another tab, then return here. Keep this tab open.'
    : code === 404
      ? 'This session is unavailable. Keep this tab open and ask Yaniv to restore it.'
      : code === 413
        ? 'An upload is too large or the session is full. Keep this tab open and ask Yaniv for help.'
        : [409, 410, 415].includes(code)
          ? 'This upload cannot be delivered. Export or discard its saved bytes.'
          : 'Uploads not received yet — retrying automatically. Keep this tab open.';
}

import { openCaptureOutbox } from './capture-outbox.mjs';
/** Consented remote usability capture; never an authority for simulation state. */
export async function mountRemotePlaytest({ context, checkpoint }) {
  const uploadTimeoutMs = 45000;
  const config = await fetch('/api/playtest/config')
    .then((r) =>
      r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null,
    )
    .catch(() => null);
  if (!config?.enabled) return null;
  if (config.protocolVersion !== 2) {
    const notice = document.createElement('p');
    notice.textContent =
      'Recording needs a compatible server. Saved recordings have not been changed.';
    document.body.append(notice);
    return { active: () => false, emit: () => {}, dispose: () => notice.remove() };
  }
  const canRecord =
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder === 'function';
  if (!canRecord) {
    const notice = document.createElement('dialog');
    notice.className = 'playtest-dialog';
    notice.innerHTML =
      '<h2>Open the playtest on a computer</h2><p>This browser cannot record a workshop tab. No recording has started.</p><p>For the recorded playtest, open the same invitation link in Chrome or Edge on a laptop or desktop. The workshop also works best with a keyboard and mouse.</p><button>Browse without recording</button>';
    document.body.append(notice);
    notice.querySelector('button').onclick = () => notice.close();
    notice.showModal();
    return { active: () => false, emit: () => {}, dispose: () => notice.remove() };
  }
  const outbox = await openCaptureOutbox();
  let durableRows = [],
    durableGroups = [];
  const reconcile = async () => {
    durableRows = await outbox.items();
    durableGroups = await outbox.groups();
    const picker = completion.querySelector('[data-session]');
    if (picker) {
      const chosen = picker.value;
      const ids = [
        ...new Set(
          [
            ...durableRows.map((r) => r.sessionId),
            ...(await outbox.starts()).map((r) => r.ack?.sessionId || r.sessionId),
          ].filter(Boolean),
        ),
      ];
      picker.replaceChildren(
        ...ids.map((id, index) => {
          const option = document.createElement('option');
          option.value = id;
          const blocked = durableRows.some((r) => r.sessionId === id && r.outcome === 'blocked');
          option.textContent = `Recording ${index + 1}${id === session ? ' (current)' : ''}${blocked ? ' — needs attention' : ''}`;
          return option;
        }),
      );
      if (ids.includes(chosen)) picker.value = chosen;
      else if (ids.includes(session)) picker.value = session;
    }
    if (
      session &&
      ((await outbox.starts()).some(
        (row) => row.sessionId === session && row.outcome === 'discarded',
      ) ||
        durableRows.some((row) => row.sessionId === session && row.outcome === 'discarded'))
    ) {
      captureError = 'Local recording was discarded; delivery is not complete.';
      if (active) stop();
    }
    queued = durableRows.filter((row) => ['pending', 'blocked'].includes(row.outcome)).length;
    for (const receipt of receipts) {
      const rows = durableRows.filter((row) => row.group === receipt.id);
      const group = durableGroups.find((row) => row.id === receipt.id);
      receipt.pending = rows.filter((row) => row.outcome !== 'received').length;
      receipt.error ||= rows.some((row) => row.outcome === 'discarded') || !!group?.discarded;
      if (group) receipt.sealed = group.sealed;
    }
  };
  let startAttempt = null;
  let session = null,
    origin = 0,
    seq = 0,
    active = false,
    busy = false,
    queued = 0,
    voice = null,
    video = null,
    timer = null,
    anchor = null,
    failed = '',
    pendingWrites = 0,
    captureError = '',
    voiceRequest = 0,
    voiceReceipt = null;
  let disposed = false,
    finishing = false,
    starting = false,
    dbClosed = false,
    startingStream = null,
    startController = null,
    uploadController = null;
  const recorders = new Set(),
    receipts = [],
    uploadReceipts = new Map();
  let recoveredIds = null,
    recoveredCount = 0;
  const projectStatus = `<h2>Build something that moves</h2><p><strong>We are improving the basic builder.</strong> Parts, wiring, movement, undo and save/load work today. The controls still need to feel right.</p><p><strong>Your feedback decides whether this stage is ready.</strong> Try building, and tell us when something feels confusing.</p><details><summary>Where the project goes next</summary><ol><li><strong>Now:</strong> improve building and editing until the designated player's feedback accepts this stage. Automated checks must also pass.</li><li><strong>Next:</strong> safe programmable controllers, then physical experiments for standing, shifting weight, lifting feet, stepping and stopping. Each must work before progressing.</li><li><strong>Then:</strong> terrain, better failure explanations and a rover that completes the ramp course with verified performance.</li><li><strong>Later:</strong> walkers, deeper editing and an in-game agent helper, with movement and real-player checks.</li><li><strong>Final goal:</strong> a walker goes down the ramp, takes five more steps, loops around, climbs back up and settles at its starting position. It must pass fixed variation, replay, safety, performance and human checks.</li></ol></details>`;
  const panel = document.createElement('section');
  panel.className = 'playtest-panel';
  panel.innerHTML =
    '<strong>Remote playtest</strong><button data-project>Project status</button><span data-status><span data-status-main>Ready</span><span data-status-detail></span></span><button data-feedback>Give feedback</button><button data-end>Finish session</button>';
  document.body.append(panel);
  const dialog = document.createElement('dialog');
  dialog.className = 'playtest-dialog';
  dialog.innerHTML =
    projectStatus +
    '<p data-recovery role="status" hidden></p><p><strong>To start:</strong> share only this workshop tab. Its video and your actions will be sent to Yaniv for review.</p><p>Use <strong>Give feedback</strong> anytime. Write a sentence or record a voice note; your view is attached. The microphone runs only when you choose voice recording.</p><button data-start>Share workshop tab & start</button><p data-error role="status"></p>';
  document.body.append(dialog);
  dialog.showModal();
  const projectDialog = document.createElement('dialog');
  projectDialog.className = 'playtest-dialog';
  projectDialog.innerHTML =
    projectStatus + '<button data-close-project>Back to the workshop</button>';
  document.body.append(projectDialog);
  panel.querySelector('[data-project]').onclick = () => projectDialog.showModal();
  projectDialog.querySelector('[data-close-project]').onclick = () => projectDialog.close();
  const completion = document.createElement('dialog');
  completion.className = 'playtest-dialog playtest-completion';
  completion.innerHTML =
    '<h2>Finishing your session</h2><p data-completion-status role="status"></p><button data-retry>Retry uploads</button><button data-close-completion>Close</button>';
  document.body.append(completion);
  completion.querySelector('[data-retry]').onclick = () => void pump();
  completion.querySelector('[data-close-completion]').onclick = () => completion.close();
  function closeDatabaseIfIdle() {
    if (disposed && !dbClosed && !busy && !pendingWrites && !recorders.size) {
      dbClosed = true;
      outbox.close();
    }
  }
  const status = () => {
    if (disposed) return;
    const pending = queued + pendingWrites,
      flushing = recorders.size > 0 && !active;
    const recovery = dialog.querySelector('[data-recovery]');
    recovery.hidden = !recoveredCount;
    if (recoveredCount)
      recovery.textContent =
        (recoveredIds.size
          ? `Recovering ${recoveredIds.size} saved uploads from an earlier session. ${failed || 'Sending to Yaniv. Keep this tab open.'}`
          : 'Saved uploads from your earlier session were received by Yaniv’s playtest server.') +
        (active
          ? ' Your new recording is running.'
          : ' Recording has not resumed. Share this workshop tab to start a new recording.');
    const saved =
      !!session && !active && !pending && !flushing && !busy && !captureError && !failed;
    panel.querySelector('[data-status-main]').textContent = captureError
      ? 'Recording stopped'
      : failed
        ? 'Uploads delayed'
        : active
          ? '● Recording tab'
          : saved
            ? 'Session saved'
            : pending || flushing
              ? 'Saving session'
              : 'Ready to record';
    panel.querySelector('[data-status-detail]').textContent =
      captureError ||
      failed ||
      (active
        ? 'Video and actions are sent automatically.'
        : saved
          ? 'All received'
          : pending || flushing
            ? 'Sending recording. Keep this tab open.'
            : 'Share the workshop tab to begin.');
    panel.querySelector('[data-feedback]').disabled = !active;
    panel.querySelector('[data-end]').disabled = !active;
    for (const receipt of receipts)
      receipt.status.textContent = receipt.error
        ? 'Not sent — could not save on this device. Keep this tab open.'
        : !receipt.sealed
          ? 'Recording voice comment…'
          : receipt.pending || pendingWrites
            ? failed
              ? 'Not received yet. ' + failed
              : 'Sending to Yaniv…'
            : 'Received by Yaniv’s playtest server.';
    completion.querySelector('h2').textContent = saved ? 'Session saved' : 'Finishing your session';
    completion.querySelector('[data-completion-status]').textContent = saved
      ? 'Feedback received — session saved. You can close this tab.'
      : captureError || failed
        ? 'Session not fully saved. ' + (captureError || failed) + '. Keep this tab open.'
        : 'Sending your session and final recording to Yaniv. Keep this tab open.';
    completion.querySelector('[data-retry]').hidden = saved || !failed;
  };
  async function pump() {
    if (busy || disposed) return;
    busy = true;
    try {
      while (!disposed) {
        await reconcile();
        const items = durableRows.filter((row) => ['pending', 'blocked'].includes(row.outcome));
        if (recoveredIds === null) {
          recoveredIds = new Set(items.map((row) => row.id));
          recoveredCount = recoveredIds.size;
        }
        if (disposed) break;
        if (!items.length) {
          failed = '';
          break;
        }
        const next = await outbox.next();
        if (!next) {
          failed = items.some((row) => row.outcome === 'blocked')
            ? uploadFailureMessage(items.find((row) => row.outcome === 'blocked').error)
            : 'Uploads delayed — retrying automatically.';
          break;
        }
        try {
          const target = new URL(next.url, location.origin);
          if (
            !next.url.startsWith('/api/playtest/') ||
            target.origin !== location.origin ||
            !target.pathname.startsWith('/api/playtest/')
          )
            throw Error('Invalid upload destination');
          uploadController = new AbortController();
          const timeout = setTimeout(() => uploadController?.abort(), uploadTimeoutMs);
          let response, ack;
          try {
            response = await fetch(next.url, {
              method: 'POST',
              headers: { 'Content-Type': next.type },
              body: next.body,
              signal: uploadController.signal,
            });
            if (!response.ok)
              throw Object.assign(Error(`Upload ${response.status}`), {
                status: response.status,
                retryAfter: Number(response.headers?.get('retry-after') || 0) * 1000,
              });
            ack = JSON.parse(await response.text());
          } finally {
            clearTimeout(timeout);
            uploadController = null;
          }
          await outbox.acknowledge(next, ack);
          recoveredIds.delete(next.id);
          await reconcile();
          failed = '';
          status();
        } catch (error) {
          await outbox.failure(next, error.status || 0, error.retryAfter || 0);
          failed = uploadFailureMessage(error.status);
          continue;
        }
      }
    } catch {
      failed = 'Cannot read saved uploads — retrying automatically';
    } finally {
      busy = false;
      status();
      closeDatabaseIfIdle();
    }
  }
  async function send(url, body, type, receipt) {
    pendingWrites++;
    if (receipt) receipt.pending++;
    status();
    try {
      const id = await outbox.enqueue({ url, body, type, group: receipt?.id || null });
      if (receipt) uploadReceipts.set(id, receipt);
      queued++;
      void pump();
    } catch (error) {
      if (receipt) receipt.error = true;
      captureError = `Capture stopped: ${error.message}`;
      stop();
    } finally {
      pendingWrites--;
      status();
      closeDatabaseIfIdle();
    }
  }
  function writeEvent(kind, data, receipt) {
    try {
      const event = {
        id: `event-${++seq}`,
        seq,
        timeMs: performance.now() - origin,
        at: new Date().toISOString(),
        kind,
        data,
        context: context(),
      };
      void send(
        `/api/playtest/v2/${session}/event`,
        new Blob([JSON.stringify(event)], { type: 'application/json' }),
        'application/json',
        receipt,
      );
      return seq;
    } catch (error) {
      captureError = `Capture stopped: ${error.message}`;
      stop();
    }
  }
  function emit(kind, data, receipt) {
    if (active && !disposed) return writeEvent(kind, data, receipt);
  }
  function media(stream, kind, clip, receipt) {
    let index = 0;
    const sessionId = session;
    const mime = (
      kind === 'screen'
        ? ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    ).find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      ...(kind === 'screen' ? { videoBitsPerSecond: 1200000 } : { audioBitsPerSecond: 64000 }),
    });
    recorders.add(recorder);
    recorder.ondataavailable = (event) => {
      if (event.data.size)
        void send(
          `/api/playtest/v2/${sessionId}/media?kind=${kind}&clip=${clip}&seq=${index++}`,
          event.data,
          event.data.type || 'application/octet-stream',
          receipt,
        );
    };
    recorder.onstop = () => {
      recorders.delete(recorder);
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (receipt) {
        receipt.sealed = true;
        pendingWrites++;
        void outbox
          .group({ id: receipt.id, sessionId, sealed: true })
          .catch(() => {
            receipt.error = true;
          })
          .finally(() => {
            pendingWrites--;
            status();
            closeDatabaseIfIdle();
          });
      }
      status();
      closeDatabaseIfIdle();
    };
    recorder.onerror = () => {
      captureError = `${kind} recording failed`;
      if (receipt) receipt.error = true;
      stop();
    };
    try {
      recorder.start(3000);
    } catch (error) {
      recorders.delete(recorder);
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      throw error;
    }
    return recorder;
  }
  function stopVoice(capture = active) {
    voiceRequest++;
    if (voice?.state === 'recording') {
      voice.stop();
      voice.stream.getTracks().forEach((track) => track.stop());
      if (capture) writeEvent('voice-end', { anchorId: anchor.id }, voiceReceipt);
    }
    feedback.querySelector('[data-voice]').textContent = 'Record voice comment';
  }
  function releaseVideo() {
    video?.pause();
    if (video) video.srcObject = null;
    video = null;
  }
  function stop() {
    if (finishing) return;
    finishing = true;
    const wasActive = active;
    active = false;
    clearInterval(timer);
    try {
      stopVoice(wasActive);
      if (wasActive) writeEvent('session-end', { checkpoint: checkpoint() });
    } catch (error) {
      captureError = `Capture stopped: ${error.message}`;
    } finally {
      for (const recorder of recorders) {
        if (recorder.state !== 'inactive') recorder.stop();
        for (const track of recorder.stream.getTracks()) {
          track.onended = null;
          track.stop();
        }
      }
      releaseVideo();
      finishing = false;
      status();
      if (wasActive && !disposed) {
        feedback.close();
        if (!completion.open) completion.showModal();
      }
    }
  }
  dialog.querySelector('[data-start]').onclick = async () => {
    if (disposed || active || starting) return;
    const button = dialog.querySelector('[data-start]');
    button.disabled = true;
    starting = true;
    let stream,
      ready = false;
    startController = new AbortController();
    let timeout;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
        preferCurrentTab: true,
      });
      if (disposed) return;
      startingStream = stream;
      timeout = setTimeout(() => startController?.abort(), uploadTimeoutMs);
      const settings = stream.getVideoTracks()[0].getSettings();
      if (settings.displaySurface && settings.displaySurface !== 'browser')
        throw Error('Please choose the workshop browser tab, rather than your whole screen.');
      const start =
        startAttempt ||
        (await outbox.prepareStart({
          build: document.querySelector('meta[name=build-id]').content,
          startedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
        }));
      startAttempt = start;
      const response = await fetch('/api/playtest/v2/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: start.bodyText,
        signal: startController.signal,
      });
      if (!response.ok) throw Error('Could not start the session. Please retry.');
      const created = await response.json();
      await outbox.acceptStart(start, created);
      startAttempt = null;
      if (disposed) return;
      session = created.sessionId;
      seq = 0;
      origin = performance.now();
      video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      if (disposed) return;
      const initialCheckpoint = checkpoint();
      media(stream, 'screen', 'tab');
      active = true;
      ready = true;
      captureError = '';
      emit('session-start', {
        timeOrigin: performance.timeOrigin,
        checkpoint: initialCheckpoint,
        screen: settings,
      });
      if (!active) return;
      stream.getVideoTracks()[0].onended = () => {
        emit('screen-share-ended', {});
        stop();
      };
      timer = setInterval(() => emit('state-sample', {}), 1000);
      dialog.close();
      status();
    } catch (error) {
      if (!disposed)
        dialog.querySelector('[data-error]').textContent =
          error.name === 'NotAllowedError'
            ? 'Tab sharing was cancelled or blocked. Try again and choose this workshop tab. If it stays blocked, check your browser’s screen-sharing permissions.'
            : error.name === 'NotFoundError' || error.name === 'NotSupportedError'
              ? 'Tab recording is unavailable in this browser. Open this invitation in Chrome or Edge on a computer.'
              : error.name === 'NotReadableError'
                ? 'The browser could not record the tab. Check your computer’s screen-recording permissions, then try again.'
                : error.name === 'Error'
                  ? error.message
                  : 'Could not start tab recording. Try again, or open this invitation in Chrome or Edge on a computer.';
    } finally {
      clearTimeout(timeout);
      startController = null;
      startingStream = null;
      starting = false;
      if (!ready) {
        active = false;
        stream?.getTracks().forEach((track) => track.stop());
        releaseVideo();
      }
      if (!disposed) button.disabled = false;
      closeDatabaseIfIdle();
    }
  };
  const feedback = document.createElement('dialog');
  feedback.className = 'playtest-dialog';
  feedback.innerHTML =
    '<button class="playtest-close" data-dismiss aria-label="Close feedback">×</button><h2>What felt wrong?</h2><p>Your view is attached. Comments go to Yaniv for review.</p><textarea aria-label="Your feedback" placeholder="What did you expect? What happened?" rows="4"></textarea><button data-write>Send written feedback</button><button data-voice>Record voice comment</button><button data-close>Back to building</button><p role="status"></p><ol class="playtest-comments" aria-label="Your comments" aria-live="polite"></ol>';
  document.body.append(feedback);
  function comment(text) {
    const row = document.createElement('li');
    row.className = 'playtest-comment';
    const content = document.createElement('p'),
      state = document.createElement('p');
    content.textContent = text;
    row.append(content, state);
    feedback.querySelector('.playtest-comments').append(row);
    const receipt = {
      id: crypto.randomUUID(),
      pending: 0,
      sealed: true,
      error: false,
      status: state,
    };
    pendingWrites++;
    void outbox
      .group({ id: receipt.id, sessionId: session, sealed: true })
      .catch(() => {
        receipt.error = true;
      })
      .finally(() => {
        pendingWrites--;
        status();
        closeDatabaseIfIdle();
      });
    receipts.push(receipt);
    return receipt;
  }
  panel.querySelector('[data-feedback]').onclick = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.round((video.videoHeight * canvas.width) / video.videoWidth);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    anchor = {
      id: crypto.randomUUID(),
      timeMs: performance.now() - origin,
      context: context(),
      checkpoint: checkpoint(),
      image: canvas.toDataURL('image/jpeg', 0.65),
    };
    emit('feedback-anchor', anchor);
    feedback.showModal();
  };
  feedback.querySelector('[data-write]').onclick = () => {
    const text = feedback.querySelector('textarea').value.trim();
    if (!text || !active) return;
    emit('feedback-text', { anchorId: anchor.id, text }, comment(text));
    feedback.querySelector('textarea').value = '';
    const list = feedback.querySelector('.playtest-comments');
    list.scrollTop = list.scrollHeight;
  };
  feedback.querySelector('[data-voice]').onclick = async () => {
    const button = feedback.querySelector('[data-voice]');
    if (voice?.state === 'recording') {
      stopVoice();
      return;
    }
    const request = ++voiceRequest;
    button.disabled = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== voiceRequest || !active || !feedback.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      voiceReceipt = comment('Voice comment');
      voiceReceipt.sealed = false;
      await outbox.group({ id: voiceReceipt.id, sessionId: session, sealed: false });
      emit('voice-start', { anchorId: anchor.id, clip: `${anchor.id}-${seq + 1}` }, voiceReceipt);
      voice = media(stream, 'voice', `${anchor.id}-${seq}`, voiceReceipt);
      button.textContent = '● Stop voice recording';
      status();
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (voiceReceipt && !voiceReceipt.sealed) {
        voiceReceipt.error = true;
        voiceReceipt.sealed = true;
      }
      feedback.querySelector('[role=status]').textContent =
        `Microphone unavailable: ${e.message}. You can write instead.`;
      status();
    } finally {
      button.disabled = false;
    }
  };
  const closeFeedback = () => {
    stopVoice();
    feedback.close();
  };
  feedback.querySelector('[data-close]').onclick = closeFeedback;
  feedback.querySelector('[data-dismiss]').onclick = closeFeedback;
  feedback.addEventListener('cancel', () => stopVoice());
  panel.querySelector('[data-end]').onclick = () => stop();
  const recoveryActions = document.createElement('div');
  recoveryActions.innerHTML =
    '<label>Saved recording <select data-session></select></label><button data-export>Download saved uploads</button><button data-discard>Discard a saved session</button><button data-delete>Delete a local session</button><button data-legacy>Download recordings from an older version</button>';
  completion.append(recoveryActions);
  recoveryActions.querySelector('[data-export]').onclick = async () => {
    const rows = await outbox.items();
    const parts = ['{"protocolVersion":2,"items":['];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (i) parts.push(',');
      parts.push(JSON.stringify({ ...row, body: undefined }).slice(0, -1));
      if (row.body) {
        parts.push(',"base64":"');
        const bytes = new Uint8Array(await row.body.arrayBuffer());
        for (let offset = 0; offset < bytes.length; offset += 32766)
          parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32766))));
        parts.push('"');
      }
      parts.push('}');
    }
    parts.push('],"starts":' + JSON.stringify(await outbox.starts()) + '}');
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'saved-playtest.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  recoveryActions.querySelector('[data-discard]').onclick = async () => {
    const id = completion.querySelector('[data-session]').value;
    if (
      id &&
      window.confirm('Discard this session’s local undelivered recording? This cannot be undone.')
    ) {
      await outbox.discard(id);
      await reconcile();
      status();
    }
  };
  recoveryActions.querySelector('[data-delete]').onclick = async () => {
    const id = completion.querySelector('[data-session]').value;
    if (
      id &&
      window.confirm(
        'Delete local payloads and receipts for this session? Download them first if needed.',
      )
    ) {
      await outbox.deleteSession(id);
      await reconcile();
      status();
    }
  };
  recoveryActions.querySelector('[data-legacy]').onclick = async () => {
    try {
      if (!indexedDB.databases)
        throw Error(
          'This browser cannot inspect older recordings. Use the original version to recover them.',
        );
      const databases = await indexedDB.databases();
      if (!databases.some((db) => db.name === 'simulacrum-playtest-outbox'))
        throw Error('No older recordings on this origin.');
      const legacy = await new Promise((resolve, reject) => {
        const r = indexedDB.open('simulacrum-playtest-outbox');
        r.onupgradeneeded = () => {
          r.transaction.abort();
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      let items;
      try {
        items = await new Promise((resolve, reject) => {
          const tx = legacy.transaction('items', 'readonly'),
            r = tx.objectStore('items').getAll();
          tx.oncomplete = () => resolve(r.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        legacy.close();
      }
      const parts = ['{"protocolVersion":1,"items":['];
      for (let i = 0; i < items.length; i++) {
        if (i) parts.push(',');
        const row = items[i];
        parts.push(JSON.stringify({ ...row, body: undefined }).slice(0, -1) + ',"base64":"');
        const bytes = new Uint8Array(await row.body.arrayBuffer());
        for (let offset = 0; offset < bytes.length; offset += 32766)
          parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32766))));
        parts.push('"}');
      }
      parts.push(']}');
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' })),
        link = document.createElement('a');
      link.href = url;
      link.download = 'older-playtest.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      completion.querySelector('[data-completion-status]').textContent = error.message;
    }
  };
  const manage = document.createElement('button');
  manage.textContent = 'Manage saved recordings';
  dialog.append(manage);
  manage.onclick = () => {
    dialog.close();
    completion.showModal();
  };
  completion.querySelector('[data-retry]').onclick = async () => {
    await outbox.retry(completion.querySelector('[data-session]').value || undefined);
    void pump();
  };
  const originalConsoleError = console.error;
  const consoleError = (...args) => {
    emit('console-error', {
      message: args
        .map((value) => String(value))
        .join(' ')
        .slice(0, 2000),
    });
    originalConsoleError.apply(console, args);
  };
  console.error = consoleError;
  const onError = (event) =>
    emit('browser-error', { message: event.message ?? String(event.reason) });
  const beforeUnload = (event) => {
    if (active || queued || pendingWrites || recorders.size || captureError) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  window.addEventListener('beforeunload', beforeUnload);
  const recoverStarts = async () => {
    for (const start of await outbox.starts()) {
      if (start.outcome !== 'pending' || disposed) continue;
      try {
        const response = await fetch('/api/playtest/v2/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: start.bodyText,
          signal: AbortSignal.timeout(uploadTimeoutMs),
        });
        if (response.ok) await outbox.acceptStart(start, await response.json());
      } catch {
        /* Preserve immutable creation attempts for later explicit recovery. */
      }
    }
  };
  // Recovery never starts a recorder. The user still chooses a tab on Start.
  pendingWrites++;
  void recoverStarts().finally(() => {
    pendingWrites--;
    closeDatabaseIfIdle();
  });
  const onFocus = () => void pump();
  window.addEventListener('focus', onFocus);
  window.addEventListener('visibilitychange', onFocus);
  const uploadTimer = setInterval(pump, 3000);
  pump();
  status();
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(uploadTimer);
    startController?.abort();
    // An already dispatched upload owns its bounded timeout and receipt. Let it
    // settle; disposed prevents another dispatch and storage closes after busy clears.
    startingStream?.getTracks().forEach((track) => track.stop());
    stop();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    window.removeEventListener('beforeunload', beforeUnload);
    if (console.error === consoleError) console.error = originalConsoleError;
    for (const element of [panel, dialog, projectDialog, completion, feedback]) element.remove();
    // Final MediaRecorder callbacks may still enqueue chunks. Keep storage alive
    // until those writes settle; a future mount resumes the durable outbox.
    closeDatabaseIfIdle();
  }
  return { active: () => active, emit, dispose };
}
