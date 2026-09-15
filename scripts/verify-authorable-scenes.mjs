import { placeCatalogPart, openTools } from './catalog-browser-actions.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence, uploadWorkshopFile } from './browser-evidence.mjs';
import { normalizeQuaternion } from '../src/model/transforms.mjs';
import { createDrivingMachine } from '../src/model/fixtures/driving-machine.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/authorable-scenes');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const click = async (name) => {
  // Choose scene and Edit scene live in the Tools menu.
  if (name === 'Edit scene' || name === 'Choose scene') await openTools(page);
  await page.getByRole('button', { name, exact: true }).click();
};
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const fixture = createDrivingMachine();
  writeFileSync(`${out}/machine.json`, JSON.stringify(fixture));
  await evidence.loadAndWait(page, `${out}/machine.json`);
  await placeCatalogPart(page, 'camera');
  await click('View through camera');
  assert.ok(
    (await page.evaluate(() => window.workshopProbe.readInteractionState())).cameraPhoto.active,
  );
  await click('Edit scene');
  assert.equal(
    (await page.evaluate(() => window.workshopProbe.readInteractionState())).cameraPhoto.active,
    null,
    'scene authoring restores workshop camera and input ownership',
  );
  await click('Add Platform');
  await click('Cancel preview');
  await click('Done');
  await evidence.loadAndWait(page, `${out}/machine.json`);
  const original = (await read()).metadata.blueprint;
  await click('Edit scene');
  assert.equal(await page.locator('.palette').isVisible(), false);
  // Neutral focus distinguishes global shortcuts from native button activation.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.mode === 'run',
    null,
    { timeout: 2000 },
  );
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.mode === 'paused',
    null,
    { timeout: 2000 },
  );
  const beforeStep = (await read()).tick;
  await page.keyboard.press('.');
  await page.waitForFunction(
    (tick) => JSON.parse(window.render_game_to_text()).tick === tick + 1,
    beforeStep,
    { timeout: 2000 },
  );
  await page.locator('[data-command=build]').click();
  assert.deepEqual((await read()).metadata.blueprint, original);

  await click('Add Straight ramp');
  assert.deepEqual((await read()).metadata.blueprint, original);
  await page.getByRole('textbox', { name: 'Object name', exact: true }).fill('My hill');
  await page.getByRole('textbox', { name: 'Object name', exact: true }).press('Tab');
  for (const [name, value] of [
    ['Position X (m)', '0'],
    ['Position Z (m)', '0.8'],
  ]) {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(value);
    await input.press('Tab');
  }
  await page.screenshot({ path: `${out}/placement-1280.png` });
  await click('Apply scene');
  const placed = (await read()).metadata.blueprint;
  assert.equal(placed.environment.objects.length, 1);
  assert.deepEqual(placed.parts, original.parts);
  const rendered = await page.evaluate(
    () => window.workshopProbe.readInteractionState().environment.obstacles,
  );
  assert.deepEqual(rendered[0].position, placed.environment.objects[0].position);
  assert.deepEqual(
    rendered[0].rotation,
    normalizeQuaternion(placed.environment.objects[0].rotation),
  );
  const physics = (await read()).physics.at(-1);
  assert.deepEqual(physics.position, rendered[0].position);
  const sceneState = () =>
    page.evaluate(() => window.workshopProbe.readInteractionState().sceneEditing);
  const field = async (name, value) => {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  };
  await click('My hill');
  await click('Frame scene · F');
  await page.locator('canvas').first().focus();
  await page.keyboard.press('w');
  assert.equal((await sceneState()).gizmoMode, 'translate');
  assert.equal(
    await page.getByRole('button', { name: 'Move · W', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal((await sceneState()).committedVisible, false);
  const canvas = await page.locator('canvas').first().boundingBox();
  let handle = null;
  for (const candidate of (await sceneState()).handles.filter((h) => h.axis === 'X')) {
    const [x, y, z] = candidate.point;
    if (Math.abs(x) > 0.95 || Math.abs(y) > 0.8 || z > 1) continue;
    const point = {
      x: canvas.x + (x / 2 + 0.5) * canvas.width,
      y: canvas.y + (0.5 - y / 2) * canvas.height,
    };
    await page.mouse.move(point.x, point.y);
    if ((await sceneState()).axis === 'X') {
      handle = point;
      break;
    }
  }
  assert.ok(handle, 'actual translation handle must be reachable');
  const previewBefore = (await sceneState()).preview;
  await page.mouse.down();
  await page.mouse.move(handle.x + 45, handle.y + 10, { steps: 8 });
  await page.mouse.up();
  assert.notDeepEqual((await sceneState()).preview, previewBefore);
  assert.deepEqual((await read()).metadata.blueprint, placed, 'drag is still provisional');
  await page.locator('canvas').first().focus();
  // Shift with the up arrow lifts the selected proposal by one grid step,
  // the same binding the workshop uses; the draft stays provisional.
  const beforeLift = (await sceneState()).preview.map((p) => p.position);
  await page.keyboard.press('Shift+ArrowUp');
  const afterLift = (await sceneState()).preview.map((p) => p.position);
  assert.equal(afterLift.length, beforeLift.length);
  assert.ok(
    afterLift.some((p, i) => Math.abs(p[1] - beforeLift[i][1] - 0.025) < 1e-9),
    'Shift+ArrowUp lifts the selected scene object by 25 mm',
  );
  await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(
    (await sceneState()).preview.map((p) => p.position.map((v) => Math.round(v * 1e6) / 1e6)),
    beforeLift.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)),
  );
  assert.deepEqual((await read()).metadata.blueprint, placed, 'lift is still provisional');
  await page.keyboard.press('e');
  assert.equal((await sceneState()).gizmoMode, 'rotate');
  await page.keyboard.press('v');
  assert.equal((await sceneState()).tool, 'select');
  await page.keyboard.press('Escape');
  assert.equal((await sceneState()).committedVisible, true);
  assert.deepEqual((await read()).metadata.blueprint, placed);
  await click('My hill');
  await field('Rotate Y (degrees)', 20);
  await field('Size X (m)', 0.7);
  await click('Apply scene');
  assert.notDeepEqual(
    (await read()).metadata.blueprint.environment.objects[0].rotation,
    placed.environment.objects[0].rotation,
  );
  await click('Undo');
  assert.deepEqual((await read()).metadata.blueprint, placed);
  await click('My hill');
  await click('Delete object');
  assert.deepEqual((await sceneState()).preview, []);
  assert.equal((await sceneState()).committedVisible, false);
  await click('Cancel preview');
  for (const [label, name] of [
    ['Rounded bump', 'Rounded bump'],
    ['Platform', 'Platform'],
  ]) {
    await click('Add ' + label);
    await field('Position X (m)', 3);
    if (label === 'Rounded bump') await field('Diameter (m)', 0.08);
    else await field('Size Z (m)', 0.4);
    await click('Apply scene');
    await click(name);
    await click('Delete object');
    await click('Apply scene');
    assert.deepEqual((await read()).metadata.blueprint, placed);
  }
  await click('My hill');
  await click('Undo');
  assert.match(await page.locator('.scene-inspector').innerText(), /Revalidate/);
  assert.equal(
    await page.getByRole('button', { name: 'Apply scene', exact: true }).isDisabled(),
    true,
  );
  await click('Redo');
  await click('Revalidate preview');
  await click('Cancel preview');
  await click('Done');
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).metadata.mode === 'run',
  );
  await page.locator('canvas').first().focus();
  const driveStart = (await read()).physics[0].position;
  await page.keyboard.down('w');
  await page.waitForFunction((start) => {
    const f = JSON.parse(window.render_game_to_text());
    window.sceneTouchObserved ||= f.contacts?.rows?.some(
      (row) =>
        row.a === f.metadata.blueprint.parts.length + 1 ||
        row.b === f.metadata.blueprint.parts.length + 1,
    );
    return (
      f.tick > 180 &&
      window.sceneTouchObserved &&
      Math.hypot(...f.physics[0].position.map((v, i) => v - start[i])) > 0.08
    );
  }, driveStart);
  await page.keyboard.up('w');
  await page.locator('[data-command=pause]').click();
  await openTools(page);
  assert.equal(
    await page.getByRole('button', { name: 'Edit scene', exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${out}/paused-1280.png` });
  await page.locator('[data-command=build]').click();
  assert.deepEqual((await read()).metadata.blueprint, placed);
  await click('Edit scene');
  await click('My hill');
  await field('Size Y (m)', 0.03);
  await click('Apply scene');
  await click('Done');
  const revised = (await read()).metadata.blueprint;
  await page.locator('[data-command=run]').click();
  await page.locator('canvas').first().focus();
  await page.keyboard.down('w');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick > 180);
  await page.keyboard.up('w');
  await page.locator('[data-command=build]').click();
  assert.deepEqual(
    (await read()).metadata.blueprint,
    revised,
    'retry keeps the edited initial setup',
  );
  await click('Undo');
  assert.deepEqual((await read()).metadata.blueprint, placed);
  await click('Edit scene');
  await click('My hill');
  await page.getByRole('spinbutton', { name: 'Position X (m)', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Position X (m)', exact: true }).press('Tab');
  await click('Duplicate');
  await click('Apply scene');
  assert.equal((await read()).metadata.blueprint.environment.objects.length, 2);
  await click('Done');
  await click('Choose scene');
  await page.getByRole('textbox', { name: 'Saved scene name' }).fill('Two hills');
  await click('Save current scene');
  await click('Flat floor');
  await click('Preview replacement');
  await click('Cancel preview');
  assert.equal((await read()).metadata.blueprint.environment.objects.length, 2);
  await click('Choose scene');
  await click('Flat floor');
  await click('Preview replacement');
  await click('Apply scene');
  assert.equal((await read()).metadata.blueprint.environment.objects.length, 0);
  await click('Done');
  await click('Choose scene');
  await click('Two hills');
  await click('Preview replacement');
  await click('Apply scene');
  assert.equal((await read()).metadata.blueprint.environment.objects.length, 2);
  await click('Done');
  const beforeSave = (await read()).metadata.blueprint,
    download = page.waitForEvent('download');
  await click('Save');
  await (await download).saveAs(`${out}/saved.json`);
  await evidence.loadAndWait(page, `${out}/saved.json`);
  assert.deepEqual((await read()).metadata.blueprint, beforeSave);
  const empty = { ...beforeSave, parts: [], connections: [] };
  delete empty.assemblies;
  writeFileSync(`${out}/scene-only.json`, JSON.stringify(empty));
  await evidence.loadAndWait(page, `${out}/scene-only.json`);
  await click('Learn & examples');
  await click('Try driving example');
  assert.match(await page.locator('.example-message').innerText(), /scene/);
  await click('Cancel replacement');
  await page.keyboard.press('Escape');
  assert.deepEqual((await read()).metadata.blueprint, empty);

  await click('Learn & examples');
  await click('Try driving example');
  await page.evaluate(() => {
    window.sceneOriginalURL = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw Error('test export failure');
    };
  });
  await click('Download current workshop');
  assert.match(await page.locator('.example-message').innerText(), /could not start/);
  assert.deepEqual((await read()).metadata.blueprint, empty);
  await page.evaluate(() => {
    URL.createObjectURL = window.sceneOriginalURL;
    delete window.sceneOriginalURL;
  });
  const protectedDownload = page.waitForEvent('download');
  await click('Download current workshop');
  await (await protectedDownload).saveAs(`${out}/protected-workshop.json`);
  assert.deepEqual((await read()).metadata.blueprint, empty);
  await click('I saved the file — open example');
  assert.ok((await read()).metadata.blueprint.parts.length > 0);
  assert.equal((await read()).metadata.editing.undoCount, 0);
  const settingsOnly = {
    ...empty,
    environment: { objects: [], ground: { friction: 0.3, restitution: 0 } },
  };
  writeFileSync(`${out}/settings-only.json`, JSON.stringify(settingsOnly));
  await evidence.loadAndWait(page, `${out}/settings-only.json`);
  await click('Learn & examples');
  await click('Try driving example');
  assert.match(await page.locator('.example-message').innerText(), /scene/);
  await click('Cancel replacement');
  await page.keyboard.press('Escape');
  assert.deepEqual((await read()).metadata.blueprint, settingsOnly);
  await evidence.loadAndWait(page, `${out}/scene-only.json`);
  await click('Edit scene');
  await click('Frame scene · F');
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: `${out}/scene-900.png` });
  await click('Done');
  await click('Choose scene');
  await page.screenshot({ path: `${out}/browser-900.png` });
  await page.keyboard.press('Escape');
  await click('Choose scene');
  const sceneDownload = page.waitForEvent('download');
  await click('Export scene');
  await (await sceneDownload).saveAs(`${out}/scene-export.json`);
  await page.getByRole('button', { name: 'Close scene chooser', exact: true }).click();
  await click('Choose scene');
  await page.getByLabel('Import scene', { exact: true }).setInputFiles(`${out}/scene-export.json`);
  await click('Preview replacement');
  await click('Apply scene');
  await click('Done');
  const imported = (await read()).metadata.blueprint;
  assert.deepEqual(imported.environment, empty.environment);
  assert.deepEqual(imported.parts, empty.parts);
  await click('Edit scene');
  await click('My hill');
  const pendingBefore = (await sceneState()).preview;
  writeFileSync(
    `${out}/invalid.json`,
    JSON.stringify({
      ...imported,
      environment: { objects: [], ground: { friction: 99, restitution: 0 } },
    }),
  );
  const beforeInvalid = await page.evaluate(() => window.workshopProbe.readLastCommandResult());
  await uploadWorkshopFile(page, `${out}/invalid.json`);
  await page
    .getByText('The workshop could not open. Your current machine and scene are unchanged.', {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.workshopProbe.readLastCommandResult()),
    beforeInvalid,
    'invalid files are rejected before command admission',
  );
  assert.deepEqual((await read()).metadata.blueprint, imported);
  await page.keyboard.press('Escape');
  assert.deepEqual((await sceneState()).preview, pendingBefore);
  await click('Cancel preview');
  await click('Done');
  await page.evaluate((environment) => {
    localStorage.setItem(
      'simulacrum.scenes.v1',
      JSON.stringify({
        version: 1,
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `scene-${i}`,
          name: `Saved scene ${i + 1} with a long descriptive name`,
          scene: environment,
        })),
      }),
    );
  }, imported.environment);
  await click('Choose scene');
  await click('Saved scene 50 with a long descriptive name');
  await page.keyboard.press('Escape');
  await click('Edit scene');
  for (const zoom of [1, 1.25]) {
    await page.evaluate((value) => {
      document.documentElement.style.zoom = String(value);
    }, zoom);
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, 'scene layout stays within the zoomed viewport');
    await page.screenshot({ path: `${out}/scene-zoom-${zoom}.png` });
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.locator('canvas').first().focus();
  await page.keyboard.press('Escape');
  // Edit scene sits in the Tools menu; leaving the editor hands focus to that control.
  assert.equal(
    await page
      .locator('details.tools-menu > summary')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ok: true,
        build: await page.locator('[data-build-id]').textContent(),
        evidence: 'automated journey and rendered transforms; no target-player evidence',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
