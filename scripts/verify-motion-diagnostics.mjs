import { placeCatalogPart, openTools } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { appFingerprint } from './build-fingerprint.mjs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

const directory = browserArtifactPath('artifacts/motion-diagnostics');
mkdirSync(directory, { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  page.setDefaultTimeout(6000);
  const health = page.locator('.machine-health');
  browserEvidence.assert('equal', [await health.isVisible(), false], 'empty bench: no line');
  await placeCatalogPart(page, 'poweredMotor');
  await health.filter({ hasText: /^Not ready to run/ }).waitFor();
  browserEvidence.assert('equal', [
    await health.textContent(),
    'Not ready to run · power ✗ · axles ✗ · drive set ✓ · Check machine',
  ]);
  await openTools(page);
  await page.locator('[data-command=check-machine]').click();
  const dialog = page.getByRole('dialog', { name: 'Check machine' });
  browserEvidence.assert('deepEqual', [
    await dialog
      .locator('[data-diagnostic-code]')
      .evaluateAll((rows) => rows.map((r) => r.dataset.diagnosticCode)),
    ['MISSING_AXLE', 'MISSING_POWER'],
  ]);
  await page.screenshot({ path: `${directory}/missing-connections.png` });
  await dialog.locator('[data-diagnostic-code=MISSING_POWER]').getByRole('button').click();
  browserEvidence.assert('equal', [await dialog.isVisible(), false]);
  browserEvidence.assert('match', [
    await page.locator('.port-explanation').textContent(),
    /Carries electrical power/,
  ]);
  await page.keyboard.press('Escape');
  await openTools(page);
  await page.locator('[data-command=new]').click();
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await health.filter({ hasText: /^Ready to run/ }).waitFor();
  browserEvidence.assert('equal', [
    await health.textContent(),
    'Ready to run · power ✓ · axles ✓ · drive set ✓ · Check machine',
  ]);
  await health.click();
  browserEvidence.assert('equal', [await dialog.isVisible(), true], 'the line opens the check');
  browserEvidence.assert('equal', [await dialog.locator('[data-diagnostic-code]').count(), 0]);
  browserEvidence.assert('match', [await dialog.textContent(), /Run the machine to test/]);
  await dialog.getByRole('button', { name: 'Close machine check', exact: true }).click();
  await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  const drive = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
  await drive.fill('0');
  await drive.press('Tab');
  await health.filter({ hasText: /drive set ✗/ }).waitFor();
  browserEvidence.assert('match', [await health.textContent(), /^Ready to run · power ✓/]);
  await openTools(page);
  await page.locator('[data-command=check-machine]').click();
  browserEvidence.assert('equal', [
    await dialog.locator('[data-diagnostic-code=COMMAND_OFF]').count(),
    1,
  ]);
  await dialog.getByRole('button', { name: 'Inspect Motor', exact: true }).click();
  browserEvidence.assert('equal', [await drive.inputValue(), '0']);
  browserEvidence.assert('deepEqual', [errors, []]);
  const build = await page.locator('meta[name=build-id]').getAttribute('content');
  browserEvidence.assert('equal', [build, appFingerprint()]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${directory}/browser.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build,
        errors,
        checks: [
          'both missing connections explained',
          'Inspect opens actual power port',
          'ready guided build has no false blocker',
          'zero command points to editable motor',
        ],
      },
      null,
      2,
    ),
  );
  console.log('motion diagnostic browser passed');
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
