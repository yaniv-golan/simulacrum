import { withCleanup, errorMessages } from './verification-cleanup.mjs';
import { placeCatalogPart } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { createCaptureReviewIndex } from '../src/application/capture-stream.mjs';
import { reviewVideo, seekVideo } from '../src/presentation/capture-review-model.mjs';
import {
  validateFeedbackEnvelope,
  validateFeedbackReceipt,
  feedbackDigest,
} from '../src/application/feedback-protocol.mjs';
import { sampleCapture } from './playtest/capture-samples.mjs';
import { feedbackReceiptMs, waitForCaptureDrain } from './playtest/release-policy.mjs';
import { installCaptureFault } from './playtest/capture-fault.mjs';
import { assertDrivenMotion } from './playtest/load.mjs';
import { createLocalCloud } from './playtest/local-cloud.mjs';
import { downloadCapture } from './playtest/download.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { createPlaytestServer } from './playtest-server.mjs';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const privateRoot = process.env.PLAYTEST_VERIFY_PRIVATE_ROOT;
const output = browserArtifactPath(
  'artifacts/remote-playtest',
  privateRoot ? join(privateRoot, 'screens') : undefined,
);
const expectedFaultErrors = [];
const browserEvidence = createBrowserEvidence({
  expectedErrors: expectedFaultErrors,
  ...(process.env.PLAYTEST_VERIFY_BUILD
    ? { readBuild: () => process.env.PLAYTEST_VERIFY_BUILD }
    : {}),
  ...(privateRoot
    ? {
        writeArtifact: (file, value) => {
          const dir = browserArtifactPath(
            'artifacts/browser-evidence/remote-playtest',
            join(privateRoot, 'evidence'),
          );
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, file),
            Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value),
          );
        },
      }
    : {}),
});

const recordingMode = process.env.PLAYTEST_RECORDING_MODE || 'data';
if (!['data', 'video'].includes(recordingMode)) throw Error('Invalid recording mode');
const adapter = process.env.PLAYTEST_VERIFY_ADAPTER || 'node';
const remoteOrigin = process.env.PLAYTEST_VERIFY_ORIGIN;
const dataRoot = browserArtifactPath('artifacts/remote-playtest-data', privateRoot || tmpdir());
mkdirSync(dataRoot, { recursive: true });
const data = mkdtempSync(join(dataRoot, 'remote-playtest-')),
  token = process.env.PLAYTEST_VERIFY_TOKEN || 'browser-verification-token-'.repeat(3),
  adminToken = process.env.PLAYTEST_ADMIN_TOKEN || 'local-admin-test-'.repeat(4);
