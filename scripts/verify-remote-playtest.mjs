import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { createCaptureReviewIndex } from '../src/application/capture-stream.mjs';
import { sampleCapture } from './playtest/capture-samples.mjs';
import { feedbackReceiptMs, waitForCaptureDrain } from './playtest/release-policy.mjs';
import { installCaptureFault } from './playtest/capture-fault.mjs';
import { assertDrivenMotion } from './playtest/load.mjs';
import { createLocalCloud } from './playtest/local-cloud.mjs';
import { downloadCapture } from './playtest/download.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { createPlaytestServer } from './playtest-server.mjs';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const privateRoot = process.env.PLAYTEST_VERIFY_PRIVATE_ROOT;
const output = privateRoot ? join(privateRoot, 'screens') : 'artifacts/remote-playtest';
const expectedFaultErrors = [];
const browserEvidence = createBrowserEvidence({
  expectedErrors: expectedFaultErrors,
  ...(process.env.PLAYTEST_VERIFY_BUILD
    ? { readBuild: () => process.env.PLAYTEST_VERIFY_BUILD }
    : {}),
  ...(privateRoot
    ? {
        writeArtifact: (file, value) => {
          const dir = join(privateRoot, 'evidence');
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
const data = mkdtempSync(join(privateRoot || tmpdir(), 'remote-playtest-')),
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
let capturedSession, retryEpochs;
page.on('response', (response) => {
  if (new URL(response.url()).pathname === '/api/playtest/v2/session' && response.ok())
    capturedSession = response.json().then((value) => value.sessionId);
});
try {
  await page.context().grantPermissions(['microphone']);
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
  await page.getByRole('button', { name: 'Start recording' }).click();
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
  console.log('sharing');
  const captureSeconds = Number(process.env.PLAYTEST_CAPTURE_SECONDS || 0);
  if (!Number.isFinite(captureSeconds) || captureSeconds < 0 || captureSeconds > 1800)
    throw Error('Invalid capture duration');
  const outboxSamples = [];
  const resourceSamples = [];
  const metrics =
    process.env.PLAYTEST_CHARACTERIZATION === 'true'
      ? await page.context().newCDPSession(page)
      : null;
  if (metrics) await metrics.send('Performance.enable');
  const sampleOutbox = () =>
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
  }
  const activeWorkload = process.env.PLAYTEST_ACTIVE_WORKLOAD === 'true';
  const workloadActions = [];
  let driveStart, driveEnd;
  const readFrame = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  if (activeWorkload) {
    await page.locator('[data-part-type=poweredMotor]').click();
    await page.keyboard.press('ArrowRight');
    workloadActions.push('build-edit');
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
    await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
    driveStart = await readFrame();
    await page.locator('[data-command=run]').click();
    await page
      .locator('canvas')
      .first()
      .click({ position: { x: 20, y: 20 } });
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
  await page.screenshot({ path: join(output, 'recording-bar.png') });
  await page.locator('[data-part-type=poweredMotor]').click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('I expected this motor to move separately.');
  await page.getByRole('button', { name: 'Send written feedback' }).click();
  await page.waitForFunction(
    () => document.querySelector('.playtest-comment')?.textContent.includes('Received by'),
    undefined,
    { timeout: feedbackReceiptMs },
  );
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, 'feedback-receipt.png') });
  await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '● Stop voice recording', exact: true }).click();
  await page.getByRole('button', { name: 'Back to building' }).click();
  await page.waitForTimeout(3200);
  if (faultName === 'reload-recovery')
    fault = await installCaptureFault(page, faultName, expectedFaultErrors);
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
              .textContent.includes('You can close this tab'),
        ),
      }),
    });
  }
  await page.waitForTimeout(800);
  const finalOutbox = await sampleOutbox();
  if (finalOutbox.bytes || finalOutbox.pending)
    throw Error('Finished capture retains unacknowledged payloads');
  if (fault) fault.state.recovered = true;
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
  const id = readdirSync(data)[0],
    dir = join(data, id),
    records = readFileSync(join(dir, 'events.ndjson'), 'utf8').trim().split('\n').map(JSON.parse),
    wireEvents = records.filter((x) => x.event).map((x) => x.event),
    decoded = createCaptureReviewIndex(wireEvents),
    events = decoded.events;
  browserEvidence.assert('equal', [decoded.status, 'complete']);
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
  for (const kind of [
    'session-start',
    'input',
    'command-result',
    'feedback-anchor',
    'feedback-text',
    'voice-start',
    'voice-end',
    'session-end',
  ])
    browserEvidence.assert('ok', [events.some((x) => x.kind === kind), kind]);
  browserEvidence.assert('ok', [
    records.some((x) => x.media?.kind === 'screen' && x.media.bytes > 0) ===
      (recordingMode === 'video'),
  ]);
  browserEvidence.assert('ok', [
    records.some((x) => x.media?.kind === 'voice' && x.media.bytes > 0),
  ]);
  const anchor = decoded.readEvent(events.findIndex((x) => x.kind === 'feedback-anchor'));
  browserEvidence.assert('ok', [anchor.data.image.startsWith('data:image/jpeg')]);
  browserEvidence.assert('ok', [anchor.data.context.ui.selected]);
  browserEvidence.assert('ok', [
    events.find((x) => x.kind === 'feedback-text').data.anchorId === anchor.data.id,
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, 'completed.png') });
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
          mediaFiles: records
            .filter((row) => row.media?.kind === (recordingMode === 'data' ? 'voice' : 'screen'))
            .map((row) => join(dir, row.media.file)),
          recordingMode,
          captureSchema: 1,
          eventSamples: wireEvents,
          maximumEventBytes: Math.max(
            ...wireEvents.map((event) => Buffer.byteLength(JSON.stringify(event))),
          ),
          voiceBytes: records
            .filter((row) => row.media?.kind === 'voice')
            .reduce((sum, row) => sum + row.media.bytes, 0),
          maximumVoiceChunkBytes: Math.max(
            0,
            ...records.filter((row) => row.media?.kind === 'voice').map((row) => row.media.bytes),
          ),
          voiceChunks: records.filter((row) => row.media?.kind === 'voice').length,
          screenChunks: records.filter((row) => row.media?.kind === 'screen').length,
          exportMs,
          outboxSamples,
          resourceSamples,
          finalOutbox,
          storageBytes: records.reduce(
            (n, row) => n + (row.media?.bytes || row.rawEvent?.bytes || 0),
            0,
          ),
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
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: join(output, 'failure.png') });
  writeFileSync(join(output, 'failure.txt'), await page.locator('body').innerText());
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    if (cloud) await cloud.close();
  }
}
