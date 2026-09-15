import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { openTools } from './catalog-browser-actions.mjs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
  errors = browserEvidence.errors;

mkdirSync(browserArtifactPath('artifacts/selection-ux'), { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 4; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  const motorId = await page.evaluate(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.name === 'Motor').id,
  );
  await browserEvidence.clickPart(page, motorId);
  browserEvidence.assert('equal', [
    await page.locator('.part-list-item.selected').textContent(),
    'Motor',
    'visible motor casing must pick motor, not wheel decoration',
  ]);
  await page.mouse.click(866, 551);
  browserEvidence.assert('equal', [
    await page.locator('.part-list-item.selected').count(),
    0,
    'empty floor clears selection',
  ]);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  await page.locator('.part-settings > summary').click();
  await page.getByRole('spinbutton', { name: 'Drive setting', exact: true }).fill('0.5');
  await page.getByRole('spinbutton', { name: 'Drive setting', exact: true }).press('Tab');
  await page.waitForFunction(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.name === 'Motor').parameters
        .defaultDuty === 0.5,
  );
  browserEvidence.assert('equal', [await page.locator('.part-settings').getAttribute('open'), '']);
  await page.getByRole('combobox', { name: 'Material', exact: true }).selectOption('aluminium');
  await page.waitForFunction(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.name === 'Motor').authoredMaterial
        .body === 'aluminium',
  );
  browserEvidence.assert('equal', [await page.locator('.part-settings').getAttribute('open'), '']);
  browserEvidence.assert('equal', [
    await page.getByRole('spinbutton', { name: 'Drive setting', exact: true }).inputValue(),
    '0.5',
  ]);
  await openTools(page);
  await page.locator('[data-command=new]').click();
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  await page.locator('.port-button[data-port-id=power]').click();
  await page.getByRole('button', { name: 'Disconnect Power · Cell', exact: true }).click();
  if (
    (await page.locator('.port-button[data-port-id=power]').getAttribute('aria-expanded')) !==
    'true'
  )
    await page.locator('.port-button[data-port-id=power]').click();
  await page
    .getByRole('button', { name: 'Wire Cell · power (parts stay put)', exact: true })
    .click();
  browserEvidence.assert('equal', [
    await page.locator('.guide-progress').textContent(),
    '16 / 16 steps',
  ]);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.screenshot({ path: browserArtifactPath('artifacts/selection-ux/repaired.png') });
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    browserArtifactPath('artifacts/selection-ux/result.json'),
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        checks: [
          'motor picking',
          'empty-space deselection',
          'settings stay open',
          'property persists after material edit',
          'manual reversed wiring satisfies guide',
        ],
      },
      null,
      2,
    ),
  );
  console.log('selection and manual wiring browser regressions passed');
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