let server, cloud;
let origin = remoteOrigin;
if (!origin && adapter === 'cloud') {
  cloud = await createLocalCloud({ token, adminToken, optionalVideo: recordingMode === 'video' });
  origin = cloud.origin;
} else if (!origin) {
  server = createPlaytestServer({
    publicDir: 'dist',
    dataDir: data,
    token,
    adminToken,
    optionalVideo: recordingMode === 'video',
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
}
const browser = await browserEvidence.launch({
  profile: 'recording',
  ...{
    channel: 'chrome',
    headless: false,
    args: [
      '--auto-accept-this-tab-capture',
      '--auto-select-tab-capture-source-by-title=Simulacrum',
      '--use-fake-device-for-media-stream',
      '--allow-http-screen-capture',
    ],
  },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

page.setDefaultTimeout(15000);
let capturedSession, retryEpochs, feedbackOpenedAt, feedbackClosedAt;
const submittedFeedback = new Map();
const outboxSamples = [],
  resourceSamples = [];
const uploadTimings = [];
const uploadStarted = new WeakMap();
const uploadStatus = new WeakMap();
let sampleOutbox = async () => null;
const phaseTimings = [];
function phase(name) {
  const now = Date.now();
  if (phaseTimings.length) phaseTimings.at(-1).elapsedMs = now - phaseTimings.at(-1).startedAt;
  phaseTimings.push({ name, startedAt: now });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'phases.json'), JSON.stringify(phaseTimings), { mode: 0o600 });
  console.log('capture phase', name);
}
page.on('request', (request) => {
  if (/^\/api\/playtest\/v2\/[a-f0-9]{32}\/(event|media)$/.test(new URL(request.url()).pathname))
    uploadStarted.set(request, Date.now());
});
page.on('requestfinished', (request) => {
  const started = uploadStarted.get(request);
  if (started && uploadTimings.length < 10000)
    uploadTimings.push({
      at: Date.now(),
      ms: Date.now() - started,
      outcome: 'finished',
      status: uploadStatus.get(request) ?? null,
    });
});
page.on('requestfailed', (request) => {
  const started = uploadStarted.get(request);
  if (started && uploadTimings.length < 10000)
    uploadTimings.push({ at: Date.now(), ms: Date.now() - started, outcome: 'failed' });
});
page.on('response', (response) => {
  if (
    new URL(response.url()).pathname === '/api/playtest/feedback/v1/submission' &&
    response.ok()
  ) {
    const bodyText = response.request().postData(),
      envelope = JSON.parse(bodyText);
    submittedFeedback.set(envelope.id, { bodyText, envelope, receipt: response.json() });
  }
  if (uploadStarted.has(response.request()))
    uploadStatus.set(response.request(), response.status());
  if (new URL(response.url()).pathname === '/api/playtest/v2/session' && response.ok())
    capturedSession = response.json().then((value) => value.sessionId);
});
let executionError,
  executionFailed = false;
try {
  await page.context().grantPermissions(['microphone']);
  phase('setup');
  console.log('opening');
  await browserEvidence.goto(page, `${origin}/join?token=${token}`);
  console.log('loaded');
  if (recordingMode === 'video') await page.locator('[data-video]').check();
  else
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = () => {
        throw Error('Data capture requested screen access');
      };
    });
  await page.locator('[data-start]').click();
  console.log('share clicked');
  await page
    .waitForFunction(
      () =>
        document.querySelector('.playtest-panel [data-status]').textContent.includes('Recording '),
      null,
      { timeout: 15000 },
    )
    .catch(async (e) => {
      console.log(await page.locator('body').innerText());
      throw e;
    });
  phase('capture');
  console.log('sharing');
  const captureSeconds = Number(process.env.PLAYTEST_CAPTURE_SECONDS ?? 3);
  if (!Number.isFinite(captureSeconds) || captureSeconds < 0 || captureSeconds > 1800)
    throw Error('Invalid capture duration');
  const metrics =
    process.env.PLAYTEST_CHARACTERIZATION === 'true'
      ? await page.context().newCDPSession(page)
      : null;
  if (metrics) await metrics.send('Performance.enable');
  sampleOutbox = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('simulacrum-playtest-outbox-v2', 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('items', 'readonly'),
            r = tx.objectStore('items').getAll();
          tx.oncomplete = () =>
            resolve({
              at: Date.now(),
              pending: r.result.filter((row) => row.body).length,
              retained: r.result.length,
              blocked: r.result.filter((row) => row.outcome === 'blocked').length,
              received: r.result.filter((row) => row.outcome === 'received').length,
              bytes: r.result.reduce((n, row) => n + (row.body?.size || 0), 0),
            });
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
  // Local synthetic capture: keep a real upload outstanding across application retry.
  // Hosted characterization keeps its separately configured workload unchanged.
  if (
    !remoteOrigin &&
    !process.env.PLAYTEST_CAPTURE_FAULT &&
    process.env.PLAYTEST_ACTIVE_WORKLOAD !== 'true'
  ) {
    const readWorkshop = () => page.evaluate(() => window.workshopProbe.observe());
    browserEvidence.assert('equal', [
      (await readWorkshop()).frames[0].metadata.blueprint.parts.length,
      0,
      'empty recorded workbench is an explicit starting condition',
    ]);
    await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
    await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
    browserEvidence.assert('equal', [
      await page.getByRole('button', { name: 'Replace without saving', exact: true }).isVisible(),
      false,
      'empty workbench needs no replacement confirmation',
    ]);
    browserEvidence.assert('ok', [
      (await readWorkshop()).frames[0].metadata.blueprint.parts.length > 0,
      'empty-workbench example actually loaded',
    ]);
    const bp = createEmptyBlueprint('recorded-ball', 'Recorded Ball');
    bp.parts.push(createPart('ball', 'ball', [0, 3, 0]));
    mkdirSync(output, { recursive: true });
    const fixture = join(output, 'retry-ball.json');
    writeFileSync(fixture, JSON.stringify(bp));
    const retryFault = await installCaptureFault(page, 'reload-recovery', expectedFaultErrors);
    try {
      await browserEvidence.loadAndWait(page, fixture);
      await page.locator('[data-command=run]').click();
      await page.evaluate(() => window.advanceTime(1000));
      for (let tries = 0; tries < 50 && !retryFault.state.injected; tries++)
        await page.waitForTimeout(100);
      browserEvidence.assert('ok', [retryFault.state.injected > 0, 'a real upload was attempted']);
      browserEvidence.assert('ok', [(await sampleOutbox()).pending > 0]);
      const before = await page.evaluate(() => window.workshopProbe.observe());
      // A load requested while retry is pending must not run a different document.
      await page.evaluate(() => {
        document.querySelector('[data-command=retry]').click();
        const input = document.querySelector('input[type=file]'),
          transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [
              JSON.stringify({
                version: 3,
                id: 'wrong-document',
                name: 'Wrong document',
                parts: [],
                connections: [],
              }),
            ],
            'other.json',
            { type: 'application/json' },
          ),
        );
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Confirm the requested replacement in the same pending-retry turn.
        // Selecting a file alone only opens the protection dialog.
        [...document.querySelectorAll('button')]
          .find((button) => button.textContent === 'Replace without saving')
          .click();
      });
      await page.waitForFunction(
        (epoch) => window.workshopProbe.observe().cursor.epoch > epoch,
        before.cursor.epoch,
      );
      await page.evaluate(() => window.advanceTime(100));
      const after = await page.evaluate(() => window.workshopProbe.observe());
      browserEvidence.assert('deepEqual', [
        after.frames[0].metadata.blueprint,
        before.frames[0].metadata.blueprint,
      ]);
      browserEvidence.assert('equal', [after.frames[0].metadata.mode, 'run']);
      browserEvidence.assert('ok', [(await sampleOutbox()).pending > 0]);
      browserEvidence.assert('equal', [
        after.cursor.epoch,
        before.cursor.epoch + 1,
        'overlapping load must not cause a second reset',
      ]);
      retryEpochs = [before.cursor.epoch, after.cursor.epoch];
      await page.evaluate(() => {
        const input = document.querySelector('input[type=file]'),
          transfer = new DataTransfer();
        const save = JSON.stringify(JSON.parse(window.render_game_to_text()).metadata.blueprint);
        transfer.items.add(new File([save], 'slow-read.json', { type: 'application/json' }));
        input.files = transfer.files;
        Object.defineProperty(input.files[0], 'text', {
          value: () =>
            new Promise((resolve) => {
              window.finishBallFileRead = () => resolve(save);
            }),
        });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
      await page.waitForFunction(() => typeof window.finishBallFileRead === 'function');
      await page.evaluate(() => {
        document.querySelector('[data-command=retry]').click();
      });
      browserEvidence.assert('equal', [
        (await page.evaluate(() => window.workshopProbe.readLastCommandResult())).result.reasonCode,
        'RETRY_PENDING',
        'retry rejected while an earlier file read is pending',
      ]);
      await page.evaluate(() => {
        window.finishBallFileRead();
        delete window.finishBallFileRead;
      });
      await page.waitForFunction(() => {
        const r = window.workshopProbe.readLastCommandResult();
        return r?.input.type === 'load' && r.result.ok;
      });
    } finally {
      await retryFault.stop();
    }
    await page.locator('[data-command=build]').click();
    const populated = await readWorkshop();
    browserEvidence.assert('equal', [
      populated.frames[0].metadata.blueprint.parts.length,
      1,
      'recorded Ball remains populated before replacement',
    ]);
    await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
    await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
    browserEvidence.assert('deepEqual', [
      await readWorkshop(),
      populated,
      'cancelling recorded replacement preserves blueprint, cursor and consequential state',
    ]);
    await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
    await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
    browserEvidence.assert('ok', [
      (await readWorkshop()).frames[0].metadata.blueprint.parts.length > 1,
      'confirmed recorded replacement actually changes the machine',
    ]);
  }
  const activeWorkload = process.env.PLAYTEST_ACTIVE_WORKLOAD !== 'false';
  const workloadActions = [];
  let driveStart, driveEnd;
  const readFrame = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  if (activeWorkload) {
    await placeCatalogPart(page, 'poweredMotor');
    await page.keyboard.press('ArrowRight');
    workloadActions.push('build-edit');
    await page.keyboard.press('Delete');
    const beforeReplacement = await readFrame();
    await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
    await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
    if (beforeReplacement.metadata.blueprint.parts.length) {
      await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
    }
    driveStart = await readFrame();
    await page.locator('[data-command=run]').click();
    const canvas = page.locator('canvas').first();
    const canvasBounds = await canvas.boundingBox();
    await canvas.click({
      position: { x: canvasBounds.width / 2, y: canvasBounds.height / 2 },
    });
    await page.keyboard.down('w');
    workloadActions.push('drive');
  }
  const faultName = process.env.PLAYTEST_CAPTURE_FAULT;
  let fault =
    faultName && faultName !== 'reload-recovery'
      ? await installCaptureFault(page, faultName, expectedFaultErrors)
      : null;
  const captureStarted = Date.now();
  let turn = false;
  while (Date.now() - captureStarted < captureSeconds * 1000) {
    await page.waitForTimeout(
      Math.min(3000, Math.max(1, captureSeconds * 1000 - (Date.now() - captureStarted))),
    );
    outboxSamples.push(await sampleOutbox());
    if (metrics) {
      const values = (await metrics.send('Performance.getMetrics')).metrics;
      resourceSamples.push({
        at: Date.now(),
        ...Object.fromEntries(
          values
            .filter((x) => ['JSHeapUsedSize', 'Nodes', 'Documents'].includes(x.name))
            .map((x) => [x.name, x.value]),
        ),
      });
    }
    if (activeWorkload) {
      if (turn) await page.keyboard.up('a');
      else await page.keyboard.down('a');
      turn = !turn;
    }
  }
  const captureEnded = Date.now();
  if (fault) await fault.stop();
  if (activeWorkload) {
    driveEnd = await readFrame();
    assertDrivenMotion(driveStart, driveEnd);
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: join(output, 'active-driving.png') });
    await page.keyboard.up('w');
    await page.keyboard.up('a');
    await page.locator('[data-command=build]').click();
    workloadActions.push('return-build');
  }
  mkdirSync(output, { recursive: true });
  phase('feedback');
  await page.screenshot({ path: join(output, 'recording-bar.png') });
  await placeCatalogPart(page, 'poweredMotor');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your feedback' }).waitFor({ state: 'visible' });
  feedbackOpenedAt = await page.evaluate(() => Date.now());
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('I expected this motor to move separately.');
  await page.locator('[data-attachments] summary').first().click();
  await page.locator('[data-image]').check();
  await page.locator('[data-context]').check();
  await page.locator('[data-image-preview]').waitFor({ state: 'visible' });
  await page.locator('[data-context-preview]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-receipt-state]')?.textContent === 'Sent to Yaniv for review.',
    undefined,
    { timeout: feedbackReceiptMs },
  );
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, 'feedback-receipt.png') });
  await page.getByRole('button', { name: 'Add another', exact: true }).click();
  await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop voice recording', exact: true }).click();
  await page.locator('[data-playback]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-playback]').readyState >= 1);
  await page.locator('[data-playback]').evaluate(async (audio) => {
    await audio.play();
    audio.pause();
  });
  browserEvidence.assert('equal', [
    submittedFeedback.size,
    1,
    'finalized voice remains local before Send',
  ]);
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-submitted-text]')?.textContent === 'Voice comment',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-receipt-state]')?.textContent === 'Sent to Yaniv for review.',
    undefined,
    { timeout: feedbackReceiptMs },
  );
  feedbackClosedAt = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Back to building' }).click();
  await page.waitForTimeout(3200);
  if (faultName === 'reload-recovery')
    fault = await installCaptureFault(page, faultName, expectedFaultErrors);
  phase('completion');
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  if (faultName === 'reload-recovery') {
    await page.waitForTimeout(500);
    const pending = await sampleOutbox();
    if (!pending.pending) throw Error('Reload fault requires pending durable payloads');
    fault.state.pendingBeforeReload = pending.pending;
    await fault.stop();
    await browserEvidence.reload(page);
  }
  let finalDrain;
  if (faultName === 'reload-recovery') {
    await page
      .getByText(
        'Saved uploads from your earlier session were received by Yaniv’s playtest server.',
        { exact: false },
      )
      .waitFor();
    browserEvidence.assert('ok', [
      (await page.locator('.playtest-panel [data-status]').innerText()).includes('Ready to record'),
      'Reload recovery must not restart recording',
    ]);
  } else {
    finalDrain = await waitForCaptureDrain({
      read: async () => ({
        ...(await sampleOutbox()),
        saved: await page.evaluate(
          () =>
            document
              .querySelector('.playtest-panel [data-status]')
              .textContent.includes('All received') &&
            document
              .querySelector('[data-completion-status]')
              .textContent.includes('Recording received'),
        ),
      }),
    });
  }
  await page.waitForTimeout(800);
  const finalOutbox = await sampleOutbox();
  if (finalOutbox.bytes || finalOutbox.pending)
    throw Error('Finished capture retains unacknowledged payloads');
  if (fault) fault.state.recovered = true;
  phase('export');
  const exportStarted = Date.now();
  if (adapter === 'cloud' || remoteOrigin) {
    const id = await capturedSession;
    if (!id) throw Error('Missing owned cloud capture');
    await downloadCapture({
      origin,
      sessionId: id,
      directory: join(data, id),
      token: adminToken,
      allowLocal: !!cloud,
    });
  }
  const exportMs = Date.now() - exportStarted;
  phase('index');
  const id = await capturedSession,
    dir = join(data, id),
    records = readFileSync(join(dir, 'events.ndjson'), 'utf8').trim().split('\n').map(JSON.parse),
    wireEvents = records.filter((x) => x.event).map((x) => x.event),
    decoded = createCaptureReviewIndex(wireEvents),
    events = decoded.events;
  browserEvidence.assert('equal', [decoded.status, 'complete']);
  let segmentEvidence;
  if (recordingMode === 'video') {
    const sealed = events
      .filter((event) => event.kind === 'screen-segment')
      .map((event) => event.data)
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
    browserEvidence.assert('ok', [
      sealed.length >= 2,
      'actual video resumes in a new segment after feedback closes',
    ]);
    const reviewMedia = [],
      decodes = [];
    for (const segment of sealed) {
      browserEvidence.assert('ok', [
        [segment.startTimeMs, segment.endTimeMs, segment.durationMs].every(Number.isFinite) &&
          segment.durationMs > 0 &&
          segment.endTimeMs > segment.startTimeMs,
        'sealed video has measured finite duration',
      ]);
      const chunks = records
        .filter((row) => row.media?.kind === 'screen' && row.media.clip === segment.clip)
        .map((row) => row.media)
        .sort((a, b) => a.seq - b.seq);
      browserEvidence.assert('ok', [
        chunks.length > 0,
        'every sealed video segment exports its actual encoder bytes',
      ]);
      chunks.forEach((chunk, index) =>
        browserEvidence.assert('equal', [
          chunk.seq,
          index,
          'segment media is contiguous from its header',
        ]),
      );
      const bytes = Buffer.concat(chunks.map((chunk) => readFileSync(join(dir, chunk.file))));
      const mime = chunks[0].mime,
        file = `segment-${segment.clip}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
      writeFileSync(join(dir, file), bytes, { mode: 0o600 });
      reviewMedia.push({ kind: 'screen', clip: segment.clip, file });
      const decodedFrame = await page.evaluate(
        async ({ base64, mime }) => {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
            video = document.createElement('video');
          const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          video.muted = true;
          video.playsInline = true;
          video.width = 160;
          video.height = 90;
          video.style.position = 'fixed';
          video.style.right = '0';
          video.style.bottom = '0';
          video.style.pointerEvents = 'none';
          document.body.append(video);
          try {
            return await new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(Error('Exported segment did not decode a frame')),
                15000,
              );
              video.onerror = () => {
                clearTimeout(timer);
                reject(Error('Exported segment media decode failed'));
              };
              video.requestVideoFrameCallback((_, metadata) => {
                clearTimeout(timer);
                resolve({
                  width: video.videoWidth,
                  height: video.videoHeight,
                  mediaTime: metadata.mediaTime,
                });
              });
              video.src = url;
              void video.play().catch((error) => {
                clearTimeout(timer);
                reject(error);
              });
            });
          } finally {
            video.pause();
            video.remove();
            URL.revokeObjectURL(url);
          }
        },
        { base64: bytes.toString('base64'), mime },
      );
      browserEvidence.assert('ok', [
        decodedFrame.width > 0 &&
          decodedFrame.height > 0 &&
          Number.isFinite(decodedFrame.mediaTime),
        'real exported segment decodes a browser video frame',
      ]);
      decodes.push({ clip: segment.clip, bytes: bytes.length, ...decodedFrame });
    }
    const reviewed = reviewVideo(events, reviewMedia);
    browserEvidence.assert('equal', [reviewed.error, undefined]);
    browserEvidence.assert('equal', [reviewed.segments.length, sealed.length]);
    const start = events.find((event) => event.kind === 'session-start'),
      originEpoch = Date.parse(start.at) - start.timeMs;
    const protectedStart = feedbackOpenedAt - originEpoch,
      protectedEnd = feedbackClosedAt - originEpoch;
    browserEvidence.assert('ok', [
      protectedEnd - protectedStart >= 1000,
      'protected feedback interval includes the recorded voice preview journey',
    ]);
    const gap = sealed
      .slice(1)
      .map((next, index) => ({ start: sealed[index].endTimeMs, end: next.startTimeMs }))
      .find((gap) => gap.start <= protectedStart + 2 && gap.end >= protectedEnd - 2);
    browserEvidence.assert('ok', [
      gap,
      'actual encoder segments leave the visible feedback interval unavailable',
    ]);
    browserEvidence.assert('equal', [
      seekVideo(reviewed, (protectedStart + protectedEnd) / 2),
      null,
      'reviewer cannot seek into a feedback suppression gap',
    ]);
    for (const segment of sealed) {
      const seek = seekVideo(reviewed, (segment.startTimeMs + segment.endTimeMs) / 2);
      browserEvidence.assert('ok', [
        seek && Math.abs(seek.timeSeconds - segment.durationMs / 2000) < 1e-8,
        'reviewer maps session time to measured media time',
      ]);
    }
    segmentEvidence = { sealed, decodes, protectedStart, protectedEnd, gap };
  }
  if (retryEpochs) {
    const contexts = events.map((_, i) => decoded.readEvent(i));
    browserEvidence.assert('ok', [
      contexts.some(
        (e) =>
          e.kind === 'command-result' &&
          e.data.input?.type === 'load' &&
          e.data.result?.reasonCode === 'RETRY_PENDING',
      ),
      'file load was rejected while retry was pending',
    ]);
    browserEvidence.assert('ok', [
      contexts.some(
        (e) =>
          e.kind === 'command-result' &&
          e.data.input?.type === 'retry' &&
          e.data.result?.reasonCode === 'RETRY_PENDING',
      ),
      'retry was rejected while file read was pending',
    ]);
    for (const epoch of retryEpochs)
      browserEvidence.assert('ok', [
        contexts.some((e) => e.context?.cursor?.epoch === epoch),
        'recording retains both retry epochs',
      ]);
    browserEvidence.assert('ok', [
      contexts.some(
        (e) => e.kind === 'command-result' && e.data.input?.type === 'retry' && e.data.result.ok,
      ),
      'actual application retry receipt retained',
    ]);
    browserEvidence.assert('ok', [
      contexts.every((e) => e.context?.observation?.metadata?.blueprint?.id !== 'wrong-document'),
      'overlapping load never replaced captured machine',
    ]);
  }
  for (const kind of ['session-start', 'input', 'command-result', 'session-end'])
    browserEvidence.assert('ok', [events.some((event) => event.kind === kind), kind]);
  browserEvidence.assert('equal', [
    events.some((event) =>
      ['feedback-anchor', 'feedback-text', 'voice-start', 'voice-end'].includes(event.kind),
    ),
    false,
    'standalone feedback does not extend recorded timeline',
  ]);
  browserEvidence.assert('ok', [
    records.some((row) => row.media?.kind === 'screen' && row.media.bytes > 0) ===
      (recordingMode === 'video'),
  ]);
  browserEvidence.assert('equal', [
    submittedFeedback.size,
    2,
    'text plus attachments and voice are two explicit submissions',
  ]);
  const feedbackExports = [],
    feedbackExportStarted = Date.now();
  for (const [submissionId, submitted] of submittedFeedback) {
    const response = await fetch(
      new URL(`/admin/playtest/feedback/${submissionId}/export`, origin),
      { headers: { authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw Error(`Owned feedback export failed: ${response.status}`);
    const exported = await response.json(),
      envelope = validateFeedbackEnvelope(exported.envelope);
    browserEvidence.assert('equal', [exported.protocolVersion, 1]);
    browserEvidence.assert('equal', [
      exported.bodyText,
      submitted.bodyText,
      'admin export preserves exact submitted bytes',
    ]);
    browserEvidence.assert('deepEqual', [JSON.parse(exported.bodyText), envelope]);
    browserEvidence.assert('ok', [
      validateFeedbackReceipt(exported.receipt, {
        id: submissionId,
        uploadHash: await feedbackDigest(exported.bodyText),
      }),
    ]);
    browserEvidence.assert('deepEqual', [
      exported.receipt,
      await submitted.receipt,
      'admin export retains the acknowledged receipt',
    ]);
    feedbackExports.push(exported);
  }
  const feedbackExportMs = Date.now() - feedbackExportStarted;
  writeFileSync(join(dir, 'feedback.json'), JSON.stringify(feedbackExports), { mode: 0o600 });
  const written = feedbackExports.find((row) => row.envelope.text),
    spoken = feedbackExports.find((row) => row.envelope.voice);
  browserEvidence.assert('equal', [
    written.envelope.text,
    'I expected this motor to move separately.',
  ]);
  browserEvidence.assert('ok', [written.envelope.image.dataUrl.startsWith('data:image/')]);
  browserEvidence.assert('equal', [written.envelope.image.scope, 'canvas']);
  browserEvidence.assert('ok', [written.envelope.context.value.workshop.ui.selected]);
  browserEvidence.assert('ok', [
    written.envelope.context.value.project.parts.some(
      (part) => part.id === written.envelope.context.value.workshop.ui.selected,
    ),
    'feedback includes the selected authored part',
  ]);
  browserEvidence.assert('equal', [
    'physics' in written.envelope.context.value.project ||
      'configuration' in written.envelope.context.value.project,
    false,
    'feedback project excludes replay checkpoint storage',
  ]);
  browserEvidence.assert('equal', [written.envelope.image.reference.sessionId, id]);
  browserEvidence.assert('equal', [written.envelope.context.reference.sessionId, id]);
  browserEvidence.assert('ok', [
    spoken.envelope.voice.durationMs > 0 && spoken.envelope.voice.durationMs <= 60000,
  ]);
  const feedbackFiles = feedbackExports.map((row) => {
    const file = join(dir, `feedback-envelope-${row.envelope.id}.json`);
    writeFileSync(file, row.bodyText, { mode: 0o600 });
    return file;
  });
  browserEvidence.assert('deepEqual', [errors, []]);
  mkdirSync(output, { recursive: true });
  phase('screenshot');
  await page.screenshot({ path: join(output, 'completed.png') });
  phase('report');
  browserEvidence.assertUnchanged();
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: decoded.readEvent(0).context.build,
        events: events.length,
        media: records.filter((x) => x.media).map((x) => x.media),
        errors,
        recordingMode,
        captureSchema: 1,
        segmentEvidence,
        feedbackSubmissions: feedbackExports.map((row) => ({
          id: row.envelope.id,
          voiceBytes: row.envelope.voice
            ? Buffer.from(row.envelope.voice.base64, 'base64').length
            : 0,
        })),
        screenSource:
          recordingMode === 'video'
            ? 'Chromium automated current-tab capture; fake microphone device'
            : 'No video; canvas feedback screenshot; fake microphone device',
      },
      null,
      2,
    ),
  );
  if (process.env.PLAYTEST_VERIFY_RESULT)
    writeFileSync(
      process.env.PLAYTEST_VERIFY_RESULT,
      JSON.stringify(
        await sampleCapture({
          directory: dir,
          source: browserEvidence.identity.source,
          build: browserEvidence.identity.build,
          syntheticRun:
            JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).syntheticRun ?? null,
          feedbackFiles,
          mediaFiles:
            recordingMode === 'data'
              ? []
              : records
                  .filter((row) => row.media?.kind === 'screen')
                  .map((row) => join(dir, row.media.file)),
          recordingMode,
          captureSchema: 1,
          eventSamples: wireEvents,
          maximumEventBytes: Math.max(
            ...wireEvents.map((event) => Buffer.byteLength(JSON.stringify(event))),
          ),
          voiceBytes: 0,
          maximumVoiceChunkBytes: 0,
          voiceChunks: 0,
          screenChunks: records.filter((row) => row.media?.kind === 'screen').length,
          exportMs,
          feedbackExportMs,
          segmentEvidence,
          phaseTimings,
          outboxSamples,
          resourceSamples,
          uploadTimings,
          finalOutbox,
          storageBytes:
            records.reduce((n, row) => n + (row.media?.bytes || row.rawEvent?.bytes || 0), 0) +
            feedbackExports.reduce((n, row) => n + Buffer.byteLength(row.bodyText), 0),
          captureSeconds,
          finalDrain,
          captureStarted,
          captureEnded,
          browserVersion: browser.version(),
          workloadActions,
          fault: fault?.state ?? null,
          driving: driveStart
            ? {
                fromTick: driveStart.tick,
                toTick: driveEnd.tick,
                from: driveStart.physics.map((b) => b.position),
                to: driveEnd.physics.map((b) => b.position),
              }
            : null,
          maximumScreenChunkBytes: Math.max(
            0,
            ...records.filter((row) => row.media?.kind === 'screen').map((row) => row.media.bytes),
          ),
          screenBytes: records
            .filter((row) => row.media?.kind === 'screen')
            .reduce((sum, row) => sum + row.media.bytes, 0),
        }),
      ),
      { mode: 0o600 },
    );
  console.log('remote capture browser passed', adapter);
} catch (error) {
  executionFailed = true;
  executionError = error;
  try {
    phase('failed');
    let finalFailureOutbox, diagnosticTimeout;
    try {
      finalFailureOutbox = await Promise.race([
        sampleOutbox(),
        new Promise((resolve) => {
          diagnosticTimeout = setTimeout(() => resolve({ unavailable: true }), 5000);
        }),
      ]);
    } catch {
      finalFailureOutbox = { unavailable: true };
    } finally {
      clearTimeout(diagnosticTimeout);
    }
    // Preserve bounded numeric diagnostics even when receipt or drain fails.
    // Do not export invitation URLs, payload bodies, comments or credentials.
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, 'transport-failure.json'),
      JSON.stringify({
        outboxSamples,
        resourceSamples,
        uploadTimings,
        finalFailureOutbox,
        phaseTimings,
      }),
      { mode: 0o600 },
    );
    await browserEvidence.captureFailure(error);

    await page.screenshot({ path: join(output, 'failure.png') });
    writeFileSync(join(output, 'failure.txt'), await page.locator('body').innerText());
  } catch (diagnosticError) {
    executionError = new AggregateError(
      [error, diagnosticError],
      [error, diagnosticError].flatMap((e) => errorMessages(e)).join('; '),
    );
  }
} finally {
  await withCleanup(
    () => {
      if (executionFailed) throw executionError;
    },
    () => browserEvidence.assertUnchanged(),
    () => phase('browser-close'),
    () => browser.close(),
    () => {
      if (server) phase('server-close');
    },
    () => {
      if (server) server.closeAllConnections();
    },
    () =>
      server &&
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    () => {
      if (cloud) phase('cloud-close');
    },
    () => cloud?.close(),
    () => phase('closed'),
  );
}
