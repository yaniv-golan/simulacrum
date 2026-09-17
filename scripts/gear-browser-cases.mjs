import {
  placeCatalogPart,
  placeCatalogPartByName,
  browseAllParts,
  openTools,
} from './catalog-browser-actions.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Gear extension of the registered learning-example browser journey. */
export async function verifyGearJourney({ page, evidence, out }) {
  mkdirSync(out, { recursive: true });
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const chooseInput = async () => {
    const picker = page.locator('.machine-picker');
    if (!(await picker.evaluate((el) => el.open))) await picker.locator('summary').click();
    await page.locator('[data-part-id=input-gear].part-list-item').click();
  };
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.getByRole('button', { name: 'Try gear lift', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace without saving', exact: true });
  if (await replace.isVisible()) await replace.click();
  const built = (await read()).metadata.blueprint;
  evidence.assert('equal', [built.parts.filter((p) => p.type === 'spurGear').length, 2]);
  evidence.assert('equal', [built.connections.filter((c) => c.kind === 'gear').length, 1]);
  await browseAllParts(page);
  await placeCatalogPart(page, 'spurGear');
  evidence.assert('equal', [
    (await read()).metadata.blueprint.parts.length,
    built.parts.length + 1,
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  await chooseInput();
  if ((await page.locator('[data-port-id=mesh]').getAttribute('aria-expanded')) !== 'true')
    await page.locator('[data-port-id=mesh]').click();
  await page.locator('[data-disconnect-id=gear-mesh]').click();
  const disconnected = (await read()).metadata.blueprint;
  evidence.assert('equal', [disconnected.connections.filter((c) => c.kind === 'gear').length, 0]);
  evidence.assert('deepEqual', [
    disconnected.parts,
    built.parts,
    'disconnect preserves authored poses',
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, built]);
  if ((await page.locator('[data-port-id=mesh]').getAttribute('aria-expanded')) !== 'true')
    await page.locator('[data-port-id=mesh]').click();
  await page.locator('[data-disconnect-id=gear-mesh]').click();
  await page.getByRole('button', { name: /^Mesh with/ }).click();
  const reconnected = (await read()).metadata.blueprint;
  evidence.assert('deepEqual', [
    reconnected.parts,
    built.parts,
    'meshing does not snap or move parts',
  ]);
  evidence.assert('equal', [reconnected.connections.filter((c) => c.kind === 'gear').length, 1]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.screenshot({ path: `${out}/connected.png` });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(`${out}/saved-gears.json`);
  await evidence.loadAndWait(page, `${out}/saved-gears.json`);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, reconnected]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.locator('[data-command=pause]').click();
  const frame = await read();
  evidence.assert('ok', [
    frame.gears?.length === 1,
    'mesh state is observable after physical stepping',
  ]);
  await page.screenshot({ path: `${out}/running.png` });
  await verifyGearConstruction({ page, evidence, out });
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, tick: frame.tick, gears: frame.gears }, null, 2),
  );
}

/** Construct with catalog, inspector and connector controls; observations are read-only. */
async function verifyGearConstruction({ page, evidence, out }) {
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const started = performance.now();
  await page.locator('[data-command=build]').click();
  await openTools(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace without saving', exact: true });
  if (await replace.isVisible()) await replace.click();
  evidence.assert('equal', [(await read()).metadata.blueprint.parts.length, 0]);
  const select = async (part) => {
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list-item[data-part-id="${part.id}"]`).click();
  };
  const place = async (name) => {
    const button = page.getByRole('button', { name, exact: true });
    if (!(await button.isVisible())) await browseAllParts(page);
    const before = (await read()).metadata.blueprint.parts.length;
    await placeCatalogPartByName(page, name);
    const parts = (await read()).metadata.blueprint.parts;
    evidence.assert('equal', [parts.length, before + 1]);
    return parts.at(-1);
  };
  // Placing a second part of the same kind cannot go by display name: the machine picker names
  // its rows after the part, so "Spur gear" would match the catalog tile and the placed gear.
  const placeType = async (type) => {
    const before = (await read()).metadata.blueprint.parts.length;
    await placeCatalogPart(page, type);
    const parts = (await read()).metadata.blueprint.parts;
    evidence.assert('equal', [parts.length, before + 1]);
    return parts.at(-1);
  };
  const mount = async (part, source, target, face, along = 0, across = 0) => {
    await select(part);
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
    await page.getByLabel('Mounting face', { exact: true }).selectOption(source);
    await page
      .getByLabel('Target surface', { exact: true })
      .selectOption(JSON.stringify([target.id, face]));
    if (!(await page.locator('.surface-precise').evaluate((el) => el.open)))
      await page.locator('.surface-precise > summary').click();
    await page.getByLabel('Along surface (mm)', { exact: true }).fill(String(along));
    await page.getByLabel('Across surface (mm)', { exact: true }).fill(String(across));
    await page.getByLabel('Turn (degrees)', { exact: true }).fill('0');
    await page.getByLabel('Turn (degrees)', { exact: true }).press('Tab');
    evidence.assert('equal', [
      await page.locator('[data-command=apply-surface]').isEnabled(),
      true,
    ]);
    await page.locator('[data-command=apply-surface]').click();
  };
  const connect = async (part, port, target, targetPort, verb) => {
    await select(part);
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
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('.12');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).press('Tab');
  const input = await place('Powered Motor');
  await mount(input, 'bottom', base, 'top', 60, -90);
  const output = await place('Powered Motor');
  await mount(output, 'bottom', base, 'top', 60, 90);
  // One catalog row: the pair is made by authoring the tooth count, not by picking a part.
  const small = await placeType('spurGear');
  const large = await placeType('spurGear');
  const setting = async (part, key, value) => {
    await select(part);
    if (!(await page.locator('.part-settings').evaluate((el) => el.open)))
      await page.locator('.part-settings > summary').click();
    const input = page.getByLabel(key, { exact: true });
    await input.fill(value);
    await input.press('Tab');
  };
  // Reads the field back in the inspector the entry was typed into, without reselecting the part:
  // a reselect rebuilds the control from the frame and would hide what the field itself shows.
  const settingEntry = async (part, key, value) => {
    await select(part);
    if (!(await page.locator('.part-settings').evaluate((el) => el.open)))
      await page.locator('.part-settings > summary').click();
    const input = page.getByLabel(key, { exact: true });
    await input.fill(value);
    await input.press('Tab');
    return page.getByLabel(key, { exact: true }).inputValue();
  };
  await setting(large, 'teeth', '24');
  evidence.assert('equal', [
    (await read()).metadata.blueprint.parts.at(-1).parameters.teeth,
    24,
    'the authored tooth count is stored on the gear',
  ]);
  const unsupported = (await read()).metadata.blueprint;
  await connect(small, 'mesh', large, 'mesh', 'Mesh with');
  evidence.assert('deepEqual', [
    (await read()).metadata.blueprint,
    unsupported,
    'unsupported mesh is rejected without moving parts',
  ]);
  await connect(input, 'shaft', small, 'left', 'Attach to');
  await connect(output, 'shaft', large, 'left', 'Attach to');
  const cell = await place('Power Cell');
  await mount(cell, 'bottom', base, 'bottom');
  await connect(cell, 'power', input, 'power', 'Wire');
  const supported = (await read()).metadata.blueprint;
  await connect(small, 'mesh', large, 'mesh', 'Mesh with');
  const completed = (await read()).metadata.blueprint;
  evidence.assert('equal', [completed.connections.filter((c) => c.kind === 'gear').length, 1]);
  evidence.assert('deepEqual', [
    completed.parts,
    supported.parts,
    'explicit mesh never snaps supported shafts',
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, supported]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, completed]);
  await page.screenshot({ path: `${out}/constructed.png` });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await downloadEvent).saveAs(`${out}/constructed-gears.json`);
  await evidence.loadAndWait(page, `${out}/constructed-gears.json`);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, completed]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.locator('[data-command=pause]').click();
  const frame = await read();
  evidence.assert('equal', [frame.gears?.length, 1]);
  const ia = completed.parts.findIndex((p) => p.id === small.id),
    ib = completed.parts.findIndex((p) => p.id === large.id);
  const speeds = [frame.physics[ia].angularVelocity[0], frame.physics[ib].angularVelocity[0]];
  evidence.assert('ok', [
    Math.abs(speeds[0]) > 0.1 && speeds[0] * speeds[1] < 0,
    'ordinary electrically powered gear construction turns both shafts in opposite directions',
  ]);
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [index, gear] of [
    [ia, small],
    [ib, large],
  ])
    evidence.assert('ok', [
      rendered
        .find((pose) => pose.id === gear.id)
        .position.every(
          (value, axis) => Math.abs(value - frame.physics[index].position[axis]) < 1e-6,
        ),
      'drawn gear teeth follow the simulated body and are never animated on their own',
    ]);
  await page.locator('[data-command=build]').click();
  await select(base);
  if (!(await page.locator('.placement-settings').evaluate((el) => el.open)))
    await page.locator('.placement-settings > summary').click();
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('.25');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).press('Tab');
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).status === 'failed');
  const limited = await read();
  evidence.assert('equal', [limited.failure.reasonCode, 'GEAR_MOTION_LIMIT']);
  evidence.assert('equal', [limited.failure.tick, limited.tick + 1]);
  const diagnosis = page.getByText(/Gear motion exceeded this model/);
  evidence.assert('equal', [await diagnosis.isVisible(), true]);
  evidence.assert('match', [await diagnosis.innerText(), /Return to Build/]);
  await page.screenshot({ path: `${out}/motion-limit.png` });
  await page.locator('[data-command=build]').click();
  evidence.assert('equal', [(await read()).tick, 0]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, completed]);
  // A tooth size the other gear cannot mesh with is reported on the mesh row itself, in words
  // about tooth size, and the setting is accepted rather than refused. Repairing it clears the
  // row: the diagnosis is reachable and escapable from the same control that caused it.
  const meshId = completed.connections.find((c) => c.kind === 'gear').id;
  const meshRow = async (part) => {
    await select(part);
    const port = page.locator('[data-port-id=mesh]');
    if ((await port.getAttribute('aria-expanded')) !== 'true') await port.click();
    return port.locator('.port-peer').first().innerText();
  };
  // An off-menu tooth size never becomes a command: the field reports it and the authored value
  // stands, so the player is not told about a refusal the control could have shown. The field
  // goes back to the authored value too, so the player never reads a number the gear does not have.
  const offMenuShown = await settingEntry(large, 'module', '0.007');
  evidence.assert('deepEqual', [
    (await read()).metadata.blueprint,
    completed,
    'an off-menu tooth size is reported by the field and never authored',
  ]);
  evidence.assert('equal', [
    offMenuShown,
    '0.01',
    'the field shows the authored tooth size again after an off-menu entry is reported',
  ]);
  await setting(large, 'module', '0.005');
  const mismatched = await read();
  evidence.assert('equal', [
    mismatched.metadata.blueprint.parts.find((p) => p.id === large.id).parameters.module,
    0.005,
    'an unmeshable tooth size is still accepted as an authored setting',
  ]);
  evidence.assert('equal', [
    mismatched.metadata.connections.find((c) => c.id === meshId).reasonCode,
    'GEAR_TOOTH_SIZE_MISMATCH',
  ]);
  evidence.assert('match', [await meshRow(small), /different tooth sizes/]);
  await page.screenshot({ path: `${out}/tooth-size-mismatch.png` });
  await setting(large, 'module', '0.01');
  evidence.assert('equal', [
    (await read()).metadata.connections.find((c) => c.id === meshId).reasonCode,
    'OK',
  ]);
  evidence.assert('doesNotMatch', [await meshRow(small), /different tooth sizes|check/]);
  writeFileSync(
    `${out}/construction-result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        elapsedMs: performance.now() - started,
        tick: frame.tick,
        speeds,
        parts: completed.parts.length,
      },
      null,
      2,
    ),
  );
}
