import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const out = browserArtifactPath('artifacts/guide-feedback');
mkdirSync(out, { recursive: true });
const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

page.setDefaultTimeout(6000);
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 8; i++) await page.locator('[data-command=guide-step]').click();
  const read = () =>
    page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
  const messages = [];
  for (let i = 0; i < 8; i++) {
    const before = await read();
    await page.locator('[data-command=guide-step]').focus();
    browserEvidence.assert('match', [
      await page.locator('.guide-feedback').innerText(),
      /Next connection/,
    ]);
    browserEvidence.assert('deepEqual', [
      await read(),
      before,
      'preview cannot author a connection',
    ]);
    await page.locator('[data-command=guide-step]').click();
    await page.waitForTimeout(200);
    browserEvidence.assert('match', [
      await page.locator('.guide-feedback').innerText(),
      /✓ Connected/,
      'stationary pointer must not replace completion with the next preview',
    ]);
    await page.mouse.move(1000, 800);
    const after = await read();
    browserEvidence.assert('equal', [after.connections.length, before.connections.length + 1]);
    browserEvidence.assert('match', [
      await page.locator('.guide-feedback').innerText(),
      /✓ Connected/,
    ]);
    browserEvidence.assert('match', [await page.locator('.guide-receipt').innerText(), /✓/]);
    messages.push(await page.locator('.guide-feedback').innerText());
    if (i === 3) await page.screenshot({ path: `${out}/hidden-joint.png` });
  }
  browserEvidence.assert('ok', [messages.some((m) => m.includes('Bolted together'))]);
  browserEvidence.assert('ok', [messages.some((m) => m.includes('wheel can turn'))]);
  browserEvidence.assert('ok', [messages.some((m) => m.includes('Power wired'))]);
  await page.screenshot({ path: `${out}/completed.png` });
  const connected = await read();
  await page.keyboard.press('Escape');
  browserEvidence.assert('equal', [
    await page.locator('.guide-feedback').isVisible(),
    false,
    'clearing selection removes guide scene highlights',
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.guide-receipt').count(),
    1,
    'written completion remains',
  ]);
  browserEvidence.assert('deepEqual', [await read(), connected]);
  await page.screenshot({ path: `${out}/cleared.png` });
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('equal', [await page.locator('.guide-receipt').count(), 0]);
  browserEvidence.assert('equal', [await page.locator('.guide-feedback').isVisible(), false]);
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  browserEvidence.assert('equal', [await page.locator('.guide-feedback').isVisible(), false]);
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        messages,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('guide connection feedback passed');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
