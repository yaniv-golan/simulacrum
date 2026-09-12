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

import { packCapturePacket } from './capture-packet.mjs';
import { createCaptureEncoder, captureStreamLimits } from './capture-stream.mjs';
import { openCaptureOutbox } from './capture-outbox.mjs';
import { mountFeedbackClient } from './feedback-client.mjs';
import { createFeedbackCaptureGate } from './feedback-capture-gate.mjs';
import { measureRecordedDuration } from './capture-media-duration.mjs';
/** Consented remote usability capture; never an authority for simulation state. */
export async function mountRemotePlaytest({
  context,
  checkpoint,
  screenshot,
  measureVideoDuration = measureRecordedDuration,
}) {
  const uploadTimeoutMs = 45000;
  const panel = document.createElement('section');
  panel.className = 'playtest-panel';
  panel.innerHTML =
    '<strong>Remote playtest</strong><button data-project>Project status</button><span data-status><span data-status-main>Ready</span><span data-status-detail></span></span><button data-setup>Start recording</button><button data-feedback aria-label="Give feedback">Give feedback<small data-feedback-state></small></button><button data-end hidden>Finish session</button>';
  document.body.append(panel);
  let captureHooks = {},
    recordingReference = () => undefined;
  const captureGate = createFeedbackCaptureGate({
    onSuppress: () => captureHooks.suppress?.(),
    onResume: () => captureHooks.resume?.(),
  });
  // A browser without coordination cannot start tab video in this build.
  const feedbackGate = captureGate.isSupported
    ? captureGate
    : { enter: async () => {}, leave: () => {} };
  let client;
  client = await mountFeedbackClient({
    trigger: panel.querySelector('[data-feedback]'),
    gate: feedbackGate,
    context,
    checkpoint,
    screenshot,
    reference: () => recordingReference(),
    stopTabRecording: () => captureHooks.stop?.(),
    onChange: (message) => {
      if (typeof message === 'string')
        panel.querySelector('[data-status-detail]').textContent = message;
      else if (message)
        panel.querySelector('[data-feedback-state]').textContent = message.dirty
          ? 'Draft not saved'
          : message.blocked
            ? 'Needs attention'
            : message.pending
              ? 'Waiting to send'
              : '';
    },
  });
  const config = await fetch('/api/playtest/config', { signal: AbortSignal.timeout(10000) })
    .then((r) =>
      r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null,
    )
    .catch(() => null);
  client.configure(config);
  if (!config?.enabled) {
    panel.querySelector('[data-setup]').disabled = true;
    panel.querySelector('[data-project]').hidden = true;
    panel.querySelector('[data-status-detail]').textContent =
      'Recording unavailable. Feedback drafts remain accessible.';
    return {
      active: () => false,
      emit: () => {},
      dispose: () => {
        client.dispose();
        void captureGate.close();
        panel.remove();
      },
    };
  }
  if (config.protocolVersion !== 2) {
    const notice = document.createElement('p');
    notice.textContent =
      'Recording needs a compatible server. Saved recordings have not been changed.';
    document.body.append(notice);
    panel.querySelector('[data-setup]').disabled = true;
    return {
      active: () => false,
      emit: () => {},
      dispose: () => {
        notice.remove();
        client.dispose();
        void captureGate.close();
        panel.remove();
      },
    };
  }
  const canRecord =
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder === 'function' &&
    captureGate.isSupported;
  const outbox = await openCaptureOutbox();
  let durableRows = [],
    durableGroups = [];
  const readDurableState = async () => {
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
  // A stale read must not overwrite a newer enqueue/acknowledgement observation.
  let reconciliation = Promise.resolve();
  const reconcile = () => {
    const current = reconciliation.catch(() => {}).then(readDurableState);
    reconciliation = current;
    return current;
  };
  let startAttempt = null;
  let encoder,
    packetSeq = 0,
    packet = [],
    packetBytes = 0,
    packetTimer = null;
  let recordingMode = 'data',
    captureBytes = 0,
    captureWireBytes = 0,
    completionReason = '';
  let session = null,
    origin = 0,
    seq = 0,
    active = false,
    busy = false,
    queued = 0,
    video = null,
    timer = null,
    failed = '',
    pendingWrites = 0,
    captureError = '',
    screenRecorder = null,
    screenStream = null,
    segment = null,
    segmentDone = Promise.resolve(),
    finalizeRecording = Promise.resolve(),
    segmentMeasurements = 0,
    segmentTimer = null,
    videoWanted = false;
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
  const dialog = document.createElement('dialog');
  dialog.className = 'playtest-dialog';
  dialog.innerHTML =
    projectStatus +
    '<button class="playtest-close" data-dismiss-setup aria-label="Close recording setup">×</button><p data-recovery role="status" hidden></p><p>Your project, programs, actions and sampled workshop state will be sent to Yaniv for review.</p><label data-video-option hidden><input type="checkbox" data-video> Include tab video (optional)</label><p data-video-note>Before recording video, close older workshop tabs. This build pauses its tab recordings while you give feedback.</p><p>Use <strong>Give feedback</strong> anytime, even without recording. Attachments are optional. Voice comments stay on this device until you choose Send.</p><button data-start>Start recording</button><p data-error role="status"></p>';
  dialog.querySelector('[data-video-option]').hidden = !(
    canRecord && config.optionalVideo === true
  );
  dialog.querySelector('[data-video-note]').hidden = !(canRecord && config.optionalVideo === true);
  document.body.append(dialog);
  dialog.setAttribute('aria-label', 'Recording setup');
  panel.querySelector('[data-setup]').onclick = () => dialog.showModal();
  dialog.querySelector('[data-dismiss-setup]').onclick = () => dialog.close();
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
    if (
      disposed &&
      !dbClosed &&
      !busy &&
      !pendingWrites &&
      !recorders.size &&
      !finishing &&
      !segmentMeasurements
    ) {
      dbClosed = true;
      outbox.close();
    }
  }
  recordingReference = () =>
    session ? { sessionId: session, timeMs: Math.max(0, performance.now() - origin) } : undefined;
  const status = () => {
    if (disposed) return;
    const pending = queued + pendingWrites + packet.length,
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
          : ' Recording has not resumed. Choose Start recording to begin a new session.');
    const saved =
      !!session && !active && !pending && !flushing && !busy && !captureError && !failed;
    panel.querySelector('[data-status-main]').textContent = captureError
      ? 'Recording stopped'
      : failed
        ? 'Uploads delayed'
        : active
          ? recordingMode === 'video'
            ? '● Recording tab'
            : '● Recording actions'
          : saved
            ? 'Session saved'
            : pending || flushing
              ? 'Saving session'
              : 'Ready to record';
    panel.querySelector('[data-status-detail]').textContent =
      captureError ||
      failed ||
      (active
        ? recordingMode === 'video'
          ? 'Video and actions are sent automatically.'
          : 'Actions and sampled workshop state are sent automatically.'
        : saved
          ? 'All received'
          : pending || flushing
            ? 'Sending recording. Keep this tab open.'
            : 'Start recording to begin.');
    panel.querySelector('[data-feedback]').disabled = false;
    panel.querySelector('[data-setup]').hidden = active;
    panel.querySelector('[data-end]').hidden = !active;
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
      ? `${completionReason}Recording received — session saved. Your feedback has its own delivery status.`
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
      await reconcile();
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
  function flushEvents(receipt) {
    clearTimeout(packetTimer);
    packetTimer = null;
    if (!packet.length) return;
    const body = JSON.stringify(
      packCapturePacket({
        id: `packet-${++packetSeq}`,
        kind: 'capture-batch',
        data: { schema: 1, events: packet },
      }),
    );
    packet = [];
    packetBytes = 0;
    captureWireBytes += new TextEncoder().encode(body).byteLength;
    if (captureWireBytes >= captureStreamLimits.captureWireBytes - 2 * captureStreamLimits.bytes)
      queueMicrotask(() => {
        if (active) {
          completionReason = 'This recording reached its size limit. ';
          stop();
        }
      });
    void send(
      `/api/playtest/v2/${session}/event`,
      new Blob([body], { type: 'application/json' }),
      'application/json',
      receipt,
    );
  }
  function writeEvent(kind, data, receipt) {
    try {
      const event = encoder.encode(
        {
          id: `event-${++seq}`,
          seq,
          timeMs: performance.now() - origin,
          at: new Date().toISOString(),
          kind,
          data,
          context: context(),
        },
        { keyframe: ['session-start', 'session-end', 'feedback-anchor'].includes(kind) },
      );
      const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
      // Reserve wrapper overhead; the wire packet has the same bound as one event.
      if (bytes + 256 > captureStreamLimits.bytes)
        throw Error('Recording event exceeds the upload limit');
      if (
        receipt ||
        packet.length >= captureStreamLimits.batch ||
        packetBytes + bytes + 256 > captureStreamLimits.bytes
      )
        flushEvents();
      packet.push(event);
      packetBytes += bytes + 1;
      captureBytes += bytes + 256;
      if (receipt || kind === 'session-end' || kind === 'session-start') flushEvents(receipt);
      else if (!packetTimer) packetTimer = setTimeout(flushEvents, 1000);
      if (
        kind !== 'session-end' &&
        (seq >= 95000 ||
          captureBytes >= captureStreamLimits.encodedBytes - 2 * captureStreamLimits.bytes)
      ) {
        completionReason = 'This recording reached its size limit. ';
        stop();
      }
      status();
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
  function releaseVideo() {
    video?.pause();
    if (video) video.srcObject = null;
    video = null;
  }
  function startVideoSegment() {
    if (!active || !screenStream || !videoWanted) return;
    const startTimeMs = performance.now() - origin,
      clip = `tab-${crypto.randomUUID()}`;
    const current = { clip, startTimeMs, chunks: [], bytes: 0, overLimit: false };
    segment = current;
    writeEvent('screen-segment-start', { clip, startTimeMs });
    let resolveSegment;
    segmentDone = new Promise((resolve) => {
      resolveSegment = resolve;
    });
    segmentMeasurements++;
    const roll = () => {
      if (current !== segment || !videoWanted || !active) return;
      const wait = segmentDone;
      current.endTimeMs = performance.now() - origin;
      if (screenRecorder?.state !== 'inactive') screenRecorder.stop();
      void wait.then(() => {
        if (videoWanted && active && current === segment) startVideoSegment();
      });
    };
    try {
      screenRecorder = media(screenStream, 'screen', clip);
      const recorder = screenRecorder,
        receive = recorder.ondataavailable,
        finalize = recorder.onstop;
      recorder.ondataavailable = (event) => {
        receive(event);
        if (event.data.size && !current.overLimit) {
          if (current.bytes + event.data.size <= 4 * 1024 ** 2) {
            current.chunks.push(event.data);
            current.bytes += event.data.size;
          } else {
            current.overLimit = true;
            current.chunks = [];
            queueMicrotask(roll);
          }
        }
      };
      recorder.onstop = () => {
        clearTimeout(segmentTimer);
        finalize();
        const endTimeMs = current.endTimeMs ?? performance.now() - origin;
        void (async () => {
          const durationMs =
            current.overLimit || !current.chunks.length
              ? null
              : await measureVideoDuration(
                  new Blob(current.chunks, { type: current.chunks[0].type }),
                );
          current.chunks = [];
          if (endTimeMs > startTimeMs)
            writeEvent('screen-segment', { clip, startTimeMs, endTimeMs, durationMs });
        })()
          .catch(() => {
            captureError = 'Could not finalize tab video timing';
          })
          .finally(() => {
            segmentMeasurements--;
            resolveSegment();
            closeDatabaseIfIdle();
          });
      };
      segmentTimer = setTimeout(roll, 10000);
    } catch (error) {
      segmentMeasurements--;
      resolveSegment();
      throw error;
    }
  }
  captureHooks = {
    stop: () => stop(),
    async resume() {
      videoWanted = true;
      startVideoSegment();
    },
    async suppress() {
      videoWanted = false;
      clearTimeout(segmentTimer);
      const current = screenRecorder;
      if (current && current.state !== 'inactive') {
        if (segment) segment.endTimeMs = performance.now() - origin;
        current.stop();
      }
      await segmentDone;
      screenRecorder = null;
    },
  };
  function stop() {
    void client.stopVoice();
    if (finishing) return finalizeRecording;
    finishing = true;
    const wasActive = active;
    active = false;
    clearInterval(timer);
    videoWanted = false;
    clearTimeout(segmentTimer);
    screenStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    // Capture stops synchronously; terminal metadata is written after segment flush.
    finalizeRecording = (async () => {
      try {
        await captureGate.stopCapture();
        if (wasActive && !captureError) writeEvent('session-end', { checkpoint: checkpoint() });
        flushEvents();
      } catch (error) {
        captureError = `Capture stopped: ${error.message}`;
      } finally {
        screenStream = null;
        releaseVideo();
        finishing = false;
        status();
        if (wasActive && !disposed) {
          if (!(await client.finish()) && !completion.open) completion.showModal();
        }
        closeDatabaseIfIdle();
      }
    })();
    return finalizeRecording;
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
      recordingMode = startAttempt
        ? JSON.parse(startAttempt.bodyText).metadata.recordingMode
        : canRecord && config.optionalVideo === true && dialog.querySelector('[data-video]').checked
          ? 'video'
          : 'data';
      let settings = null;
      if (recordingMode === 'video') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 15 },
          audio: false,
          preferCurrentTab: true,
        });
        if (disposed) return;
        startingStream = stream;
        settings = stream.getVideoTracks()[0].getSettings();
        if (settings.displaySurface && settings.displaySurface !== 'browser')
          throw Error('Please choose the workshop browser tab, rather than your whole screen.');
      }
      timeout = setTimeout(() => startController?.abort(), uploadTimeoutMs);
      const start =
        startAttempt ||
        (await outbox.prepareStart({
          build: document.querySelector('meta[name=build-id]').content,
          startedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          recordingMode,
          captureSchema: 1,
        }));
      startAttempt = start;
      dialog.querySelector('[data-video]').disabled = true;
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
      packetSeq = 0;
      ((captureBytes = 0), (captureWireBytes = 0));
      completionReason = '';
      encoder = createCaptureEncoder();
      origin = performance.now();
      if (stream) {
        video = document.createElement('video');
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        if (disposed) return;
      }
      const initialCheckpoint = checkpoint();
      screenStream = stream || null;
      active = true;
      captureError = '';
      emit('session-start', {
        timeOrigin: performance.timeOrigin,
        checkpoint: initialCheckpoint,
        screen: settings,
        recordingMode,
        captureSchema: 1,
        sampleIntervalMs: 100,
      });
      if (!active) return;
      if (stream) await captureGate.startCapture();
      if (!active || disposed) return;
      ready = true;
      if (stream)
        stream.getVideoTracks()[0].onended = () => {
          emit('screen-share-ended', {});
          stop();
        };
      timer = setInterval(() => {
        if (!document.hidden) emit('state-sample', {});
      }, 100);
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
  panel.querySelector('[data-end]').onclick = () => {
    void stop();
  };
  const recoveryActions = document.createElement('div');
  recoveryActions.innerHTML =
    '<label>Saved recording <select data-session></select></label><button data-export>Download saved uploads</button><button data-discard>Discard a saved session</button><button data-delete>Delete a local session</button><button data-legacy>Download recordings from an older version</button>';
  const recoveryDetails = document.createElement('details');
  recoveryDetails.innerHTML = '<summary>Manage saved recordings</summary>';
  recoveryDetails.append(recoveryActions);
  completion.append(recoveryDetails);
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
  // Recovery only drains immutable uploads. A new capture needs fresh consent.
  pendingWrites++;
  void recoverStarts().finally(() => {
    pendingWrites--;
    closeDatabaseIfIdle();
  });
  const onFocus = () => {
    emit('visibility', { hidden: document.hidden });
    void pump();
  };
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
    void stop().finally(() => captureGate.close());
    client.dispose();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    window.removeEventListener('beforeunload', beforeUnload);
    if (console.error === consoleError) console.error = originalConsoleError;
    for (const element of [panel, dialog, projectDialog, completion]) element.remove();
    // Final MediaRecorder callbacks may still enqueue chunks. Keep storage alive
    // until those writes settle; a future mount resumes the durable outbox.
    closeDatabaseIfIdle();
  }
  return { active: () => active, emit, dispose, feedback: client };
}
