import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/workbench-content');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(6000);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  evidence.assert('equal', [
    await page.locator('.starter-guide').isVisible(),
    false,
    'the parts catalogue must not start with an unsolicited lesson/example panel',
  ]);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  evidence.assert('equal', [
    await page
      .locator('.examples-browser button')
      .filter({ hasText: 'Compare zero damping' })
      .count(),
    0,
    'zero damping is an inspector edit within the spring experiment, not a replacement preset',
  ]);
  await page.locator('.examples-header h2').click();
  evidence.assert('equal', [await page.locator('.examples-browser').isVisible(), true]);
  await page.mouse.click(10, 100);
  evidence.assert('equal', [await page.locator('.examples-browser').isVisible(), false]);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  evidence.assert('equal', [await page.locator('.starter-guide').isVisible(), false]);
  const before = await read();
  evidence.assert('equal', [await page.locator('.selection-actions').count(), 0]);
  await page.locator('canvas').focus();
  await page.keyboard.press('ArrowRight');
  const after = await read();
  const moved = after.metadata.blueprint.parts.filter(
    (p, i) =>
      JSON.stringify(p.position) !== JSON.stringify(before.metadata.blueprint.parts[i].position),
  );
  evidence.assert('ok', [moved.length > 1]);
  evidence.assert('equal', [
    await page.locator('.move-scope').innerText(),
    `Moves ${moved.length} parts together`,
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, before.metadata.blueprint]);
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  await page.locator('.move-scope').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate · E', exact: true }).click();
  evidence.assert('equal', [
    await page.locator('.move-scope').innerText(),
    `Rotates ${moved.length} parts together`,
  ]);
  await page.getByRole('button', { name: 'Mirror parts…', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: `${out}/build.png` });
  evidence.assert('equal', [await page.locator('.motion-values').isVisible(), false]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 5);
  await page.locator('[data-command=pause]').click();
  evidence.assert('equal', [await page.locator('.move-scope').isVisible(), false]);
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();
  evidence.assert('equal', [await page.locator('.motion-values').isVisible(), true]);
  await page.locator('[data-command=build]').click();
  evidence.assert('match', [await page.locator('.motion-values').innerText(), /Last run:/]);
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
  evidence.assert('match', [
    await page.locator('.example-message').innerText(),
    /Replace your current machine/,
  ]);
  await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
  await page.getByRole('button', { name: 'Close examples', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, before.metadata.blueprint]);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Close help', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, before.metadata.blueprint]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  evidence.assert('equal', [overflow, false]);
  await page.locator('.placement-settings > summary').click();
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).fill('110');
  await page.getByRole('spinbutton', { name: 'Position X', exact: true }).press('Tab');
  await page.locator('[data-command=run]').click();
  await page.locator('.motion-readout strong').waitFor({ state: 'visible' });
  evidence.assert('equal', [await page.locator('.motion-values').isVisible(), false]);
  evidence.assert('match', [
    await page.locator('.motion-readout strong').innerText(),
    /Return to Build/,
  ]);
  await page.screenshot({ path: `${out}/recovery.png` });
  await page.setViewportSize({ width: 980, height: 720 });
  const clipped = await page.locator('.workshop-header button').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const r = button.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth || r.top < 0;
      })
      .map((button) => button.textContent),
  );
  evidence.assert('deepEqual', [clipped, [], 'header actions remain reachable at smaller widths']);
  await page.screenshot({ path: `${out}/smaller.png` });
  await page.locator('[data-command=build]').click();
  const preserved = (await read()).metadata.blueprint;
  const learn = page.getByRole('button', { name: 'Learn & examples', exact: true });
  await learn.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Try driving example', exact: true }).click();
  // A download error cannot clear or replace the current machine.
  await page.evaluate(() => {
    window.savedCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw Error('download unavailable');
    };
  });
  await page.getByRole('button', { name: 'Download current machine', exact: true }).click();
  evidence.assert('match', [await page.locator('.example-message').innerText(), /could not start/]);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, preserved]);
  await page.evaluate(() => {
    URL.createObjectURL = window.savedCreateObjectURL;
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current machine', exact: true }).click();
  const download = await downloadEvent;
  evidence.assert('deepEqual', [
    JSON.parse(readFileSync(await download.path(), 'utf8')),
    preserved,
  ]);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, preserved]);
  await page.getByRole('button', { name: 'I saved the file — open example', exact: true }).click();
  evidence.assert('notDeepEqual', [(await read()).metadata.blueprint, preserved]);
  evidence.assert('equal', [await page.locator('.examples-browser').isVisible(), false]);
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();
  evidence.assert('doesNotMatch', [await page.locator('.motion-values').innerText(), /Last run:/]);
  await page.getByText('What is measured?', { exact: true }).click();
  evidence.assert('match', [
    await page.locator('.motion-values').innerText(),
    /including detached parts/,
  ]);
  // Both requested panels must remain separate and reachable in the workbench.
  for (const mode of ['build', 'run', 'pause']) {
    await page.locator(`[data-command=${mode}]`).click();
    for (const viewport of [
      { width: 900, height: 650 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      for (const expanded of [false, true]) {
        const controls = page.locator('.vehicle-controls');
        if ((await controls.getAttribute('open')) !== (expanded ? '' : null))
          await controls.locator('summary').click();
        const boxes = await page
          .locator('.vehicle-controls, .motion-readout')
          .evaluateAll((panels) =>
            panels.map((panel) => {
              const r = panel.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            }),
          );
        const [a, b] = boxes;
        evidence.assert('ok', [
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
          `Machine controls and Measurements must not overlap at ${viewport.width}, expanded=${expanded}`,
        ]);
        const stage = await page.locator('.viewport').boundingBox();
        evidence.assert('ok', [
          boxes.every(
            (r) =>
              r.left >= stage.x &&
              r.right <= stage.x + stage.width &&
              r.top >= stage.y &&
              r.bottom <= stage.y + stage.height,
          ),
          'both panels stay inside the workbench',
        ]);
        if (expanded) {
          await controls.locator('button').last().scrollIntoViewIfNeeded();
          await controls.locator('button').last().focus();
          evidence.assert('equal', [
            await controls
              .locator('button')
              .last()
              .evaluate((el) => el === document.activeElement),
            true,
          ]);
        }
        await controls.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.screenshot({
          path: `${out}/panels-${mode}-${viewport.width}-${expanded ? 'expanded' : 'collapsed'}.png`,
        });
      }
    }
  }
  await page.locator('[data-command=build]').click();
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();
  // Requested content must remain stable while the simulation updates.
  await page.locator('[data-command=run]').click();
  await page.locator('canvas').focus();
  await page.keyboard.down('w');
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).power.sources.some((s) => s.duty !== 0),
  );
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).power.sources.every((s) => s.duty === 0),
  );
  await page.keyboard.press('Escape');
  evidence.assert('ok', [(await read()).power.sources.every((s) => s.duty === 0)]);
  await page.keyboard.up('w');

  await learn.click();
  const springLaunch = page.getByRole('button', { name: 'Try spring playground', exact: true });
  await springLaunch.focus();
  const tick = (await read()).tick;
  await page.waitForFunction((t) => JSON.parse(window.render_game_to_text()).tick > t + 10, tick);
  evidence.assert('equal', [
    await springLaunch.evaluate((el) => el === document.activeElement),
    true,
  ]);
  await page.keyboard.press('Escape');
  evidence.assert('equal', [await learn.evaluate((el) => el === document.activeElement), true]);
  await page.locator('[data-command=build]').click();
  const stable = (await read()).metadata.blueprint;
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();
  evidence.assert('match', [await page.locator('.motion-values').innerText(), /Last run:/]);
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await page.waitForFunction(() => document.querySelector('input[type=file]').value === '');
  evidence.assert('match', [await page.locator('.motion-values').innerText(), /Last run:/]);
  await page.locator('input[type=file]').setInputFiles({
    name: 'same-machine.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(stable)),
  });
  await page.getByText('Machine opened. Choose Run to try it.', { exact: true }).waitFor();
  evidence.assert('doesNotMatch', [await page.locator('.motion-values').innerText(), /Last run:/]);
  await page.getByRole('button', { name: 'Measurements', exact: true }).click();

  // A compact effective viewport exercises dialog reflow; this is not browser zoom.
  await page.setViewportSize({ width: 640, height: 360 });
  const helpLaunch = page.getByRole('button', { name: 'Help', exact: true });
  await helpLaunch.focus();
  await page.keyboard.press('Enter');
  const helpDialog = page.getByRole('dialog', { name: 'Help', exact: true });
  for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    evidence.assert('equal', [
      await helpDialog.evaluate(
        (el) => el.contains(document.activeElement) || document.activeElement === document.body,
      ),
      true,
    ]);
  }
  await page.getByText('Build information', { exact: true }).click();
  const buildValue = await page
    .getByRole('textbox', { name: 'Build information', exact: true })
    .inputValue();
  evidence.assert('equal', [buildValue, await page.locator('[data-build-id]').innerText()]);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy build info', exact: true }).click();
  evidence.assert('equal', [await page.evaluate(() => navigator.clipboard.readText()), buildValue]);
  evidence.assert('equal', [
    await helpDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  ]);
  await page.screenshot({ path: `${out}/help-small.png` });
  await page.keyboard.press('Escape');
  evidence.assert('equal', [
    await helpLaunch.evaluate((el) => el === document.activeElement),
    true,
  ]);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, stable]);
  await learn.click();
  // The final activity remains reachable without an extra feature-specific category.
  await page.getByRole('button', { name: 'Try spring playground', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
  await page.screenshot({ path: `${out}/examples-small.png` });
  await page.keyboard.press('Escape');
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, errors: evidence.errors }, null, 2),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
