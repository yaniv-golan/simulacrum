import { placeCatalogPartByName, openTools } from './catalog-browser-actions.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/load-cell-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
  page = await context.newPage();
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  await openTools(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace without saving', exact: true });
  if (await replace.isVisible()) await replace.click();
  assert.equal((await read()).metadata.blueprint.parts.length, 0);
  const select = async (p) => {
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list-item[data-part-id="${p.id}"]`).click();
  };
  const place = async (name) => {
    await placeCatalogPartByName(page, name);
    return (await read()).metadata.blueprint.parts.at(-1);
  };
  const mount = async (p, source, target, face) => {
    await select(p);
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
    await page.getByLabel('Mounting face', { exact: true }).selectOption(source);
    await page
      .getByLabel('Target surface', { exact: true })
      .selectOption(JSON.stringify([target.id, face]));
    await page.locator('[data-command=apply-surface]').click();
  };
  const connect = async (p, port, target, targetPort, verb) => {
    await select(p);
    const button = page.locator(`[data-port-id="${port}"]`);
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await page
      .getByRole('button', {
        name: `${verb} ${target.name} · ${targetPort}${verb === 'Attach to' ? '' : ' (parts stay put)'}`,
        exact: verb !== 'Attach to',
      })
      .click();
  };
  const base = await place('Chassis');
  await page.locator('.placement-settings > summary').click();
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('0.02');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).press('Tab');
  const sensor = await place('Load Cell');
  await mount(sensor, 'left', base, 'top');
  const power = await place('Power Cell');
  await connect(power, 'power', sensor, 'power', 'Wire');
  await select(sensor);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 60);
  await page.locator('[data-command=pause]').click();
  let state = await read();
  const reading = (f) =>
    f.sensors.readings.find(
      (r) => r.node === f.metadata.blueprint.parts.findIndex((p) => p.id === sensor.id),
    );
  assert.equal(reading(state).channels.load.status, 'disconnected');
  assert.equal(Object.hasOwn(reading(state).channels.load, 'value'), false);
  assert.match(await page.locator('.sensor-live').innerText(), /Not connected/);
  await page.screenshot({ path: `${out}/disconnected.png` });
  await page.locator('[data-command=build]').click();
  const payload = await place('Spacer block');
  await mount(payload, 'bottom', sensor, 'right');
  const repaired = (await read()).metadata.blueprint;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    (await read()).metadata.blueprint.connections.length,
    repaired.connections.length - 1,
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual((await read()).metadata.blueprint, repaired);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/constructed.json`);
  await evidence.loadAndWait(page, `${out}/constructed.json`);
  assert.deepEqual((await read()).metadata.blueprint, repaired);
  await select(sensor);
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  const faceLabels = await page
    .getByLabel('Mounting face', { exact: true })
    .locator('option')
    .allTextContents();
  assert.ok(faceLabels.some((x) => /A.*support/.test(x)));
  assert.ok(faceLabels.some((x) => /B.*measured/.test(x)));
  await page.keyboard.press('Escape');
  assert.deepEqual(
    (await read()).metadata.blueprint,
    repaired,
    'cancelling inspection preserves the machine',
  );
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 180);
  await page.locator('[data-command=pause]').click();
  state = await read();
  const transforms = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [i, part] of repaired.parts.entries()) {
    const rendered = transforms.find((r) => r.id === part.id);
    assert.deepEqual(rendered.position, state.physics[i].position);
    assert.deepEqual(rendered.rotation, state.physics[i].rotation);
  }
  assert.equal(reading(state).channels.load.status, 'ok');
  assert.ok(reading(state).channels.load.value > 0.01, 'supported payload transmits actual load');
  assert.ok(
    reading(state).channels.axialForce.value < 0,
    'the payload pressing down on B reads as compression',
  );
  assert.match(
    await page.locator('.sensor-live').innerText(),
    /Axial force.*N.*Attachment force.*N/,
  );
  assert.match(await page.locator('.sensor-inspector').innerText(), /Automatic/);
  await page.screenshot({ path: `${out}/loaded-1280.png` });
  await page.setViewportSize({ width: 960, height: 720 });
  await select(sensor);
  assert.ok(await page.locator('.sensor-inspector').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${out}/loaded-960.png` });
  assert.deepEqual(evidence.errors, [], 'browser console and page errors');
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, reading: reading(state), blueprint: repaired }, null, 2),
  );
  console.log(
    'Load cell ordinary mounting, invalid/repair, readings, history, save/load and layout probes passed.',
  );
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  writeFileSync(
    `${out}/failure.txt`,
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
