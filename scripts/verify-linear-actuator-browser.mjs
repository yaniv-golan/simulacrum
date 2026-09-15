import { placeCatalogPartByName, openTools } from './catalog-browser-actions.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/linear-actuator-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'focus' }),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
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
  const position = async (part, values) => {
    await select(part);
    if (!(await page.locator('.placement-settings').evaluate((el) => el.open)))
      await page.locator('.placement-settings > summary').click();
    for (const [axis, value] of Object.entries(values)) {
      const input = page.getByRole('spinbutton', { name: `Position ${axis}`, exact: true });
      await input.fill(String(value));
      await input.press('Tab');
    }
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
  const drive = await place('Powered linear actuator');
  await mount(drive, 'bottom', base, 'top');
  const carriage = await place('Spring carriage');
  await connect(drive, 'slide', carriage, 'slide', 'Attach to');
  const platform = await place('Plate');
  await mount(platform, 'bottom', carriage, 'top');
  const cell = await place('Power Cell'),
    keys = await place('Command Receiver');
  // Loose supplies must not sit in the platform travel path.
  await position(cell, { Z: 1 });
  await position(keys, { Z: 1.3 });
  await connect(cell, 'power', drive, 'power', 'Wire');
  await connect(keys, 'signal', drive, 'signal', 'Wire');
  await select(drive);
  const setting = page.getByRole('spinbutton', { name: 'currentLimit', exact: true });
  await setting.fill('0.1');
  await setting.press('Tab');
  const failedBuild = (await read()).metadata.blueprint;
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 90);
  await page.keyboard.up('KeyW');
  await page.locator('[data-command=pause]').click();
  const failed = await read();
  assert.ok(failed.springs[0].length < 0.1, 'underpowered load falls to lower stop');
  await page.screenshot({ path: `${out}/underpowered.png` });
  await page.locator('[data-command=build]').click();
  await select(drive);
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).press('Tab');
  const repaired = (await read()).metadata.blueprint;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await read()).metadata.blueprint, failedBuild);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual((await read()).metadata.blueprint, repaired);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/constructed.json`);
  await evidence.loadAndWait(page, `${out}/constructed.json`);
  assert.deepEqual((await read()).metadata.blueprint, repaired);
  await select(drive);
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 480);
  // Read the driven state while the key is still held: release is off and the
  // load can fall, so a late pause click would measure harness latency instead.
  assert.ok((await read()).springs[0].length > 0.38, 'repaired load extends');
  await page.keyboard.up('KeyW');
  await page.locator('[data-command=pause]').click();
  const extended = await read();
  await page.screenshot({ path: `${out}/extended.png` });
  const transforms = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [i, part] of repaired.parts.entries()) {
    const rendered = transforms.find((r) => r.id === part.id);
    assert.deepEqual(rendered.position, extended.physics[i].position);
    assert.deepEqual(rendered.rotation, extended.physics[i].rotation);
  }
  const rods = await page.evaluate(() => window.workshopProbe.readRenderedSpringEndpoints());
  assert.equal(rods.length, 1);
  for (const [end, point] of [
    ['a', extended.springs[0].pointA],
    ['b', extended.springs[0].pointB],
  ])
    assert.ok(Math.hypot(...rods[0][end].map((v, i) => v - point[i])) < 1e-6);
  assert.equal(extended.power.sources[0].duty, 0, 'key release clears drive');
  const rendered = await page.evaluate(() => window.workshopProbe.readInteractionState());
  writeFileSync(`${out}/rendered.json`, JSON.stringify(rendered, null, 2));
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: `${out}/narrow.png` });
  assert.equal(
    await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).isVisible(),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyS');
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick >= t,
    extended.tick + 120,
  );
  await page.keyboard.up('KeyS');
  await page.locator('[data-command=pause]').click();
  assert.ok((await read()).springs[0].length < 0.1, 'reverse key retracts');
  // A second ordinary build authors a horizontal axis: the upright plate supplies
  // the mounting face. Its plate is an extendable gate and a press face.
  await page.locator('[data-command=build]').click();
  await openTools(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  if (await replace.isVisible()) await replace.click();
  assert.equal((await read()).metadata.blueprint.parts.length, 0);

  const gateBase = await place('Chassis');
  await position(gateBase, { Y: 0.02 });
  if (!(await page.locator('.part-settings').evaluate((el) => el.open)))
    await page.locator('.part-settings > summary').click();
  await page.getByLabel('Material', { exact: true }).selectOption('steel');
  const upright = await place('Plate');
  await mount(upright, 'left', gateBase, 'top');
  const gateDrive = await place('Powered linear actuator');
  await mount(gateDrive, 'bottom', upright, 'top');
  const gateCarriage = await place('Spring carriage');
  await connect(gateDrive, 'slide', gateCarriage, 'slide', 'Attach to');
  const gatePlate = await place('Plate');
  await mount(gatePlate, 'bottom', gateCarriage, 'top');
  const gateCell = await place('Power Cell'),
    gateKeys = await place('Command Receiver');
  await position(gateCell, { Z: 1 });
  await position(gateKeys, { Z: 1.3 });
  await connect(gateCell, 'power', gateDrive, 'power', 'Wire');
  await connect(gateKeys, 'signal', gateDrive, 'signal', 'Wire');
  const initialGate = await read();
  writeFileSync(`${out}/gate-initial.json`, JSON.stringify(initialGate, null, 2));
  const slide = initialGate.springs[0],
    axis = slide.pointB.map((v, i) => (v - slide.pointA[i]) / slide.length);
  assert.ok(Math.abs(axis[1]) < 1e-6, 'mounting authors a horizontal slide');
  const blockerBase = await place('Chassis');
  if (!(await page.locator('.part-settings').evaluate((el) => el.open)))
    await page.locator('.part-settings > summary').click();
  await page.getByLabel('Material', { exact: true }).selectOption('steel');
  const blocker = await place('Beam');
  await mount(blocker, 'left', blockerBase, 'top');
  await position(blockerBase, {
    X: slide.pointA[0] + axis[0] * 0.36,
    Y: 0.02,
    Z: slide.pointA[2] + axis[2] * 0.36,
  });
  await select(gateDrive);
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 180);
  const pressing = await read();
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick >= t,
    pressing.tick + 60,
  );
  const pressed = await read();
  const partIndex = (id) => pressed.metadata.blueprint.parts.findIndex((p) => p.id === id),
    plateIndex = partIndex(gatePlate.id),
    blockerIndex = partIndex(blocker.id);
  const assertPressContact = (sample) => {
    assert.ok(
      sample.springs[0].length > 0.24 && sample.springs[0].length < 0.36,
      'ordinary beam contact blocks the press before its built-in end stop',
    );
    assert.ok(
      sample.contacts.available &&
        sample.contacts.rows.some(
          (row) =>
            row.a === plateIndex &&
            row.b === blockerIndex &&
            row.available &&
            row.distance < 0.001 &&
            row.normalImpulse &&
            Math.hypot(...row.normalImpulse) > 0.01,
        ),
      'press face carries a measured contact impulse against the authored obstacle',
    );
  };
  assertPressContact(pressed);
  assert.throws(() => assertPressContact({ ...pressed, contacts: { available: true, rows: [] } }));
  assert.throws(() =>
    assertPressContact({ ...pressed, springs: [{ ...pressed.springs[0], length: 0.4 }] }),
  );
  assert.ok(
    Math.abs(pressed.springs[0].length - pressing.springs[0].length) < 0.002,
    'sustained command cannot push the face through the obstacle',
  );
  assert.ok(Math.abs(pressed.springs[0].speed) < 0.01, 'contact stalls the drive');
  assert.ok(
    pressed.power.motors[0].current > 0 &&
      pressed.power.motors[0].heatJ > pressing.power.motors[0].heatJ + 1,
    'contact stall remains electrically funded and heats the winding',
  );
  await page.keyboard.up('KeyW');
  await page.locator('[data-command=pause]').click();
  writeFileSync(`${out}/pressed.json`, JSON.stringify({ pressing, pressed }, null, 2));
  await page.screenshot({ path: `${out}/pressed.png` });
  await page.locator('[data-command=build]').click();
  await select(blocker);
  await page.getByRole('button', { name: 'Delete part', exact: true }).click();
  await select(gateDrive);
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 240);
  await page.keyboard.up('KeyW');
  await page.locator('[data-command=pause]').click();
  const gateExtended = await read();
  writeFileSync(`${out}/gate-extended.json`, JSON.stringify(gateExtended, null, 2));
  assert.ok(
    gateExtended.springs[0].length > 0.38,
    'removing the obstruction repairs the horizontal gate',
  );
  await page.screenshot({ path: `${out}/gate-extended.png` });
  const gateTransforms = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [i, part] of gateExtended.metadata.blueprint.parts.entries()) {
    const rendered = gateTransforms.find((r) => r.id === part.id);
    assert.deepEqual(rendered.position, gateExtended.physics[i].position);
    assert.deepEqual(rendered.rotation, gateExtended.physics[i].rotation);
  }
  const gateRods = await page.evaluate(() => window.workshopProbe.readRenderedSpringEndpoints());
  assert.equal(gateRods.length, 1);
  for (const [end, point] of [
    ['a', gateExtended.springs[0].pointA],
    ['b', gateExtended.springs[0].pointB],
  ])
    assert.ok(Math.hypot(...gateRods[0][end].map((v, i) => v - point[i])) < 1e-6);

  await page.locator('[data-command=run]').click();
  await page.keyboard.down('KeyS');
  await page.waitForFunction(
    (t) => JSON.parse(window.render_game_to_text()).tick >= t,
    gateExtended.tick + 180,
  );
  await page.keyboard.up('KeyS');
  await page.locator('[data-command=pause]').click();
  assert.ok(
    (await read()).springs[0].length < 0.1,
    'horizontal gate retracts with the reverse key',
  );
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        failedLength: failed.springs[0].length,
        extendedLength: extended.springs[0].length,
        physics: extended.physics,
        pressLength: pressed.springs[0].length,
        horizontalLength: gateExtended.springs[0].length,
      },
      null,
      2,
    ),
  );
  console.log(
    'Linear actuator lift, horizontal gate, press contact, failure/repair, history and save/load passed.',
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
