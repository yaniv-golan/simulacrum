import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/release-coupler');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(6000);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace without saving', exact: true });
  if (await replace.isVisible()) await replace.click();
  evidence.assert('equal', [(await read()).metadata.blueprint.parts.length, 0]);
  const select = async (p) => {
    if (!(await page.locator('.machine-picker').evaluate((e) => e.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list-item[data-part-id="${p.id}"]`).click();
  };
  const place = async (name) => {
    const button = page.getByRole('button', { name, exact: true });
    if (!(await button.isVisible())) await page.getByText('More parts', { exact: true }).click();
    await button.click();
    return (await read()).metadata.blueprint.parts.at(-1);
  };
  const mount = async (p, source, target, face) => {
    await select(p);
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
    await page.getByLabel('Mounting face', { exact: true }).selectOption(source);
    await page
      .getByLabel('Target surface', { exact: true })
      .selectOption(JSON.stringify([target.id, face]));
    await page.screenshot({ path: `${out}/mount-preview.png` });
    evidence.assert('equal', [
      await page.locator('[data-command=apply-surface]').isEnabled(),
      true,
    ]);
    await page.locator('[data-command=apply-surface]').click();
  };
  const wire = async (p, port, target, targetPort) => {
    await select(p);
    const button = page.locator(`[data-port-id="${port}"]`);
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await page
      .getByRole('button', {
        name: `Wire ${target.name} · ${targetPort} (parts stay put)`,
        exact: true,
      })
      .click();
  };
  const base = await place('Chassis'),
    tower = await place('Chassis');
  await mount(tower, 'left', base, 'top');
  const latch = await place('Release Coupler');
  await mount(latch, 'left', tower, 'top');
  const cargo = await place('Spacer block');
  await mount(cargo, 'left', latch, 'right');
  const cell = await place('Power Cell'),
    receiver = await place('Command Receiver');
  await wire(cell, 'power', latch, 'power');
  await wire(receiver, 'signal', latch, 'signal');
  await select(latch);
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.getByText('Engineering details', { exact: true }).click();
  await page.getByLabel('energyJ', { exact: true }).fill('10');
  await page.getByLabel('energyJ', { exact: true }).press('Tab');
  const built = (await read()).metadata.blueprint;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  await page.screenshot({ path: `${out}/build.png` });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await downloadEvent).saveAs(`${out}/machine.json`);
  await evidence.loadAndWait(page, `${out}/machine.json`);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  await select(latch);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 60);
  const before = await read(),
    index = built.parts.findIndex((p) => p.id === cargo.id);
  evidence.assert('equal', [before.power.couplers[0].opened, false]);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).power.couplers[0].opened,
  );
  await page.keyboard.up('KeyW');
  const released = await read();
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick >= t + 60,
    released.tick,
  );
  await page.locator('[data-command=pause]').click();
  const after = await read();
  evidence.assert('ok', [
    after.physics[index].position[1] < before.physics[index].position[1] - 0.05,
    'cargo visibly falls after opening',
  ]);
  evidence.assert('equal', [after.status, 'ready']);
  evidence.assert('equal', [
    await page.getByText(`Bolted to ${cargo.name} · Left`, { exact: true }).count(),
    0,
  ]);
  await page.screenshot({ path: `${out}/released.png` });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: `${out}/released-narrow.png` });
  evidence.assert('equal', [await page.locator('[data-command=build]').isVisible(), true]);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).power.couplers[0].opened,
  );
  evidence.assert('equal', [(await read()).power.couplers[0].heatJ, 0]);
  const retryTick = (await read()).tick;
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick >= t + 20,
    retryTick,
  );
  evidence.assert('equal', [(await read()).power.couplers[0].opened, false]);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).power.couplers[0].opened,
  );
  await page.keyboard.up('KeyW');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).power.couplers[0].opened,
  );
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => {
    const c = JSON.parse(window.render_game_to_text()).power.couplers[0];
    return c.progressJ > 0 && !c.opened;
  });
  await page.keyboard.up('KeyW');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).power.couplers[0].progressJ === 0,
  );
  evidence.assert('ok', [(await read()).power.couplers[0].heatJ > 0]);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).power.couplers[0].heatJ === 0,
  );
  evidence.assert('equal', [(await read()).power.couplers[0].opened, false]);
  await page.locator('[data-command=build]').click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  evidence.assert('equal', [(await read()).power.couplers[0].opened, false]);
  await page.screenshot({ path: `${out}/recovered.png` });
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, before, after }, null, 2),
  );
} finally {
  await browser.close();
}
