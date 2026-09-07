import { createFixtureEvidence } from './browser-evidence.mjs';
// M3b: feedback receipts must follow server acknowledgement and final media flush.

import { createServer } from 'node:http';
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
    'scripts/verify-feedback-receipts.mjs',
  ],
});

const source = readFileSync(process.env.FEEDBACK_SOURCE || 'src/application/remote-playtest.mjs'),
  css = readFileSync('src/presentation/workshop.css');
const server = createServer((req, res) => {
  res.setHeader(
    'Content-Type',
    req.url === '/remote.mjs'
      ? 'text/javascript'
      : req.url === '/style.css'
        ? 'text/css'
        : 'text/html',
  );
  res.end(
    req.url === '/remote.mjs'
      ? source
      : req.url === '/style.css'
        ? css
        : '<link rel="stylesheet" href="/style.css"><meta name="build-id" content="receipt-test"><script type="module">import {mountRemotePlaytest} from "/remote.mjs";window.mountCapture=()=>mountRemotePlaytest({context:()=>({}),checkpoint:()=>({})});window.remoteCapture=await window.mountCapture();</script>',
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
  page.setDefaultTimeout(5000);

  await page.addInitScript(() => {
    window.originalConsoleError = console.error;
    const originalTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) =>
      originalTimeout(callback, delay === 15000 ? 100 : delay, ...args);
    const originalFetch = window.fetch;
    window.hungUploads = 0;
    window.fetch = async (url, options) => {
      if (
        window.hangNext &&
        String(url).endsWith('/event') &&
        JSON.parse(await options.body.text()).kind === 'feedback-text'
      ) {
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
      constructor(stream) {
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
        r.ondataavailable({ data: new Blob(['final media'], { type: 'video/webm' }) });
        r.onstop();
      }
    };
  });
  let sequence = 0,
    held = null,
    holdComment = true,
    badReceipt = false,
    statusCode = 200,
    sessionPosts = 0;
  const uploads = [];
  await page.route('**/api/playtest/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/config')) return route.fulfill({ json: { enabled: true } });
    if (path.endsWith('/session')) {
      sessionPosts++;
      return route.fulfill({ json: { sessionId: 'test-session' } });
    }
    uploads.push({ url: route.request().url(), body: route.request().postData() });
    if (
      path.endsWith('/event') &&
      route.request().postDataJSON().kind === 'feedback-text' &&
      holdComment
    ) {
      held = route;
      return;
    }
    if (statusCode !== 200)
      return route.fulfill({ status: statusCode, json: { error: 'test failure' } });
    return route.fulfill({
      json: badReceipt ? {} : { sequence: ++sequence, receivedAt: new Date().toISOString() },
    });
  });
  await browserEvidence.goto(page, `http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Share workshop tab & start' }).click();
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
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page
    .getByRole('button', { name: 'Close feedback', exact: true })
    .waitFor({ timeout: 3000 });
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Keep this exact comment visible.');
  await page.getByRole('button', { name: 'Send written feedback' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.playtest-comment')?.textContent.includes('Sending to Yaniv'),
  );
  browserEvidence.assert('match', [
    await page.locator('.playtest-comment').innerText(),
    /Keep this exact comment visible/,
  ]);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('.playtest-comment').innerText(),
    /Received by/,
  ]);
  browserEvidence.assert('deepEqual', [
    await geometry(),
    initial,
    'pending comment cannot resize the bar',
  ]);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-status]').textContent(),
    /uploads pending/,
  ]);
  while (!held) await new Promise((r) => setTimeout(r, 10));
  await held.fulfill({ json: {} });
  holdComment = false;
  badReceipt = true;
  await page.waitForFunction(() =>
    document.querySelector('.playtest-comment')?.textContent.includes('Not received yet'),
  );
  browserEvidence.assert('doesNotMatch', [
    await page.locator('.playtest-comment').innerText(),
    /Received by/,
  ]);
  browserEvidence.assert('deepEqual', [
    await geometry(),
    initial,
    'retry message cannot move controls',
  ]);
  badReceipt = false;
  await page.waitForFunction(() =>
    document.querySelector('.playtest-comment')?.textContent.includes('Received by Yaniv'),
  );
  for (const [code, message] of [
    [401, 'Open your invitation again'],
    [403, 'Open your invitation again'],
    [404, 'session is unavailable'],
    [413, 'upload is too large'],
    [503, 'retrying automatically'],
  ]) {
    statusCode = code;
    await page.getByRole('textbox', { name: 'Your feedback' }).fill(`Failure ${code}`);
    await page.getByRole('button', { name: 'Send written feedback' }).click();
    await page.waitForFunction(
      (text) => document.querySelector('[data-status-detail]').textContent.includes(text),
      message,
    );
    browserEvidence.assert('doesNotMatch', [
      await page.locator('.playtest-comment').last().innerText(),
      /Received by/,
    ]);
    statusCode = 200;
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.playtest-comment')]
        .at(-1)
        .textContent.includes('Received by Yaniv'),
    );
  }
  await page.evaluate(() => {
    window.hangNext = true;
  });
  await page.getByRole('textbox', { name: 'Your feedback' }).fill('Recover the timed-out upload.');
  await page.getByRole('button', { name: 'Send written feedback' }).click();
  await page.waitForFunction(() => window.hungUploads === 1);
  await page.waitForFunction(() =>
    document.querySelector('[data-status-detail]').textContent.includes('retrying automatically'),
  );
  browserEvidence.assert('doesNotMatch', [
    await page.locator('.playtest-comment').last().innerText(),
    /Received by/,
  ]);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.playtest-comment')]
      .at(-1)
      .textContent.includes('Received by Yaniv'),
  );
  for (const close of ['x', 'escape']) {
    await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
    await page.getByRole('button', { name: '● Stop voice recording', exact: true }).waitFor();
    if (close === 'x')
      await page.getByRole('button', { name: 'Close feedback', exact: true }).click();
    else await page.keyboard.press('Escape');
    browserEvidence.assert('equal', [await page.evaluate(() => window.pendingRecorders.length), 1]);
    browserEvidence.assert('equal', [
      await page.evaluate(() =>
        window.pendingRecorders[0].stream.getTracks().every((t) => t.readyState === 'ended'),
      ),
      true,
    ]);
    await page.evaluate(() => window.flushRecorders());
    await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Back to building' }).click();
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  browserEvidence.assert('match', [
    await page.locator('[data-completion-status]').innerText(),
    /Keep this tab open/,
  ]);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /You can close this tab/,
  ]);
  await page.waitForTimeout(150);
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /You can close this tab/,
  ]);
  await page.evaluate(() => window.flushRecorders());
  await page.waitForFunction(
    () =>
      document.querySelector('[data-completion-status]').textContent ===
      'Feedback received — session saved. You can close this tab.',
  );
  await page.evaluate(() => {
    window.originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readonly') throw Error('outbox unavailable');
      return window.originalTransaction.apply(this, args);
    };
  });
  await page.waitForFunction(() =>
    document
      .querySelector('[data-completion-status]')
      .textContent.includes('Session not fully saved'),
  );
  browserEvidence.assert('doesNotMatch', [
    await page.locator('[data-completion-status]').innerText(),
    /You can close this tab/,
  ]);
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.originalTransaction;
  });
  await page.getByRole('button', { name: 'Retry uploads' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-completion-status]')
      .textContent.includes('You can close this tab'),
  );
  // Real IndexedDB persists across a same-origin document reload; media capture remains mocked.
  const outbox = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('simulacrum-playtest-outbox', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction('items', 'readonly').objectStore('items').getAll();
          request.onsuccess = () =>
            resolve(
              request.result.map(({ id, url, body, type }) => ({ id, url, size: body.size, type })),
            );
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
  await browserEvidence.reload(page);
  await page.getByRole('button', { name: 'Share workshop tab & start' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-status-main]')?.textContent === '● Recording tab',
  );
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  statusCode = 503;
  const recoveryComment = 'Saved through reload while the server is unavailable.';
  await page.getByRole('textbox', { name: 'Your feedback' }).fill(recoveryComment);
  await page.getByRole('button', { name: 'Send written feedback' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.playtest-comment')?.textContent.includes('Not received yet'),
  );
  // Assert body durability too, not merely that some unrelated periodic upload survived.
  const savedBody = await page.evaluate(async (text) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('simulacrum-playtest-outbox', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await new Promise((resolve) => {
      const request = db.transaction('items').objectStore('items').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    for (const row of rows) {
      const body = await row.body.text();
      if (body.includes(text)) return { id: row.id, url: row.url, body };
    }
    return null;
  }, recoveryComment);
  browserEvidence.assert('ok', [
    savedBody,
    'written feedback body committed to real IndexedDB before reload',
  ]);
  const sessionsBeforeReload = sessionPosts,
    uploadsBeforeReload = uploads.length;
  await browserEvidence.reload(page);
  await page.waitForFunction(() =>
    document.querySelector('[data-status-detail]')?.textContent.includes('retrying automatically'),
  );
  browserEvidence.assert('ok', [
    (await outbox()).some((row) => row.id === savedBody.id),
    'outage cannot delete the persisted comment',
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
    true,
  ]);
  browserEvidence.assert('match', [
    await page.locator('[data-recovery]').innerText(),
    /saved uploads from an earlier session/i,
  ]);
  browserEvidence.assert('match', [
    await page.locator('[data-recovery]').innerText(),
    /recording has not resumed/i,
  ]);
  mkdirSync('artifacts/reload-recovery', { recursive: true });
  await page.screenshot({ path: 'artifacts/reload-recovery/outage-after-reload.png' });
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
    'malformed ACK after reload cannot delete saved feedback',
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
    'exact persisted feedback body retried to its original session',
  ]);
  browserEvidence.assert('equal', [await page.evaluate(() => window.captureRequests), 0]);
  browserEvidence.assert('equal', [sessionPosts, sessionsBeforeReload]);
  const receivedNotice = await page.locator('[data-recovery]').innerText();
  browserEvidence.assert('match', [receivedNotice, /recording has not resumed/i]);
  await page.screenshot({ path: 'artifacts/reload-recovery/received-after-reload.png' });
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/reload-recovery/result.json',
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
  // Dispose must release the mount while preserving delayed final MediaRecorder
  // bytes in real IndexedDB; a remount drains them without resuming capture.
  await page.getByRole('button', { name: 'Share workshop tab & start' }).click();
  await page.waitForFunction(() => window.remoteCapture.active());
  statusCode = 503;
  await page.evaluate(() => window.remoteCapture.dispose());
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
      const r = indexedDB.open('simulacrum-playtest-outbox', 1);
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
  await page.evaluate(() => window.remoteCapture.dispose());
  browserEvidence.assert('equal', [
    await page.locator('.playtest-panel, .playtest-dialog').count(),
    0,
  ]);
  browserEvidence.assert('equal', [
    await page.evaluate(() => console.error === window.originalConsoleError),
    true,
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
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
