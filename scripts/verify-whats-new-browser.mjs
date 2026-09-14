import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { RELEASE_NOTES } from '../src/application/release-notes.mjs';
import { STORAGE_KEY } from '../src/presentation/whats-new.mjs';
const out = browserArtifactPath('artifacts/whats-new');
mkdirSync(out, { recursive: true });
const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const evidence = createBrowserEvidence();
const browser = await evidence.launch({ profile: 'ui' });
const newest = RELEASE_NOTES[0].id,
  twoBack = RELEASE_NOTES[2].id;
const results = {};
const state = (page) => page.evaluate(() => window.workshopProbe.readInteractionState().whatsNew);
const stored = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORAGE_KEY);
const seedCursor = (page, seenId) =>
  page.evaluate(
    ([key, id]) => localStorage.setItem(key, JSON.stringify({ seenId: id })),
    [STORAGE_KEY, seenId],
  );
const notice = (page) => page.locator('section.whats-new-notice');
const helpButton = (page) => page.getByRole('button', { name: 'Help', exact: true });
async function scenario(name, run, { init } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await evidence.goto(page, url);
    await page.waitForFunction(() => window.workshopProbe);
    results[name] = await run(page, context);
    results[name].final = await state(page);
  } finally {
    await context.close();
  }
}
try {
  await scenario('first-visit', async (page) => {
    const s = await state(page);
    assert.equal(s.firstVisit, true);
    assert.equal(s.badge, false);
    assert.equal(s.noticeOpen, false);
    assert.equal((await stored(page)).seenId, newest, 'first visit records the newest id');
    assert.equal(await helpButton(page).count(), 1, 'Help keeps its name');
    await helpButton(page).click();
    const status = page.locator('.whats-new-status');
    assert.equal(await status.innerText(), 'Nothing new since your last visit.');
    assert.equal(await page.locator('.whats-new-seen li').count(), RELEASE_NOTES.length);
    await page.screenshot({ path: `${out}/first-visit-help.png` });
    await page.keyboard.press('Escape');
    return { stored: await stored(page) };
  });

  await scenario('returning-keys-alive', async (page) => {
    await seedCursor(page, twoBack);
    await evidence.reload(page);
    await page.waitForFunction(() => window.workshopProbe);
    await notice(page).waitFor({ state: 'visible' });
    assert.equal(await page.locator('dialog[open]').count(), 0, 'the notice is not a dialog');
    assert.deepEqual(
      await notice(page).locator('h4').allInnerTexts(),
      [RELEASE_NOTES[0].name, RELEASE_NOTES[1].name],
    );
    const s = await state(page);
    assert.equal(s.badge, true);
    assert.equal(s.noticeOpen, true);
    assert.equal((await stored(page)).seenId, newest, 'shown means seen');
    assert.equal(await helpButton(page).count(), 1, 'badge does not rename Help');
    assert.ok(await helpButton(page).getAttribute('aria-describedby'));
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains('whats-new-notice')),
      true,
      'the notice takes focus',
    );
    await page.screenshot({ path: `${out}/returning-notice.png` });
    // Workshop keys stay alive while the notice is open: with focus outside it, E picks
    // the rotate tool and the notice is still there; then ? opens Help, which marks seen.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('e');
    await page.waitForFunction(
      () => window.workshopProbe.readInteractionState().tool === 'rotate',
    );
    assert.equal((await state(page)).noticeOpen, true, 'a tool key leaves the notice open');
    await page.keyboard.press('v');
    await page.keyboard.press('?');
    await page.locator('dialog[open][aria-label="Help"]').waitFor();
    await notice(page).waitFor({ state: 'hidden' });
    assert.equal((await state(page)).badge, false, 'opening Help marks the notes seen');
    assert.equal(
      await page.locator('.whats-new-status').innerText(),
      'Nothing new since your last visit.',
    );
    await page.keyboard.press('Escape');
    return {};
  });

  await scenario('escape-returns-focus', async (page) => {
    await seedCursor(page, twoBack);
    await evidence.reload(page);
    await page.waitForFunction(() => window.workshopProbe);
    await notice(page).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await notice(page).waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      'Help',
      'focus returns to the Help button',
    );
    assert.equal((await state(page)).badge, false);
    assert.equal(await helpButton(page).getAttribute('aria-describedby'), null);
    return {};
  });

  await scenario('click-outside-dismisses', async (page) => {
    await seedCursor(page, twoBack);
    await evidence.reload(page);
    await page.waitForFunction(() => window.workshopProbe);
    await notice(page).waitFor({ state: 'visible' });
    const canvas = await page.locator('[aria-label="Machine view"]').boundingBox();
    const cameraBefore = await page.evaluate(
      () => window.workshopProbe.readInteractionState().camera.position,
    );
    // The dismissing pointerdown is not swallowed: the same drag still orbits.
    await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5, {
      steps: 8,
    });
    await page.mouse.up();
    await notice(page).waitFor({ state: 'hidden' });
    assert.equal((await state(page)).badge, false);
    await page.waitForFunction(
      (before) =>
        window.workshopProbe
          .readInteractionState()
          .camera.position.some((c, i) => Math.abs(c - before[i]) > 1e-6),
      cameraBefore,
    );
    return {};
  });

  await scenario('try-it', async (page) => {
    const missing = await page.evaluate(
      (examples) =>
        examples.filter((command) => !document.querySelector(`[data-command="${command}"]`)),
      RELEASE_NOTES.map((note) => note.example).filter(Boolean),
    );
    assert.deepEqual(missing, [], 'every note example names an existing Learn & examples card');
    const seenBefore = async () => {
      await helpButton(page).click();
      if (!(await page.locator('.whats-new-seen').evaluate((e) => e.open)))
        await page.locator('.whats-new-seen summary').click();
    };
    await seenBefore();
    const entry = page.locator('.whats-new li', { hasText: 'Machines make sound' });
    await entry.getByRole('button', { name: 'Try it', exact: true }).click();
    await page.waitForFunction(
      () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length > 0,
    );
    assert.equal(
      (await page.evaluate(() => window.workshopProbe.readLastCommandResult())).input.type,
      'spring-launcher-example',
    );
    assert.equal(await page.locator('dialog[open]').count(), 0, 'example opened, dialogs closed');
    const before = await page.evaluate(
      () => window.workshopProbe.observe().frames[0].metadata.blueprint,
    );
    await seenBefore();
    await entry.getByRole('button', { name: 'Try it', exact: true }).click();
    await page.locator('dialog[open][aria-label="Learn & examples"]').waitFor();
    assert.equal(await page.locator('.example-replacement').isVisible(), true);
    assert.deepEqual(
      await page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint),
      before,
      'the machine is unchanged until the replacement is confirmed',
    );
    await page.screenshot({ path: `${out}/try-it-replacement.png` });
    await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
    await page.keyboard.press('Escape');
    return {};
  });

  await scenario(
    'gated-mount-yields-to-dialog',
    async (page) => {
      await seedCursor(page, twoBack);
      await page.evaluate(() => sessionStorage.setItem('whats-new-gate', '1'));
      await evidence.reload(page);
      await page.waitForFunction(() => window.workshopProbe);
      await page.locator('dialog[open]#whats-new-gate').waitFor();
      let s = await state(page);
      assert.equal(s.badge, true, 'badge only while a dialog is open');
      assert.equal(s.noticeOpen, false);
      await page.evaluate(() => {
        sessionStorage.removeItem('whats-new-gate');
        document.querySelector('#whats-new-gate').close();
      });
      await notice(page).waitFor({ state: 'visible' });
      s = await state(page);
      assert.equal(s.noticeOpen, true, 'the notice opens once the dialog closes');
      return {};
    },
    {
      init: () => {
        const gate = () => {
          if (sessionStorage.getItem('whats-new-gate') !== '1') return;
          const dialog = document.createElement('dialog');
          dialog.id = 'whats-new-gate';
          dialog.setAttribute('open', '');
          document.documentElement.append(dialog);
        };
        if (document.readyState !== 'loading') gate();
        else document.addEventListener('DOMContentLoaded', gate);
      },
    },
  );

  await scenario(
    'blocked-storage',
    async (page) => {
      const s = await state(page);
      assert.equal(s.mode, 'unavailable');
      assert.equal(s.badge, false);
      assert.equal(s.noticeOpen, false);
      await helpButton(page).click();
      assert.equal(
        await page.locator('.whats-new-status').innerText(),
        'This browser is not saving which changes you have seen.',
      );
      assert.equal(
        await page.locator('.whats-new > .whats-new-list li').count(),
        RELEASE_NOTES.length,
      );
      assert.equal(await page.locator('.whats-new-seen').isVisible(), false);
      await page.screenshot({ path: `${out}/blocked-storage-help.png` });
      await page.keyboard.press('Escape');
      return {};
    },
    {
      init: () => {
        const blocked = () => {
          throw new Error('storage blocked');
        };
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked },
        });
      },
    },
  );

  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, newest, twoBack, results }, null, 2),
  );
  evidence.assertUnchanged();
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
