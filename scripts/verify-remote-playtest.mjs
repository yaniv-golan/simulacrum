import { createLocalCloud } from './playtest/local-cloud.mjs';
import { downloadCapture } from './playtest/download.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { createPlaytestServer } from './playtest-server.mjs';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const privateRoot = process.env.PLAYTEST_VERIFY_PRIVATE_ROOT;
const output = privateRoot ? join(privateRoot, 'screens') : 'artifacts/remote-playtest';
const browserEvidence = createBrowserEvidence({
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

const adapter = process.env.PLAYTEST_VERIFY_ADAPTER || 'node';
const remoteOrigin = process.env.PLAYTEST_VERIFY_ORIGIN;
const data = mkdtempSync(join(privateRoot || tmpdir(), 'remote-playtest-')),
  token = process.env.PLAYTEST_VERIFY_TOKEN || 'browser-verification-token-'.repeat(3),
  adminToken = process.env.PLAYTEST_ADMIN_TOKEN || 'local-admin-test-'.repeat(4);
let server, cloud;
let origin = remoteOrigin;
if (!origin && adapter === 'cloud') {
  cloud = await createLocalCloud({ token, adminToken });
  origin = cloud.origin;
} else if (!origin) {
  server = createPlaytestServer({ publicDir: 'dist', dataDir: data, token });
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

let capturedSession;
page.on('response', (response) => {
  if (new URL(response.url()).pathname === '/api/playtest/v2/session' && response.ok())
    capturedSession = response.json().then((value) => value.sessionId);
});
try {
  await page.context().grantPermissions(['microphone']);
  console.log('opening');
  await browserEvidence.goto(page, `${origin}/join?token=${token}`);
  console.log('loaded');
  await page.getByRole('button', { name: 'Share workshop tab & start' }).click();
  console.log('share clicked');
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('.playtest-panel [data-status]')
          .textContent.includes('Recording tab'),
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
  for (let remaining = captureSeconds * 1000; remaining > 0; remaining -= 3000) {
    await page.waitForTimeout(Math.min(remaining, 3000));
    outboxSamples.push(await sampleOutbox());
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
  await page.waitForFunction(() =>
    document.querySelector('.playtest-comment')?.textContent.includes('Received by'),
  );
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, 'feedback-receipt.png') });
  await page.getByRole('button', { name: 'Record voice comment', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '● Stop voice recording', exact: true }).click();
  await page.getByRole('button', { name: 'Back to building' }).click();
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.playtest-panel [data-status]').textContent.includes('All received'),
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[data-completion-status]')
      .textContent.includes('You can close this tab'),
  );
  await page.waitForTimeout(800);
  const finalOutbox = await sampleOutbox();
  if (finalOutbox.bytes || finalOutbox.pending)
    throw Error('Finished capture retains unacknowledged payloads');
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
    events = records.filter((x) => x.event).map((x) => x.event);
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
    records.some((x) => x.media?.kind === 'screen' && x.media.bytes > 0),
  ]);
  browserEvidence.assert('ok', [
    records.some((x) => x.media?.kind === 'voice' && x.media.bytes > 0),
  ]);
  const anchor = events.find((x) => x.kind === 'feedback-anchor');
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
        build: events[0].context.build,
        events: events.length,
        media: records.filter((x) => x.media).map((x) => x.media),
        errors,
        screenSource: 'Chromium automated current-tab capture; fake microphone device',
      },
      null,
      2,
    ),
  );
  if (process.env.PLAYTEST_VERIFY_RESULT)
    writeFileSync(
      process.env.PLAYTEST_VERIFY_RESULT,
      JSON.stringify({
        directory: dir,
        mediaFiles: records
          .filter((row) => row.media?.kind === 'screen')
          .map((row) => join(dir, row.media.file)),
        eventSamples: events,
        exportMs,
        outboxSamples,
        finalOutbox,
        storageBytes: records.reduce(
          (n, row) => n + (row.media?.bytes || row.rawEvent?.bytes || 0),
          0,
        ),
        captureSeconds,
      }),
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
