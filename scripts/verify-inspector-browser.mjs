import { placeCatalogPart, browseAllParts } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
  errors = browserEvidence.errors;

const out = browserArtifactPath('artifacts/inspector-browser', process.argv[3]);
mkdirSync(out, { recursive: true });
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
const selectPart = async (name) => {
  if (
    (await page.locator('.machine-picker').count()) &&
    !(await page.locator('.machine-picker').evaluate((el) => el.open))
  )
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click();
};
const withinInspector = async (locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect(),
        panel = element.closest('.inspector-panel').getBoundingClientRect();
      return {
        text: element.textContent,
        visible:
          !!element.getClientRects().length &&
          box.top >= panel.top &&
          box.bottom <= panel.bottom &&
          box.left >= panel.left &&
          box.right <= panel.right,
      };
    }),
  );
let build;
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  page.setDefaultTimeout(6000);
  await page.waitForFunction(() => window.workshopProbe);
  build = await page.locator('meta[name=build-id]').getAttribute('content');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) {
    await page.locator('[data-command=guide-step]').click();
    if (i === 7) {
      await page.screenshot({ path: `${out}/guide-step-eight.png` });
      const label = await page.locator('.selection-label').boundingBox(),
        toolbar = await page.locator('.edit-toolbar').boundingBox();
      browserEvidence.assert('ok', [
        label && toolbar,
        'guided selection exposes its label and toolbar',
      ]);
      browserEvidence.assert('ok', [
        label.x + label.width <= toolbar.x ||
          toolbar.x + toolbar.width <= label.x ||
          label.y + label.height <= toolbar.y ||
          toolbar.y + toolbar.height <= label.y,
        `selection label overlaps toolbar: ${JSON.stringify({ label, toolbar })}`,
      ]);
    }
  }
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  await selectPart('Motor');
  browserEvidence.assert('equal', [
    await page.locator('.selected-part-header .part-summary').textContent(),
    'Powered Motor · Shaft to Drive wheel · 3 wired',
    'the header says what the part is and what it turns before any section is opened',
  ]);
  const duty = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
  browserEvidence.assert('equal', [
    await duty.isVisible(),
    true,
    'motor power must be a visible primary control without opening engineering details',
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.part-settings').evaluate((el) => el.open),
    false,
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.part-settings > summary').textContent(),
    'Engineering details',
  ]);
  const compact = await withinInspector(
    page.locator('.port-button,.part-settings > summary,[aria-label="Drive setting"]'),
  );
  browserEvidence.assert('equal', [await page.locator('.port-button').count(), 3]);
  browserEvidence.assert('equal', [
    await page.locator('.port-button[data-port-id=mount]').count(),
    0,
  ]);
  browserEvidence.assert('match', [
    await page.locator('.mount-relationship').innerText(),
    /Bolted to Chassis/,
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('button', { name: 'Adjust mount', exact: true }).isVisible(),
    true,
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('button', { name: 'Detach', exact: true }).isVisible(),
    true,
  ]);
  browserEvidence.assert('ok', [
    compact.every((row) => row.visible),
    `primary control, three ports and Engineering details must fit at 1280×720: ${JSON.stringify(compact)}`,
  ]);
  await page.screenshot({ path: `${out}/motor-primary.png` });
  const strength = page.getByRole('slider', { name: 'Drive strength', exact: true });
  browserEvidence.assert('equal', [await strength.isVisible(), true]);
  await strength.press('Home');
  await strength.press('ArrowRight');
  browserEvidence.assert('equal', [
    (await read()).parts.find((p) => p.name === 'Motor').parameters.defaultDuty,
    -0.95,
  ]);
  await page
    .locator('.drive-directions')
    .getByRole('button', { name: 'Reverse', exact: true })
    .click();
  browserEvidence.assert('equal', [
    (await read()).parts.find((p) => p.name === 'Motor').parameters.defaultDuty,
    -1,
  ]);
  await page
    .locator('.drive-directions')
    .getByRole('button', { name: 'Forward', exact: true })
    .click();
  browserEvidence.assert('equal', [
    (await read()).parts.find((p) => p.name === 'Motor').parameters.defaultDuty,
    1,
  ]);
  const before = await read();
  await page.locator('.port-button[data-port-id=power]').click();
  browserEvidence.assert('equal', [
    await page.locator('.port-list > .port-button[data-port-id=power] + .port-explanation').count(),
    1,
    'port actions belong immediately after their port',
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.port-explanation [data-disconnect-id]').count(),
    1,
  ]);
  browserEvidence.assert('equal', [
    await page
      .locator('.port-explanation')
      .evaluate(
        (el) =>
          !!(
            el.compareDocumentPosition(document.querySelector('.placement-settings')) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    true,
    'port actions precede position editing',
  ]);
  browserEvidence.assert('deepEqual', [
    await read(),
    before,
    'opening an occupied power port only inspects',
  ]);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  browserEvidence.assert('equal', [await page.locator('.port-explanation').count(), 0]);
  browserEvidence.assert('ok', [
    (await page.locator('[data-live-part]').textContent()).trim().length > 0,
    'cancel preserves populated live status',
  ]);
  browserEvidence.assert('deepEqual', [await read(), before]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => window.workshopProbe.observe().cursor.tick >= 10);
  await page.locator('[data-command=pause]').click();
  const paused = await read();
  for (const port of await page.locator('.port-button').all()) {
    browserEvidence.assert('equal', [
      await port.isEnabled(),
      true,
      'paused ports remain inspectable',
    ]);
  }
  await page.locator('.port-button[data-port-id=power]').click();
  browserEvidence.assert('equal', [
    await page.locator('.port-explanation [data-disconnect-id]').isEnabled(),
    false,
  ]);
  browserEvidence.assert('equal', [await page.locator('.target-button').count(), 0]);
  browserEvidence.assert('deepEqual', [
    await read(),
    paused,
    'paused inspection cannot mutate blueprint',
  ]);
  await page.screenshot({ path: `${out}/paused-port.png` });
  await page
    .locator('.port-explanation')
    .getByRole('button', { name: 'Return to Build', exact: true })
    .click();
  browserEvidence.assert('equal', [await duty.isEnabled(), true]);
  await selectPart('Drive wheel');
  browserEvidence.assert('equal', [
    await page.locator('.port-button').first().getAttribute('data-port-id'),
    'axle',
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.port-button[data-port-id=mount]').count(),
    0,
    'wheel mounting is a surface action, never an optional fixed socket',
  ]);
  await page.locator('.port-button[data-port-id=axle]').click();
  browserEvidence.assert('match', [
    await page.locator('.port-explanation').textContent(),
    /holds the wheel too; no separate fixed mount/,
  ]);
  await page.screenshot({ path: `${out}/wheel-axle.png` });
  await browseAllParts(page);
  await placeCatalogPart(page, 'commandReceiver');
  const receiver = (await read()).parts.find((part) => part.type === 'commandReceiver');
  browserEvidence.assert('ok', [receiver]);
  await selectPart('Motor');
  await page.locator('.port-button[data-port-id=signal]').click();
  await page.locator(`.target-button[data-target-part-id="${receiver.id}"]`).click();
  const connected = await read(),
    motor = connected.parts.find((part) => part.name === 'Motor');
  browserEvidence.assert('ok', [
    connected.connections.some(
      (connection) =>
        connection.kind === 'signal' &&
        connection.a.part === receiver.id &&
        connection.a.port === 'signal' &&
        connection.b.part === motor.id &&
        connection.b.port === 'signal',
    ),
    'selecting a signal source actually connects output to motor input',
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('spinbutton', { name: 'Drive setting', exact: true }).isVisible(),
    false,
    'connected signal replaces primary default drive',
  ]);
  browserEvidence.assert('match', [
    await page.locator('.signal-ownership').textContent(),
    /Drive commanded by/,
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.signal-ownership .part-link').textContent(),
    receiver.name,
  ]);
  await page.screenshot({ path: `${out}/signal-owner.png` });
  await page.locator('.signal-ownership .part-link').click();
  browserEvidence.assert('equal', [
    await page.locator('.selected-part-header h2').textContent(),
    receiver.name,
    'ownership link selects actual signal source',
  ]);
  browserEvidence.assert('deepEqual', [
    await page.locator('.port-button.signal .port-title').allTextContents(),
    ['Control input', 'Control output'],
  ]);
  browserEvidence.assert('equal', [
    await page.locator('.drive-buttons button.primary').count(),
    0,
    'receiver action must not imply an active drive command',
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build,
        errors,
        checks: [
          'primary motor power and all ports fit without scrolling at 1280x720',
          'port actions inline before placement',
          'paused ports inspect without mutation and return to Build',
          'cancel retains populated live status',
          'wheel axle first without duplicate fixed socket',
          'actual signal source replaces default drive and can be inspected',
        ],
      },
      null,
      2,
    ),
  );
  console.log('inspector browser passed');
} catch (error) {
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify({ build, errors, message: error.message }, null, 2),
  );
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
