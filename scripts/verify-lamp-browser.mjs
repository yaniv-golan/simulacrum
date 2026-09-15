import { placeCatalogPartByName } from './catalog-browser-actions.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { liveWait } from './browser-idle.mjs';
const out = browserArtifactPath('artifacts/lamp-browser');
mkdirSync(out, { recursive: true });
const evidence = createBrowserEvidence();
const browser = await evidence.launch({
  profile: 'focus',
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal((await read()).metadata.blueprint.parts.length, 0);
  const select = async (part) => {
    if (!(await page.locator('.machine-picker').evaluate((e) => e.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list-item[data-part-id="${part.id}"]`).click();
  };
  const place = async (name) => {
    await placeCatalogPartByName(page, name);
    return (await read()).metadata.blueprint.parts.at(-1);
  };
  const mount = async (part, target, face = 'top', precise = {}) => {
    await select(part);
    await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
    await page.getByLabel('Mounting face', { exact: true }).selectOption('bottom');
    await page
      .getByLabel('Target surface', { exact: true })
      .selectOption(JSON.stringify([target.id, face]));
    const fields = Object.entries(precise);
    if (fields.length && !(await page.locator('.surface-precise').evaluate((e) => e.open)))
      await page.locator('.surface-precise summary').click();
    for (const [label, value] of fields) await page.getByLabel(label).fill(String(value));
    await page.locator('[data-command=apply-surface]').click();
  };
  const wire = async (part, port, target, targetPort) => {
    await select(part);
    const b = page.locator(`[data-port-id="${port}"]`);
    if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
    await page
      .getByRole('button', {
        name: `Wire ${target.name} · ${targetPort} (parts stay put)`,
        exact: true,
      })
      .click();
  };
  const base = await place('Chassis');
  const lamp = await place('Powered Lamp');
  // Turn 0 aims the beam along -z, across the default camera's view of the floor.
  await mount(lamp, base, 'top', { 'Turn (degrees)': 0 });
  const cell = await place('Power Cell');
  await mount(cell, base, 'bottom');
  await wire(cell, 'power', lamp, 'power');
  await select(lamp);
  await page.screenshot({ path: `${out}/mounted-build.png` });
  await page.locator('[data-command=run]').click();
  await liveWait(page, () => JSON.parse(window.render_game_to_text()).tick >= 12, null, {
    label: 'twelve ticks',
  });
  let f = await read();
  assert.ok(f.power.lamps[0].luminousFluxLm > 990);
  let v = await page.evaluate(() => window.workshopProbe.readInteractionState().lamps[0]);
  assert.equal(v.flux, f.power.lamps[0].luminousFluxLm);
  assert.ok(v.emission > 0);
  // Shadow casting is the presentation budget of the live graphics level, never telemetry.
  const quality = await page.evaluate(
    () => window.workshopProbe.readInteractionState().rendering.quality,
  );
  assert.equal(v.shadows, quality.lampShadowSize > 0);
  assert.equal(v.shadowRefresh, true, 'a lit lamp refreshes its shadow map');
  await page.screenshot({ path: `${out}/default-on.png` });
  await page.locator('[data-command=pause]').click();
  const paused = await read();
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
  });
  const held = await read();
  assert.equal(held.tick, paused.tick);
  assert.equal(held.status, 'ready');
  assert.deepEqual(held.power, paused.power);
  assert.equal(
    (await page.evaluate(() => window.workshopProbe.readInteractionState().lamps[0])).flux,
    paused.power.lamps[0].luminousFluxLm,
  );
  await page.locator('[data-command=build]').click();
  await select(lamp);
  for (const [name, value] of [
    ['brightness', '0.35'],
    ['beamSpread', '0.9'],
  ]) {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(value);
    await input.press('Tab');
  }
  await page.getByLabel('Light color', { exact: true }).fill('#ff3300');
  await page.getByLabel('Light color', { exact: true }).dispatchEvent('change');
  const saved = (await read()).metadata.blueprint;
  assert.deepEqual(saved.parts.find((p) => p.id === lamp.id).parameters, {
    brightness: 0.35,
    color: 0xff3300,
    beamSpread: 0.9,
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/saved.json`);
  await evidence.loadAndWait(page, `${out}/saved.json`);
  assert.deepEqual((await read()).metadata.blueprint, saved);
  const receiver = await place('Command Receiver');
  await wire(receiver, 'signal', lamp, 'signal');
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(100));
  assert.equal((await read()).power.lamps[0].deliveredW, 0);
  await page.keyboard.down('w');
  await page.evaluate(() => window.advanceTime(100));
  assert.ok((await read()).power.lamps[0].deliveredW > 0);
  await page.keyboard.up('w');
  await page.evaluate(() => window.advanceTime(100));
  assert.equal((await read()).power.lamps[0].deliveredW, 0);
  await page.locator('[data-command=build]').click();
  await select(cell);
  await page.getByText('Engineering details', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).fill('0.01');
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).press('Tab');
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('w');
  await page.evaluate(() => window.advanceTime(100));
  const weak = (await read()).power.lamps[0];
  const visual = await page.evaluate(() => window.workshopProbe.readInteractionState().lamps[0]);
  assert.equal(visual.color, 0xff3300);
  assert.equal(visual.angle, 0.9);
  assert.equal(visual.flux, weak.luminousFluxLm);
  assert.ok(visual.emission > 0);

  assert.ok(weak.deliveredW > 0 && weak.deliveredW < 0.25);
  const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  const weakPixels = await page.locator('canvas').first().screenshot();
  await page.keyboard.up('w');
  await page.evaluate(() => window.advanceTime(100));
  const offPixels = await page.locator('canvas').first().screenshot();
  const illumination = await page.evaluate(
    async ({ on, off, centers }) => {
      const decode = async (src) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + src;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
      };
      const a = await decode(on),
        b = await decode(off);
      let brightened = 0,
        redIncrease = 0;
      for (let y = 0; y < a.h; y++)
        for (let x = 0; x < a.w; x++) {
          if (
            centers.some(
              (c) => Math.hypot(x - (c.x * 0.5 + 0.5) * a.w, y - (-c.y * 0.5 + 0.5) * a.h) < 50,
            )
          )
            continue;
          const i = (y * a.w + x) * 4,
            dr = a.data[i] - b.data[i],
            dg = a.data[i + 1] - b.data[i + 1],
            db = a.data[i + 2] - b.data[i + 2];
          if (dr + dg + db > 3 && dr > db) {
            brightened++;
            redIncrease += dr;
          }
        }
      return { brightened, redIncrease };
    },
    { on: weakPixels.toString('base64'), off: offPixels.toString('base64'), centers },
  );
  writeFileSync(
    `${out}/weak-illumination.json`,
    JSON.stringify({ ...evidence.identity, weak, illumination }, null, 2),
  );
  assert.ok(
    illumination.brightened > 300,
    'weak orange beam must illuminate the scene beyond its lens',
  );
  assert.equal(
    (await page.evaluate(() => window.workshopProbe.readInteractionState().lamps[0])).flux,
    0,
  );
  await page.keyboard.up('w');
  await select(lamp);
  assert.match(await page.locator('[data-live-part]').innerText(), /input/);
  await page.screenshot({ path: `${out}/controlled.png` });
  await page.locator('[data-command=build]').click();
  await select(cell);
  await page.getByText('Engineering details', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).fill('20');
  await page.getByRole('spinbutton', { name: 'currentLimit', exact: true }).press('Tab');
  await page.locator('[data-command=run]').click();
  await page.keyboard.down('w');
  await page.evaluate(() => window.advanceTime(100));
  assert.ok((await read()).power.lamps[0].deliveredW > 3);
  await page.keyboard.up('w');
  await page.locator('[data-command=build]').click();
  await select(lamp);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: `${out}/small-settings.png` });
  assert.ok(await page.getByLabel('Light color', { exact: true }).isVisible());
  await page.setViewportSize({ width: 1280, height: 720 });
  // Occlusion: the same floor window, lit by the key-driven lamp, must darken once a
  // plate stands across the cone. Each lit capture is paired with its own unlit capture
  // so grid lines, key-light shadows and UI state cancel; only lamp light remains.
  const frames = (count) =>
    page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
    }, count);
  const floorWindow = async () => {
    const lampPose = (
      await page.evaluate(() => window.workshopProbe.readRenderedTransforms())
    ).find((row) => row.id === lamp.id);
    const direction = rotateVector(lampPose.rotation, [0, 0, 1]),
      lensOffset = rotateVector(lampPose.rotation, [0, 0, 0.045]),
      origin = lampPose.position.map((c, i) => c + lensOffset[i]);
    assert.ok(Math.abs(direction[1]) < 0.01, 'mounted lamp shines level with the floor');
    // The light sits 0.05 m above the chassis top with 0.175 m of chassis ahead of it,
    // so the chassis's own shadow ends 3.5 H from the light (H = light height). The
    // plate top is 0.03 m below the light and its far edge 0.255 m ahead, so its shadow
    // reaches 8.5 H. Sample at 4 H: lit without the plate, dark with it, 14 degrees
    // below the axis of the 0.52 rad cone, as near as the chassis shadow allows.
    const reach = 4 * origin[1];
    const point = [origin[0] + direction[0] * reach, 0, origin[2] + direction[2] * reach];
    const ndc = await page.evaluate((p) => window.workshopProbe.projectWorldPoint(p), point);
    assert.ok(
      Math.abs(ndc.x) < 0.85 && Math.abs(ndc.y) < 0.85,
      `floor window on canvas (${ndc.x}, ${ndc.y})`,
    );
    return { direction, origin, reach, point, ndc };
  };
  const lampLight = async (label) => {
    await page.locator('[data-command=run]').click();
    await page.evaluate(() => window.advanceTime(1500));
    await frames(3);
    const probe = await floorWindow();
    await page.keyboard.down('w');
    await page.evaluate(() => window.advanceTime(100));
    await frames(3);
    const lit = await page.locator('canvas').first().screenshot();
    await page.screenshot({ path: `${out}/${label}-lit.png` });
    const level = await page.evaluate(
      () => window.workshopProbe.readInteractionState().rendering.quality,
    );
    await page.keyboard.up('w');
    await page.evaluate(() => window.advanceTime(100));
    await frames(3);
    const unlit = await page.locator('canvas').first().screenshot();
    await page.locator('[data-command=build]').click();
    const region = await page.evaluate(
      async ({ lit, unlit, ndc }) => {
        const decode = async (src) => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + src;
          await image.decode();
          const c = document.createElement('canvas');
          c.width = image.width;
          c.height = image.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(image, 0, 0);
          return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
        };
        const a = await decode(lit),
          b = await decode(unlit);
        const cx = Math.round((ndc.x * 0.5 + 0.5) * a.w),
          cy = Math.round((-ndc.y * 0.5 + 0.5) * a.h),
          half = 12;
        let sum = 0,
          count = 0,
          dark = 0;
        for (let y = cy - half; y < cy + half; y++)
          for (let x = cx - half; x < cx + half; x++) {
            if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
            const i = (y * a.w + x) * 4;
            const d =
              a.data[i] + a.data[i + 1] + a.data[i + 2] - b.data[i] - b.data[i + 1] - b.data[i + 2];
            sum += d;
            count++;
            if (d < 12) dark++;
          }
        return { cx, cy, count, meanDelta: sum / count, darkFraction: dark / count };
      },
      { lit: lit.toString('base64'), unlit: unlit.toString('base64'), ndc: probe.ndc },
    );
    return { ...probe, ...region, level: level.level, lampShadowSize: level.lampShadowSize };
  };
  // Full brightness and the default cone for a measurable floor window at 4 H.
  await select(lamp);
  for (const [name, value] of [
    ['brightness', '1'],
    ['beamSpread', '0.52'],
  ]) {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(value);
    await input.press('Tab');
  }
  // A fixed camera and no selection label keep the floor window's pixels deterministic.
  const follow = page.getByRole('checkbox', { name: 'Follow motion', exact: true });
  if (await follow.isChecked()) await follow.uncheck();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const open = await lampLight('open');
  assert.equal(open.count, 576, 'floor window is fully on the canvas');
  assert.ok(
    open.meanDelta > 12,
    `lamp lights the floor window (${open.meanDelta} at ${JSON.stringify(open.point)})`,
  );
  const plate = await place('Plate');
  await mount(plate, base, 'top', {
    'Across surface (mm)': Math.round(180 * Math.sign(open.direction[2])),
  });
  const mounted = (await read()).metadata.blueprint.connections.filter((c) => c.kind === 'fixed');
  assert.equal(mounted.length, 3, 'plate is bolted across the beam');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const occluded = await lampLight('occluded');
  const glRenderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  // Both captures must have run with lamp shadows on for the comparison to mean anything;
  // this journey runs exclusively so the adaptive level cannot quietly drop and void it.
  const shadowChecked = open.lampShadowSize > 0 && occluded.lampShadowSize > 0;
  assert.ok(shadowChecked, `lamp shadows stayed on (levels ${open.level}, ${occluded.level})`);
  {
    assert.ok(
      occluded.meanDelta < open.meanDelta * 0.35,
      `plate darkens the floor behind it (${occluded.meanDelta} vs ${open.meanDelta})`,
    );
    assert.ok(
      open.darkFraction < 0.1,
      `lit floor window is free of shadow acne (${open.darkFraction})`,
    );
  }
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        defaultFlux: f.power.lamps[0].luminousFluxLm,
        weak,
        glRenderer,
        shadow: { checked: shadowChecked, open, occluded },
        journey:
          'empty workshop mount wire configure keys save reload weak-supply repair occlusion',
      },
      null,
      2,
    ),
  );
  evidence.assertUnchanged();
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
