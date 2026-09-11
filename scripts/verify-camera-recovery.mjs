import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

const out = browserArtifactPath('artifacts/camera-recovery');
mkdirSync(out, { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  await page.keyboard.press('Escape');
  const state = () => page.evaluate(() => window.workshopProbe.readInteractionState());
  const canvas = await page.locator('canvas').boundingBox();
  const x = canvas.x + canvas.width * 0.85,
    y = canvas.y + canvas.height * 0.6;
  for (let attempt = 0; attempt < 6 && (await state()).camera.position[1] >= 0; attempt++) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(x, y - 100, { steps: 12 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(300);
  }
  const below = await state();
  browserEvidence.assert('ok', [
    below.camera.position[1] < 0,
    'ordinary orbit must reach underside',
  ]);
  await page.screenshot({ path: `${out}/underside.png` });
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click();
  await page.waitForTimeout(800);
  const inspected = await state();
  browserEvidence.assert('ok', [
    inspected.camera.position[1] < inspected.camera.target[1],
    'exploding preserves underside heading',
  ]);
  await page.screenshot({ path: `${out}/exploded-underside.png` });
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.waitForTimeout(400);
  const recovered = await state();
  browserEvidence.assert('ok', [
    recovered.camera.position[1] > recovered.camera.target[1],
    'Frame must recover above-floor angle',
  ]);
  await page.screenshot({ path: `${out}/recovered.png` });
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        below: below.camera,
        recovered: recovered.camera,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('camera recovery browser checks passed');
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
