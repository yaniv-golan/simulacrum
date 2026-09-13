import { placeCatalogPart, browseAllParts } from './catalog-browser-actions.mjs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { SPRING_PERFORMANCE, springQuantile } from './measure-springs.mjs';
import { createDrivingMachine } from '../src/model/fixtures/driving-machine.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/camera-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({
  profile: 'ui',
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(8000);
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);
const state = () => page.evaluate(() => window.workshopProbe.readInteractionState());
async function select(name) {
  const picker = page.locator('.machine-picker');
  if (!(await picker.evaluate((n) => n.open))) await picker.locator('summary').click();
  await picker.getByRole('button', { name, exact: true }).click();
}
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.workshopProbe);
  // Compile the exact candidate modules for injection; preview serves built assets, not /src.
  const opticalBundle = await build({
    entryPoints: [fileURLToPath(new URL('./camera-optical-probe.mjs', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'cameraOpticalVerification',
    minify: true,
  });
  await page.addScriptTag({ content: opticalBundle.outputFiles[0].text });
  const memorySession = await page.context().newCDPSession(page);
  await memorySession.send('Performance.enable');
  await memorySession.send('HeapProfiler.collectGarbage');
  const heapBefore = (await memorySession.send('Performance.getMetrics')).metrics.find(
    (m) => m.name === 'JSHeapUsedSize',
  ).value;
  const opticalEvidence = await page.evaluate(() => cameraOpticalVerification.cameraOpticalProbe());
  await memorySession.send('HeapProfiler.collectGarbage');
  const heapAfter = (await memorySession.send('Performance.getMetrics')).metrics.find(
    (m) => m.name === 'JSHeapUsedSize',
  ).value;
  opticalEvidence.heap = {
    before: heapBefore,
    after: heapAfter,
    delta: heapAfter - heapBefore,
    limit: 8 * 1024 * 1024,
  };
  assert.ok(
    heapAfter - heapBefore < opticalEvidence.heap.limit,
    'bounded retained heap after capture/disposal',
  );
  for (const [field, limit] of [
    ['rasterMs', 6],
    ['copyMs', 6],
    ['completionMs', 100],
  ])
    assert.ok(
      springQuantile(opticalEvidence.timings.map((t) => t[field])) <= limit,
      `${field} exceeds ${limit} ms`,
    );
  writeFileSync(`${out}/optical-resources.json`, JSON.stringify(opticalEvidence, null, 2));
  const path = `${out}/rover.json`;
  writeFileSync(path, JSON.stringify(createDrivingMachine()));
  await evidence.loadAndWait(page, path);
  await placeCatalogPart(page, 'camera');
  const cameraId = (await read()).metadata.blueprint.parts.find((p) => p.type === 'camera').id;
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mounting face', exact: true }).selectOption('front');
  await page
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption(JSON.stringify(['frame', 'back']));
  await page.locator('[data-command=apply-surface]').click();
  await page.locator('.port-button[data-port-id=power]').click();
  await page.getByRole('button', { name: /Wire Shared cell · power/ }).click();
  const authored = (await read()).metadata.blueprint;
  assert.equal(
    authored.connections.some((c) => c.kind === 'fixed' && [c.a.part, c.b.part].includes(cameraId)),
    true,
  );
  await page.getByRole('button', { name: 'Show viewing cone (1 m)', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraFrustum.visible,
  );
  await page.screenshot({ path: `${out}/viewing-cone.png` });
  await page.getByRole('button', { name: 'View through camera', exact: true }).click();
  const beforePreview = (await read()).metadata.blueprint;
  await browseAllParts(page);
  await page.locator('[data-part-type="powerCell"]').click();
  assert.equal(
    (await state()).cameraPhoto.active,
    null,
    'catalog placement must recover the visible workshop scene',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Place part', exact: true }).isVisible(),
    true,
  );
  await page.screenshot({ path: `${out}/placement-recovery.png` });
  await page.getByRole('button', { name: 'Cancel placement', exact: true }).click();
  assert.deepEqual(
    (await read()).metadata.blueprint,
    beforePreview,
    'cancelled preview must not author a part',
  );
  await select('Camera');
  await page.getByRole('button', { name: 'View through camera', exact: true }).click();
  const orbit = (await state()).camera;
  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.render?.tick > 12,
  );
  const occluded = await page.locator('.machine-camera-image canvas').evaluate((c) => {
    const x = document.createElement('canvas');
    x.width = 320;
    x.height = 240;
    x.getContext('2d').drawImage(c, 0, 0);
    const d = x.getContext('2d').getImageData(0, 0, 320, 240).data;
    return (
      Array.from(
        { length: 76800 },
        (_, i) => d[i * 4] === 184 && d[i * 4 + 1] === 206 && d[i * 4 + 2] === 220,
      ).filter(Boolean).length / 76800
    );
  });
  assert.ok(occluded < 0.05, `own chassis blocks the sky: ${occluded} sky fraction`);
  await page.screenshot({ path: `${out}/occluded.png` });
  await page.keyboard.down('w');
  await page.waitForFunction(() =>
    window.workshopProbe.observe().frames[0].power.sources.some((s) => Math.abs(s.duty) > 0),
  );
  await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Return to workshop view', exact: true }).click();
  assert.deepEqual((await state()).camera.position, orbit.position);
  await page.getByRole('button', { name: '↶ Build', exact: true }).click();
  await select('Camera');
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mounting face', exact: true }).selectOption('bottom');
  await page
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption(JSON.stringify(['frame', 'top']));
  await page
    .getByRole('region', { name: 'Mounting', exact: true })
    .getByText('Precise position', { exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Across surface (mm)', exact: true }).fill('180');
  await page.getByRole('spinbutton', { name: 'Across surface (mm)', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: 'Turn (degrees)', exact: true }).fill('180');
  await page.getByRole('spinbutton', { name: 'Turn (degrees)', exact: true }).press('Tab');
  await page.locator('[data-command=apply-surface]').click();
  await page.getByRole('button', { name: 'View through camera', exact: true }).click();
  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.render?.tick > 12,
  );
  const repairedSky = await page.locator('.machine-camera-image canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, 320, 240).data;
    return (
      Array.from(
        { length: 76800 },
        (_, i) => d[i * 4] === 184 && d[i * 4 + 1] === 206 && d[i * 4 + 2] === 220,
      ).filter(Boolean).length / 76800
    );
  });
  assert.ok(repairedSky > 0.2, `reoriented lens has a clear sky view: ${repairedSky}`);
  await page.screenshot({ path: `${out}/repaired.png` });
  const optics = (await state()).cameraPhoto.render;
  const [qx, qy, qz, qw] = optics.body.rotation;
  const forward = [2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy)];
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(
      Math.abs(optics.cameraForward[axis] - forward[axis]) < 1e-9,
      'rendered forward equals independent physical quaternion column',
    );
    assert.ok(
      Math.abs(
        optics.cameraPosition[axis] - (optics.body.position[axis] + forward[axis] * 0.020001),
      ) < 1e-9,
      'rendered lens origin follows completed body',
    );
  }
  const renderCosts = await page.evaluate(async () => {
    const samples = [];
    window.__cameraCadence = [];
    let last = -1;
    while (samples.length < 90) {
      await new Promise((r) => setTimeout(r, 20));
      const row = window.workshopProbe.readInteractionState().cameraPhoto.render;
      if (row.tick !== last) {
        last = row.tick;
        samples.push(row.submissionMs);
        window.__cameraCadence.push({
          tick: row.tick,
          timeMs: performance.now(),
          ageTicks: window.workshopProbe.observe().frames[0].tick - row.tick,
        });
      }
    }
    return samples;
  });
  assert.ok(
    springQuantile(renderCosts) <= SPRING_PERFORMANCE.renderP95Ms,
    'camera render CPU respects existing 6 ms budget',
  );

  const cadence = await page.evaluate(() => window.__cameraCadence);
  assert.ok(
    cadence.every((row) => row.tick % 12 === 0 && row.ageTicks >= 0 && row.ageTicks < 12),
    '10 Hz completed sampling and bounded live-frame age',
  );
  writeFileSync(
    `${out}/cadence.json`,
    JSON.stringify(
      { samples: cadence, simulatedPeriodTicks: 12, profile: 'unpaused local browser run' },
      null,
      2,
    ),
  );

  // Delay only callback delivery, retaining the exact rasterized bytes before the display advances.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    window.__cameraEncodes = [];
    HTMLCanvasElement.prototype.toBlob = function (cb, ...args) {
      const ctx = this.getContext('2d');
      if (this.width === 320 && this.height === 240 && ctx)
        window.__cameraEncodes.push({
          pixels: Array.from(ctx.getImageData(0, 0, 320, 240).data),
          render: window.workshopProbe.readInteractionState().cameraPhoto.render,
        });
      return original.call(this, (blob) => setTimeout(() => cb(blob), 150), ...args);
    };
  });
  await page
    .locator('.machine-camera-bar')
    .getByRole('button', { name: 'Take photo', exact: true })
    .click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.gallery.photos.length === 1,
  );
  const photographed = (await state()).cameraPhoto.gallery.photos[0];
  assert.equal(photographed.metadata.captureTick % 12, 0);
  const pixels = await page.evaluate(async () => {
    const s = window.workshopProbe.readInteractionState().cameraPhoto;
    const img = new Image();
    img.src = s.gallery.photos[0].url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    c.getContext('2d').drawImage(img, 0, 0);
    return {
      same: Array.from(c.getContext('2d').getImageData(0, 0, 320, 240).data).every(
        (v, i) => v === window.__cameraEncodes[0].pixels[i],
      ),
      tick: window.__cameraEncodes[0].render.tick,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  });
  assert.equal(pixels.same, true);
  assert.equal(pixels.tick, photographed.metadata.captureTick);
  assert.equal(pixels.width, 320);
  assert.equal(pixels.height, 240);
  await page
    .locator('.machine-camera-bar')
    .getByRole('button', { name: 'Photos', exact: true })
    .click();
  assert.equal(await page.getByRole('combobox', { name: 'Choose a photo' }).inputValue(), '0');
  assert.deepEqual(
    photographed.metadata.sourceIdentity,
    await page.evaluate(() => ({
      head: document.querySelector('meta[name=source-head]').content,
      workingTreeDigest: document.querySelector('meta[name=source-digest]').content,
    })),
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save photo', exact: true }).click();
  await (await download).saveAs(`${out}/photo.png`);
  await page.screenshot({ path: `${out}/gallery.png` });
  await page.getByRole('button', { name: 'Close photos', exact: true }).click();
  await page.setViewportSize({ width: 760, height: 720 });
  await page.screenshot({ path: `${out}/narrow.png` });
  assert.equal(
    await page.getByRole('button', { name: 'Return to workshop view', exact: true }).isVisible(),
    true,
  );
  await page.getByRole('button', { name: 'Return to workshop view', exact: true }).click();
  await page.getByRole('button', { name: '↶ Build', exact: true }).click();
  assert.equal((await state()).cameraPhoto.gallery.photos.length, 1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await placeCatalogPart(page, 'commandReceiver');
  await placeCatalogPart(page, 'logicController');
  await page.locator('.port-button[data-port-id=out1]').click();
  await page.getByRole('button', { name: /Wire Command Receiver · command/ }).click();
  await page.getByText('Code · TypeScript', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Controller TypeScript', exact: true })
    .fill('let n=0;function tick(){n=n+1;if(n<12){write("out1",0);}else{write("out1",1);}}');
  await page.getByRole('button', { name: 'Apply program', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.workshopProbe.readLastCommandResult()?.input.type === 'install-controller-program' &&
      window.workshopProbe.readLastCommandResult()?.result.ok,
  );
  await select('Camera');
  await page.locator('.port-button[data-port-id=trigger]').click();
  await page.getByRole('button', { name: /Wire Command Receiver · signal/ }).click();
  await page.waitForFunction(() => {
    const f = window.workshopProbe.observe().frames[0];
    const id = f.metadata.blueprint.parts.find((p) => p.type === 'camera').id;
    return f.metadata.blueprint.connections.some(
      (c) => c.kind === 'signal' && [c.a.part, c.b.part].includes(id),
    );
  });
  await page.getByRole('button', { name: 'View through camera', exact: true }).click();
  await select('Command Receiver');
  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.mode === 'run',
  );
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.gallery.photos.length === 2,
  );
  await page.waitForFunction(() => window.workshopProbe.observe().cursor.tick > 120);
  assert.equal(
    (await state()).cameraPhoto.gallery.photos.length,
    2,
    'held controller high takes one photo',
  );
  await page.locator('.machine-camera-image').click({ position: { x: 250, y: 100 }, force: true });
  await page.keyboard.down('p');
  await page.keyboard.down('p');
  await page.keyboard.up('p');
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.gallery.photos.length === 3,
  );
  await page.keyboard.down('w');
  await page
    .locator('.machine-camera-bar')
    .getByRole('button', { name: 'Photos', exact: true })
    .click();
  await page.waitForFunction(() =>
    window.workshopProbe
      .observe()
      .frames[0].power.sources.filter((s) => s.node < 12)
      .every((s) => s.duty === 0),
  );
  await page.keyboard.up('w');
  const count = (await state()).cameraPhoto.gallery.photos.length;
  await page.keyboard.press('p');
  assert.equal(
    (await state()).cameraPhoto.gallery.photos.length,
    count,
    'gallery focus never takes a photo',
  );
  await page.getByRole('button', { name: 'Close photos', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Return to workshop view', exact: true }).click();
  await page.getByRole('button', { name: '↶ Build', exact: true }).click();
  await select('Camera');
  await page.getByRole('button', { name: 'View through camera', exact: true }).click();
  await page.getByRole('button', { name: 'Delete part', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().cameraPhoto.active === null,
  );
  assert.equal(
    (await state()).cameraPhoto.gallery.photos.length,
    3,
    'camera removal retains photographs',
  );
  writeFileSync(
    `${out}/summary.json`,
    JSON.stringify(
      {
        occluded,
        repairedSky,
        optics,
        renderCosts,
        renderP95Ms: springQuantile(renderCosts),
        pixels,
        photo: photographed.metadata,
        source: evidence.identity,
        errors: evidence.errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  try {
    evidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
