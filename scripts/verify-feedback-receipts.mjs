import { browserArtifactPath } from './browser-artifacts.mjs';
import { unpackCapturePacket } from '../src/application/capture-packet.mjs';
import { decodeCaptureEvents } from '../src/application/capture-stream.mjs';
import { createFixtureEvidence } from './browser-evidence.mjs';
// M3b: feedback receipts must follow server acknowledgement and final media flush.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const browserEvidence = createFixtureEvidence({
  expectedErrors: [401, 403, 404, 413, 503].flatMap((status) => [
    { type: 'http', status, url: '/api/playtest/' },
    { type: 'console', url: '/api/playtest/', message: 'Failed to load resource' },
  ]),
  name: 'feedback-receipts',
  build: 'receipt-test',
  files: [
    process.env.FEEDBACK_SOURCE || 'src/application/remote-playtest.mjs',
    'src/presentation/workshop.css',
    'src/application/capture-outbox.mjs',
    'src/application/feedback-client.mjs',
    'src/application/feedback-store.mjs',
    'src/application/feedback-protocol.mjs',
    'src/application/feedback-capture-gate.mjs',
    'src/application/capture-media-duration.mjs',
    'src/application/capture-stream.mjs',
    'src/application/capture-packet.mjs',
    'package-lock.json',
    'scripts/verify-feedback-receipts.mjs',
  ],
});

const source = readFileSync(process.env.FEEDBACK_SOURCE || 'src/application/remote-playtest.mjs'),
  css = readFileSync('src/presentation/workshop.css');
