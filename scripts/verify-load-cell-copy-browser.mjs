import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mechanicalLoadCellStand } from './load-cell-browser-fixtures.mjs';
import {
  readLoadCellFrame as read,
  selectLoadCellPart as select,
  placeLoadCellControl as place,
  wireLoadCellPart as wire,
} from './load-cell-browser-actions.mjs';

const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/load-cell-copy-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'focus' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  const stand = mechanicalLoadCellStand();
  writeFileSync(`${out}/mechanical.json`, JSON.stringify(stand));
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  await evidence.loadAndWait(page, `${out}/mechanical.json`);
  const sourceSensor = stand.parts.find((p) => p.id === 'sensor');
  const supply = await place(page, 'powerCell', [0.6, 0.05, 0]);
  await wire(page, supply, 'power', sourceSensor, 'power');
  await select(page, sourceSensor);
  const original = (await read(page)).metadata.blueprint;
  await page.getByRole('button', { name: 'Create assembly…', exact: true }).click();
  for (const part of original.parts)
    await page.getByRole('checkbox', { name: `Include ${part.name}`, exact: true }).check();
  await page.getByLabel('Assembly name', { exact: true }).fill('Force stand');
  await page.getByRole('button', { name: 'Create and save assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assemblies', exact: true });
  await dialog.getByRole('button', { name: 'Force stand', exact: true }).click();
  await dialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
  const placement = page.getByRole('region', { name: 'Assembly placement', exact: true });
  await placement.getByText('Precise position', { exact: true }).click();
  for (const [axis, value] of [
    ['X', '2'],
    ['Y', '0.02'],
    ['Z', '0'],
  ]) {
    const field = placement.getByRole('spinbutton', {
      name: `Insert assembly ${axis} (m)`,
      exact: true,
    });
    await field.fill(value);
    await field.press('Tab');
  }
  const beforeInsert = await page.evaluate(
    () => window.workshopProbe.readLastCommandResult().sequence,
  );
  await placement.getByRole('button', { name: 'Place', exact: true }).click();
  await page.waitForFunction((sequence) => {
    const receipt = window.workshopProbe.readLastCommandResult();
    return receipt.sequence > sequence && receipt.input.type === 'insert-assembly';
  }, beforeInsert);
  const insertion = await page.evaluate(() => window.workshopProbe.readLastCommandResult());
  writeFileSync(`${out}/copy-insertion-receipt.json`, JSON.stringify(insertion, null, 2));
  assert.equal(
    insertion.result.ok,
    true,
    `Copied Load Cell assembly insertion must be admitted: ${JSON.stringify(insertion.result)}`,
  );
  const copied = (await read(page)).metadata.blueprint;
  assert.equal(copied.parts.length, original.parts.length * 2);
  const originalIds = new Set(original.parts.map((p) => p.id));
  const copies = copied.parts.filter((p) => !originalIds.has(p.id));
  const copyIds = new Set(copies.map((p) => p.id));
  assert.equal(copyIds.size, original.parts.length);
  const copySensor = copies.find((p) => p.type === 'loadCellSensor');
  assert.ok(copySensor);
  const copiedConnections = copied.connections.filter(
    (c) => !original.connections.some((o) => o.id === c.id),
  );
  assert.equal(copiedConnections.length, original.connections.length);
  assert.ok(
    copiedConnections.every((c) => copyIds.has(c.a.part) && copyIds.has(c.b.part)),
    'all copied attachments and power stay inside the copied assembly',
  );
  const load = (frame, id) =>
    frame.sensors.readings.find(
      (r) => r.node === frame.metadata.blueprint.parts.findIndex((p) => p.id === id),
    ).channels.load;
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(1000));
  let frame = await read(page);
  for (const sensor of [sourceSensor, copySensor]) {
    assert.equal(load(frame, sensor.id).status, 'ok');
    assert.ok(load(frame, sensor.id).value > 0.01);
  }
  await select(page, copySensor);
  assert.match(await page.locator('.sensor-live').innerText(), /Attachment force.*N/);
  const transforms = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const sensor of [sourceSensor, copySensor]) {
    const i = frame.metadata.blueprint.parts.findIndex((p) => p.id === sensor.id);
    assert.deepEqual(
      transforms.find((r) => r.id === sensor.id).position,
      frame.physics[i].position,
    );
    assert.deepEqual(
      transforms.find((r) => r.id === sensor.id).rotation,
      frame.physics[i].rotation,
    );
  }
  await page.screenshot({ path: `${out}/two-stands.png` });
  await page.locator('[data-command=build]').click();
  await select(page, sourceSensor);
  await page
    .locator('.mount-relationship')
    .filter({ hasText: 'Bolted to Spacer block' })
    .getByRole('button', { name: 'Detach', exact: true })
    .click();
  const disconnected = (await read(page)).metadata.blueprint;
  assert.equal(disconnected.connections.length, copied.connections.length - 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await read(page)).metadata.blueprint, copied);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual((await read(page)).metadata.blueprint, disconnected);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/copied.json`);
  await evidence.loadAndWait(page, `${out}/copied.json`);
  assert.deepEqual((await read(page)).metadata.blueprint, disconnected);
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(1000));
  frame = await read(page);
  assert.equal(load(frame, sourceSensor.id).status, 'disconnected');
  assert.equal(Object.hasOwn(load(frame, sourceSensor.id), 'value'), false);
  assert.equal(load(frame, copySensor.id).status, 'ok');
  assert.ok(
    load(frame, copySensor.id).value > 0.01,
    'copy must measure its own B attachment after the original B is disconnected',
  );
  await select(page, copySensor);
  await page.screenshot({ path: `${out}/independent-copy.png` });
  assert.deepEqual(evidence.errors, [], 'browser console and page errors');
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        original,
        copied,
        disconnected,
        readings: frame.sensors.readings,
        setup:
          'Mechanical stand loaded; power insertion/wiring, assembly creation/insertion and disconnection use UI.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Load Cell UI assembly copy, independent B binding, history and saved-copy readings passed.',
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
  await browser.close();
}
