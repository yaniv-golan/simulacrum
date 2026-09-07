import { createBrowserEvidence } from './browser-evidence.mjs';
import { chromium } from 'playwright';
import { createPlaytestServer } from './playtest-server.mjs';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const browserEvidence = createBrowserEvidence();

const data = mkdtempSync(join(tmpdir(), 'remote-playtest-')),
  token = 'browser-verification-token-'.repeat(3),
  server = createPlaytestServer({ publicDir: 'dist', dataDir: data, token });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--auto-accept-this-tab-capture',
    '--auto-select-tab-capture-source-by-title=Simulacrum',
    '--use-fake-device-for-media-stream',
    '--allow-http-screen-capture',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
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
  mkdirSync('artifacts/remote-playtest', { recursive: true });
  await page.screenshot({ path: 'artifacts/remote-playtest/recording-bar.png' });
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
  mkdirSync('artifacts/remote-playtest', { recursive: true });
  await page.screenshot({ path: 'artifacts/remote-playtest/feedback-receipt.png' });
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
    assert.ok(
      events.some((x) => x.kind === kind),
      kind,
    );
  assert.ok(records.some((x) => x.media?.kind === 'screen' && x.media.bytes > 0));
  assert.ok(records.some((x) => x.media?.kind === 'voice' && x.media.bytes > 0));
  const anchor = events.find((x) => x.kind === 'feedback-anchor');
  assert.ok(anchor.data.image.startsWith('data:image/jpeg'));
  assert.ok(anchor.data.context.ui.selected);
  assert.ok(events.find((x) => x.kind === 'feedback-text').data.anchorId === anchor.data.id);
  assert.deepEqual(errors, []);
  mkdirSync('artifacts/remote-playtest', { recursive: true });
  await page.screenshot({ path: 'artifacts/remote-playtest/completed.png' });
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/remote-playtest/result.json',
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: events[0].context.build,
        dir,
        events: events.length,
        media: records.filter((x) => x.media).map((x) => x.media),
        errors,
        screenSource: 'Chromium automated current-tab capture; fake microphone device',
      },
      null,
      2,
    ),
  );
  console.log('remote capture browser passed', dir);
} catch (error) {
  await page.screenshot({ path: 'artifacts/remote-playtest/failure.png' });
  writeFileSync('artifacts/remote-playtest/failure.txt', await page.locator('body').innerText());
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
