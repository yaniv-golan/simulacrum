import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;
const frame = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);

mkdirSync(browserArtifactPath('artifacts/direct-edit'), { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  browserEvidence.assert('equal', [
    await page.locator('.parts-panel .part-icon').count(),
    await page.locator('[data-part-type]').count(),
    'every palette part needs a picture',
  ]);
  // Catalog thumbnails publish asynchronously; wait for actual decoded images.
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.parts-panel .part-icon')];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  browserEvidence.assert('ok', [
    await page
      .locator('.parts-panel .part-icon')
      .evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)),
  ]);
  await browserEvidence.dragFrom(page, page.locator('[data-part-type=poweredMotor]'), async () => {
    const canvas = await page.locator('canvas').first().boundingBox();
    return { x: canvas.x + canvas.width * 0.5, y: canvas.y + canvas.height * 0.65 };
  });
  const canvas = await page.locator('canvas').first().boundingBox();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 1,
  );
  const original = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('equal', [original.type, 'poweredMotor']);
  browserEvidence.assert('equal', [original.position[1], 0.06]);
  await page.screenshot({ path: browserArtifactPath('artifacts/direct-edit/dragged.png') });
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
  await page.screenshot({ path: browserArtifactPath('artifacts/direct-edit/move-preview.png') });
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
  // Arrows move on the floor; Shift with the up arrow lifts by the same step,
  // and the visible canvas hint says so.
  browserEvidence.assert('ok', [Math.abs(moved.position[1] - original.position[1]) < 1e-9]);
  browserEvidence.assert('match', [
    await page.locator('.canvas-hint').textContent(),
    /Shift\+↑↓ raises and lowers/,
  ]);
  await page.keyboard.press('Shift+ArrowUp');
  const lifted = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('ok', [Math.abs(lifted.position[1] - moved.position[1] - 0.025) < 1e-9]);
  browserEvidence.assert('ok', [
    Math.abs(lifted.position[0] - moved.position[0]) < 1e-9 &&
      Math.abs(lifted.position[2] - moved.position[2]) < 1e-9,
  ]);
  await page.keyboard.press('Shift+ArrowDown');
  // Lowering returns to the same height up to float residue (0.06 + 0.025 − 0.025).
  const lowered = (await frame()).metadata.blueprint.parts[0];
  browserEvidence.assert('ok', [
    lowered.position.every((v, i) => Math.abs(v - moved.position[i]) < 1e-9),
  ]);
  await page.keyboard.press('Alt+ArrowUp');
  const rotated = (await frame()).metadata.blueprint.parts[0];
  // Rotation copies the position verbatim: bit-exact against the lowered pose.
  browserEvidence.assert('deepEqual', [rotated.position, lowered.position]);
  browserEvidence.assert('ok', [Math.abs(Math.abs(rotated.rotation[3]) - Math.SQRT1_2) < 1e-9]);
  const cameraBefore = await page.evaluate(
    () => window.workshopProbe.readInteractionState().camera,
  );
  await page.keyboard.press('c');
  let bp = (await frame()).metadata.blueprint;
  browserEvidence.assert('equal', [bp.parts.length, 2]);
  browserEvidence.assert('equal', [bp.connections.length, 0]);
  browserEvidence.assert('equal', [bp.parts[1].type, rotated.type]);
  browserEvidence.assert('deepEqual', [bp.parts[1].rotation, rotated.rotation]);
  // The copy lands beside the original along one floor axis, one extent plus
  // 25 mm away on the 25 mm grid -- never a metre off, never diagonal.
  const offset = bp.parts[1].position.map((v, i) => v - rotated.position[i]);
  browserEvidence.assert('ok', [Math.abs(offset[1]) < 1e-9]);
  browserEvidence.assert('ok', [Math.min(Math.abs(offset[0]), Math.abs(offset[2])) < 1e-9]);
  const copyDistance = Math.hypot(...offset);
  browserEvidence.assert('ok', [copyDistance > 0.05 && copyDistance < 0.5]);
  browserEvidence.assert('ok', [
    Math.abs(copyDistance / 0.025 - Math.round(copyDistance / 0.025)) < 1e-6,
  ]);
  // The view moves only when the copy fell outside the visible canvas, and the
  // message says which happened: a copy in view leaves the camera untouched; a
  // framed copy moves it so both parts render inside the viewport.
  const cameraAfter = await page.evaluate(() => window.workshopProbe.readInteractionState().camera);
  const copyMessage = await page.locator('.status-message').innerText();
  browserEvidence.assert('match', [
    copyMessage,
    /^Copied (beside it|toward the camera and framed)/,
  ]);
  if (/framed/.test(copyMessage)) {
    browserEvidence.assert('notDeepEqual', [cameraAfter.position, cameraBefore.position]);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
    browserEvidence.assert('equal', [centers.length, 2]);
    browserEvidence.assert('ok', [
      centers.every((c) => Math.abs(c.x) < 1 && Math.abs(c.y) < 1 && c.z > -1 && c.z < 1),
    ]);
  } else {
    browserEvidence.assert('deepEqual', [cameraAfter.position, cameraBefore.position]);
    browserEvidence.assert('deepEqual', [cameraAfter.target, cameraBefore.target]);
  }
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
  await page.locator('.part-settings > summary').click();
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
  await page.locator('[data-command=run]').click();
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
    browserArtifactPath('artifacts/direct-edit/result.json'),
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
