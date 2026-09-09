import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const evidence = createBrowserEvidence(),
  out = 'artifacts/workbench-content';
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
  evidence.assert('match', [await page.locator('.example-message').innerText(), /Save.*New/]);
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
