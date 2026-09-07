import { createBrowserEvidence } from './browser-evidence.mjs';
import { chromium } from 'playwright';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
const browserEvidence = createBrowserEvidence();

const out = 'artifacts/surface-browser';
mkdirSync(out, { recursive: true });
const fixture = {
  ...createEmptyBlueprint('surface-test', 'Surface test'),
  parts: [
    createPart('chassis', 'base', [0, 0.35, 0]),
    createPart('poweredMotor', 'motor', [0.45, 0.35, 0]),
  ],
};
writeFileSync(`${out}/fixture.json`, JSON.stringify(fixture));
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(r.url()));
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.locator('[data-part-type=poweredMotor]').click();
  assert.equal(
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).count(),
    1,
    'selected motor must expose surface placement',
  );
  await page.locator('input[type=file]').setInputFiles(`${out}/fixture.json`);
  const read = () =>
    page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
  async function select(id) {
    if (!(await page.locator('.machine-picker').evaluate((e) => e.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list [data-part-id="${id}"]`).click();
  }
  await select('motor');
  const before = await read();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  assert.equal(await page.getByLabel('Mounting face').count(), 1);
  await page.locator('.surface-precise summary').click();
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'top']));
  await page.waitForFunction(() => document.querySelector('.surface-cue')?.textContent);
  assert.match(await page.locator('.surface-cue').innerText(), /Click Attach/);
  assert.doesNotMatch(await page.locator('.surface-confirmation').innerText(), /Release/);
  assert.deepEqual(await read(), before, 'preview must leave authored state unchanged');
  await page.getByLabel('Along surface (mm)').fill('500');
  assert.equal(
    await page.locator('[data-command=apply-surface]').isDisabled(),
    true,
    'overhanging pad refuses',
  );
  assert.match(
    await page.locator('.surface-placement [role=status]').innerText(),
    /extends beyond/,
  );
  assert.match(await page.locator('.surface-confirmation').innerText(), /Blocked · not placed/);
  await page.screenshot({ path: `${out}/blocked.png` });
  const blockedFooter = await page.locator('.surface-confirmation').boundingBox();
  const blockedAction = await page.locator('[data-command=apply-surface]').boundingBox();
  assert.ok(
    blockedAction.y >= blockedFooter.y &&
      blockedAction.y + blockedAction.height <= blockedFooter.y + blockedFooter.height,
    'blocked reason and action share one visible footer',
  );
  await select('base');
  assert.deepEqual(
    await read(),
    before,
    'leaving an invalid preview must not attach or move parts',
  );
  await select('motor');
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'top']));
  await page.getByRole('button', { name: 'Center on surface', exact: true }).click();
  const centered = await page.evaluate(
    () => window.workshopProbe.readInteractionState().surfacePlacement,
  );
  assert.equal(centered.u, 0);
  assert.equal(centered.v, 0);
  await page.getByRole('button', { name: 'Align to surface edge 1', exact: true }).click();
  const beforeKeyboard = await read();
  await page.getByRole('button', { name: 'Center on surface', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await read(), beforeKeyboard, 'Enter on an alignment button must not attach');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await read(), beforeKeyboard, 'focused marker arrows must only move preview');
  await page.keyboard.press('Space');
  assert.deepEqual(
    await read(),
    beforeKeyboard,
    'Space on a marker must not run or edit the machine',
  );
  assert.equal(
    (await page.evaluate(() => window.workshopProbe.readInteractionState().surfacePlacement)).u,
    0,
  );
  await page.getByRole('button', { name: 'Align to surface edge 1', exact: true }).click();
  const edgePreview = await page.evaluate(
    () => window.workshopProbe.readInteractionState().surfacePlacement,
  );
  assert.ok(
    edgePreview.valid && edgePreview.u < 0,
    'surface edge marker aligns a fitting footprint',
  );
  assert.deepEqual(await read(), before, 'alignment controls adjust only the labelled preview');
  if (!(await page.locator('.surface-precise').evaluate((e) => e.open)))
    await page.locator('.surface-precise summary').click();
  await page.getByLabel('Along surface (mm)').fill('50');
  assert.equal(await page.locator('[data-command=apply-surface]').isDisabled(), false);
  const previewUI = await page.evaluate(() => window.workshopProbe.readInteractionState()),
    camera = new THREE.PerspectiveCamera(previewUI.camera.fov, previewUI.camera.aspect, 0.01, 100);
  camera.position.fromArray(previewUI.camera.position);
  camera.lookAt(new THREE.Vector3(...previewUI.camera.target));
  camera.updateMatrixWorld();
  const previewPoint = new THREE.Vector3(
      ...previewUI.surfacePlacement.previewParts[0].position,
    ).project(camera),
    canvas = await page.locator('canvas[aria-label="Machine view"]').boundingBox(),
    px = canvas.x + (previewPoint.x * 0.5 + 0.5) * canvas.width,
    py = canvas.y + (-previewPoint.y * 0.5 + 0.5) * canvas.height;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 20, py, { steps: 6 });
  const draggedUI = await page.evaluate(() => window.workshopProbe.readInteractionState());
  assert.deepEqual(draggedUI.camera, previewUI.camera, 'dragging preview must not orbit camera');
  assert.notDeepEqual(
    [draggedUI.surfacePlacement.u, draggedUI.surfacePlacement.v],
    [previewUI.surfacePlacement.u, previewUI.surfacePlacement.v],
    'dragging preview slides on face',
  );
  await page.screenshot({ path: `${out}/preview.png` });
  await page.mouse.up();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.connections.length === 1,
  );
  assert.equal(
    (await read()).connections.length,
    1,
    'releasing a valid surface placement must attach',
  );
  const committed = await read();
  await select('base');
  assert.deepEqual(await read(), committed, 'clicking away must preserve completed attachment');
  await select('motor');
  const mounted = await read();
  assert.equal(mounted.connections.length, 1);
  assert.deepEqual(mounted.parts[0], before.parts[0]);
  assert.match(await page.locator('.mount-status').innerText(), /Bolted to Chassis · Top/);
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  if (!(await page.locator('.surface-precise').evaluate((e) => e.open)))
    await page.locator('.surface-precise summary').click();
  await page.getByLabel('Across surface (mm)').fill('50');
  await page.locator('[data-command=apply-surface]').click();
  const adjusted = await read();
  assert.notDeepEqual(adjusted.parts[1], mounted.parts[1]);
  assert.deepEqual(adjusted.parts[0], mounted.parts[0]);
  await page.locator('[data-command=undo]').click();
  assert.deepEqual(await read(), mounted);
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  if (!(await page.locator('.surface-precise').evaluate((e) => e.open)))
    await page.locator('.surface-precise summary').click();
  await page.getByLabel('Across surface (mm)').fill('40');
  await page.keyboard.press('Escape');
  assert.deepEqual(await read(), mounted);
  await page.getByRole('button', { name: 'Detach', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'bottom']));
  await page.locator('[data-command=apply-surface]').click();
  const underside = await read();
  assert.ok(underside.parts[1].position[1] < underside.parts[0].position[1]);
  assert.equal(underside.connections[0].a.surface.region, 'bottom');
  await page.screenshot({ path: `${out}/underside.png` });
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  const observation = await page.evaluate(() => window.workshopProbe.observe().frames[0]);
  for (const [i, p] of observation.metadata.blueprint.parts.entries()) {
    assert.deepEqual(rendered.find((r) => r.id === p.id).position, observation.physics[i].position);
  }
  await page.getByRole('button', { name: 'Detach', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'top']));
  await page.getByLabel('Placement result').selectOption('position');
  await page.locator('[data-command=apply-surface]').click();
  assert.equal((await read()).connections.length, 0);
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  assert.equal(
    await page.getByLabel('Placement result').inputValue(),
    'attach',
    'new operations default to attachment',
  );
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'top']));
  const beforeOutside = await read();
  const pending = await page.evaluate(() => window.workshopProbe.readInteractionState());
  camera.position.fromArray(pending.camera.position);
  camera.lookAt(new THREE.Vector3(...pending.camera.target));
  camera.updateMatrixWorld();
  const outsideStart = new THREE.Vector3(
    ...pending.surfacePlacement.previewParts[0].position,
  ).project(camera);
  await page.mouse.move(
    canvas.x + ((outsideStart.x + 1) * canvas.width) / 2,
    canvas.y + ((1 - outsideStart.y) * canvas.height) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(canvas.x - 20, canvas.y + canvas.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(
    await read(),
    beforeOutside,
    'release outside the canvas cancels without a joint',
  );
  assert.equal(
    await page.evaluate(() => window.workshopProbe.readInteractionState().surfacePlacement),
    null,
  );
  await page.locator('input[type=file]').setInputFiles(`${out}/fixture.json`);
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(window.workshopProbe.observe().frames[0].metadata.blueprint) === expected,
    JSON.stringify(fixture),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const dragUI = await page.evaluate(() => window.workshopProbe.readInteractionState());
  const dragCamera = new THREE.PerspectiveCamera(
    dragUI.camera.fov,
    dragUI.camera.aspect,
    0.01,
    100,
  );
  dragCamera.position.fromArray(dragUI.camera.position);
  dragCamera.lookAt(new THREE.Vector3(...dragUI.camera.target));
  dragCamera.updateMatrixWorld();
  const dragCanvas = await page.locator('canvas').first().boundingBox();
  function dragScreen(position) {
    const p = new THREE.Vector3(...position).project(dragCamera);
    return [
      dragCanvas.x + ((p.x + 1) * dragCanvas.width) / 2,
      dragCanvas.y + ((1 - p.y) * dragCanvas.height) / 2,
    ];
  }
  await page.mouse.move(...dragScreen(fixture.parts[1].position));
  await page.mouse.down();
  await page.mouse.move(
    dragCanvas.x + dragCanvas.width - 30,
    dragCanvas.y + dragCanvas.height - 30,
    { steps: 4 },
  );
  assert.equal(
    await page.locator('.placement-cue').isVisible(),
    true,
    'free drag offers release hint',
  );
  await page.mouse.move(...dragScreen([0, 0.4, 0]), { steps: 1 });
  await page.mouse.up();
  assert.equal(
    await page.locator('.placement-cue').isVisible(),
    false,
    'surface release clears free-drag hint',
  );
  const fullTurnFixture = {
    ...createEmptyBlueprint('full-turn', 'Full turn'),
    parts: [
      createPart('chassis', 'base', [0, 0.35, 0]),
      createPart('chassis', 'moving', [1, 0.35, 0]),
    ],
  };
  writeFileSync(`${out}/full-turn.json`, JSON.stringify(fullTurnFixture));
  await page.locator('input[type=file]').setInputFiles(`${out}/full-turn.json`);
  await select('moving');
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.getByLabel('Mounting face').selectOption('left');
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['base', 'right']));
  const markers = page.locator('.surface-anchor:visible');
  await markers.first().waitFor();
  const markerCount = await markers.count();
  assert.ok(markerCount > 0, 'exact-fit face initially offers alignment controls');
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Rotate on surface +90°', exact: true }).click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await markers.count(), markerCount, 'four quarter turns restore alignment controls');
  assert.deepEqual(await read(), fullTurnFixture, 'full-turn preview does not author a joint');
  await page.screenshot({ path: `${out}/full-turn.png` });
  await page.locator('input[type=file]').setInputFiles(`${out}/fixture.json`);
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.id === 'surface-test',
  );
  await page.getByLabel('Surface snap', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.waitForTimeout(300);
  const beforeBlockedDrag = await read();
  const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  const box = await page.locator('canvas').first().boundingBox();
  const pixel = (id) => {
    const p = centers.find((p) => p.id === id);
    return { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 };
  };
  const start = pixel('motor'),
    end = pixel('base');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  assert.match(await page.locator('.placement-cue').innerText(), /overlaps/);
  await page.screenshot({ path: `${out}/free-overlap-preview.png` });
  await page.mouse.up();
  assert.deepEqual(await read(), beforeBlockedDrag, 'blocked free drag preserves authored machine');
  assert.match(await page.locator('body').innerText(), /nothing was changed/);
  await page.screenshot({ path: `${out}/free-overlap-restored.png` });
  assert.deepEqual(errors, []);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        checks: [
          'surface control',
          'read-only preview',
          'invalid overhang',
          'top attachment',
          'adjust and undo',
          'cancel',
          'underside attachment',
          'render agrees with physics',
          'place without attachment',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('surface browser passed');
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