const moduleFiles = new Map(
  [
    'capture-outbox',
    'capture-stream',
    'capture-packet',
    'feedback-client',
    'feedback-store',
    'feedback-protocol',
    'feedback-capture-gate',
    'capture-media-duration',
  ].map((name) => [`/${name}.mjs`, `src/application/${name}.mjs`]),
);
const server = createServer((req, res) => {
  res.setHeader(
    'Content-Type',
    req.url.endsWith('.mjs')
      ? 'text/javascript'
      : req.url === '/style.css'
        ? 'text/css'
        : 'text/html',
  );
  res.end(
    req.url === '/fflate.mjs'
      ? readFileSync('node_modules/fflate/esm/browser.js')
      : moduleFiles.has(req.url)
        ? readFileSync(moduleFiles.get(req.url))
        : req.url === '/remote.mjs'
          ? source
          : req.url === '/style.css'
            ? css
            : '<link rel="stylesheet" href="/style.css"><meta name="build-id" content="receipt-test"><script type="importmap">{"imports":{"fflate":"/fflate.mjs"}}</script><script type="module">import {unpackCapturePacket} from "/capture-packet.mjs";window.unpackCapturePacket=unpackCapturePacket;import {captureStreamLimits} from "/capture-stream.mjs";window.captureStreamLimits=captureStreamLimits;import {validateFeedbackEnvelope} from "/feedback-protocol.mjs";window.validateFeedbackEnvelope=validateFeedbackEnvelope;import {openFeedbackStore} from "/feedback-store.mjs";window.readFeedbackItems=async()=>{const store=await openFeedbackStore();try{return await store.items()}finally{store.close()}};import {mountRemotePlaytest} from "/remote.mjs";window.mountCapture=()=>mountRemotePlaytest({measureVideoDuration:async()=>1000,context:()=>({}),checkpoint:()=>({}),screenshot:()=>{throw Error("screenshot unavailable")}});window.remoteCapture=await window.mountCapture();</script>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await browserEvidence.launch({
  profile: 'recording',
  ...{ channel: 'chrome', headless: true },
});
try {
  const page = await browser.newPage(),
    errors = browserEvidence.errors;
  page.setDefaultTimeout(20000);

  await page.addInitScript(() => {
    window.originalConsoleError = console.error;
    window.packetHas = (body, kind) =>
      (body.kind === 'capture-batch' ? window.unpackCapturePacket(body).data.events : [body]).some(
        (e) => e.kind === kind,
      );
    const originalTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) =>
      originalTimeout(
        callback,
        [15000, 45000].includes(delay) && window.hangNext ? 100 : delay,
        ...args,
      );
    const originalFetch = window.fetch;
    window.hungUploads = 0;
    window.fetch = async (url, options) => {
      if (window.hangNext && String(url).endsWith('/feedback/v1/submission')) {
        window.hangNext = false;
        window.hungUploads++;
        return new Promise((resolve, reject) =>
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'AbortError')),
            { once: true },
          ),
        );
      }
      return originalFetch(url, options);
    };
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    setInterval(() => canvas.getContext('2d').fillRect(0, 0, 100, 100), 50);
    window.captureRequests = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.captureRequests++;
      return canvas.captureStream();
    };
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream();
    window.pendingRecorders = [];
    window.stoppedTracks = 0;
    window.MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
      constructor(stream, options = {}) {
        this.mimeType = options.mimeType || 'video/webm';
        this.stream = stream;
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        window.pendingRecorders.push(this);
      }
    };
    window.flushRecorders = () => {
      for (const r of window.pendingRecorders.splice(0)) {
        r.ondataavailable?.({ data: new Blob(['final media'], { type: r.mimeType }) });
        r.onstop?.();
      }
    };
  });
  let sequence = 0,
    held = null,
    holdFinalReceipt = false,
    heldFinalReceipt = null,
    disposalUpload = null,
    disposalArrival = Promise.withResolvers(),
    holdComment = true,
    holdFeedbackRecovery = false,
    badReceipt = false,
    statusCode = 200,
    feedbackStatus = 200,
    sessionPosts = 0,
    failNextSession = false;
  const uploads = [],
    feedbackUploads = [];
  const hasEvent = (packet, kind) =>
    (packet.kind === 'capture-batch' ? unpackCapturePacket(packet).data.events : [packet]).some(
      (e) => e.kind === kind,
    );
  const receipt = (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      raw = request.postDataBuffer();
    if (url.pathname.endsWith('/feedback/v1/submission'))
      return {
        protocolVersion: 1,
        submissionId: JSON.parse(raw).id,
        uploadHash: createHash('sha256').update(raw).digest('hex'),
        receivedAt: new Date().toISOString(),
        status: 'received',
      };
    const media = url.pathname.endsWith('/media');
    return {
      protocolVersion: 2,
      sessionId: url.pathname.split('/')[4],
      logicalKey: media
        ? `media:${url.searchParams.get('kind')}:${url.searchParams.get('clip')}:${url.searchParams.get('seq')}`
        : `event:${JSON.parse(raw).id}`,
      uploadHash: createHash('sha256')
        .update(media ? request.headers()['content-type'].toLowerCase() : '')
        .update(raw)
        .digest('hex'),
      sequence: ++sequence,
      receivedAt: new Date().toISOString(),
    };
  };
  await page.route('**/api/playtest/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/config'))
      return route.fulfill({
        json: {
          enabled: true,
          protocolVersion: 2,
          optionalVideo: true,
          feedback: { enabled: true, protocolVersion: 1 },
        },
      });
    if (path.endsWith('/session')) {
      sessionPosts++;
      if (failNextSession) {
        failNextSession = false;
        return route.fulfill({ status: 503, json: { error: 'uncertain start' } });
      }
      return route.fulfill({
        json: {
          protocolVersion: 2,
          sessionId: sessionPosts.toString(16).padStart(32, '0'),
          requestId: route.request().postDataJSON().requestId,
          requestHash: createHash('sha256').update(route.request().postDataBuffer()).digest('hex'),
        },
      });
    }
    uploads.push({ url: route.request().url(), body: route.request().postData() });
    if (path.endsWith('/feedback/v1/submission')) feedbackUploads.push(uploads.at(-1));
    if (
      holdFinalReceipt &&
      path.endsWith('/event') &&
      hasEvent(route.request().postDataJSON(), 'session-end')
    ) {
      heldFinalReceipt = route;
      return;
    }
    if (path.endsWith('/event') && hasEvent(route.request().postDataJSON(), 'disposal-witness')) {
      disposalUpload = route;
      disposalArrival.resolve();
      return;
    }
    if (path.endsWith('/feedback/v1/submission') && holdComment) {
      held = route;
      return;
    }
    if (holdFeedbackRecovery && path.endsWith('/feedback/v1/submission'))
      return route.fulfill({ status: 503, json: { error: 'held feedback recovery' } });
    const injectedStatus = path.endsWith('/feedback/v1/submission') ? feedbackStatus : statusCode;
    if (injectedStatus !== 200)
      return route.fulfill({ status: injectedStatus, json: { error: 'test failure' } });
    return route.fulfill({
      json: badReceipt ? {} : receipt(route),
    });
  });
  await browserEvidence.goto(page, `http://127.0.0.1:${server.address().port}`);
  browserEvidence.assert('equal', [
    await page.evaluate(async () => {
      const { validateFeedbackEnvelope } = window;
      const bytes = new Uint8Array(2 * 1024 ** 2);
      let binary = '';
      for (let at = 0; at < bytes.length; at += 8192)
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
      const value = {
        protocolVersion: 1,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        text: '',
        voice: { mime: 'audio/webm', base64: btoa(binary), durationMs: 60000 },
      };
      return validateFeedbackEnvelope(value).voice.durationMs;
    }),
    60000,
    'browser admits a complete maximum-size voice envelope',
  ]);
  await page.locator('[data-video]').check();
  await page.locator('[data-start]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-status-main]')?.textContent === '● Recording tab',
  );
  const panel = page.locator('.playtest-panel'),
    geometry = () =>
      panel.evaluate((el) =>
        [el, ...el.querySelectorAll('button')].map((n) => {
          const r = n.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        }),
      );
  const initial = await geometry();
  browserEvidence.assert('equal', [
    await page.locator('[data-status-detail]').textContent(),
    'Video and actions are sent automatically.',
  ]);
  await page.waitForTimeout(1200);
  browserEvidence.assert('deepEqual', [
    await geometry(),
    initial,
    'automatic state uploads cannot move feedback controls',
  ]);
  const openFeedback = async () => {
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
    // The actual privacy gate waits for final screen bytes before exposing the dialog.
    await page.waitForFunction(() => {
      if (window.pendingRecorders.length) window.flushRecorders();
      return document.querySelector('.feedback-dialog')?.open;
    });
  };
  const receiptState = page.locator('[data-receipt-state]');
  const received = () =>
    page.waitForFunction(
      () =>
        document.querySelector('[data-receipt-state]')?.textContent === 'Sent to Yaniv for review.',
    );
  const sendText = async (text) => {
    if (await page.getByRole('button', { name: 'Add another', exact: true }).isVisible())
      await page.getByRole('button', { name: 'Add another', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your feedback' }).fill(text);
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await page.waitForFunction(
      (value) => document.querySelector('[data-submitted-text]')?.textContent === value,
      text,
    );
  };
  const retryFeedback = async () => {
    await page.getByRole('button', { name: 'Your feedback history', exact: true }).click();
    await page
      .getByRole('button', { name: 'Retry', exact: true })
      .last()
      .waitFor({ state: 'visible' });
    feedbackStatus = 200;
    await page.getByRole('button', { name: 'Retry', exact: true }).last().click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.playtest-comment')].every((row) =>
        row.textContent.includes('Sent to Yaniv for review.'),
      ),
    );
    await page.getByRole('button', { name: 'Add another', exact: true }).click();
    await page.getByRole('textbox', { name: 'Your feedback' }).waitFor({ state: 'visible' });
  };
  await openFeedback();
  await sendText('Keep this exact comment visible.');
  await page.waitForFunction(() =>
    document.querySelector('[data-receipt-state]')?.textContent.includes('waiting to send'),
  );
  browserEvidence.assert('match', [
    await page.locator('[data-submitted-text]').innerText(),
    /Keep this exact comment visible/,
  ]);
  browserEvidence.assert('doesNotMatch', [await receiptState.innerText(), /Sent to Yaniv/]);
  browserEvidence.assert('deepEqual', [
    await geometry(),
    initial,
    'pending feedback cannot resize the bar',
  ]);
  while (!held) await new Promise((resolve) => setTimeout(resolve, 10));
  await held.fulfill({ json: {} });
  holdComment = false;
  badReceipt = true;
  await page.waitForTimeout(100);
  browserEvidence.assert('doesNotMatch', [await receiptState.innerText(), /Sent to Yaniv/]);
  browserEvidence.assert('deepEqual', [
    await geometry(),
    initial,
    'feedback retry cannot move controls',
  ]);
  badReceipt = false;
  await received();
  console.log('feedback fixture: receipt identity passed');
  for (const [code, message] of [
    [401, 'Open your invitation again'],
    [403, 'Open your invitation again'],
    [404, 'unavailable'],
    [413, 'too large'],
    [503, 'retry automatically'],
  ]) {
    feedbackStatus = code;
    await sendText(`Failure ${code}`);
    await page.waitForFunction(
      (text) => document.querySelector('[data-receipt-state]')?.textContent.includes(text),
      message,
    );
    browserEvidence.assert('doesNotMatch', [await receiptState.innerText(), /Sent to Yaniv/]);
    if (code !== 503) {
      browserEvidence.assert('equal', [
        (await page.evaluate(async () => await window.readFeedbackItems())).at(-1).outcome,
        'blocked',
        'permanent failures require explicit retry',
      ]);
      await retryFeedback();
    } else {
      feedbackStatus = 200;
      await received();
    }
  }
  await page.evaluate(() => {
    window.hangNext = true;
  });
  await sendText('Recover the timed-out upload.');
  await page.waitForFunction(() => window.hungUploads === 1);
  browserEvidence.assert('doesNotMatch', [await receiptState.innerText(), /Sent to Yaniv/]);
  await received();
  console.log('feedback fixture: failure and timeout recovery passed');
  // A frozen standalone envelope survives reload and retries identical bytes without capture.
  feedbackStatus = 503;
  holdFeedbackRecovery = true;
  await sendText('Standalone feedback survives reload.');
  await page.waitForFunction(async () =>
    (await window.readFeedbackItems()).some(
      (row) => row.envelope?.text === 'Standalone feedback survives reload.' && row.error === 503,
    ),
  );
  const frozen = await page.evaluate(async () =>
    (await window.readFeedbackItems()).find(
      (row) => row.envelope?.text === 'Standalone feedback survives reload.',
    ),
  );
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.evaluate(() => window.flushRecorders());
  feedbackStatus = 200;
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  badReceipt = true;
  const startsBeforeFeedbackReload = sessionPosts;
  await browserEvidence.reload(page);
  await page.waitForFunction(async () => (await window.readFeedbackItems()).some((row) => row.id));
  browserEvidence.assert('equal', [sessionPosts, startsBeforeFeedbackReload]);
  browserEvidence.assert('equal', [await page.evaluate(() => window.captureRequests), 0]);
  holdFeedbackRecovery = false;
  await page.waitForFunction(
    async (id) => (await window.readFeedbackItems()).find((row) => row.id === id)?.error === 0,
    frozen.id,
  );
  const malformedRecovery = (
    await page.evaluate(async () => await window.readFeedbackItems())
  ).find((row) => row.id === frozen.id);
  browserEvidence.assert('equal', [
    malformedRecovery.bodyText,
    frozen.bodyText,
    'malformed ACK after reload retains exact feedback',
  ]);
  browserEvidence.assert('equal', [
    malformedRecovery.outcome,
    'pending',
    'malformed ACK is not receipt',
  ]);
  badReceipt = false;
  await page.waitForFunction(
    async (id) =>
      (await window.readFeedbackItems()).find((row) => row.id === id)?.outcome === 'received',
    frozen.id,
  );
  browserEvidence.assert('ok', [
    feedbackUploads
      .filter((row) => JSON.parse(row.body).id === frozen.id)
      .every((row) => row.body === frozen.bodyText),
    'all feedback retries preserve exact frozen bytes',
  ]);
  console.log('feedback fixture: standalone reload passed');
  // Resume a fresh recording for local-only voice and final capture-flush witnesses.
  await page.locator('[data-video]').check();
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.remoteCapture.active());
  await openFeedback();
  for (const close of ['x', 'escape']) {
    const before = feedbackUploads.length;
    await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
    await page.getByRole('button', { name: 'Stop voice recording', exact: true }).waitFor();
    if (close === 'x')
      await page.getByRole('button', { name: 'Close feedback', exact: true }).click();
    else await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.pendingRecorders.length === 1);
    browserEvidence.assert('equal', [
      await page.evaluate(() =>
        window.pendingRecorders[0].stream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
      true,
    ]);
    browserEvidence.assert('equal', [
      feedbackUploads.length,
      before,
      'closing voice has not submitted it',
    ]);
    await page.evaluate(() => window.flushRecorders());
    await page.waitForFunction(() => !document.querySelector('.feedback-dialog').open);
    await openFeedback();
    await page.getByRole('button', { name: 'Remove voice comment', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
  await page.getByRole('button', { name: 'Stop voice recording', exact: true }).click();
  await page.evaluate(() => window.flushRecorders());
  await page.locator('[data-playback]').waitFor({ state: 'visible' });
  const beforeVoiceSend = feedbackUploads.length;
  await page.waitForTimeout(50);
  browserEvidence.assert('equal', [
    feedbackUploads.length,
    beforeVoiceSend,
    'voice preview is local until Send',
  ]);
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-submitted-text]')?.textContent === 'Voice comment',
  );
  await received();
  browserEvidence.assert('ok', [
    JSON.parse(feedbackUploads.at(-1).body).voice?.base64,
    'voice belongs to complete standalone envelope',
  ]);
  await page.getByRole('button', { name: 'Back to building', exact: true }).click();
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /Recording received/,
  ]);
  await page.waitForTimeout(150);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /Recording received/,
  ]);
  await page.evaluate(() => window.flushRecorders());
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  await page.evaluate(() => {
    window.originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'simulacrum-playtest-outbox-v2' && args[1] === 'readonly')
        throw Error('outbox unavailable');
      return window.originalTransaction.apply(this, args);
    };
  });
  await page.waitForFunction(() =>
    document
      .querySelector('[data-completion-status]')
      ?.textContent.includes('Session not fully saved'),
  );
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /Recording received/,
  ]);
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.originalTransaction;
  });
  await page.getByRole('button', { name: 'Retry uploads', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  console.log('feedback fixture: local voice and final flush passed');
  // Real IndexedDB persists across a same-origin document reload; media capture remains mocked.
  const outbox = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction('items', 'readonly').objectStore('items').getAll();
          request.onsuccess = () =>
            resolve(
              request.result
                .filter((row) => row.body)
                .map(({ id, url, body, type }) => ({ id, url, size: body.size, type })),
            );
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
  await browserEvidence.reload(page);
  await page.locator('[data-video]').check();
  await page.locator('[data-start]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-status-main]')?.textContent === '● Recording tab',
  );
  statusCode = 503;
  const recoveryComment = 'Saved through reload while the server is unavailable.';
  await page.evaluate(
    (text) => window.remoteCapture.emit('capture-recovery-witness', { text }),
    recoveryComment,
  );
  await page.waitForFunction(() =>
    document.querySelector('[data-status-detail]')?.textContent.includes('retrying automatically'),
  );
  // Assert body durability too, not merely that some unrelated periodic upload survived.
  const readSavedBody = () =>
    page.evaluate(async (text) => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
        request.onsuccess = () => resolve(request.result);
      });
      const rows = await new Promise((resolve) => {
        const request = db.transaction('items').objectStore('items').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      for (const row of rows.filter((row) => row.body)) {
        const body = await row.body.text();
        if (body.includes(text)) return { id: row.id, url: row.url, body };
      }
      return null;
    }, recoveryComment);
  let savedBody;
  const saveDeadline = Date.now() + 5000;
  while (!(savedBody = await readSavedBody()) && Date.now() < saveDeadline)
    await page.waitForTimeout(25);
  browserEvidence.assert('ok', [
    savedBody,
    'capture witness body committed to real IndexedDB before reload',
  ]);
  const sessionsBeforeReload = sessionPosts,
    uploadsBeforeReload = uploads.length;
  await browserEvidence.reload(page);
  await page.waitForFunction(() =>
    document.querySelector('[data-status-detail]')?.textContent.includes('retrying automatically'),
  );
  browserEvidence.assert('ok', [
    (await outbox()).some((row) => row.id === savedBody.id),
    'outage cannot delete the persisted capture witness',
  ]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => window.captureRequests),
    0,
    'reload never silently requests display capture',
  ]);
  browserEvidence.assert('equal', [
    sessionPosts,
    sessionsBeforeReload,
    'reload never silently creates a capture session',
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('button', { name: 'Give feedback', exact: true }).isDisabled(),
    false,
    'feedback remains reachable while capture is stopped',
  ]);
  browserEvidence.assert('match', [
    await page.locator('[data-recovery]').innerText(),
    /saved uploads from an earlier session/i,
  ]);
  browserEvidence.assert('match', [
    await page.locator('[data-recovery]').innerText(),
    /recording has not resumed/i,
  ]);
  mkdirSync(browserArtifactPath('artifacts/reload-recovery'), { recursive: true });
  await page.screenshot({
    path: browserArtifactPath('artifacts/reload-recovery/outage-after-reload.png'),
  });
  const outageNotice = await page.locator('[data-recovery]').innerText();
  statusCode = 200;
  badReceipt = true;
  const beforeMalformed = uploads.length;
  for (let attempt = 0; uploads.length === beforeMalformed && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  browserEvidence.assert('ok', [
    uploads.length > beforeMalformed,
    'saved uploads retry after reload',
  ]);
  await page.waitForTimeout(100);
  browserEvidence.assert('ok', [
    (await outbox()).some((row) => row.id === savedBody.id),
    'malformed capture ACK after reload cannot delete saved capture',
  ]);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-recovery]').innerText(),
    /received by Yaniv/,
  ]);
  badReceipt = false;
  await page.waitForFunction(() =>
    document.querySelector('[data-recovery]')?.textContent.includes('received by Yaniv'),
  );
  browserEvidence.assert('deepEqual', [
    await outbox(),
    [],
    'only valid acknowledgements drain recovered uploads',
  ]);
  browserEvidence.assert('ok', [
    uploads
      .slice(uploadsBeforeReload)
      .some((upload) => upload.url.endsWith(savedBody.url) && upload.body === savedBody.body),
    'exact persisted capture body retried to its original session',
  ]);
  browserEvidence.assert('equal', [await page.evaluate(() => window.captureRequests), 0]);
  browserEvidence.assert('equal', [sessionPosts, sessionsBeforeReload]);
  const receivedNotice = await page.locator('[data-recovery]').innerText();
  browserEvidence.assert('match', [receivedNotice, /recording has not resumed/i]);
  await page.screenshot({
    path: browserArtifactPath('artifacts/reload-recovery/received-after-reload.png'),
  });
  browserEvidence.assertUnchanged();
  writeFileSync(
    browserArtifactPath('artifacts/reload-recovery/result.json'),
    JSON.stringify(
      {
        ...browserEvidence.identity,
        outageNotice,
        receivedNotice,
        commentBody: savedBody,
        sessionPosts,
        captureRequestsAfterReload: await page.evaluate(() => window.captureRequests),
        remainingOutbox: await outbox(),
        bounds:
          'Real Chromium IndexedDB and same-origin reload; mocked API receipts and capture. No human usability or actual capture permission claim.',
      },
      null,
      2,
    ),
  );
  console.log('feedback fixture: legacy outbox reload passed');
  // Dispose must release the mount while preserving delayed final MediaRecorder
  // bytes in real IndexedDB; a remount drains them without resuming capture.
  await page.locator('[data-video]').check();
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.remoteCapture.active());
  // Hold a real request across disposal; it must settle under its owned deadline,
  // not be aborted by unmount or dispatched again by the disposed pump.
  await page.evaluate(() => window.remoteCapture.emit('disposal-witness', {}));
  let arrivalTimeout;
  try {
    await Promise.race([
      disposalArrival.promise,
      new Promise((_, reject) => {
        arrivalTimeout = setTimeout(() => reject(Error('disposal request did not arrive')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(arrivalTimeout);
  }
  browserEvidence.assert('ok', [disposalUpload, 'disposal witness reached the server']);
  await page.evaluate(() => window.remoteCapture.emit('after-disposal-witness', {}));
  await page.evaluate(() => window.remoteCapture.dispose());
  await disposalUpload.fulfill({
    json: receipt(disposalUpload),
  });
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
      r.onsuccess = () => resolve(r.result);
    });
    try {
      const rows = await new Promise((resolve) => {
        const r = db.transaction('items').objectStore('items').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      for (const row of rows)
        if (
          row.body &&
          row.url.endsWith('/event') &&
          window.packetHas(JSON.parse(await row.body.text()), 'disposal-witness')
        )
          return false;
      return true;
    } finally {
      db.close();
    }
  });
  browserEvidence.assert('deepEqual', [
    errors,
    [],
    'disposal must not abort the acknowledged request',
  ]);
  browserEvidence.assert('equal', [
    uploads.some((u) => u.body?.includes('after-disposal-witness')),
    false,
    'disposed pump starts no queued request',
  ]);
  statusCode = 503;
  await page.waitForFunction(
    () => document.querySelectorAll('.playtest-panel, .playtest-dialog').length === 0,
  );
  browserEvidence.assert('equal', [
    await page.locator('.playtest-panel, .playtest-dialog').count(),
    0,
  ]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => console.error === window.originalConsoleError),
    true,
  ]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => window.remoteCapture.active()),
    false,
  ]);
  browserEvidence.assert('equal', [await page.evaluate(() => window.pendingRecorders.length), 1]);
  await page.evaluate(() => window.flushRecorders());
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise((resolve) => {
        const r = db.transaction('items').objectStore('items').getAll();
        r.onsuccess = () => resolve(r.result.some((row) => row.url.includes('/media?')));
      });
    } finally {
      db.close();
    }
  });
  const beforeRemount = await page.evaluate(() => window.captureRequests);
  statusCode = 200;
  await page.evaluate(async () => {
    window.remoteCapture = await window.mountCapture();
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-recovery]')?.textContent.includes('received by Yaniv'),
  );
  browserEvidence.assert('deepEqual', [await outbox(), []]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => window.captureRequests),
    beforeRemount,
  ]);
  browserEvidence.assert('equal', [await page.locator('.playtest-panel').count(), 1]);
  // Failure after unmount must retain the exact request, release the owned DB,
  // and recover on remount. Hold transport and deadline explicitly, without sleeps.
  for (const outcome of ['http', 'timeout']) {
    await page.locator('[data-video]').check();
    await page.locator('[data-start]').click();
    await page.waitForFunction(() => window.remoteCapture.active());
    await page.evaluate((outcome) => {
      const fetch = window.fetch,
        schedule = window.setTimeout,
        close = IDBDatabase.prototype.close;
      window.disposalPending = false;
      window.disposalAborted = false;
      window.disposalDbCloses = 0;
      let deadline;
      window.setTimeout = (callback, delay, ...args) => {
        const id = schedule(callback, delay, ...args);
        if (delay === 45000)
          deadline = () => {
            clearTimeout(id);
            callback(...args);
          };
        return id;
      };
      IDBDatabase.prototype.close = function () {
        if (this.name === 'simulacrum-playtest-outbox-v2') window.disposalDbCloses++;
        return close.call(this);
      };
      window.fetch = async (url, options) => {
        if (
          String(url).endsWith('/event') &&
          window.packetHas(JSON.parse(await options.body.text()), 'disposal-failure')
        ) {
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                window.disposalAborted = true;
                reject(new DOMException('Timed out', 'AbortError'));
              },
              { once: true },
            );
            window.settleDisposal =
              outcome === 'timeout' ? deadline : () => resolve(new Response('{}', { status: 503 }));
            window.disposalPending = true;
          });
        }
        return fetch(url, options);
      };
      window.restoreDisposalFixture = () => {
        window.fetch = fetch;
        window.setTimeout = schedule;
        IDBDatabase.prototype.close = close;
      };
      window.remoteCapture.emit('disposal-failure', { outcome });
    }, outcome);
    await page.waitForFunction(() => window.disposalPending);
    const exactRows = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
          r.onsuccess = () => resolve(r.result);
        });
        try {
          const rows = await new Promise((resolve) => {
            const r = db.transaction('items').objectStore('items').getAll();
            r.onsuccess = () => resolve(r.result);
          });
          const result = [];
          for (const row of rows.filter((row) => row.body))
            result.push({
              id: row.id,
              url: row.url,
              uploadHash: row.uploadHash,
              body: await row.body.text(),
            });
          return result.filter((row) => row.body.includes('disposal-failure'));
        } finally {
          db.close();
        }
      });
    const saved = await exactRows();
    browserEvidence.assert('equal', [saved.length, 1]);
    await page.evaluate(() => {
      window.disposalDbCloses = 0;
      window.remoteCapture.dispose();
    });
    await page.waitForFunction(() => window.pendingRecorders.length > 0);
    await page.evaluate(() => window.flushRecorders());
    browserEvidence.assert('equal', [
      await page.evaluate(() => window.disposalAborted),
      false,
      'unmount must not abort upload',
    ]);
    await page.evaluate(() => window.settleDisposal());
    await page.waitForFunction(() => window.disposalDbCloses > 0);
    browserEvidence.assert('equal', [
      await page.evaluate(() => window.disposalAborted),
      outcome === 'timeout',
    ]);
    browserEvidence.assert('deepEqual', [
      await exactRows(),
      saved,
      'failed disposed upload retains exact durable request',
    ]);
    await page.evaluate(() => window.restoreDisposalFixture());
    const receivedBefore = uploads.length;
    await page.evaluate(async () => {
      window.remoteCapture = await window.mountCapture();
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-recovery]')?.textContent.includes('received by Yaniv'),
    );
    browserEvidence.assert('deepEqual', [await outbox(), []]);
    browserEvidence.assert('ok', [
      uploads
        .slice(receivedBefore)
        .some((u) => u.url.endsWith(saved[0].url) && u.body === saved[0].body),
      'remount delivers exact retained request',
    ]);
    browserEvidence.assert('equal', [
      await page.evaluate(() => window.remoteCapture.active()),
      false,
    ]);
  }
  await page.evaluate(() => window.remoteCapture.dispose());
  await page.waitForFunction(
    () => document.querySelectorAll('.playtest-panel, .playtest-dialog').length === 0,
  );
  browserEvidence.assert('equal', [
    await page.locator('.playtest-panel, .playtest-dialog').count(),
    0,
  ]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => console.error === window.originalConsoleError),
    true,
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  // An uncertain start retains its consented mode on retry.
  await page.evaluate(async () => {
    window.remoteCapture = await window.mountCapture();
  });
  await page.locator('[data-video]').check();
  failNextSession = true;
  await page.locator('[data-start]').click();
  await page.waitForFunction(
    () => !!document.querySelector('[aria-label="Recording setup"] [data-error]')?.textContent,
  );
  browserEvidence.assert('equal', [await page.locator('[data-video]').isDisabled(), true]);
  await page.locator('[data-start]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-status-main]')?.textContent === '● Recording tab',
  );
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.evaluate(() => window.flushRecorders());
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  await page.evaluate(() => window.remoteCapture.dispose());
  // Data capture remains usable without either browser media API. A failed
  // canvas screenshot must not block text feedback or the terminal receipt.
  const dataUploadsStart = uploads.length;
  const displayBeforeData = await page.evaluate(() => window.captureRequests);
  await page.evaluate(async () => {
    window.MediaRecorder = undefined;
    navigator.mediaDevices.getDisplayMedia = undefined;
    window.remoteCapture = await window.mountCapture();
  });
  await page.locator('[data-start]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-status-main]')?.textContent === '● Recording actions',
  );
  await openFeedback();
  await page.locator('[data-attachments] summary').first().click();
  await page.locator('[data-image]').check();
  await page.waitForFunction(() =>
    document.querySelector('[data-attachment-status]')?.textContent.includes('unavailable'),
  );
  await sendText('Data feedback despite unavailable screenshot.');
  await received();
  for (const [code, message] of [
    [401, 'Open your invitation again'],
    [403, 'Open your invitation again'],
    [404, 'session is unavailable'],
    [413, 'upload is too large'],
    [503, 'retrying automatically'],
  ]) {
    statusCode = code;
    await page.evaluate(
      (code) => window.remoteCapture.emit('capture-http-witness', { code }),
      code,
    );
    await page.waitForFunction(
      (text) => document.querySelector('[data-status-detail]')?.textContent.includes(text),
      message,
    );
    browserEvidence.assert('ok', [
      (await outbox()).length > 0,
      'capture error retains unacknowledged bytes',
    ]);
    statusCode = 200;
    await page.evaluate(
      (id) => {
        document.querySelector('[data-session]').value = id;
        document.querySelector('[data-retry]').click();
      },
      sessionPosts.toString(16).padStart(32, '0'),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-status-detail]')?.textContent ===
        'Actions and sampled workshop state are sent automatically.',
    );
  }
  await page.getByRole('button', { name: 'Back to building' }).click();
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  const dataUploads = uploads.slice(dataUploadsStart);
  browserEvidence.assert('equal', [
    await page.evaluate(() => window.captureRequests),
    displayBeforeData,
  ]);
  browserEvidence.assert('equal', [
    dataUploads.some((upload) => upload.url.includes('/media?')),
    false,
  ]);
  const uniqueDataPackets = new Map();
  for (const upload of dataUploads.filter((row) => row.url.endsWith('/event'))) {
    const packet = JSON.parse(upload.body),
      prior = uniqueDataPackets.get(packet.id);
    if (prior)
      browserEvidence.assert('equal', [
        prior,
        upload.body,
        'capture retry preserves exact packet bytes',
      ]);
    else uniqueDataPackets.set(packet.id, upload.body);
  }
  const decoded = decodeCaptureEvents([...uniqueDataPackets.values()].map(JSON.parse));
  browserEvidence.assert('equal', [decoded.status, 'complete']);
  browserEvidence.assert('equal', [decoded.events[0].data.recordingMode, 'data']);
  const dataFeedback = JSON.parse(
    dataUploads.find((upload) => upload.url.endsWith('/feedback/v1/submission')).body,
  );
  browserEvidence.assert('equal', [
    dataFeedback.image,
    undefined,
    'failed optional screenshot is omitted',
  ]);
  browserEvidence.assert('match', [dataFeedback.text, /despite unavailable/]);
  browserEvidence.assert('equal', [
    decoded.events.some((event) =>
      ['feedback-anchor', 'feedback-text', 'voice-start', 'voice-end'].includes(event.kind),
    ),
    false,
    'standalone feedback never extends capture events',
  ]);
  await page.evaluate(() => window.remoteCapture.dispose());
  // A stale reconciliation must never report success before the final receipt.
  await page.evaluate(async () => {
    window.remoteCapture = await window.mountCapture();
  });
  await page.locator('[data-start]').click();
  await page.waitForFunction(() => window.remoteCapture.active());
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise((resolve) => {
        const tx = db.transaction('items', 'readonly'),
          r = tx.objectStore('items').getAll();
        tx.oncomplete = () => resolve(r.result.every((row) => !row.body));
      });
    } finally {
      db.close();
    }
  });
  holdFinalReceipt = true;
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let held = false;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args);
      if (!held && args[0] === 'groups' && args[1] === 'readonly') {
        held = true;
        let callback;
        Object.defineProperty(tx, 'oncomplete', {
          configurable: true,
          get: () => callback,
          set: (value) => {
            callback = value;
          },
        });
        tx.addEventListener('complete', (event) => {
          window.releaseStaleRead = () => callback?.call(tx, event);
        });
      }
      return tx;
    };
    window.restoreTransactions = () => {
      IDBDatabase.prototype.transaction = original;
    };
    window.prematureCompletion = false;
    window.completionObserver = new MutationObserver(() => {
      if (
        document
          .querySelector('[data-completion-status]')
          ?.textContent.includes('Recording received')
      )
        window.prematureCompletion = true;
    });
    window.completionObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => typeof window.releaseStaleRead === 'function');
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.evaluate(() => window.releaseStaleRead());
  for (let i = 0; i < 100 && !heldFinalReceipt; i++) await page.waitForTimeout(50);
  browserEvidence.assert('ok', [heldFinalReceipt, 'Final upload must reach the withheld receipt']);
  browserEvidence.assert('equal', [await page.evaluate(() => window.prematureCompletion), false]);
  await page.evaluate(() => {
    window.completionObserver.disconnect();
    window.restoreTransactions();
  });
  holdFinalReceipt = false;
  await heldFinalReceipt.fulfill({ json: receipt(heldFinalReceipt) });
  await page.waitForFunction(() =>
    document.querySelector('[data-completion-status]')?.textContent.includes('Recording received'),
  );
  await page.evaluate(() => window.remoteCapture.dispose());
  // Producer bounds finish an intact stream instead of creating an unreviewable session.
  await browserEvidence.measure('producer-byte-limit-and-drain', async () => {
    const boundedUploadsStart = uploads.length;
    await page.evaluate(async () => {
      window.remoteCapture = await window.mountCapture();
    });
    await page.locator('[data-start]').click();
    await page.waitForFunction(() => window.remoteCapture.active());
    await page.evaluate(async () => {
      const { captureStreamLimits } = window;
      const payload = 'b'.repeat(1024 * 1024);
      const count = Math.ceil(captureStreamLimits.encodedBytes / payload.length) + 1;
      for (let i = 0; i < count && window.remoteCapture.active(); i++)
        window.remoteCapture.emit('bounded-recording-witness', { payload });
    });
    browserEvidence.assert('equal', [
      await page.evaluate(() => window.remoteCapture.active()),
      false,
    ]);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-completion-status]')
          ?.textContent.includes('Recording received'),
      undefined,
      { timeout: 120000 },
    );
    browserEvidence.assert('match', [
      await page.locator('[data-completion-status]').innerText(),
      /size limit/,
    ]);
    const boundedDecoded = decodeCaptureEvents(
      uploads
        .slice(boundedUploadsStart)
        .filter((upload) => upload.url.endsWith('/event'))
        .map((upload) => JSON.parse(upload.body)),
      { indexed: true },
    );
    browserEvidence.assert('equal', [boundedDecoded.status, 'complete']);
    browserEvidence.assert('equal', [boundedDecoded.events.at(-1).kind, 'session-end']);
    await page.evaluate(() => window.remoteCapture.dispose());
  });
  console.log(
    'feedback receipt checks passed: delayed/malformed acknowledgement, 401/403/404/413/503 recovery, hung upload timeout/recovery, retained comments, X/Escape microphone stop, final media flush, outbox read failure, real IndexedDB reload/outage recovery, disposal/final-flush/remount recovery',
  );
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
