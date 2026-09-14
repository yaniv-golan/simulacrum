import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence(),
  out = 'artifacts/learning-controller';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(10000);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.getByRole('button', { name: 'Try learning delivery', exact: true }).click();
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=learner]').click();
  await page.getByRole('button', { name: 'Teach a controller', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Teach a controller' });
  await panel.getByRole('button', { name: 'Teach / record correction', exact: true }).click();
  await panel.getByRole('button', { name: 'Close controller teaching', exact: true }).click();
  await page.locator('canvas').click({ position: { x: 150, y: 120 } });
  await page.keyboard.down('w');
  const start = (await read()).tick;
  await page.waitForFunction((t) => JSON.parse(window.render_game_to_text()).tick > t + 120, start);
  await page.keyboard.up('w');
  await page.waitForFunction((t) => JSON.parse(window.render_game_to_text()).tick > t + 180, start);
  await page
    .locator('.learning-live')
    .getByRole('button', { name: 'Stop teaching', exact: true })
    .click();
  await page.locator('[data-command=build]').click();
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=learner]').click();
  await page.getByRole('button', { name: 'Teach a controller', exact: true }).click();
  await panel.getByRole('button', { name: 'Train candidate', exact: true }).click();
  await panel.getByRole('button', { name: 'Install candidate', exact: true }).click();
  await page.waitForFunction(
    () =>
      !!JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'learner',
      )?.learningModel,
  );
  const model = (await read()).metadata.blueprint.parts.find(
    (p) => p.id === 'learner',
  ).learningModel;
  evidence.assert('ok', [!!model]);
  await panel.getByRole('button', { name: 'Try it', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 30);
  const running = await read();
  evidence.assert('ok', [running.receiverControl.receivers.some((r) => r.mode === 'learned')]);
  await panel.getByRole('button', { name: 'Take over', exact: true }).click();
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).receiverControl.receivers.every(
      (r) => r.mode === 'manual',
    ),
  );
  await page.locator('[data-command=pause]').click();
  await panel.getByRole('button', { name: 'Inspect & compare', exact: true }).click();
  const before = JSON.stringify((await read()).metadata.blueprint);
  await panel.getByRole('slider').first().fill('0');
  evidence.assert('equal', [JSON.stringify((await read()).metadata.blueprint), before]);
  await panel.getByRole('button', { name: 'Restart and teach a correction', exact: true }).click();
  await page.waitForFunction(() => {
    const f = JSON.parse(window.render_game_to_text());
    return f.metadata.mode === 'run' && f.tick > 18;
  });
  evidence.assert('ok', [
    (await page.locator('.learning-live').innerText()).includes('Correction cue'),
  ]);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const workspaceBox = await panel.boundingBox(),
      liveBox = await page.locator('.learning-live').boundingBox();
    evidence.assert('ok', [workspaceBox.y + workspaceBox.height <= liveBox.y]);
  }
  await panel.getByRole('button', { name: 'Teach & try', exact: true }).click();
  await panel.getByRole('button', { name: 'Take over', exact: true }).click();
  await panel.getByRole('button', { name: 'Teach / record correction', exact: true }).click();
  const correctionStart = (await read()).tick;
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick > t + 24,
    correctionStart,
  );
  await page
    .locator('.learning-live')
    .getByRole('button', { name: 'Stop teaching', exact: true })
    .click();
  await page.locator('[data-command=build]').click();
  await panel.getByRole('button', { name: 'Train candidate', exact: true }).click();
  await panel.getByRole('button', { name: 'Install candidate', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Candidate installed' }).waitFor();
  const installed = JSON.stringify((await read()).metadata.blueprint);
  await panel.getByRole('button', { name: 'Train candidate', exact: true }).click();
  await page
    .locator('.learning-live')
    .getByRole('button', { name: 'Cancel training', exact: true })
    .click();
  await panel.getByRole('status').filter({ hasText: 'Training cancelled' }).waitFor();
  evidence.assert('equal', [JSON.stringify((await read()).metadata.blueprint), installed]);
  await panel.getByText('Probe the working model (no movement)', { exact: true }).click();
  await panel.getByRole('spinbutton', { name: 'Probe closingSpeed', exact: true }).fill('1.5');
  evidence.assert('equal', [JSON.stringify((await read()).metadata.blueprint), installed]);
  await panel.getByRole('button', { name: 'Inspect & compare', exact: true }).click();
  await panel.getByRole('button', { name: 'Compare attempts', exact: true }).click();
  await panel
    .getByText('Manual takeover, duration and changed conditions can affect outcomes.', {
      exact: false,
    })
    .waitFor();
  await page.screenshot({ path: `${out}/attempt-inspection.png` });
  await panel.getByRole('button', { name: 'Saved versions', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Saved version name' }).fill('Working delivery');
  await panel.getByRole('button', { name: 'Save model and machine', exact: true }).click();
  await page.setViewportSize({ width: 960, height: 640 });
  await page.screenshot({ path: `${out}/saved-version-small.png` });
  const box = await panel.boundingBox();
  evidence.assert('ok', [
    box.x >= 0 && box.y >= 0 && box.x + box.width <= 960 && box.y + box.height <= 640,
  ]);
  await panel.getByRole('button', { name: 'Close controller teaching', exact: true }).click();
  await page.getByRole('button', { name: 'Teach a controller', exact: true }).click();
  await panel.getByText('Working delivery', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Close controller teaching', exact: true }).click();
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(`${out}/result.json`, JSON.stringify(evidence.identity, null, 2));
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
