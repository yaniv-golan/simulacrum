import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const out = browserArtifactPath('artifacts/property-focus', process.argv[3]);
mkdirSync(out, { recursive: true });
const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
  errors = browserEvidence.errors;

page.setDefaultTimeout(6000);
const active = () =>
  page.evaluate(() => ({
    tag: document.activeElement.tagName,
    label: document.activeElement.getAttribute('aria-label'),
    text: document.activeElement.textContent,
  }));
const parameter = (key) =>
  page.evaluate(
    (key) =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((part) => part.type === 'poweredMotor').parameters[
        key
      ],
    key,
  );
let build;
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  build = await page.locator('meta[name=build-id]').getAttribute('content');
  await page.locator('[data-part-type=poweredMotor]').click();
  const duty = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
  await duty.fill('.3');
  await duty.press('Escape');
  browserEvidence.assert('equal', [
    await parameter('defaultDuty'),
    1,
    'Escape discards the numeric draft',
  ]);
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item').first().click();
  await duty.focus();
  await duty.press('Shift+Tab');
  const nativePrevious = await active();
  browserEvidence.assert('notEqual', [
    nativePrevious.tag,
    'BODY',
    'the field has a native predecessor',
  ]);
  await duty.fill('.5');
  await duty.press('Tab');
  await page.waitForFunction(
    () =>
      window.workshopProbe.observe().frames[0].metadata.blueprint.parts[0].parameters
        .defaultDuty === 0.5,
  );
  browserEvidence.assert('equal', [
    (await active()).label,
    'Drive strength',
    'editing Drive setting then Tab must focus its adjacent slider, not body',
  ]);
  await page.keyboard.press('Tab');
  browserEvidence.assert('equal', [
    (await active()).text,
    'Reverse',
    'the following Tab continues to Reverse',
  ]);
  await duty.fill('.25');
  await duty.press('Shift+Tab');
  browserEvidence.assert('equal', [await parameter('defaultDuty'), 0.25]);
  browserEvidence.assert('deepEqual', [
    await active(),
    nativePrevious,
    'Shift+Tab after editing preserves the native predecessor',
  ]);
  await duty.focus();
  await duty.press('Tab');
  browserEvidence.assert('equal', [
    (await active()).label,
    'Drive strength',
    'unchanged Tab keeps native order',
  ]);
  await page.locator('.part-settings > summary').click();
  const torque = page.getByRole('spinbutton', { name: 'torqueConstant', exact: true }),
    resistance = page.getByRole('spinbutton', { name: 'resistance', exact: true });
  await torque.fill('.2');
  await torque.press('Tab');
  browserEvidence.assert('equal', [await parameter('torqueConstant'), 0.2]);
  browserEvidence.assert('equal', [
    (await active()).label,
    'resistance',
    'engineering numeric edit continues to the next field',
  ]);
  await resistance.fill('2');
  await resistance.press('Shift+Tab');
  browserEvidence.assert('equal', [await parameter('resistance'), 2]);
  browserEvidence.assert('equal', [
    (await active()).label,
    'torqueConstant',
    'engineering reverse Tab preserves previous field',
  ]);
  await torque.fill('.3');
  await torque.press('Shift+Tab');
  browserEvidence.assert('equal', [
    (await active()).text,
    'Engineering details',
    'reverse Tab can restore a summary without an aria-label',
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.part-settings').evaluate((element) => element.open),
    true,
    'editing preserves open engineering section',
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  await page.screenshot({ path: `${out}/focus.png` });
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build,
        errors,
        checks: [
          'edited primary Tab to slider then preset',
          'edited primary Shift+Tab preserves native predecessor',
          'unchanged native Tab',
          'engineering next and previous fields',
          'engineering summary focus and open state',
        ],
      },
      null,
      2,
    ),
  );
  console.log('property focus browser passed');
} catch (error) {
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: `${out}/failed.png` });
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify({ build, errors, message: error.message, active: await active() }, null, 2),
  );
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
