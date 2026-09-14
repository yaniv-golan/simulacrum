import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mechanicalLoadCellPress } from './load-cell-browser-fixtures.mjs';
import {
  readLoadCellFrame as read,
  selectLoadCellPart as select,
  placeLoadCellControl as place,
  wireLoadCellPart as wire,
} from './load-cell-browser-actions.mjs';

const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/load-cell-force-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  const mechanical = mechanicalLoadCellPress();
  assert.ok(
    mechanical.parts.every(
      (p) => !['logicController', 'commandReceiver', 'powerCell'].includes(p.type),
    ),
  );
  assert.ok(mechanical.connections.every((c) => !['power', 'signal'].includes(c.kind)));
  writeFileSync(`${out}/mechanical.json`, JSON.stringify(mechanical));
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  await evidence.loadAndWait(page, `${out}/mechanical.json`);
  const rules = await place(page, 'logicController', [2, 0.03, 0]);
  const receiver = await place(page, 'commandReceiver', [3, 0.03, 0]);
  const supply = await place(page, 'powerCell', [4, 0.05, 0]);
  const sensor = mechanical.parts.find((p) => p.id === 'sensor');
  const drive = mechanical.parts.find((p) => p.id === 'drive');
  await wire(page, supply, 'power', sensor, 'power');
  await wire(page, supply, 'power', drive, 'power');
  await wire(page, sensor, 'load', rules, 'input1');
  await wire(page, rules, 'out1', receiver, 'command');
  await wire(page, receiver, 'signal', drive, 'signal');
  await select(page, rules);
  const editor = page.locator('.controller-editor');
  await editor.getByRole('button', { name: 'Close → slow', exact: true }).click();
  await editor.getByLabel('When 1', { exact: true }).selectOption('input1');
  assert.match(
    await editor.getByLabel('When 1', { exact: true }).innerText(),
    /Attachment force.*N/,
  );
  await editor.getByLabel('Comparison 1', { exact: true }).selectOption('<');
  for (const [label, value] of [
    ['Threshold', '40'],
    ['Then duty', '0.5'],
    ['Otherwise duty', '0'],
  ]) {
    await editor.getByLabel(`${label} 1`, { exact: true }).fill(value);
    await editor.getByLabel(`${label} 1`, { exact: true }).press('Tab');
  }
  await editor.getByRole('button', { name: 'Apply program', exact: true }).click();
  await page.waitForFunction(
    (id) =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find((p) => p.id === id)
        ?.controllerProgram?.rules?.[0]?.threshold === 40,
    rules.id,
  );
  const authored = (await read(page)).metadata.blueprint;
  assert.deepEqual(authored.parts.find((p) => p.id === rules.id).controllerProgram.rules, [
    { input: 'input1', operator: '<', threshold: 40, output: 'out1', duty: 0.5, otherwise: 0 },
  ]);
  assert.equal(authored.connections.length, mechanical.connections.length + 5);
  await page.screenshot({ path: `${out}/rules.png` });

  // advanceTime is the existing production clock driver: inspect each completed tick
  // so a short contact cannot be missed between rendered animation frames.
  const trace = (ticks, stopAtForce = false) =>
    page.evaluate(
      ({ count, stopAtForce }) => {
        const rows = [];
        let powered = false;
        for (let i = 0; i < count; i++) {
          window.advanceTime(1000 / 120);
          const f = JSON.parse(window.render_game_to_text());
          const sensorNode = f.metadata.blueprint.parts.findIndex((p) => p.id === 'sensor');
          const channels = f.sensors.readings.find((r) => r.node === sensorNode).channels;
          rows.push({
            tick: f.tick,
            status: f.status,
            channels,
            receiver: f.receiverControl.receivers[0],
            motor: f.power.motors[0],
            contact: f.contacts.rows.some(
              (r) =>
                [r.a, r.b].includes(2) &&
                [r.a, r.b].includes(5) &&
                Math.hypot(...(r.normalImpulse ?? [])) > 0,
            ),
          });
          const row = rows.at(-1);
          powered ||= Math.abs(row.motor.torque) > 0;
          if (
            stopAtForce &&
            powered &&
            channels.load.status === 'ok' &&
            channels.load.value > 40 &&
            channels.axialForce.value < -2 &&
            row.receiver.mode === 'automatic' &&
            row.receiver.duty === 0 &&
            row.motor.torque === 0 &&
            row.contact
          )
            break;
        }
        return rows;
      },
      { count: ticks, stopAtForce },
    );
  await page.locator('[data-command=run]').click();
  const passive = await trace(360);
  assert.ok(
    passive.every((r) => r.motor.torque === 0),
    'unarmed press never drives',
  );
  assert.ok(
    passive.slice(20).every((r) => r.channels.load.status === 'ok' && r.channels.load.value < 40),
    'ordinary gravity alone must not explain the stop threshold',
  );

  const retry = async () => {
    const before = await page.evaluate(() => window.workshopProbe.observe().cursor);
    await page.locator('[data-command=retry]').click();
    await page.waitForFunction(
      (epoch) => window.workshopProbe.observe().cursor.epoch > epoch,
      before.epoch,
    );
    const warm = await trace(20);
    assert.ok(
      warm.every((r) => r.motor.torque === 0 && r.receiver.duty === 0),
      'Retry requires a deliberate new command before the press moves',
    );
    assert.equal(warm.at(-1).channels.load.status, 'ok');
    assert.deepEqual((await read(page)).metadata.blueprint, authored);
    return warm;
  };
  await retry();
  await select(page, receiver);
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  const driven = await trace(360, true);
  for (const row of driven) {
    if (
      row.receiver.mode === 'automatic' &&
      row.channels.load.status === 'ok' &&
      row.channels.load.value >= 40
    ) {
      assert.equal(row.receiver.duty, 0, `tick ${row.tick}: threshold removes duty on this sample`);
      assert.equal(row.motor.torque, 0, `tick ${row.tick}: threshold removes drive on this sample`);
    }
  }
  const firstDrive = driven.findIndex((r) => Math.abs(r.motor.torque) > 0);
  assert.ok(firstDrive >= 0, 'deliberate Automatic must actually power the actuator');
  const stopped = driven
    .slice(firstDrive + 1)
    .find(
      (r) =>
        r.channels.load.status === 'ok' &&
        r.channels.load.value > 40 &&
        r.channels.axialForce.value < -2 &&
        r.receiver.mode === 'automatic' &&
        r.receiver.duty === 0 &&
        r.motor.torque === 0 &&
        r.contact,
    );
  assert.ok(stopped, 'measured compression from actual carriage contact must remove motor drive');
  assert.ok(driven.every((r) => r.status === 'ready'));
  await page.screenshot({ path: `${out}/press.png` });
  const reset = await retry();
  await page.screenshot({ path: `${out}/retry.png` });
  // Recovery is permission, not automatic restart: only this second player arm drives.
  await select(page, receiver);
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  const rearmed = await trace(40);
  assert.ok(rearmed.some((r) => Math.abs(r.motor.torque) > 0));
  assert.deepEqual(evidence.errors, [], 'browser console and page errors');
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        authored,
        passive,
        driven,
        stopped,
        reset,
        rearmed,
        setup:
          'Mechanical press loaded; all control parts and wires authored through UI. Per-tick observation uses advanceTime.',
      },
      null,
      2,
    ),
  );
  console.log(
    'Load Cell UI control insertion, wiring, Rules threshold, force stop and Retry/rearm passed.',
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
