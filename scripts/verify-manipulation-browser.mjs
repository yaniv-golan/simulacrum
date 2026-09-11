import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

const out = browserArtifactPath('artifacts/manipulation-ux');
mkdirSync(out, { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  browserEvidence.assert('match', [
    await page.locator('.move-scope').textContent(),
    /Moves 8 parts together/,
  ]);
  const read = () =>
    page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
  const before = await read();
  await page.locator('canvas').first().focus();
  await page.keyboard.press('ArrowRight');
  const moved = await read();
  const delta = moved.parts[0].position.map((v, i) => v - before.parts[0].position[i]);
  browserEvidence.assert('ok', [Math.hypot(...delta) > 0.02]);
  for (let i = 0; i < moved.parts.length; i++)
    for (let axis = 0; axis < 3; axis++)
      browserEvidence.assert('ok', [
        Math.abs(moved.parts[i].position[axis] - before.parts[i].position[axis] - delta[axis]) <
          1e-9,
      ]);
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('deepEqual', [await read(), before]);
  await page.locator('.port-button[data-port-id=power]').click();
  await page.getByRole('button', { name: 'Disconnect Power · Cell', exact: true }).click();
  browserEvidence.assert('match', [
    await page.locator('.status-message').textContent(),
    /Disconnected.*Undo/,
  ]);
  if (
    (await page.locator('.port-button[data-port-id=power]').getAttribute('aria-expanded')) !==
    'true'
  )
    await page.locator('.port-button[data-port-id=power]').click();
  const target = page.getByRole('button', {
    name: 'Wire Cell · power (parts stay put)',
    exact: true,
  });
  await target.focus();
  browserEvidence.assert('equal', [
    await target.evaluate((e) => e.classList.contains('previewing')),
    true,
  ]);
  await page.screenshot({ path: `${out}/wire-preview.png` });
  await target.click();
  browserEvidence.assert('deepEqual', [(await read()).parts, before.parts]);
  await page.getByRole('button', { name: 'Delete part', exact: true }).click();
  browserEvidence.assert('equal', [(await read()).parts.length, 7]);
  browserEvidence.assert('match', [
    await page.locator('.status-message').textContent(),
    /Deleted Motor.*Undo/,
  ]);
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('equal', [(await read()).parts.length, 8]);
  await page.keyboard.press('Escape');
  browserEvidence.assert('equal', [await page.locator('.move-scope').isVisible(), false]);
  browserEvidence.assert('match', [
    await page.locator('.selection-hint').textContent(),
    /Select a part/,
  ]);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  await page.screenshot({ path: `${out}/assembly-scope.png` });
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        checks: [
          'scope matches all eight physically moved parts',
          'undo restores poses',
          'disconnect and deletion recovery',
          'keyboard connection preview',
          'wiring does not move parts',
          'escape clears selection',
        ],
      },
      null,
      2,
    ),
  );
  console.log('manipulation browser checks passed');
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
