import { placeCatalogPart, browseAllParts } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { settledWindow } from './browser-idle.mjs';
const browserEvidence = createBrowserEvidence();

import { mkdirSync, writeFileSync } from 'node:fs';
import { appFingerprint } from './app-fingerprint.mjs';
import { sourceIdentity } from './source-identity.mjs';

const out = browserArtifactPath('artifacts/ui-lifecycle');
mkdirSync(out, { recursive: true });
const source = sourceIdentity(),
  expectedBuild = appFingerprint(),
  browser = await browserEvidence.launch({ profile: 'ui', ...{} });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = browserEvidence.errors;

page.setDefaultTimeout(10000);
const idleChecks = [];
const read = () =>
  page.evaluate(() => ({
    blueprint: window.workshopProbe.observe().frames[0].metadata.blueprint,
    ui: window.workshopProbe.readInteractionState(),
  }));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const build = await page.locator('meta[name=build-id]').getAttribute('content');
  browserEvidence.assert('equal', [
    build,
    expectedBuild,
    'served build must equal the current app fingerprint',
  ]);
  browserEvidence.assert('deepEqual', [
    await page.evaluate(() => {
      const toolbar = document.querySelector('.playtest-panel').getBoundingClientRect();
      const intersects = (element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          Math.min(rect.right, toolbar.right) > Math.max(rect.left, toolbar.left) &&
          Math.min(rect.bottom, toolbar.bottom) > Math.max(rect.top, toolbar.top)
        );
      };
      return [...document.querySelectorAll('.viewport canvas, .inspector-panel')]
        .filter(intersects)
        .map((element) => element.className || element.tagName);
    }),
    [],
    'feedback toolbar leaves canvas and inspector pointer regions unobstructed',
  ]);
  await browseAllParts(page);
  await placeCatalogPart(page, 'chassis');
  const canvas = page.locator('canvas').first(),
    box = await canvas.boundingBox();
  const center = await page.evaluate(() => window.workshopProbe.readRenderedCenters()[0]);
  const x = box.x + (center.x * 0.5 + 0.5) * box.width,
    y = box.y + (-center.y * 0.5 + 0.5) * box.height;
  async function startDrag(type) {
    await page.locator(`[data-part-type=${type}]`).scrollIntoViewIfNeeded();
    const card = await page.locator(`[data-part-type=${type}]`).boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 20 });
  }
  await startDrag('poweredMotor');
  browserEvidence.assert('ok', [(await read()).ui.surfacePlacement]);
  await page.mouse.move(20, 850, { steps: 10 });
  await page.mouse.up();
  browserEvidence.assert('equal', [
    (await read()).ui.surfacePlacement,
    null,
    'outside cancellation releases the palette candidate',
  ]);
  await startDrag('powerCell');
  await page.mouse.up();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 2,
  );
  const placed = await read();
  browserEvidence.assert('equal', [
    placed.blueprint.parts[1].type,
    'powerCell',
    'new drag inserts the newly requested part',
  ]);
  // Positive completion above; Escape must also leave no palette candidate.
  await startDrag('poweredMotor');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  browserEvidence.assert('equal', [(await read()).ui.surfacePlacement, null]);
  browserEvidence.assert('equal', [(await read()).blueprint.parts.length, 2]);
  // Explicit surface placement uses a different pointer path than direct body dragging.
  await placeCatalogPart(page, 'poweredMotor');
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  const frameBefore = await read();
  const base = frameBefore.blueprint.parts.find((p) => p.type === 'chassis');
  await page.getByLabel('Mounting face', { exact: true }).selectOption({ label: 'Left' });
  await page
    .getByLabel('Target surface', { exact: true })
    .selectOption(JSON.stringify([base.id, 'right']));
  const markers = page.locator('.surface-anchor:visible');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.surface-anchor')].filter((e) => !e.hidden).length === 5,
  );
  const markerBoxes = await markers.evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  for (let i = 0; i < markerBoxes.length; i++)
    for (let j = 0; j < i; j++) {
      const a = markerBoxes[i],
        b = markerBoxes[j];
      browserEvidence.assert('ok', [
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        'alignment markers must not intercept one another',
      ]);
    }
  await page.getByRole('button', { name: 'Align to surface edge 1', exact: true }).click();
  await page.getByRole('button', { name: 'Align to surface edge 2', exact: true }).click();
  await page.screenshot({ path: `${out}/separated-markers.png` });
  await page.getByLabel('Mounting face', { exact: true }).selectOption({ label: 'Bottom' });
  await page
    .getByLabel('Target surface', { exact: true })
    .selectOption(JSON.stringify([base.id, 'top']));
  const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  const baseCenter = centers.find((p) => p.id === base.id),
    currentBox = await canvas.boundingBox();
  const bx = currentBox.x + (baseCenter.x * 0.5 + 0.5) * currentBox.width,
    by = currentBox.y + (-baseCenter.y * 0.5 + 0.5) * currentBox.height;
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0 });
  await page.mouse.up();
  browserEvidence.assert('equal', [
    (await read()).ui.surfacePlacement,
    null,
    'pointercancel cancels explicit placement',
  ]);
  browserEvidence.assert('deepEqual', [
    (await read()).blueprint,
    frameBefore.blueprint,
    'cancelled pointer cannot commit a mount',
  ]);
  const cameraBefore = (await read()).ui.camera.position;
  await page.mouse.move(
    currentBox.x + currentBox.width - 65,
    currentBox.y + currentBox.height - 65,
  );
  await page.mouse.down();
  await page.mouse.move(
    currentBox.x + currentBox.width - 150,
    currentBox.y + currentBox.height - 100,
    { steps: 12 },
  );
  await page.mouse.up();
  browserEvidence.assert('notDeepEqual', [
    (await read()).ui.camera.position,
    cameraBefore,
    'orbit resumes after surface cancellation',
  ]);
  // Count actual main-scene GPU submissions, not RAF callbacks or simulation ticks.
  const frames = () =>
    page.evaluate(() => window.workshopProbe.readInteractionState().rendering.frames);
  async function idle() {
    // OrbitControls damping still changes the camera after pointerup.
    await page.evaluate(() => {
      window.__idleRenderProbe = null;
    });
    await page.waitForFunction(
      () => {
        const state = window.workshopProbe.readInteractionState(),
          frames = state.rendering.frames,
          camera = [
            ...state.camera.position,
            ...state.camera.target,
            state.camera.fov,
            state.camera.aspect,
          ],
          now = performance.now();
        // A pause between GPU submissions is not camera quiescence: damping can
        // accumulate sub-threshold movement and trigger another frame later.
        // Require the observed camera itself to stay stable to sub-pixel precision.
        const previous = window.__idleRenderProbe;
        if (
          !previous ||
          previous.frames !== frames ||
          camera.some((value, i) => Math.abs(value - previous.camera[i]) > 1e-9)
        )
          window.__idleRenderProbe = { frames, camera, since: now };
        return now - window.__idleRenderProbe.since >= 350;
      },
      null,
      { timeout: browserEvidence.waitBudget(15000) },
    );
    const before = await frames();
    // Prove the renderer was alive while it submitted nothing; a starved window is refused.
    const settled = await settledWindow(page, 350);
    browserEvidence.assert('equal', [
      await frames(),
      before,
      'settled build mode does not submit duplicate GPU frames',
    ]);
    idleChecks.push({ before, after: await frames(), loopTicks: settled.observed });
  }
  async function draws(action) {
    const before = await frames();
    await action();
    await page.waitForFunction(
      (before) => window.workshopProbe.readInteractionState().rendering.frames > before,
      before,
    );
  }
  await idle();
  const idlePixels = await canvas.screenshot({ path: `${out}/idle-before.png` });
  await settledWindow(page, 350);
  browserEvidence.assert('deepEqual', [
    await canvas.screenshot({ path: `${out}/idle-after.png` }),
    idlePixels,
    'idle canvas pixels are preserved exactly',
  ]);
  await draws(async () => {
    await page.mouse.move(
      currentBox.x + currentBox.width - 65,
      currentBox.y + currentBox.height - 65,
    );
    await page.mouse.down();
    await page.mouse.move(
      currentBox.x + currentBox.width - 120,
      currentBox.y + currentBox.height - 100,
      { steps: 8 },
    );
    await page.mouse.up();
  });
  await idle();
  const parts = (await read()).blueprint.parts;
  const motor = parts.find((part) => part.type === 'poweredMotor');
  await draws(async () => {
    if (!(await page.locator('.machine-picker').evaluate((element) => element.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list [data-part-id="${motor.id}"]`).click();
  });
  await idle();
  const beforePreview = (await read()).blueprint;
  await draws(async () => {
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
    await page
      .getByLabel('Target surface', { exact: true })
      .selectOption(JSON.stringify([base.id, 'top']));
  });
  browserEvidence.assert('ok', [(await read()).ui.surfacePlacement.previewParts.length]);
  browserEvidence.assert('deepEqual', [
    (await read()).blueprint,
    beforePreview,
    'rendered preview remains read only',
  ]);
  await draws(() => page.keyboard.press('Escape'));
  await idle();
  await draws(() => page.locator('[data-command=run]').click());
  await page.waitForFunction(() => window.workshopProbe.observe().frames[0].tick >= 2);
  await page.locator('[data-command=pause]').click();
  await idle();
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assert('deepEqual', [sourceIdentity(), source, 'verification source unchanged']);
  browserEvidence.assert('equal', [
    appFingerprint(),
    expectedBuild,
    'app source unchanged during browser run',
  ]);
  await page.screenshot({ path: `${out}/complete.png` });
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        source,
        build,
        errors,
        idleChecks,
        checks: [
          'outside drag cancellation',
          'different candidate after cancellation',
          'successful drop',
          'Escape cancellation',
          'explicit surface pointercancel',
          'orbit recovery',
          'idle GPU submissions stop',
          'camera selection and surface changes invalidate',
          'run resumes rendering and pause settles',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS UI drag lifecycle, orbit recovery and demand rendering');
} catch (error) {
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: `${out}/failure.png` });
  writeFileSync(`${out}/failure-state.json`, JSON.stringify(await read(), null, 2));
  throw error;
} finally {
  await browser.close();
}
