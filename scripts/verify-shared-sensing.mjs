import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSensorWorkshop } from '../src/model/fixtures/sensor-workshop.mjs';
const evidence = createBrowserEvidence(),
  out = 'artifacts/shared-sensing-browser';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(10000);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const openCode = async () => {
  const summary = page
    .locator('.controller-editor')
    .getByText('Code · TypeScript', { exact: true });
  if (!(await summary.evaluate((e) => e.parentElement.open))) await summary.click();
};
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'sensor-rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(createSensorWorkshop('range'))),
    });
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === 'sensor-range',
  );
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  const editor = page.locator('.controller-editor');
  await editor.getByRole('heading', { name: 'Controller behavior' }).waitFor();
  await editor.getByLabel('Condition type 1', { exact: true }).selectOption('no-return');
  evidence.assert('ok', [
    (await editor.getByRole('textbox', { name: 'Controller TypeScript' }).inputValue()).includes(
      'status("input1") === 2',
    ),
  ]);
  await editor.getByLabel('Condition type 1', { exact: true }).selectOption('value');
  await editor.getByLabel('Threshold 1', { exact: true }).focus();
  evidence.assert('equal', [
    await editor
      .getByRole('textbox', { name: 'Controller TypeScript' })
      .evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)),
    '0.6',
  ]);

  const code = editor.getByRole('textbox', { name: 'Controller TypeScript' }),
    original = await code.inputValue();
  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isEnabled()]);
  const oversized = original + '\n//' + 'x'.repeat(16384);
  await code.fill(oversized);
  await page.reload();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'sensor-rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(createSensorWorkshop('range'))),
    });
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === 'sensor-range',
  );
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  await openCode();
  evidence.assert('equal', [await code.inputValue(), oversized]);
  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isDisabled()]);
  evidence.assert('ok', [
    await editor.getByRole('button', { name: 'Apply program', exact: true }).isDisabled(),
  ]);
  const downloadEvent = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Export code draft', exact: true }).click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  evidence.assert('equal', [Buffer.concat(chunks).toString(), oversized]);
  await page.screenshot({ path: out + '/oversized-code.png' });
  await editor.getByRole('button', { name: 'Undo draft edit', exact: true }).click();
  await openCode();
  evidence.assert('equal', [await code.inputValue(), original]);
  evidence.assert('ok', [
    await editor.getByRole('button', { name: 'Apply program', exact: true }).isEnabled(),
  ]);
  await code.fill(oversized);
  await code.fill(original + '\n');
  evidence.assert('ok', [
    await editor.getByRole('button', { name: 'Apply program', exact: true }).isEnabled(),
  ]);

  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isDisabled()]);
  await editor.getByRole('button', { name: 'Undo draft edit', exact: true }).click();
  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isEnabled()]);
  await openCode();
  await editor
    .getByRole('textbox', { name: 'Controller TypeScript' })
    .fill(original + '\n// my code');
  await editor.getByRole('button', { name: 'Restore rules', exact: true }).click();
  await editor.getByRole('button', { name: 'Keep editing code', exact: true }).click();
  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isDisabled()]);
  await editor.getByRole('button', { name: 'Restore rules', exact: true }).click();
  await editor.getByRole('button', { name: 'Restore and save code', exact: true }).click();
  evidence.assert('ok', [await editor.getByLabel('Threshold 1', { exact: true }).isEnabled()]);
  await editor.getByText('Saved code before restoring rules', { exact: true }).click();
  evidence.assert('ok', [(await editor.locator('pre').innerText()).includes('// my code')]);
  await editor.getByLabel('Threshold 1', { exact: true }).fill('.55');
  await editor.getByLabel('Threshold 1', { exact: true }).press('Tab');
  await editor.getByRole('button', { name: 'Apply program', exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'rules',
      ).controllerProgram.rules[0].threshold === 0.55,
  );
  await page.screenshot({ path: out + '/rules.png' });
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 4);
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=left-control]').click();
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=right-control]').click();
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).receiverControl.receivers.every(
      (r) => r.mode === 'automatic',
    ),
  );
  await page.keyboard.down('w');
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).receiverControl.receivers.every(
      (r) => r.mode === 'manual',
    ),
  );
  await page.keyboard.up('w');
  await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=sensor]').click();
  await page.locator('.sensor-live').filter({ hasText: 'distance:' }).waitFor();
  await page.screenshot({ path: out + '/sensor.png' });
  for (const viewport of [
    { width: 960, height: 640 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const box = await page.locator('.sensor-inspector').boundingBox();
    evidence.assert('ok', [box.width > 0 && box.x >= 0 && box.x + box.width <= viewport.width]);
  }
  for (const kind of ['contact', 'tilt', 'jointAngle', 'linearMotion', 'contactLoad']) {
    await page.locator('[data-command=build]').click();
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: kind + '.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(createSensorWorkshop(kind))),
      });
    await page.waitForFunction(
      (kind) => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === 'sensor-' + kind,
      kind,
    );
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator('.part-list-item[data-part-id=sensor]').click();
    await page.locator('[data-command=run]').click();
    await page.waitForFunction(() => {
      const f = JSON.parse(window.render_game_to_text()),
        node = f.metadata.blueprint.parts.findIndex((p) => p.id === 'sensor');
      const r = f.sensors.readings.find((r) => r.node === node);
      return f.tick > 4 && r && Object.values(r.channels).every((c) => c.status === 'ok');
    });
    await page
      .locator('.sensor-live')
      .filter({
        hasText: {
          contact: 'touching:',
          contactLoad: 'normalLoad:',
          tilt: 'tiltX:',
          jointAngle: 'angle:',
          linearMotion: 'velocityZ:',
        }[kind],
      })
      .waitFor();
    await page.waitForFunction(
      () =>
        !/No power|Needs power|No completed reading/.test(
          document.querySelector('.sensor-live')?.textContent ?? 'No completed reading',
        ),
    );
    await page.locator('[data-command=pause]').click();
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).metadata.mode === 'paused',
    );
    const paused = await read(),
      sensorNode = paused.metadata.blueprint.parts.findIndex((p) => p.id === 'sensor');
    const displayed = await page.locator('.sensor-live').innerText();
    for (const [channel, reading] of Object.entries(
      paused.sensors.readings.find((r) => r.node === sensorNode).channels,
    )) {
      evidence.assert('ok', [
        displayed.includes(channel + ': ' + reading.value.toFixed(3)),
        'sensor inspector must display its completed paused reading: ' + channel,
      ]);
    }
    if (kind === 'jointAngle')
      await page
        .getByRole('img', { name: 'Measured joint angle relative to authored zero' })
        .waitFor();
    await page.screenshot({ path: out + '/' + kind + '.png' });
    if (kind === 'contact') {
      await page.locator('[data-command=run]').click();
      await page.waitForFunction(
        () => JSON.parse(window.render_game_to_text()).metadata.mode === 'run',
      );
      // Stop wall-clock progression while the player arms both receivers. Otherwise
      // the first wheel drives alone during the second selection and can turn the
      // narrow contact pad away from the obstacle. Flush the queued pause first.
      await page.evaluate(() => window.advanceTime(1000 / 120));
      const beforeArming = await read();
      evidence.assert('ok', [
        beforeArming.receiverControl.receivers.every((r) => r.duty === 0),
        'pause must leave both drives off before arming',
      ]);
      const armTick = beforeArming.tick;
      for (const id of ['left-control', 'right-control']) {
        if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
          await page.locator('.machine-picker > summary').click();
        await page.locator('.part-list-item[data-part-id=' + id + ']').click();
        await page.getByRole('button', { name: 'Automatic', exact: true }).click();
        await page.waitForFunction((id) => {
          const result = window.workshopProbe.readLastCommandResult();
          return (
            result?.input?.type === 'control-mode' && result.input.id === id && result.result.ok
          );
        }, id);
      }
      evidence.assert('equal', [
        (await read()).tick,
        armTick,
        'arming must not drive one wheel alone',
      ]);
      // Observe every normal 1/120 s step: contact reversal can last less than one
      // rendered frame. Keep the original 20-second physical horizon.
      const contactTrace = await page.evaluate(() => {
        const rows = [];
        const started = performance.now();
        for (let i = 0; i < 2400 && performance.now() - started < 20000; i++) {
          window.advanceTime(1000 / 120);
          const f = JSON.parse(window.render_game_to_text());
          const node = f.metadata.blueprint.parts.findIndex((p) => p.id === 'sensor');
          const row = {
            tick: f.tick,
            channels: f.sensors.readings.find((r) => r.node === node).channels,
            receivers: f.receiverControl.receivers,
            chassis: f.physics[0],
            contacts: f.contacts,
          };
          rows.push(row);
          if (
            row.channels.touching.status === 'ok' &&
            row.channels.touching.value === 1 &&
            row.receivers.every((r) => r.mode === 'automatic') &&
            row.receivers[0].duty === 0.25 &&
            row.receivers[1].duty === -0.25
          )
            break;
        }
        return rows;
      });
      writeFileSync(out + '/contact-trace.json', JSON.stringify(contactTrace, null, 2));
      evidence.assert('ok', [
        contactTrace.some((r) => r.receivers[0].duty === -0.25 && r.receivers[1].duty === 0.25),
        'both wheels must first drive toward the obstacle',
      ]);
      const reversed = contactTrace.at(-1);
      evidence.assert('ok', [
        reversed.channels.touching.status === 'ok' &&
          reversed.channels.touching.value === 1 &&
          reversed.receivers.every((r) => r.mode === 'automatic') &&
          reversed.receivers[0].duty === 0.25 &&
          reversed.receivers[1].duty === -0.25,
        'actual contact must reverse both automatic drives within 20 simulated seconds',
      ]);
    }
  }
  await page.locator('[data-command=build]').click();
  const broken = createSensorWorkshop('range');
  broken.connections = broken.connections.filter((c) => c.id !== 'sensor-power');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(broken)),
    });
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 5);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  await page.getByText('Inspect previous decisions', { exact: true }).click();
  await page
    .locator('.controller-history pre')
    .first()
    .filter({ hasText: 'Needs power' })
    .waitFor();
  await page.screenshot({ path: out + '/fault-history.png' });
  await page
    .locator('.controller-history')
    .getByRole('button', { name: 'Repair Watch this sensor', exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.mode === 'build',
  );
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  await page.getByText('Inspect previous decisions', { exact: true }).click();
  await page
    .locator('.controller-history pre')
    .first()
    .filter({ hasText: 'Needs power' })
    .waitFor();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=sensor]').click();
  await page.locator('.port-button[data-part-id=sensor][data-port-id=power]').click();
  await page.locator('[data-target-part-id=cell][data-target-port-id=power]').click();
  await page.locator('[data-command=run]').click();
  await page.locator('.sensor-live').filter({ hasText: 'distance:' }).waitFor();
  await page.waitForFunction(() => {
    const f = JSON.parse(window.render_game_to_text());
    return f.tick > 4 && f.sensors.readings.some((r) => r.channels.distance?.status === 'ok');
  });
  await page.locator('[data-command=build]').click();
  const missed = createSensorWorkshop('range');
  missed.parts.filter((p) => p.id.startsWith('barrier')).forEach((p) => (p.position[0] += 2));
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'missed.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(missed)),
    });
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 5);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  await page.locator('.controller-live').filter({ hasText: 'No object detected' }).waitFor();
  await page.getByText('Inspect previous decisions', { exact: true }).click();
  await page
    .locator('.controller-history pre')
    .first()
    .filter({ hasText: 'No object detected' })
    .waitFor();
  await page
    .locator('.controller-history')
    .getByRole('button', { name: 'Change rule or mechanism', exact: true })
    .click();
  const rulesAgain = page.locator('.controller-editor');
  await rulesAgain.getByLabel('Condition type 1', { exact: true }).selectOption('no-return');
  await rulesAgain.getByRole('button', { name: 'Apply program', exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'rules',
      ).controllerProgram.rules[0].status === 'no-return',
  );
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 5);
  await page.locator('.controller-live').filter({ hasText: 'condition met' }).waitFor();
  await page.screenshot({ path: out + '/missed-beam-repair.png' });
  await page.locator('[data-command=build]').click();
  const savedBuild = (await read()).metadata.blueprint;
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  await openCode();
  const sourceBefore = await page
    .getByRole('textbox', { name: 'Controller TypeScript' })
    .inputValue();
  await page
    .getByRole('textbox', { name: 'Controller TypeScript' })
    .fill(sourceBefore + '\n// retained after reload');
  await page.reload();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'saved.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(savedBuild)),
    });
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item[data-part-id=rules]').click();
  evidence.assert('ok', [await page.getByLabel('Threshold 1', { exact: true }).isDisabled()]);
  await page.getByRole('button', { name: 'Undo draft edit', exact: true }).click();
  evidence.assert('ok', [await page.getByLabel('Condition type 1', { exact: true }).isEnabled()]);
  await openCode();
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith('simulacrum-controller-draft')) throw Error('storage unavailable');
      return window.originalStorageSet.call(this, k, v);
    };
  });
  await page
    .getByRole('textbox', { name: 'Controller TypeScript' })
    .fill(sourceBefore + '\n// keep through failed storage');
  await page.getByRole('button', { name: 'Restore rules', exact: true }).click();
  await page.getByRole('button', { name: 'Restore and save code', exact: true }).click();
  evidence.assert('ok', [
    (await page.getByRole('textbox', { name: 'Controller TypeScript' }).inputValue()).includes(
      '// keep through failed storage',
    ),
  ]);
  evidence.assert('ok', [await page.getByLabel('Condition type 1', { exact: true }).isDisabled()]);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageSet;
    delete window.originalStorageSet;
  });
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(out + '/result.json', JSON.stringify(evidence.identity, null, 2));
} catch (error) {
  writeFileSync(out + '/failure-frame.json', JSON.stringify(await read(), null, 2));
  await page.screenshot({ path: out + '/failure.png' });
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
