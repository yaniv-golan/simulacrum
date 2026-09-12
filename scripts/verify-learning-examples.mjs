import { verifyGearJourney } from './gear-browser-cases.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/learning-examples');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(6000);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.screenshot({ path: `${out}/examples.png` });
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  evidence.assert('match', [
    await page.locator('.active-guide').innerText(),
    /Set Drive setting to 0/,
  ]);
  // Follow the independent attempt through the ordinary inspector, not guide commands.
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=guide-motor]').click();
  const built = (await read()).metadata.blueprint;
  const driveSetting = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
  await driveSetting.fill('0');
  await driveSetting.press('Tab');
  const switchedOff = structuredClone(built);
  switchedOff.parts.find((p) => p.id === 'guide-motor').parameters.defaultDuty = 0;
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, switchedOff]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 5);
  await page.locator('[data-command=pause]').click();
  await page.screenshot({ path: `${out}/guide-independent-attempt.png` });
  await page.locator('[data-command=build]').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.getByRole('button', { name: 'Try spring playground', exact: true }).click();
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  const stiffness = page.getByRole('spinbutton', { name: 'Stiffness · Soft / Firm', exact: true });
  await stiffness.fill('250');
  await stiffness.press('Tab');
  const tunedSpring = (await read()).metadata.blueprint;
  // The comparison instruction itself must not mutate or reload the example.
  await page.getByText('Compare damping', { exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, tunedSpring]);
  await page.screenshot({ path: `${out}/spring-comparison.png` });
  const damping = page.getByRole('spinbutton', {
    name: 'Damping · More bounce / Less bounce',
    exact: true,
  });
  await damping.fill('0');
  await damping.press('Tab');
  const zeroDamping = structuredClone(tunedSpring);
  zeroDamping.parts.find((p) => p.id === 'guide').parameters.damping = 0;
  evidence.assert('deepEqual', [
    (await read()).metadata.blueprint,
    zeroDamping,
    'comparison preserves stiffness and every other authored choice',
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.locator('[data-command=pause]').click();
  evidence.assert('ok', [(await read()).springs.length > 0]);
  await page.screenshot({ path: `${out}/spring-zero-damping.png` });
  await page.locator('[data-command=build]').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, tunedSpring]);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.getByRole('button', { name: 'Try spring playground', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, tunedSpring]);
  await page.screenshot({ path: `${out}/examples.png` });
  await page.keyboard.press('Escape');
  await verifyGearJourney({ page, evidence, out: `${out}/gears` });
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
