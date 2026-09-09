import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;
const frame = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);

mkdirSync('artifacts/direct-edit', { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  browserEvidence.assert('equal', [
    await page.locator('.parts-panel .part-icon').count(),
    await page.locator('[data-part-type]').count(),
    'every palette part needs a picture',
  ]);
  browserEvidence.assert('ok', [
    await page
      .locator('.parts-panel .part-icon')
      .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)),
  ]);
  await page.locator('[data-part-type=poweredMotor]').scrollIntoViewIfNeeded();
  const card = await page.locator('[data-part-type=poweredMotor]').boundingBox(),
    canvas = await page.locator('canvas').first().boundingBox();
  const x = canvas.x + canvas.width * 0.5,
    y = canvas.y + canvas.height * 0.65;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 1,
  );
  const original = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('equal', [original.type, 'poweredMotor']);
  browserEvidence.assert('equal', [original.position[1], 0.06]);
  await page.screenshot({ path: 'artifacts/direct-edit/dragged.png' });
  const center = await page.evaluate(() => window.workshopProbe.readRenderedCenters()[0]);
  const px = canvas.x + (center.x * 0.5 + 0.5) * canvas.width,
    py = canvas.y + (-center.y * 0.5 + 0.5) * canvas.height;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 90, py - 20, { steps: 12 });
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint.parts[0].position,
    original.position,
    'drag preview cannot write physical pose',
  ]);
  await page.screenshot({ path: 'artifacts/direct-edit/move-preview.png' });
  await page.mouse.up();
  browserEvidence.assert('notDeepEqual', [
    (await frame()).metadata.blueprint.parts[0].position,
    original.position,
    'dragging body moves part',
  ]);
  await page.keyboard.press('ControlOrMeta+z');
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint.parts[0].position,
    original.position,
  ]);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 60, py + 10, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint.parts[0].position,
    original.position,
    'Escape cancels drag',
  ]);
  browserEvidence.assert(
    'match',
    [await page.locator('.workshop-footer').textContent(), /cancelled/],
    { expectation: 'Cancelled drag replaces its stale movement instructions' },
  );
  // An edit accepted while the pointer is held must survive drag release.
  await page.getByRole('checkbox', { name: 'Surface snap', exact: true }).uncheck();
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 60, py + 10, { steps: 8 });
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForFunction(
    () =>
      Math.abs(window.workshopProbe.observe().frames[0].metadata.blueprint.parts[0].rotation[3]) <
      0.99,
  );
  const editedDuringDrag = (await frame()).metadata.blueprint;
  await page.mouse.up();
  browserEvidence.assert('deepEqual', [(await frame()).metadata.blueprint, editedDuringDrag], {
    expectation: 'Releasing a stale drag preserves an intervening keyboard edit',
  });
  await page.keyboard.press('ControlOrMeta+z');
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item').first().click();

  await page.keyboard.press('e');
  browserEvidence.assert('equal', [
    await page.locator('[data-edit-tool=rotate]').getAttribute('aria-pressed'),
    'true',
  ]);
  browserEvidence.assert('match', [
    await page.locator('.canvas-hint').textContent(),
    /Drag rings to rotate/,
  ]);
  await page.keyboard.press('v');
  browserEvidence.assert('equal', [
    await page.locator('[data-edit-tool=select]').getAttribute('aria-pressed'),
    'true',
  ]);
  await page.keyboard.press('ArrowRight');
  const moved = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('ok', [
    Math.abs(Math.hypot(...moved.position.map((v, i) => v - original.position[i])) - 0.025) < 1e-9,
  ]);
  await page.keyboard.press('Alt+ArrowUp');
  const rotated = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('deepEqual', [rotated.position, moved.position]);
  browserEvidence.assert('ok', [Math.abs(Math.abs(rotated.rotation[3]) - Math.SQRT1_2) < 1e-9]);
  await page.keyboard.press('c');
  let bp = (await frame()).metadata.blueprint;
  browserEvidence.assert('equal', [bp.parts.length, 2]);
  browserEvidence.assert('equal', [bp.connections.length, 0]);
  browserEvidence.assert('equal', [bp.parts[1].type, rotated.type]);
  browserEvidence.assert('deepEqual', [bp.parts[1].rotation, rotated.rotation]);
  browserEvidence.assert('ok', [
    Math.abs(Math.hypot(...bp.parts[1].position.map((v, i) => v - rotated.position[i])) - 1) < 1e-9,
  ]);
  await page.keyboard.press('Delete');
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.parts.length, 1]);
  await page.keyboard.press('ControlOrMeta+z');
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.parts.length, 2]);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item').first().click();
  await page.keyboard.press('ControlOrMeta+c');
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.parts.length, 3]);
  await page.keyboard.press('x');
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.parts.length, 2]);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item').first().click();
  await page.locator('.part-settings summary').click();
  const input = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
  await input.focus();
  const before = (await frame()).metadata.blueprint;
  await page.keyboard.press('ArrowDown');
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint.parts.map((p) => [p.id, p.position, p.rotation]),
    before.parts.map((p) => [p.id, p.position, p.rotation]),
    'input arrows must not transform parts',
  ]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  const running = (await frame()).metadata.blueprint;
  await page.keyboard.press('c');
  await page.keyboard.press('Delete');
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint,
    running,
    'build shortcuts cannot edit during run',
  ]);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/direct-edit/result.json',
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        original,
        moved,
        rotated,
        checks: [
          'rendered catalog icons',
          'real drag placement',
          'camera-plane arrow motion',
          'Alt rotation without translation',
          'duplicate preserving properties',
          'delete and undo',
          'input focus guard',
          'run mode guard',
        ],
      },
      null,
      2,
    ),
  );
  console.log('direct manipulation browser passed');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
