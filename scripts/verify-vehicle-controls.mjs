import { placeCatalogPart, browseAllParts, openTools } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';

const evidence = createBrowserEvidence();
const out = browserArtifactPath('artifacts/vehicle-controls', process.argv[3]);
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({
  profile: 'focus',
  ...{
    headless: false,
    ignoreDefaultArgs: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage(),
  errors = evidence.errors,
  samples = [];

const frame = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const blueprint = async () => (await frame()).metadata.blueprint;
const command = (name) => page.locator(`[data-command="${name}"]`).click();
async function select(id) {
  if (!(await page.locator('.machine-picker').evaluate((element) => element.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator(`.part-list [data-part-id="${id}"]`).click();
}
async function openControlSettings() {
  if (!(await page.locator('.receiver-controls').evaluate((element) => element.open))) {
    await page.locator('.receiver-controls > summary').click();
  }
}
async function sample(label) {
  samples.push({
    label,
    frame: await frame(),
    controls: await page.locator('.vehicle-controls').innerText(),
    focusEvents: await page.evaluate(() => window.__vehicleFocusEvents ?? []),
    focusState: await page.evaluate(() => ({
      hidden: document.hidden,
      focused: document.hasFocus(),
    })),
  });
  writeFileSync(
    `${out}/progress.json`,
    JSON.stringify({ ...evidence.identity, errors, samples }, null, 2),
  );
}
async function expectDuties(expected, label) {
  await page.waitForFunction(
    (expected) => {
      const frame = JSON.parse(window.render_game_to_text());
      return Object.entries(expected).every(([id, duty]) => {
        const index = frame.metadata.blueprint.parts.findIndex((part) => part.id === id);
        return frame.power.sources.find((source) => source.node === index)?.duty === duty;
      });
    },
    expected,
    { timeout: 6000 },
  );
  await sample(label);
}
let driveId, steerId;
try {
  await context.tracing.start({ screenshots: true, snapshots: true });
  // Playwright forces focus by default; ordinary browser lifecycle behavior is
  // required here so switching tabs can exercise the application's blur owner.
  await page.addInitScript(() => {
    window.__vehicleFocusEvents = [];
    const record = (event) =>
      window.__vehicleFocusEvents.push({
        type: event.type,
        hidden: document.hidden,
        focused: document.hasFocus(),
        at: performance.now(),
      });
    window.addEventListener('blur', record);
    window.addEventListener('focus', record);
    document.addEventListener('visibilitychange', record);
  });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  page.setDefaultTimeout(6000);
  await page.waitForFunction(() => window.render_game_to_text);
  const lifecycle = await context.newCDPSession(page);
  await lifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await browseAllParts(page);
  for (const [name, preset] of [
    ['Drive action', 'drive'],
    ['Steer action', 'steer'],
  ]) {
    await placeCatalogPart(page, 'commandReceiver');
    await page.getByRole('button', { name: 'Rename part', exact: true }).click();
    await page.getByRole('textbox', { name: 'Part name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await openControlSettings();
    await page.getByRole('combobox', { name: 'Control preset', exact: true }).selectOption(preset);
  }
  const configured = await blueprint();
  driveId = configured.parts.find((part) => part.name === 'Drive action').id;
  steerId = configured.parts.find((part) => part.name === 'Steer action').id;
  evidence.assert('equal', [
    configured.parts.find((part) => part.id === steerId).controlBinding.steer.gain,
    1,
  ]);
  await command('undo');
  evidence.assert('equal', [
    (await blueprint()).parts.find((part) => part.id === steerId).controlBinding,
    undefined,
  ]);
  await command('redo');
  evidence.assert('deepEqual', [await blueprint(), configured]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/bindings.json`);
  await command('new');
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await openTools(page);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await (await chooser).setFiles(`${out}/bindings.json`);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.length === 2,
  );
  evidence.assert('deepEqual', [
    await blueprint(),
    configured,
    'save/load retains complete bindings',
  ]);
  await select(driveId);
  await openControlSettings();
  await page.locator('.receiver-key-mixing > summary').click();
  await page.getByRole('spinbutton', { name: 'drive output strength', exact: true }).focus();
  await page.keyboard.press('w');
  evidence.assert('deepEqual', [
    await blueprint(),
    configured,
    'typing in a Build field must not transform parts or route controls',
  ]);
  await page.keyboard.press('Escape');
  await command('run');
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'run starts neutral');
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await expectDuties({ [driveId]: 1, [steerId]: 1 }, 'W+D drives both actions');
  await page.keyboard.up('w');
  await expectDuties({ [driveId]: 0, [steerId]: 1 }, 'releasing W preserves held steering');
  await select(driveId);
  await expectDuties({ [driveId]: 0, [steerId]: 1 }, 'selection does not redirect steering');
  await page.keyboard.up('d');
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'all keys released');
  await page.getByRole('checkbox', { name: 'Follow motion', exact: true }).focus();
  await page.keyboard.press('w');
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'focused form control suppresses driving');
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.keyboard.down('w');
  await expectDuties(
    { [driveId]: 1, [steerId]: 0 },
    'keyboard recovers after leaving form control',
  );
  await page.keyboard.up('w');
  await command('pause');
  await command('build');
  await select(driveId);
  await openControlSettings();
  await page.getByRole('combobox', { name: 'Key behavior', exact: true }).selectOption('toggle');
  await command('run');
  await page.keyboard.down('w');
  await expectDuties({ [driveId]: 1, [steerId]: 0 }, 'toggle first keydown');
  await page.keyboard.down('w');
  await expectDuties({ [driveId]: 1, [steerId]: 0 }, 'toggle repeat does not retrigger');
  await page.keyboard.up('w');
  await expectDuties({ [driveId]: 1, [steerId]: 0 }, 'toggle keyup retains duty');
  await page.keyboard.press('w');
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'toggle second press stops');
  await page.keyboard.press('w');
  await expectDuties({ [driveId]: 1, [steerId]: 0 }, 'toggle restart');
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus(), undefined, { polling: 50 });
  await sample('focused before tab switch');
  const blurCount = await page.evaluate(
    () => window.__vehicleFocusEvents.filter((event) => event.type === 'blur').length,
  );
  const other = await context.newPage();
  await (
    await context.newCDPSession(other)
  ).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await other.goto('about:blank');
  await other.bringToFront();
  await sample('immediately after tab switch');
  await page.waitForFunction(
    (count) => window.__vehicleFocusEvents.filter((event) => event.type === 'blur').length > count,
    blurCount,
    { polling: 50 },
  );
  await sample('real tab switch emitted blur');
  await page.bringToFront();
  await other.close();
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'real tab blur resets latched duty');
  await page.keyboard.press('w');
  await expectDuties({ [driveId]: 1, [steerId]: 0 }, 'toggle after focus recovery');
  await command('pause');
  await sample('paused after toggle');
  await command('run');
  await expectDuties({ [driveId]: 0, [steerId]: 0 }, 'pause and resume resets latched duty');
  await command('pause');
  evidence.assert('deepEqual', [errors, []]);
  await page.screenshot({ path: `${out}/completed.png` });
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        browser: browser.version(),
        errors,
        samples,
        scope:
          'Two ordinary unconnected receiver source duties; input routing, not vehicle steering qualification',
      },
      null,
      2,
    ),
  );
  console.log('vehicle control routing browser checks passed');
} catch (error) {
  await evidence.captureFailure(error);

  await sample('failure').catch(() => {});
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify(
      { ...evidence.identity, errors, samples, message: error.message, stack: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.tracing.stop({ path: `${out}/trace.zip` }).catch(() => {});
  await browser.close();
}
